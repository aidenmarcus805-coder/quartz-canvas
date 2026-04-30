pub mod chat;
pub mod hugging_face;
pub mod local_models;
pub mod model_profiles;
pub mod model_runtime;
pub mod orchestrator;
pub mod prism_runtime;
pub mod provider_config;

pub use chat::{
    generate_llama_server_chat_response, generate_ollama_chat_response, unload_ollama_model,
    ChatGenerationOptions, ChatMessageRequest, ChatRole, GenerateChatResponse,
    GenerateChatResponseRequest, GenerateLlamaServerChatResponseRequest, LocalChatError,
    UnloadOllamaModelRequest,
};
pub use hugging_face::{
    search_hugging_face_gguf_models, validate_hugging_face_gguf_url, HuggingFaceError,
    HuggingFaceGgufFile, HuggingFaceGgufModel, HuggingFaceGgufSearchResponse,
    HuggingFaceGgufSource, SearchHuggingFaceGgufModelsRequest, ValidatedHuggingFaceGgufUrl,
};
pub use local_models::{
    ensure_ollama_model, EnsureOllamaModelRequest, EnsureOllamaModelResponse, LocalModelError,
    ModelInstallPhase, ModelInstallProgressEvent, MODEL_INSTALL_PROGRESS_EVENT,
};
pub use model_profiles::{
    model_profile_catalog, plan_local_model_runtime, plan_model_import, plan_qwopus_runtime,
    plan_qwopus_runtime_from_request, qwopus_plan_for_quant, AiModelProfile, GpuMemoryProfile,
    KvCachePlacement, LocalModelRuntimePlan, ModelImportPlan, ModelImportPlanError,
    ModelImportPlanRequest, ModelImportSource, ModelPlanningError, ModelProfileError,
    ModelRuntimePlanRequest, QuantizationTier, QwopusRuntimePlan, PRISM_LLAMA_CPP_RELEASE_URL,
    PRISM_LLAMA_CPP_REPO, QUARTZ_NANO_MODEL_ID, QWOPUS_GLM_18B_REPO, QWOPUS_MODEL_ID,
    TERNARY_BONSAI_17B_MODEL_ID, TERNARY_BONSAI_17B_REPO, TERNARY_BONSAI_4B_MODEL_ID,
    TERNARY_BONSAI_4B_REPO, TERNARY_BONSAI_8B_MODEL_ID, TERNARY_BONSAI_8B_REPO,
};
pub use model_runtime::{
    AiStage, ModelBudgets, ModelDescriptor, ModelHealth, ModelProfileId, ModelProvider,
    ModelProviderId, ModelRequest, ModelRuntimeConfig, ModelRuntimeError, ModelRuntimeReadiness,
    ModelRuntimeStatus, ModelStreamEvent, ProviderDetection, QwopusRuntimeStatus,
};
pub use orchestrator::{
    AiError, AiOrchestrator, AiRequestSnapshot, AiRequestStatus, AiRuntimeSnapshot,
    ProposeUiChangeRequest,
};
pub use prism_runtime::{
    ensure_prism_llama_server, stop_prism_llama_server, EnsurePrismLlamaServerRequest,
    EnsurePrismLlamaServerResponse, PrismRuntimeError, StopPrismLlamaServerRequest,
    StopPrismLlamaServerResponse,
};
pub use provider_config::{
    local_provider_model_configs, prism_llama_cpp_model_name, LocalProviderKind,
    LocalProviderModelConfig, OLLAMA_DEFAULT_ENDPOINT, PRISM_LLAMA_CPP_DEFAULT_ENDPOINT,
    QUARTZ_NANO_PRISM_CONFIG, QUARTZ_NANO_PRISM_MODEL_NAME, QUARTZ_NANO_PROVIDER_MODEL_ID,
    TERNARY_BONSAI_8B_PRISM_CONFIG, TERNARY_BONSAI_8B_PROVIDER_MODEL_ID,
};
