use std::{path::PathBuf, sync::Arc};

use thiserror::Error;

use crate::{
    ai::AiOrchestrator,
    dev_server::DevServerRegistry,
    diagnostics::DiagnosticService,
    events::AppEventEmitter,
    indexer::SourceIndexService,
    patch::PatchService,
    project::ProjectService,
    security::{RedactionError, Redactor},
    storage::{Database, StorageError},
};

#[derive(Debug)]
pub struct AppState {
    pub projects: Arc<ProjectService>,
    pub dev_servers: Arc<DevServerRegistry>,
    pub indexer: Arc<SourceIndexService>,
    pub ai: Arc<AiOrchestrator>,
    pub patches: Arc<PatchService>,
    pub storage: Arc<Database>,
    pub diagnostics: Arc<DiagnosticService>,
    pub events: AppEventEmitter,
}

impl AppState {
    pub async fn new(app_data_dir: PathBuf) -> Result<Self, AppStateError> {
        let storage = Arc::new(Database::open(app_data_dir).await?);
        let redactor = Arc::new(Redactor::new()?);
        let indexer = Arc::new(SourceIndexService::new());
        let projects = Arc::new(ProjectService::new(storage.clone(), indexer.clone()));
        let dev_servers = Arc::new(DevServerRegistry::new(redactor.clone()));
        let ai = AiOrchestrator::new();
        let patches = Arc::new(PatchService::new());
        let diagnostics = Arc::new(DiagnosticService::new(redactor));

        Ok(Self {
            projects,
            dev_servers,
            indexer,
            ai,
            patches,
            storage,
            diagnostics,
            events: AppEventEmitter,
        })
    }
}

#[derive(Debug, Error)]
pub enum AppStateError {
    #[error("storage initialization failed")]
    Storage(#[from] StorageError),
    #[error("redaction initialization failed")]
    Redaction(#[from] RedactionError),
}
