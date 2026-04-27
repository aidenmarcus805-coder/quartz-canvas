use tauri::State;

use crate::{
    app_state::AppState,
    dev_server::{DevServerSnapshot, StartDevServerRequest},
    error::CommandError,
};

#[tauri::command]
pub async fn start_dev_server(
    state: State<'_, AppState>,
    request: StartDevServerRequest,
) -> Result<DevServerSnapshot, CommandError> {
    let active = state.projects.active_project().await?;
    state
        .dev_servers
        .start(active, request)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn stop_dev_server(
    state: State<'_, AppState>,
) -> Result<DevServerSnapshot, CommandError> {
    let active = state.projects.active_project().await?;
    state
        .dev_servers
        .stop(&active.project_id)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn restart_dev_server(
    state: State<'_, AppState>,
    request: StartDevServerRequest,
) -> Result<DevServerSnapshot, CommandError> {
    let active = state.projects.active_project().await?;
    state
        .dev_servers
        .stop(&active.project_id)
        .await
        .map_err(CommandError::from)?;
    state
        .dev_servers
        .start(active, request)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn get_dev_server_status(
    state: State<'_, AppState>,
) -> Result<DevServerSnapshot, CommandError> {
    let active = state.projects.active_project().await.ok();
    Ok(state
        .dev_servers
        .snapshot(active.as_ref().map(|project| &project.project_id))
        .await)
}
