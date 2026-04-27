use std::{future::Future, pin::Pin, time::Duration};

use futures_core::Stream;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio_util::sync::CancellationToken;

use crate::{
    ai::model_profiles::{LocalModelRuntimePlan, QwopusRuntimePlan, QWOPUS_MODEL_ID},
    domain::{AiRequestId, ContextPackageId},
};

pub const QWOPUS_PROVIDER_ID: &str = "local.qwopus";
pub const QWOPUS_PROFILE_ID: &str = QWOPUS_MODEL_ID;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;
pub type BoxStream<T> = Pin<Box<dyn Stream<Item = T> + Send>>;

pub trait ModelProvider: Send + Sync {
    fn provider_id(&self) -> ModelProviderId;
    fn detect(&self) -> BoxFuture<'_, Result<ProviderDetection, ModelRuntimeError>>;
    fn list_models(&self) -> BoxFuture<'_, Result<Vec<ModelDescriptor>, ModelRuntimeError>>;
    fn health(&self) -> BoxFuture<'_, Result<ModelHealth, ModelRuntimeError>>;
    fn warm(&self, profile: ModelProfileId) -> BoxFuture<'_, Result<(), ModelRuntimeError>>;
    fn unload(&self, profile: ModelProfileId) -> BoxFuture<'_, Result<(), ModelRuntimeError>>;
    fn generate_stream(
        &self,
        request: ModelRequest,
        cancel: CancellationToken,
    ) -> BoxStream<Result<ModelStreamEvent, ModelRuntimeError>>;
}

#[derive(Clone, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ModelProviderId(String);

impl ModelProviderId {
    pub fn new(id: String) -> Result<Self, ModelRuntimeError> {
        if id.trim().is_empty() {
            return Err(ModelRuntimeError::InvalidProviderResponse {
                reason: "provider id is empty".to_owned(),
            });
        }
        Ok(Self(id))
    }

    pub fn qwopus() -> Self {
        Self(QWOPUS_PROVIDER_ID.to_owned())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ModelProfileId(String);

impl ModelProfileId {
    pub fn qwopus() -> Self {
        Self(QWOPUS_PROFILE_ID.to_owned())
    }
}

#[derive(Clone, Debug, Default)]
pub struct ModelRuntimeConfig {
    qwopus_plan: Option<QwopusRuntimePlan>,
    planned_model: Option<LocalModelRuntimePlan>,
}

impl ModelRuntimeConfig {
    pub fn record_qwopus_plan(&mut self, plan: QwopusRuntimePlan) {
        self.qwopus_plan = Some(plan);
    }

    pub fn record_model_runtime_plan(&mut self, plan: LocalModelRuntimePlan) {
        self.planned_model = Some(plan);
    }

    pub fn can_generate(&self) -> bool {
        false
    }

    pub fn status(&self) -> ModelRuntimeStatus {
        ModelRuntimeStatus {
            providers_configured: self.can_generate(),
            ready: self.can_generate(),
            qwopus: QwopusRuntimeStatus::from_plan(self.qwopus_plan.as_ref()),
            planned_model: self.planned_model.clone(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRuntimeStatus {
    pub providers_configured: bool,
    pub ready: bool,
    pub qwopus: QwopusRuntimeStatus,
    pub planned_model: Option<LocalModelRuntimePlan>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QwopusRuntimeStatus {
    pub provider_id: ModelProviderId,
    pub profile_id: ModelProfileId,
    pub plan_configured: bool,
    pub provider_configured: bool,
    pub ready: bool,
    pub generation_available: bool,
    pub readiness: ModelRuntimeReadiness,
    pub plan: Option<QwopusRuntimePlan>,
}

impl QwopusRuntimeStatus {
    fn from_plan(plan: Option<&QwopusRuntimePlan>) -> Self {
        match plan {
            Some(plan) => Self {
                provider_id: ModelProviderId::qwopus(),
                profile_id: ModelProfileId::qwopus(),
                plan_configured: true,
                provider_configured: false,
                ready: false,
                generation_available: false,
                readiness: ModelRuntimeReadiness::ProviderNotConfigured,
                plan: Some(plan.clone()),
            },
            None => Self {
                provider_id: ModelProviderId::qwopus(),
                profile_id: ModelProfileId::qwopus(),
                plan_configured: false,
                provider_configured: false,
                ready: false,
                generation_available: false,
                readiness: ModelRuntimeReadiness::Unconfigured,
                plan: None,
            },
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelRuntimeReadiness {
    Unconfigured,
    ProviderNotConfigured,
    Ready,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiStage {
    Plan,
    Patch,
    Repair,
    Explain,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelBudgets {
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub timeout_ms: u64,
    pub memory_soft_limit_mb: Option<u32>,
}

impl ModelBudgets {
    pub fn timeout(&self) -> Duration {
        Duration::from_millis(self.timeout_ms)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRequest {
    pub request_id: AiRequestId,
    pub context_package_id: ContextPackageId,
    pub stage: AiStage,
    pub prompt: String,
    pub budgets: ModelBudgets,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDetection {
    pub provider_id: ModelProviderId,
    pub available: bool,
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDescriptor {
    pub provider_id: ModelProviderId,
    pub model: String,
    pub context_window: u32,
    pub local: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelHealth {
    pub provider_id: ModelProviderId,
    pub ready: bool,
    pub loaded_models: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "event")]
pub enum ModelStreamEvent {
    Token { text: String },
    Progress { message: String },
    Finished { output: String },
}

#[derive(Debug, Error)]
pub enum ModelRuntimeError {
    #[error("model provider is unavailable")]
    ProviderUnavailable { provider: ModelProviderId },
    #[error("model is missing")]
    ModelMissing { model: String },
    #[error("model health check failed")]
    HealthCheckFailed { reason: String },
    #[error("model request timed out")]
    RequestTimedOut { request_id: AiRequestId },
    #[error("model request was canceled")]
    Cancelled { request_id: AiRequestId },
    #[error("context package is too large")]
    ContextTooLarge { estimated_tokens: u32, limit: u32 },
    #[error("model stream was interrupted")]
    StreamInterrupted { reason: String },
    #[error("provider response is invalid")]
    InvalidProviderResponse { reason: String },
    #[error("model cannot load under current memory pressure")]
    MemoryPressure { required_mb: u32, available_mb: u32 },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::{plan_qwopus_runtime, GpuMemoryProfile};

    #[test]
    fn reports_qwopus_unconfigured_status() {
        let status = ModelRuntimeConfig::default().status();

        assert!(!status.providers_configured);
        assert!(!status.ready);
        assert!(!status.qwopus.plan_configured);
        assert!(!status.qwopus.provider_configured);
        assert!(!status.qwopus.ready);
        assert_eq!(status.qwopus.readiness, ModelRuntimeReadiness::Unconfigured);
        assert!(status.qwopus.plan.is_none());
    }

    #[test]
    fn reports_qwopus_plan_without_generation_readiness() {
        let plan = plan_qwopus_runtime(GpuMemoryProfile {
            dedicated_vram_gb: 12,
            ddr5_ram_gb: Some(64),
        })
        .expect("12 GB profile should be supported");

        let mut runtime = ModelRuntimeConfig::default();
        runtime.record_qwopus_plan(plan);
        let status = runtime.status();

        assert!(!status.providers_configured);
        assert!(!status.ready);
        assert!(status.qwopus.plan_configured);
        assert!(!status.qwopus.provider_configured);
        assert!(!status.qwopus.generation_available);
        assert_eq!(
            status.qwopus.readiness,
            ModelRuntimeReadiness::ProviderNotConfigured
        );
        assert!(status.qwopus.plan.is_some());
    }
}
