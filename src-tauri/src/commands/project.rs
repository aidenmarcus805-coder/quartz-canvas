use std::{path::PathBuf, process::Command};

use serde::Deserialize;
use tauri::State;

use crate::{
    app_state::AppState,
    error::{CommandError, ErrorCode},
    fs::{PathPolicy, SafeProjectRoot},
    project::{OpenProjectRequest, OpenProjectResponse, ProjectSnapshot},
    runtime::blocking,
};

#[tauri::command]
pub async fn open_project(
    state: State<'_, AppState>,
    request: OpenProjectRequest,
) -> Result<OpenProjectResponse, CommandError> {
    if let Ok(active) = state.projects.active_project().await {
        state
            .dev_servers
            .stop(&active.project_id)
            .await
            .map_err(CommandError::from)?;
    }

    state
        .projects
        .open(request)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn close_project(state: State<'_, AppState>) -> Result<ProjectSnapshot, CommandError> {
    if let Ok(active) = state.projects.active_project().await {
        state
            .dev_servers
            .stop(&active.project_id)
            .await
            .map_err(CommandError::from)?;
    }

    state.projects.close().await.map_err(CommandError::from)
}

#[tauri::command]
pub async fn get_project_status(
    state: State<'_, AppState>,
) -> Result<ProjectSnapshot, CommandError> {
    Ok(state.projects.snapshot().await)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProjectInExplorerRequest {
    pub root_path: PathBuf,
}

#[tauri::command]
pub async fn open_project_in_explorer(
    request: OpenProjectInExplorerRequest,
) -> Result<(), CommandError> {
    let root_path = request.root_path;
    let policy = PathPolicy::strict();
    let root = blocking::run(move || SafeProjectRoot::open(root_path, &policy))
        .await
        .map_err(|_| {
            CommandError::new(
                ErrorCode::InvalidRequest,
                "could not validate project path",
                true,
            )
        })?
        .map_err(CommandError::from)?;

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer.exe");
        command.arg(root.path());
        command
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(root.path());
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(root.path());
        command
    };

    command.spawn().map(|_| ()).map_err(|_| {
        CommandError::new(
            ErrorCode::InvalidRequest,
            "could not open project folder",
            true,
        )
    })
}
