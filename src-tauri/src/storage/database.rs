use std::{path::Path, path::PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    Executor, Row, SqlitePool,
};
use thiserror::Error;

use crate::{
    domain::{ids::IdParseError, ProjectId},
    fs::SafeProjectRoot,
    project::detect::{FrameworkKind, PackageManager, ProjectManifest},
};

use super::migrations::INIT_SCHEMA;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAuthUser {
    pub id: String,
    pub email: Option<String>,
    pub name: Option<String>,
    pub image: Option<String>,
    pub plan: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAuthSession {
    pub user: StoredAuthUser,
    pub updated_at: String,
}

#[derive(Debug)]
pub struct Database {
    pool: SqlitePool,
    data_dir: PathBuf,
}

impl Database {
    pub async fn open(data_dir: impl AsRef<Path>) -> Result<Self, StorageError> {
        let data_dir = data_dir.as_ref().to_path_buf();
        tokio::fs::create_dir_all(&data_dir)
            .await
            .map_err(|source| StorageError::CreateDirectory { source })?;

        let database_path = data_dir.join("quartz-canvas.sqlite3");
        let options = SqliteConnectOptions::new()
            .filename(&database_path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .foreign_keys(true);

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await
            .map_err(|source| StorageError::Connect { source })?;

        let database = Self { pool, data_dir };
        database.migrate().await?;
        Ok(database)
    }

    pub fn rollback_dir(&self) -> PathBuf {
        self.data_dir.join("rollback")
    }

    pub async fn upsert_project(
        &self,
        root: &SafeProjectRoot,
        manifest: &ProjectManifest,
    ) -> Result<ProjectId, StorageError> {
        let root_path = root.path().to_string_lossy().to_string();
        let now = Utc::now().to_rfc3339();

        if let Some(row) = sqlx::query("SELECT id FROM projects WHERE root_path = ?")
            .bind(&root_path)
            .fetch_optional(&self.pool)
            .await
            .map_err(|source| StorageError::Query { source })?
        {
            let id = row
                .try_get::<String, _>("id")
                .map_err(|source| StorageError::Decode { source })?;
            sqlx::query("UPDATE projects SET last_opened_at = ? WHERE id = ?")
                .bind(&now)
                .bind(&id)
                .execute(&self.pool)
                .await
                .map_err(|source| StorageError::Query { source })?;
            return ProjectId::parse(&id).map_err(StorageError::InvalidId);
        }

        let project_id = ProjectId::new();
        sqlx::query(
            "INSERT INTO projects(id, root_path, display_name, framework, package_manager, created_at, last_opened_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(project_id.to_string())
        .bind(root_path)
        .bind(root.label())
        .bind(framework_to_storage(manifest.framework))
        .bind(manifest.package_manager.map(package_manager_to_storage))
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|source| StorageError::Query { source })?;

        Ok(project_id)
    }

    pub async fn auth_session(&self) -> Result<Option<StoredAuthSession>, StorageError> {
        let row = sqlx::query("SELECT user_json, updated_at FROM auth_session WHERE id = 1")
            .fetch_optional(&self.pool)
            .await
            .map_err(|source| StorageError::Query { source })?;

        let Some(row) = row else {
            return Ok(None);
        };

        let user_json = row
            .try_get::<String, _>("user_json")
            .map_err(|source| StorageError::Decode { source })?;
        let updated_at = row
            .try_get::<String, _>("updated_at")
            .map_err(|source| StorageError::Decode { source })?;
        let user = serde_json::from_str::<StoredAuthUser>(&user_json)
            .map_err(|source| StorageError::Json { source })?;

        Ok(Some(StoredAuthSession { user, updated_at }))
    }

    pub async fn save_auth_session(
        &self,
        token: &str,
        user: &StoredAuthUser,
    ) -> Result<StoredAuthSession, StorageError> {
        let updated_at = Utc::now().to_rfc3339();
        let user_json =
            serde_json::to_string(user).map_err(|source| StorageError::Json { source })?;

        sqlx::query(
            "INSERT INTO auth_session(id, token, user_json, updated_at)
             VALUES (1, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET token = excluded.token, user_json = excluded.user_json, updated_at = excluded.updated_at",
        )
        .bind(token)
        .bind(user_json)
        .bind(&updated_at)
        .execute(&self.pool)
        .await
        .map_err(|source| StorageError::Query { source })?;

        Ok(StoredAuthSession {
            user: user.clone(),
            updated_at,
        })
    }

    pub async fn clear_auth_session(&self) -> Result<(), StorageError> {
        sqlx::query("DELETE FROM auth_session WHERE id = 1")
            .execute(&self.pool)
            .await
            .map_err(|source| StorageError::Query { source })?;
        Ok(())
    }

    pub async fn get_or_create_device_id(&self) -> Result<String, StorageError> {
        if let Some(row) = sqlx::query("SELECT value_json FROM settings WHERE key = ?")
            .bind("auth.device_id")
            .fetch_optional(&self.pool)
            .await
            .map_err(|source| StorageError::Query { source })?
        {
            let value_json = row
                .try_get::<String, _>("value_json")
                .map_err(|source| StorageError::Decode { source })?;
            let value = serde_json::from_str::<String>(&value_json)
                .map_err(|source| StorageError::Json { source })?;
            if !value.trim().is_empty() {
                return Ok(value);
            }
        }

        let device_id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let value_json =
            serde_json::to_string(&device_id).map_err(|source| StorageError::Json { source })?;

        sqlx::query(
            "INSERT INTO settings(key, value_json, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
        )
        .bind("auth.device_id")
        .bind(value_json)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|source| StorageError::Query { source })?;

        Ok(device_id)
    }

    async fn migrate(&self) -> Result<(), StorageError> {
        for statement in INIT_SCHEMA.split(';').map(str::trim) {
            if statement.is_empty() {
                continue;
            }

            self.pool
                .execute(statement)
                .await
                .map_err(|source| StorageError::Migration { source })?;
        }

        Ok(())
    }
}

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("failed to create app data directory")]
    CreateDirectory {
        #[source]
        source: std::io::Error,
    },
    #[error("failed to connect to SQLite database")]
    Connect {
        #[source]
        source: sqlx::Error,
    },
    #[error("failed to apply SQLite migration")]
    Migration {
        #[source]
        source: sqlx::Error,
    },
    #[error("failed to execute SQLite query")]
    Query {
        #[source]
        source: sqlx::Error,
    },
    #[error("failed to decode SQLite row")]
    Decode {
        #[source]
        source: sqlx::Error,
    },
    #[error("failed to encode or decode stored JSON")]
    Json {
        #[source]
        source: serde_json::Error,
    },
    #[error("stored identifier is invalid")]
    InvalidId(#[source] IdParseError),
}

fn framework_to_storage(framework: FrameworkKind) -> &'static str {
    match framework {
        FrameworkKind::Astro => "astro",
        FrameworkKind::Next => "next",
        FrameworkKind::PlainStatic => "plain_static",
        FrameworkKind::Remix => "remix",
        FrameworkKind::SvelteKit => "svelte_kit",
        FrameworkKind::Unknown => "unknown",
        FrameworkKind::Vite => "vite",
    }
}

fn package_manager_to_storage(package_manager: PackageManager) -> &'static str {
    match package_manager {
        PackageManager::Bun => "bun",
        PackageManager::Npm => "npm",
        PackageManager::Pnpm => "pnpm",
        PackageManager::Yarn => "yarn",
    }
}
