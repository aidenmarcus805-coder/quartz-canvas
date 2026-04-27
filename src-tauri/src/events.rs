use chrono::{DateTime, Utc};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use thiserror::Error;

use crate::domain::{EventId, OperationId, ProjectId, RequestId};

#[derive(Clone, Debug)]
pub struct AppEventEmitter;

impl AppEventEmitter {
    pub fn emit<T>(
        &self,
        app: &AppHandle,
        name: AppEventName,
        envelope: AppEvent<T>,
    ) -> Result<(), EventError>
    where
        T: Serialize + Clone,
    {
        app.emit(name.as_str(), envelope)
            .map_err(|source| EventError::Emit { source })
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppEvent<T>
where
    T: Serialize,
{
    pub event_id: EventId,
    pub project_id: Option<ProjectId>,
    pub request_id: Option<RequestId>,
    pub sequence: u64,
    pub project_epoch: Option<u64>,
    pub operation_id: Option<OperationId>,
    pub emitted_at: DateTime<Utc>,
    pub payload: T,
}

impl<T> AppEvent<T>
where
    T: Serialize,
{
    pub fn new(payload: T) -> Self {
        Self {
            event_id: EventId::new(),
            project_id: None,
            request_id: None,
            sequence: 0,
            project_epoch: None,
            operation_id: None,
            emitted_at: Utc::now(),
            payload,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub enum AppEventName {
    ProjectStatusChanged,
    ProjectIndexProgress,
    DevServerStatusChanged,
    DevServerLogLine,
    AiRequestStarted,
    AiProgress,
    AiProposalReady,
    AiRequestFailed,
    PatchValidationFinished,
    PatchApplied,
    PatchRollbackFinished,
    SettingsChanged,
}

impl AppEventName {
    fn as_str(self) -> &'static str {
        match self {
            AppEventName::ProjectStatusChanged => "project.status_changed",
            AppEventName::ProjectIndexProgress => "project.index_progress",
            AppEventName::DevServerStatusChanged => "dev_server.status_changed",
            AppEventName::DevServerLogLine => "dev_server.log_line",
            AppEventName::AiRequestStarted => "ai.request_started",
            AppEventName::AiProgress => "ai.progress",
            AppEventName::AiProposalReady => "ai.proposal_ready",
            AppEventName::AiRequestFailed => "ai.request_failed",
            AppEventName::PatchValidationFinished => "patch.validation_finished",
            AppEventName::PatchApplied => "patch.applied",
            AppEventName::PatchRollbackFinished => "patch.rollback_finished",
            AppEventName::SettingsChanged => "settings.changed",
        }
    }
}

#[derive(Debug, Error)]
pub enum EventError {
    #[error("failed to emit app event")]
    Emit {
        #[source]
        source: tauri::Error,
    },
}
