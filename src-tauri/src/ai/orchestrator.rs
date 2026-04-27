use std::{collections::HashMap, sync::Arc};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::Mutex;

use crate::{
    ai::{
        model_profiles::{LocalModelRuntimePlan, QwopusRuntimePlan},
        model_runtime::{AiStage, ModelRuntimeConfig, QwopusRuntimeStatus},
    },
    domain::{AiRequestId, ContextPackageId, ProjectId},
    project::ActiveProject,
};

#[derive(Debug)]
pub struct AiOrchestrator {
    requests: Mutex<HashMap<AiRequestId, AiRequestSnapshot>>,
    runtime: Mutex<ModelRuntimeConfig>,
}

impl AiOrchestrator {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            requests: Mutex::new(HashMap::new()),
            runtime: Mutex::new(ModelRuntimeConfig::default()),
        })
    }

    pub async fn propose_ui_change(
        &self,
        active: ActiveProject,
        request: ProposeUiChangeRequest,
    ) -> Result<AiRequestSnapshot, AiError> {
        if request.instruction.trim().is_empty() {
            return Err(AiError::EmptyInstruction);
        }

        if request.project_id != active.project_id || request.project_epoch != active.project_epoch
        {
            return Err(AiError::StaleProjectEpoch);
        }

        if !self.runtime.lock().await.can_generate() {
            return Err(AiError::RuntimeUnavailable);
        }

        let request_id = AiRequestId::new();
        let snapshot = AiRequestSnapshot {
            request_id: request_id.clone(),
            project_id: active.project_id,
            project_epoch: active.project_epoch,
            context_package_id: request.context_package_id,
            stage: request.stage,
            status: AiRequestStatus::Queued,
            created_at: Utc::now(),
            completed_at: None,
        };
        self.requests
            .lock()
            .await
            .insert(request_id, snapshot.clone());
        Ok(snapshot)
    }

    pub async fn record_qwopus_plan(&self, plan: QwopusRuntimePlan) {
        self.runtime.lock().await.record_qwopus_plan(plan);
    }

    pub async fn record_model_runtime_plan(&self, plan: LocalModelRuntimePlan) {
        self.runtime.lock().await.record_model_runtime_plan(plan);
    }

    pub async fn status(&self) -> AiRuntimeSnapshot {
        let runtime = self.runtime.lock().await.status();
        AiRuntimeSnapshot {
            providers_configured: runtime.providers_configured,
            ready: runtime.ready,
            active_requests: self.requests.lock().await.len(),
            local_first: true,
            cloud_fallback_enabled: false,
            qwopus: runtime.qwopus,
            planned_model: runtime.planned_model,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposeUiChangeRequest {
    pub project_id: ProjectId,
    pub project_epoch: u64,
    pub context_package_id: ContextPackageId,
    pub instruction: String,
    pub stage: AiStage,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRequestSnapshot {
    pub request_id: AiRequestId,
    pub project_id: ProjectId,
    pub project_epoch: u64,
    pub context_package_id: ContextPackageId,
    pub stage: AiStage,
    pub status: AiRequestStatus,
    pub created_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AiRequestStatus {
    Queued,
    Planning,
    GeneratingPatch,
    Validating,
    ReadyForReview,
    NeedsUserChoice,
    Failed,
    Canceled,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRuntimeSnapshot {
    pub providers_configured: bool,
    pub ready: bool,
    pub active_requests: usize,
    pub local_first: bool,
    pub cloud_fallback_enabled: bool,
    pub qwopus: QwopusRuntimeStatus,
    pub planned_model: Option<LocalModelRuntimePlan>,
}

#[derive(Debug, Error)]
pub enum AiError {
    #[error("AI instruction is empty")]
    EmptyInstruction,
    #[error("AI runtime is unavailable")]
    RuntimeUnavailable,
    #[error("AI request references a stale project epoch")]
    StaleProjectEpoch,
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use tempfile::{tempdir, TempDir};

    use super::*;
    use crate::{
        ai::{plan_qwopus_runtime, GpuMemoryProfile, ModelRuntimeReadiness, QuantizationTier},
        fs::{PathPolicy, SafeProjectRoot},
        project::detect::{ApplicationSurfaceKind, FrameworkKind, ProjectManifest},
    };

    #[tokio::test]
    async fn reports_unconfigured_runtime_status() {
        let orchestrator = AiOrchestrator::new();
        let status = orchestrator.status().await;

        assert!(!status.providers_configured);
        assert!(!status.ready);
        assert_eq!(status.active_requests, 0);
        assert!(!status.qwopus.plan_configured);
        assert_eq!(status.qwopus.readiness, ModelRuntimeReadiness::Unconfigured);
    }

    #[tokio::test]
    async fn reports_qwopus_plan_without_ready_generation() {
        let orchestrator = AiOrchestrator::new();
        let plan = plan_qwopus_runtime(GpuMemoryProfile {
            dedicated_vram_gb: 16,
            ddr5_ram_gb: Some(32),
        })
        .expect("16 GB profile should be supported");

        orchestrator.record_qwopus_plan(plan).await;
        let status = orchestrator.status().await;

        assert!(!status.providers_configured);
        assert!(!status.ready);
        assert!(status.qwopus.plan_configured);
        assert!(!status.qwopus.provider_configured);
        assert!(!status.qwopus.generation_available);
        assert_eq!(
            status.qwopus.readiness,
            ModelRuntimeReadiness::ProviderNotConfigured
        );
        assert_eq!(
            status
                .qwopus
                .plan
                .expect("Qwopus status should include the recorded plan")
                .quantization,
            QuantizationTier::Q4KM
        );
    }

    #[tokio::test]
    async fn rejects_empty_instruction_before_runtime_check() {
        let orchestrator = AiOrchestrator::new();
        let (_temp, active) = active_project(7);
        let request = request_for(&active, "   ", active.project_epoch);

        let error = orchestrator
            .propose_ui_change(active, request)
            .await
            .expect_err("empty instruction should be rejected");

        assert!(matches!(error, AiError::EmptyInstruction));
    }

    #[tokio::test]
    async fn rejects_stale_project_epoch_before_runtime_check() {
        let orchestrator = AiOrchestrator::new();
        let (_temp, active) = active_project(7);
        let request = request_for(&active, "Make the button compact", active.project_epoch + 1);

        let error = orchestrator
            .propose_ui_change(active, request)
            .await
            .expect_err("stale epoch should be rejected");

        assert!(matches!(error, AiError::StaleProjectEpoch));
    }

    #[tokio::test]
    async fn rejects_current_request_when_only_qwopus_plan_is_recorded() {
        let orchestrator = AiOrchestrator::new();
        let plan = plan_qwopus_runtime(GpuMemoryProfile {
            dedicated_vram_gb: 12,
            ddr5_ram_gb: Some(64),
        })
        .expect("12 GB profile should be supported");
        orchestrator.record_qwopus_plan(plan).await;

        let (_temp, active) = active_project(11);
        let request = request_for(&active, "Make the button compact", active.project_epoch);

        let error = orchestrator
            .propose_ui_change(active, request)
            .await
            .expect_err("recording a plan must not enable generation");

        assert!(matches!(error, AiError::RuntimeUnavailable));
    }

    fn active_project(project_epoch: u64) -> (TempDir, ActiveProject) {
        let temp = tempdir().expect("temporary project root should be available");
        let root = SafeProjectRoot::open(temp.path(), &PathPolicy::strict())
            .expect("temporary project root should pass strict policy");
        let active = ActiveProject {
            project_id: ProjectId::new(),
            project_epoch,
            root,
            manifest: ProjectManifest {
                root_label: "fixture".to_owned(),
                framework: FrameworkKind::Vite,
                surface_kind: ApplicationSurfaceKind::Web,
                surface_signals: vec!["fixture".to_owned()],
                package_manager: None,
                available_scripts: Vec::new(),
            },
            opened_at: Utc::now(),
        };

        (temp, active)
    }

    fn request_for(
        active: &ActiveProject,
        instruction: &str,
        project_epoch: u64,
    ) -> ProposeUiChangeRequest {
        ProposeUiChangeRequest {
            project_id: active.project_id.clone(),
            project_epoch,
            context_package_id: ContextPackageId::new(),
            instruction: instruction.to_owned(),
            stage: AiStage::Plan,
        }
    }
}
