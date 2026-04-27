use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::RwLock;

use crate::{
    domain::{ProjectId, RequestId},
    fs::{PathError, PathPolicy, SafeProjectRoot},
    indexer::{IndexSnapshot, SourceIndexService},
    project::detect::{
        detect_project, ApplicationSurfaceKind, DetectError, FrameworkKind, PackageManager,
        ProjectManifest,
    },
    runtime::blocking,
    storage::{Database, StorageError},
};

#[derive(Debug)]
pub struct ProjectService {
    state: RwLock<ProjectRuntimeState>,
    storage: Arc<Database>,
    indexer: Arc<SourceIndexService>,
    path_policy: PathPolicy,
    next_epoch: AtomicU64,
}

impl ProjectService {
    pub fn new(storage: Arc<Database>, indexer: Arc<SourceIndexService>) -> Self {
        Self {
            state: RwLock::new(ProjectRuntimeState::Empty),
            storage,
            indexer,
            path_policy: PathPolicy::strict(),
            next_epoch: AtomicU64::new(0),
        }
    }

    pub async fn open(
        &self,
        request: OpenProjectRequest,
    ) -> Result<OpenProjectResponse, ProjectError> {
        {
            let state = self.state.read().await;
            if matches!(
                *state,
                ProjectRuntimeState::Opening { .. } | ProjectRuntimeState::Closing { .. }
            ) {
                return Err(ProjectError::ProjectBusy);
            }
        }

        let request_id = RequestId::new();
        self.set_state(ProjectRuntimeState::Opening {
            request_id: request_id.clone(),
        })
        .await;

        let response = self.open_after_state_transition(request).await;
        if let Err(error) = &response {
            self.set_state(ProjectRuntimeState::Failed {
                reason: ProjectFailure::from_error(error),
            })
            .await;
        }

        response
    }

    async fn open_after_state_transition(
        &self,
        request: OpenProjectRequest,
    ) -> Result<OpenProjectResponse, ProjectError> {
        let root_path = request.root_path.clone();
        let policy = self.path_policy.clone();
        let root = blocking::run(move || SafeProjectRoot::open(root_path, &policy))
            .await?
            .map_err(ProjectError::Path)?;

        let root_for_detection = root.path().to_path_buf();
        let manifest = blocking::run(move || detect_project(&root_for_detection))
            .await?
            .map_err(ProjectError::Detect)?;

        let project_id = self.storage.upsert_project(&root, &manifest).await?;
        let project_epoch = self.next_epoch.fetch_add(1, Ordering::SeqCst) + 1;
        let index = self
            .indexer
            .scan_project(project_id.clone(), project_epoch, root.clone())
            .await;

        let active = ActiveProject {
            project_id: project_id.clone(),
            project_epoch,
            root,
            manifest: manifest.clone(),
            opened_at: Utc::now(),
        };
        self.set_state(ProjectRuntimeState::Open {
            active: Box::new(active),
            index: Box::new(index.clone()),
        })
        .await;

        Ok(OpenProjectResponse {
            project_id,
            project_epoch,
            root_label: manifest.root_label,
            framework: manifest.framework,
            surface_kind: manifest.surface_kind,
            surface_signals: manifest.surface_signals,
            package_manager: manifest.package_manager,
            available_scripts: manifest.available_scripts,
            index,
        })
    }

    pub async fn close(&self) -> Result<ProjectSnapshot, ProjectError> {
        let active = self.active_project().await?;
        self.set_state(ProjectRuntimeState::Closing {
            project_id: active.project_id,
        })
        .await;
        self.indexer.clear().await;
        self.set_state(ProjectRuntimeState::Empty).await;
        Ok(self.snapshot().await)
    }

    pub async fn snapshot(&self) -> ProjectSnapshot {
        let state = self.state.read().await;
        match &*state {
            ProjectRuntimeState::Empty => ProjectSnapshot::empty(),
            ProjectRuntimeState::Opening { request_id } => ProjectSnapshot {
                status: ProjectStatus::Opening,
                request_id: Some(request_id.clone()),
                ..ProjectSnapshot::empty()
            },
            ProjectRuntimeState::Open { active, index } => active.snapshot((**index).clone()),
            ProjectRuntimeState::Closing { project_id } => ProjectSnapshot {
                status: ProjectStatus::Closing,
                project_id: Some(project_id.clone()),
                ..ProjectSnapshot::empty()
            },
            ProjectRuntimeState::Failed { reason } => ProjectSnapshot {
                status: ProjectStatus::Failed,
                failure: Some(reason.clone()),
                ..ProjectSnapshot::empty()
            },
        }
    }

    pub async fn active_project(&self) -> Result<ActiveProject, ProjectError> {
        let state = self.state.read().await;
        match &*state {
            ProjectRuntimeState::Open { active, .. } => Ok((**active).clone()),
            _ => Err(ProjectError::ProjectNotOpen),
        }
    }

    async fn set_state(&self, state: ProjectRuntimeState) {
        let mut current = self.state.write().await;
        *current = state;
    }
}

#[derive(Clone, Debug)]
pub enum ProjectRuntimeState {
    Empty,
    Opening {
        request_id: RequestId,
    },
    Open {
        active: Box<ActiveProject>,
        index: Box<IndexSnapshot>,
    },
    Closing {
        project_id: ProjectId,
    },
    Failed {
        reason: ProjectFailure,
    },
}

#[derive(Clone, Debug)]
pub struct ActiveProject {
    pub project_id: ProjectId,
    pub project_epoch: u64,
    pub root: SafeProjectRoot,
    pub manifest: ProjectManifest,
    pub opened_at: DateTime<Utc>,
}

impl ActiveProject {
    fn snapshot(&self, index: IndexSnapshot) -> ProjectSnapshot {
        ProjectSnapshot {
            status: ProjectStatus::Open,
            project_id: Some(self.project_id.clone()),
            project_epoch: Some(self.project_epoch),
            root_label: Some(self.manifest.root_label.clone()),
            framework: Some(self.manifest.framework),
            surface_kind: Some(self.manifest.surface_kind),
            surface_signals: self.manifest.surface_signals.clone(),
            package_manager: self.manifest.package_manager,
            available_scripts: self.manifest.available_scripts.clone(),
            index: Some(index),
            request_id: None,
            failure: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProjectRequest {
    pub root_path: std::path::PathBuf,
    pub preferred_script: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProjectResponse {
    pub project_id: ProjectId,
    pub project_epoch: u64,
    pub root_label: String,
    pub framework: FrameworkKind,
    pub surface_kind: ApplicationSurfaceKind,
    pub surface_signals: Vec<String>,
    pub package_manager: Option<PackageManager>,
    pub available_scripts: Vec<String>,
    pub index: IndexSnapshot,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshot {
    pub status: ProjectStatus,
    pub project_id: Option<ProjectId>,
    pub project_epoch: Option<u64>,
    pub root_label: Option<String>,
    pub framework: Option<FrameworkKind>,
    pub surface_kind: Option<ApplicationSurfaceKind>,
    pub surface_signals: Vec<String>,
    pub package_manager: Option<PackageManager>,
    pub available_scripts: Vec<String>,
    pub index: Option<IndexSnapshot>,
    pub request_id: Option<RequestId>,
    pub failure: Option<ProjectFailure>,
}

impl ProjectSnapshot {
    fn empty() -> Self {
        Self {
            status: ProjectStatus::Empty,
            project_id: None,
            project_epoch: None,
            root_label: None,
            framework: None,
            surface_kind: None,
            surface_signals: Vec::new(),
            package_manager: None,
            available_scripts: Vec::new(),
            index: None,
            request_id: None,
            failure: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectStatus {
    Empty,
    Opening,
    Open,
    Closing,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case", tag = "code")]
pub enum ProjectFailure {
    InvalidRoot,
    DetectionFailed,
    StorageUnavailable,
    OperationFailed,
}

impl ProjectFailure {
    fn from_error(error: &ProjectError) -> Self {
        match error {
            ProjectError::Path(_) => Self::InvalidRoot,
            ProjectError::Detect(_) => Self::DetectionFailed,
            ProjectError::Storage(_) => Self::StorageUnavailable,
            ProjectError::Blocking(_)
            | ProjectError::ProjectBusy
            | ProjectError::ProjectNotOpen => Self::OperationFailed,
        }
    }
}

#[derive(Debug, Error)]
pub enum ProjectError {
    #[error("project is not open")]
    ProjectNotOpen,
    #[error("project operation is already running")]
    ProjectBusy,
    #[error("invalid project root")]
    Path(#[source] PathError),
    #[error("project detection failed")]
    Detect(#[source] DetectError),
    #[error("storage failed")]
    Storage(#[from] StorageError),
    #[error("blocking task failed")]
    Blocking(#[from] blocking::BlockingError),
}
