use serde::Serialize;

use super::model_profiles::{QUARTZ_NANO_MODEL_ID, TERNARY_BONSAI_8B_MODEL_ID};

pub const OLLAMA_DEFAULT_ENDPOINT: &str = "http://127.0.0.1:11434";
pub const PRISM_LLAMA_CPP_DEFAULT_ENDPOINT: &str = "http://127.0.0.1:11435";
pub const QUARTZ_NANO_PROVIDER_MODEL_ID: &str = "quartz-nano:q2_0";
pub const QUARTZ_NANO_PRISM_MODEL_NAME: &str = "Ternary-Bonsai-8B-Q2_0.gguf";
pub const TERNARY_BONSAI_8B_PROVIDER_MODEL_ID: &str = "ternary-bonsai-8b:q2_0";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalProviderKind {
    Ollama,
    PrismLlamaCpp,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalProviderModelConfig {
    pub model_key: &'static str,
    pub provider_model_id: &'static str,
    pub provider: LocalProviderKind,
    pub endpoint: &'static str,
    pub runtime_model_name: &'static str,
    pub fallback_provider_model_id: Option<&'static str>,
}

pub const QUARTZ_NANO_PRISM_CONFIG: LocalProviderModelConfig = LocalProviderModelConfig {
    model_key: QUARTZ_NANO_MODEL_ID,
    provider_model_id: QUARTZ_NANO_PROVIDER_MODEL_ID,
    provider: LocalProviderKind::PrismLlamaCpp,
    endpoint: PRISM_LLAMA_CPP_DEFAULT_ENDPOINT,
    runtime_model_name: QUARTZ_NANO_PRISM_MODEL_NAME,
    fallback_provider_model_id: Some(TERNARY_BONSAI_8B_PROVIDER_MODEL_ID),
};

pub const TERNARY_BONSAI_8B_PRISM_CONFIG: LocalProviderModelConfig = LocalProviderModelConfig {
    model_key: TERNARY_BONSAI_8B_MODEL_ID,
    provider_model_id: TERNARY_BONSAI_8B_PROVIDER_MODEL_ID,
    provider: LocalProviderKind::PrismLlamaCpp,
    endpoint: PRISM_LLAMA_CPP_DEFAULT_ENDPOINT,
    runtime_model_name: QUARTZ_NANO_PRISM_MODEL_NAME,
    fallback_provider_model_id: None,
};

pub fn local_provider_model_configs() -> Vec<LocalProviderModelConfig> {
    vec![QUARTZ_NANO_PRISM_CONFIG, TERNARY_BONSAI_8B_PRISM_CONFIG]
}

pub fn prism_llama_cpp_model_name(requested_model: &str) -> &str {
    match requested_model.trim() {
        QUARTZ_NANO_MODEL_ID
        | QUARTZ_NANO_PROVIDER_MODEL_ID
        | TERNARY_BONSAI_8B_MODEL_ID
        | TERNARY_BONSAI_8B_PROVIDER_MODEL_ID => QUARTZ_NANO_PRISM_MODEL_NAME,
        model_name => model_name,
    }
}
