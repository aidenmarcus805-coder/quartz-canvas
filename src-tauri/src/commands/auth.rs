use std::{env, process::Command};

use serde::{Deserialize, Serialize};
use tauri::State;
use url::Url;

use crate::{
    app_state::AppState,
    error::{CommandError, ErrorCode},
    storage::{StoredAuthSession, StoredAuthUser},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSessionSnapshot {
    pub authenticated: bool,
    pub user: Option<StoredAuthUser>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthValidationResponse {
    pub activated: bool,
    pub error: Option<String>,
    pub user: Option<StoredAuthUser>,
    pub session: Option<AuthSessionSnapshot>,
}

#[derive(Debug, Deserialize)]
struct ValidateDesktopTokenResponse {
    user: Option<ApiAuthUser>,
    error: Option<String>,
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ApiAuthUser {
    id: Option<String>,
    email: Option<String>,
    name: Option<String>,
    image: Option<String>,
    plan: Option<String>,
}

#[tauri::command]
pub async fn get_auth_session(
    state: State<'_, AppState>,
) -> Result<AuthSessionSnapshot, CommandError> {
    let session = state.storage.auth_session().await?;
    Ok(snapshot_from_session(session))
}

#[tauri::command]
pub async fn sign_out(state: State<'_, AppState>) -> Result<(), CommandError> {
    state.storage.clear_auth_session().await?;
    Ok(())
}

#[tauri::command]
pub async fn verify_license_key(
    state: State<'_, AppState>,
    key: String,
) -> Result<AuthValidationResponse, CommandError> {
    let token = key.trim();
    if token.is_empty() {
        return Ok(AuthValidationResponse {
            activated: false,
            error: Some("Connection code is required.".to_string()),
            user: None,
            session: None,
        });
    }

    let endpoint = auth_validation_endpoint();
    let device_id = state.storage.get_or_create_device_id().await?;
    let body = serde_json::json!({
        "token": token,
        "machineId": device_id,
        "deviceName": device_name(),
        "app": "quartz-canvas",
    });

    let response = reqwest::Client::new()
        .post(endpoint)
        .json(&body)
        .send()
        .await
        .map_err(|_| {
            CommandError::new(
                ErrorCode::InvalidRequest,
                "could not reach Quartz auth service",
                true,
            )
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        let message = if error_text.trim().is_empty() {
            format!("auth service rejected the session: {status}")
        } else {
            format!("auth service rejected the session: {status} {error_text}")
        };

        return Ok(AuthValidationResponse {
            activated: false,
            error: Some(message),
            user: None,
            session: None,
        });
    }

    let payload = response
        .json::<ValidateDesktopTokenResponse>()
        .await
        .map_err(|_| {
            CommandError::new(
                ErrorCode::InvalidRequest,
                "auth service returned an invalid response",
                true,
            )
        })?;

    let Some(api_user) = payload.user else {
        return Ok(AuthValidationResponse {
            activated: false,
            error: payload
                .error
                .or(payload.message)
                .or_else(|| Some("Invalid or expired connection code.".to_string())),
            user: None,
            session: None,
        });
    };

    let Some(user) = normalize_user(api_user) else {
        return Ok(AuthValidationResponse {
            activated: false,
            error: Some("Auth response was missing a user id.".to_string()),
            user: None,
            session: None,
        });
    };

    let session = state.storage.save_auth_session(token, &user).await?;
    let snapshot = snapshot_from_session(Some(session));

    Ok(AuthValidationResponse {
        activated: true,
        error: None,
        user: Some(user),
        session: Some(snapshot),
    })
}

#[tauri::command]
pub async fn open_auth_url(url: Option<String>) -> Result<(), CommandError> {
    let target = url
        .as_deref()
        .unwrap_or("https://quartzeditor.com/signin?callbackUrl=/api/desktop/token");

    if !is_allowed_auth_url(target) {
        return Err(CommandError::new(
            ErrorCode::InvalidRequest,
            "auth URL must use the Quartz auth domain",
            true,
        ));
    }

    open_url(target)
}

fn snapshot_from_session(session: Option<StoredAuthSession>) -> AuthSessionSnapshot {
    match session {
        Some(session) => AuthSessionSnapshot {
            authenticated: true,
            user: Some(session.user),
            updated_at: Some(session.updated_at),
        },
        None => AuthSessionSnapshot {
            authenticated: false,
            user: None,
            updated_at: None,
        },
    }
}

fn normalize_user(user: ApiAuthUser) -> Option<StoredAuthUser> {
    let id = user.id?.trim().to_string();
    if id.is_empty() {
        return None;
    }

    Some(StoredAuthUser {
        id,
        email: user.email.filter(|value| !value.trim().is_empty()),
        name: user.name.filter(|value| !value.trim().is_empty()),
        image: user.image.filter(|value| !value.trim().is_empty()),
        plan: user
            .plan
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "Pro Plan".to_string()),
    })
}

fn auth_validation_endpoint() -> String {
    let base_url = if cfg!(debug_assertions) {
        env::var("QUARTZ_AUTH_URL")
            .or_else(|_| env::var("VITE_AUTH_URL"))
            .unwrap_or_else(|_| "https://quartzeditor.com".to_string())
    } else {
        "https://quartzeditor.com".to_string()
    };

    format!("{}/api/desktop/validate", base_url.trim_end_matches('/'))
}

fn device_name() -> String {
    env::var("COMPUTERNAME")
        .or_else(|_| env::var("HOSTNAME"))
        .unwrap_or_else(|_| "Quartz Canvas desktop".to_string())
}

fn is_allowed_auth_url(target: &str) -> bool {
    let Ok(url) = Url::parse(target) else {
        return false;
    };

    let host = url.host_str().unwrap_or_default();
    let production_host =
        url.scheme() == "https" && matches!(host, "quartzeditor.com" | "www.quartzeditor.com");

    #[cfg(debug_assertions)]
    {
        production_host || (url.scheme() == "http" && matches!(host, "localhost" | "127.0.0.1"))
    }

    #[cfg(not(debug_assertions))]
    {
        production_host
    }
}

fn open_url(target: &str) -> Result<(), CommandError> {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("rundll32.exe");
        command.args(["url.dll,FileProtocolHandler", target]);
        command
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(target);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(target);
        command
    };

    command.spawn().map(|_| ()).map_err(|_| {
        CommandError::new(
            ErrorCode::InvalidRequest,
            "could not open auth URL in the system browser",
            true,
        )
    })
}
