pub mod chat;
pub mod hugging_face;
pub mod local_models;
pub mod model_profiles;
pub mod model_runtime;
pub mod orchestrator;

pub use chat::{
    generate_ollama_chat_response, ChatGenerationOptions, ChatMessageRequest, ChatRole,
    GenerateChatResponse, GenerateChatResponseRequest, LocalChatError,
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
    ModelRuntimePlanRequest, QuantizationTier, QwopusRuntimePlan, QWOPUS_GLM_18B_REPO,
    QWOPUS_MODEL_ID, TERNARY_BONSAI_17B_MODEL_ID, TERNARY_BONSAI_17B_REPO,
    TERNARY_BONSAI_4B_MODEL_ID, TERNARY_BONSAI_4B_REPO, TERNARY_BONSAI_8B_MODEL_ID,
    TERNARY_BONSAI_8B_REPO,
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
