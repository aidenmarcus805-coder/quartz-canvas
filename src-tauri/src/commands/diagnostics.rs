use serde::Deserialize;
use tauri::State;

use crate::{app_state::AppState, diagnostics::DiagnosticsSnapshot, error::CommandError};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedactDiagnosticRequest {
    pub message: String,
}

#[tauri::command]
pub async fn redact_diagnostic(
    state: State<'_, AppState>,
    request: RedactDiagnosticRequest,
) -> Result<DiagnosticsSnapshot, CommandError> {
    Ok(state.diagnostics.redact_message(&request.message))
}
