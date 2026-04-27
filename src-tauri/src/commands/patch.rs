use tauri::State;

use crate::{
    app_state::AppState,
    error::CommandError,
    patch::{
        ApplyPatchRequest, PatchApplyResponse, PatchRollbackResponse, PatchRollbackStackResponse,
        RollbackPatchRequest, RollbackPatchStackRequest, ValidatePatchRequest, ValidationReport,
    },
};

#[tauri::command]
pub async fn validate_patch(
    state: State<'_, AppState>,
    request: ValidatePatchRequest,
) -> Result<ValidationReport, CommandError> {
    let active = state.projects.active_project().await?;
    Ok(state.patches.validate(&active, &request.proposal))
}

#[tauri::command]
pub async fn apply_patch(
    state: State<'_, AppState>,
    request: ApplyPatchRequest,
) -> Result<PatchApplyResponse, CommandError> {
    let active = state.projects.active_project().await?;
    state
        .patches
        .apply(&active, request)
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn rollback_patch(
    state: State<'_, AppState>,
    request: RollbackPatchRequest,
) -> Result<PatchRollbackResponse, CommandError> {
    state.patches.rollback(request).map_err(CommandError::from)
}

#[tauri::command]
pub async fn rollback_patch_stack(
    state: State<'_, AppState>,
    request: RollbackPatchStackRequest,
) -> Result<PatchRollbackStackResponse, CommandError> {
    state
        .patches
        .rollback_stack(request)
        .map_err(CommandError::from)
}
