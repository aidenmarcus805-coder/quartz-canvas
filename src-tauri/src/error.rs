use serde::Serialize;

use crate::{
    ai::{AiError, ModelProfileError},
    dev_server::DevServerError,
    fs::PathError,
    patch::PatchError,
    project::ProjectError,
    storage::StorageError,
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: ErrorCode,
    pub message: String,
    pub recoverable: bool,
    pub details: Option<serde_json::Value>,
}

impl CommandError {
    pub fn new(code: ErrorCode, message: impl Into<String>, recoverable: bool) -> Self {
        Self {
            code,
            message: message.into(),
            recoverable,
            details: None,
        }
    }

    pub fn with_details(mut self, details: serde_json::Value) -> Self {
        self.details = Some(details);
        self
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    ProjectNotOpen,
    InvalidProjectRoot,
    FrameworkUnsupported,
    DevServerStartFailed,
    DevServerExited,
    DevCommandApprovalRequired,
    PathOutsideProject,
    ProtectedPath,
    FileConflict,
    PatchRejected,
    RollbackUnavailable,
    DatabaseUnavailable,
    AiRuntimeUnavailable,
    ModelProfileUnsupported,
    BridgeUnavailable,
    OperationCanceled,
    IndexUnavailable,
    InvalidRequest,
}

impl From<ModelProfileError> for CommandError {
    fn from(error: ModelProfileError) -> Self {
        match error {
            ModelProfileError::InsufficientVram { detected_gb } => Self::new(
                ErrorCode::ModelProfileUnsupported,
                format!("Qwopus requires at least 8 GB dedicated VRAM; detected {detected_gb} GB"),
                true,
            ),
        }
    }
}

impl From<ProjectError> for CommandError {
    fn from(error: ProjectError) -> Self {
        match error {
            ProjectError::ProjectNotOpen => {
                Self::new(ErrorCode::ProjectNotOpen, "project is not open", true)
            }
            ProjectError::ProjectBusy => Self::new(
                ErrorCode::InvalidRequest,
                "project operation is already running",
                true,
            ),
            ProjectError::Path(error) => Self::from(error),
            ProjectError::Detect(_) => Self::new(
                ErrorCode::FrameworkUnsupported,
                "project detection failed",
                true,
            ),
            ProjectError::Storage(error) => Self::from(error),
            ProjectError::Blocking(_) => {
                Self::new(ErrorCode::InvalidRequest, "background work failed", true)
            }
        }
    }
}

impl From<PathError> for CommandError {
    fn from(error: PathError) -> Self {
        match error {
            PathError::PathTraversal | PathError::PathOutsideProject => Self::new(
                ErrorCode::PathOutsideProject,
                "path is outside the active project",
                true,
            ),
            PathError::ProtectedPath | PathError::IgnoredPath => {
                Self::new(ErrorCode::ProtectedPath, "path is protected", true)
            }
            _ => Self::new(
                ErrorCode::InvalidProjectRoot,
                "project path is invalid or unsafe",
                true,
            ),
        }
    }
}

impl From<StorageError> for CommandError {
    fn from(_error: StorageError) -> Self {
        Self::new(
            ErrorCode::DatabaseUnavailable,
            "local database is unavailable",
            false,
        )
    }
}

impl From<DevServerError> for CommandError {
    fn from(error: DevServerError) -> Self {
        match error {
            DevServerError::ApprovalRequired { fingerprint } => Self::new(
                ErrorCode::DevCommandApprovalRequired,
                "dev command requires approval",
                true,
            )
            .with_details(serde_json::json!({ "fingerprint": fingerprint })),
            DevServerError::ReadyTimeout => Self::new(
                ErrorCode::DevServerStartFailed,
                "dev server readiness timed out",
                true,
            ),
            DevServerError::PortUnavailable { port } => Self::new(
                ErrorCode::DevServerStartFailed,
                format!("dev server port {port} is already in use"),
                true,
            ),
            DevServerError::ExitedEarly { code } => Self::new(
                ErrorCode::DevServerExited,
                format!("dev server exited before it was ready: {code:?}"),
                true,
            ),
            _ => Self::new(
                ErrorCode::DevServerStartFailed,
                "dev server could not be started or stopped",
                true,
            ),
        }
    }
}

impl From<AiError> for CommandError {
    fn from(error: AiError) -> Self {
        match error {
            AiError::RuntimeUnavailable => Self::new(
                ErrorCode::AiRuntimeUnavailable,
                "local AI runtime is unavailable",
                true,
            ),
            AiError::StaleProjectEpoch => Self::new(
                ErrorCode::OperationCanceled,
                "AI request references a stale project epoch",
                true,
            ),
            AiError::EmptyInstruction => {
                Self::new(ErrorCode::InvalidRequest, "AI instruction is empty", true)
            }
        }
    }
}

impl From<PatchError> for CommandError {
    fn from(error: PatchError) -> Self {
        match error {
            PatchError::ReviewRequired => Self::new(
                ErrorCode::PatchRejected,
                "patch review approval is required",
                true,
            ),
            PatchError::Rejected { report } => {
                let details = serde_json::to_value(&report).ok();
                let mut command_error =
                    Self::new(ErrorCode::PatchRejected, "patch validation failed", true);
                command_error.details = details;
                command_error
            }
            PatchError::ApplyEngineUnavailable => Self::new(
                ErrorCode::PatchRejected,
                "patch application is blocked until durable rollback is available",
                true,
            ),
            PatchError::RollbackUnavailable => Self::new(
                ErrorCode::RollbackUnavailable,
                "rollback data is unavailable",
                true,
            ),
        }
    }
}
