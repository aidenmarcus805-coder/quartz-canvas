use std::{collections::VecDeque, fs, path::Path};

use chrono::{DateTime, Utc};
use serde::Serialize;
use thiserror::Error;
use tokio::sync::RwLock;

use crate::{
    domain::{OperationId, ProjectId, SourceIndexVersion},
    fs::{PathDecision, PathPolicy, ProjectPath, SafeProjectRoot},
    runtime::blocking,
};

#[derive(Debug)]
pub struct SourceIndexService {
    current: RwLock<IndexSnapshot>,
    policy: PathPolicy,
}

impl SourceIndexService {
    pub fn new() -> Self {
        Self {
            current: RwLock::new(IndexSnapshot::idle()),
            policy: PathPolicy::strict(),
        }
    }

    pub async fn scan_project(
        &self,
        project_id: ProjectId,
        project_epoch: u64,
        root: SafeProjectRoot,
    ) -> IndexSnapshot {
        let operation_id = OperationId::new();
        self.set_snapshot(IndexSnapshot::scanning(
            project_id.clone(),
            project_epoch,
            operation_id,
        ))
        .await;

        let policy = self.policy.clone();
        let scan = blocking::run(move || scan_root(root.path(), &policy)).await;
        let snapshot = match scan {
            Ok(Ok(summary)) => IndexSnapshot::ready(project_id, project_epoch, summary),
            Ok(Err(error)) => IndexSnapshot::failed(project_id, project_epoch, error.to_string()),
            Err(error) => IndexSnapshot::failed(project_id, project_epoch, error.to_string()),
        };

        self.set_snapshot(snapshot.clone()).await;
        snapshot
    }

    pub async fn snapshot(&self) -> IndexSnapshot {
        self.current.read().await.clone()
    }

    pub async fn clear(&self) {
        self.set_snapshot(IndexSnapshot::idle()).await;
    }

    async fn set_snapshot(&self, snapshot: IndexSnapshot) {
        let mut current = self.current.write().await;
        *current = snapshot;
    }
}

impl Default for SourceIndexService {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexSnapshot {
    pub status: IndexStatus,
    pub project_id: Option<ProjectId>,
    pub project_epoch: Option<u64>,
    pub version: Option<SourceIndexVersion>,
    pub indexed_files: usize,
    pub source_files: usize,
    pub skipped_files: usize,
    pub protected_files: usize,
    pub updated_at: DateTime<Utc>,
}

impl IndexSnapshot {
    fn idle() -> Self {
        Self {
            status: IndexStatus::Idle,
            project_id: None,
            project_epoch: None,
            version: None,
            indexed_files: 0,
            source_files: 0,
            skipped_files: 0,
            protected_files: 0,
            updated_at: Utc::now(),
        }
    }

    fn scanning(project_id: ProjectId, project_epoch: u64, operation_id: OperationId) -> Self {
        Self {
            status: IndexStatus::Scanning { operation_id },
            project_id: Some(project_id),
            project_epoch: Some(project_epoch),
            version: None,
            indexed_files: 0,
            source_files: 0,
            skipped_files: 0,
            protected_files: 0,
            updated_at: Utc::now(),
        }
    }

    fn ready(project_id: ProjectId, project_epoch: u64, summary: ScanSummary) -> Self {
        Self {
            status: IndexStatus::Ready,
            project_id: Some(project_id),
            project_epoch: Some(project_epoch),
            version: Some(SourceIndexVersion::new()),
            indexed_files: summary.indexed_files,
            source_files: summary.source_files,
            skipped_files: summary.skipped_files,
            protected_files: summary.protected_files,
            updated_at: Utc::now(),
        }
    }

    fn failed(project_id: ProjectId, project_epoch: u64, message: String) -> Self {
        Self {
            status: IndexStatus::Failed { message },
            project_id: Some(project_id),
            project_epoch: Some(project_epoch),
            version: None,
            indexed_files: 0,
            source_files: 0,
            skipped_files: 0,
            protected_files: 0,
            updated_at: Utc::now(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case", tag = "state")]
pub enum IndexStatus {
    Idle,
    Scanning { operation_id: OperationId },
    Ready,
    Stale,
    Failed { message: String },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceFileRole {
    Component,
    Style,
    Route,
    Script,
    Markup,
    Other,
}

#[derive(Debug, Error)]
pub enum IndexError {
    #[error("failed to read project directory")]
    ReadDirectory {
        #[source]
        source: std::io::Error,
    },
    #[error("failed to inspect project path")]
    InspectPath {
        #[source]
        source: std::io::Error,
    },
}

#[derive(Default)]
struct ScanSummary {
    indexed_files: usize,
    source_files: usize,
    skipped_files: usize,
    protected_files: usize,
}

fn scan_root(root: &Path, policy: &PathPolicy) -> Result<ScanSummary, IndexError> {
    let mut summary = ScanSummary::default();
    let mut queue = VecDeque::from([root.to_path_buf()]);

    while let Some(directory) = queue.pop_front() {
        let entries =
            fs::read_dir(&directory).map_err(|source| IndexError::ReadDirectory { source })?;

        for entry in entries {
            let entry = entry.map_err(|source| IndexError::InspectPath { source })?;
            let path = entry.path();
            let relative = match path.strip_prefix(root).ok().and_then(parse_relative) {
                Some(relative) => relative,
                None => {
                    summary.skipped_files += 1;
                    continue;
                }
            };

            match policy.classify(&relative) {
                PathDecision::Ignored => {
                    summary.skipped_files += 1;
                    continue;
                }
                PathDecision::Protected => {
                    summary.protected_files += 1;
                    continue;
                }
                PathDecision::Allowed => {}
            }

            let metadata = entry
                .metadata()
                .map_err(|source| IndexError::InspectPath { source })?;

            if metadata.is_dir() {
                queue.push_back(path);
            } else if metadata.is_file() {
                summary.indexed_files += 1;
                if source_role(&path) != SourceFileRole::Other {
                    summary.source_files += 1;
                }
            }
        }
    }

    Ok(summary)
}

fn parse_relative(path: &Path) -> Option<ProjectPath> {
    let raw = path.to_string_lossy().replace('\\', "/");
    ProjectPath::parse(&raw).ok()
}

fn source_role(path: &Path) -> SourceFileRole {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase);

    match extension.as_deref() {
        Some("tsx" | "jsx" | "vue" | "svelte" | "astro") => SourceFileRole::Component,
        Some("css" | "scss" | "sass" | "less") => SourceFileRole::Style,
        Some("html" | "htm") => SourceFileRole::Markup,
        Some("js" | "mjs" | "cjs" | "ts") => SourceFileRole::Script,
        _ => SourceFileRole::Other,
    }
}
