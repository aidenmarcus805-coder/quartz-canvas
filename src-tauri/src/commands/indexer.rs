use tauri::State;

use crate::{app_state::AppState, error::CommandError, indexer::IndexSnapshot};

#[tauri::command]
pub async fn get_index_status(state: State<'_, AppState>) -> Result<IndexSnapshot, CommandError> {
    Ok(state.indexer.snapshot().await)
}

#[tauri::command]
pub async fn refresh_source_index(
    state: State<'_, AppState>,
) -> Result<IndexSnapshot, CommandError> {
    let active = state.projects.active_project().await?;
    Ok(state
        .indexer
        .scan_project(active.project_id, active.project_epoch, active.root)
        .await)
}
