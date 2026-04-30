use std::{path::PathBuf, process::Command};

use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};

use crate::{
    ai::{
        ensure_ollama_model, ensure_prism_llama_server as ensure_prism_llama_server_runtime,
        generate_llama_server_chat_response, generate_ollama_chat_response, model_profile_catalog,
        plan_local_model_runtime, plan_model_import, plan_qwopus_runtime,
        plan_qwopus_runtime_from_request, search_hugging_face_gguf_models as search_hf_gguf_models,
        stop_prism_llama_server as stop_prism_llama_server_runtime,
        unload_ollama_model as unload_ollama_model_runtime, AiModelProfile, AiRequestSnapshot,
        AiRuntimeSnapshot, EnsureOllamaModelRequest, EnsureOllamaModelResponse,
        EnsurePrismLlamaServerRequest, EnsurePrismLlamaServerResponse, GenerateChatResponse,
        GenerateChatResponseRequest, GenerateLlamaServerChatResponseRequest, GpuMemoryProfile,
        HuggingFaceError, HuggingFaceGgufSearchResponse, LocalChatError, LocalModelError,
        LocalModelRuntimePlan, ModelImportPlan, ModelImportPlanError, ModelImportPlanRequest,
        ModelPlanningError, ModelRuntimePlanRequest, PrismRuntimeError, ProposeUiChangeRequest,
        QwopusRuntimePlan, SearchHuggingFaceGgufModelsRequest, StopPrismLlamaServerRequest,
        StopPrismLlamaServerResponse, UnloadOllamaModelRequest, MODEL_INSTALL_PROGRESS_EVENT,
        QWOPUS_MODEL_ID,
    },
    app_state::AppState,
    error::{CommandError, ErrorCode},
};

#[tauri::command]
pub async fn propose_ui_change(
    state: State<'_, AppState>,
    request: ProposeUiChangeRequest,
) -> Result<AiRequestSnapshot, CommandError> {
    let active = state.projects.active_project().await?;
    state
        .ai
        .propose_ui_change(active, request)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn get_ai_status(state: State<'_, AppState>) -> Result<AiRuntimeSnapshot, CommandError> {
    Ok(state.ai.status().await)
}

#[tauri::command]
pub async fn list_ai_model_profiles() -> Result<Vec<AiModelProfile>, CommandError> {
    Ok(model_profile_catalog())
}

#[tauri::command]
pub async fn search_hugging_face_gguf_models(
    request: SearchHuggingFaceGgufModelsRequest,
) -> Result<HuggingFaceGgufSearchResponse, CommandError> {
    search_hf_gguf_models(request)
        .await
        .map_err(hugging_face_error)
}

#[tauri::command]
pub async fn ensure_ollama_gguf_model(
    app: AppHandle,
    request: EnsureOllamaModelRequest,
) -> Result<EnsureOllamaModelResponse, CommandError> {
    let app_handle = app.clone();
    ensure_ollama_model(request, move |event| {
        let _ = app_handle.emit(MODEL_INSTALL_PROGRESS_EVENT, event);
    })
    .await
    .map_err(local_model_error)
}

#[tauri::command]
pub async fn ensure_prism_llama_server(
    request: EnsurePrismLlamaServerRequest,
) -> Result<EnsurePrismLlamaServerResponse, CommandError> {
    ensure_prism_llama_server_runtime(request)
        .await
        .map_err(prism_runtime_error)
}

#[tauri::command]
pub async fn stop_prism_llama_server(
    request: StopPrismLlamaServerRequest,
) -> Result<StopPrismLlamaServerResponse, CommandError> {
    stop_prism_llama_server_runtime(request)
        .await
        .map_err(prism_runtime_error)
}

#[tauri::command]
pub async fn generate_ollama_chat(
    request: GenerateChatResponseRequest,
) -> Result<GenerateChatResponse, CommandError> {
    generate_ollama_chat_response(request)
        .await
        .map_err(local_chat_error)
}

#[tauri::command]
pub async fn generate_llama_server_chat(
    request: GenerateLlamaServerChatResponseRequest,
) -> Result<GenerateChatResponse, CommandError> {
    generate_llama_server_chat_response(request)
        .await
        .map_err(local_chat_error)
}

#[tauri::command]
pub async fn unload_ollama_model(request: UnloadOllamaModelRequest) -> Result<(), CommandError> {
    unload_ollama_model_runtime(request)
        .await
        .map_err(local_chat_error)
}

#[tauri::command]
pub async fn plan_qwopus_model_runtime(
    state: State<'_, AppState>,
    request: GpuMemoryProfile,
) -> Result<QwopusRuntimePlan, CommandError> {
    let plan = plan_qwopus_runtime(request).map_err(CommandError::from)?;
    state.ai.record_qwopus_plan(plan.clone()).await;
    Ok(plan)
}

#[tauri::command]
pub async fn plan_ai_model_runtime(
    state: State<'_, AppState>,
    request: ModelRuntimePlanRequest,
) -> Result<LocalModelRuntimePlan, CommandError> {
    let plan = plan_local_model_runtime(request.clone()).map_err(model_planning_error)?;
    if plan.model_id == QWOPUS_MODEL_ID {
        let qwopus_plan =
            plan_qwopus_runtime_from_request(request).map_err(model_planning_error)?;
        state.ai.record_qwopus_plan(qwopus_plan).await;
    }
    state.ai.record_model_runtime_plan(plan.clone()).await;
    Ok(plan)
}

#[tauri::command]
pub async fn plan_ai_model_import(
    request: ModelImportPlanRequest,
) -> Result<ModelImportPlan, CommandError> {
    plan_model_import(request).map_err(model_import_error)
}

#[tauri::command]
pub async fn get_default_model_directory() -> Result<String, CommandError> {
    let home_dir = home::home_dir().ok_or_else(|| {
        CommandError::new(
            ErrorCode::InvalidRequest,
            "could not resolve the user home directory",
            true,
        )
    })?;

    Ok(home_dir
        .join(".ollama")
        .join("models")
        .display()
        .to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenModelDirectoryRequest {
    pub model_directory: PathBuf,
}

#[tauri::command]
pub async fn open_model_directory(request: OpenModelDirectoryRequest) -> Result<(), CommandError> {
    let model_directory = request.model_directory;
    if !model_directory.is_absolute() || !model_directory.is_dir() {
        return Err(CommandError::new(
            ErrorCode::InvalidRequest,
            "model folder must be an existing absolute directory",
            true,
        ));
    }

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer.exe");
        command.arg(&model_directory);
        command
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(&model_directory);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(&model_directory);
        command
    };

    command.spawn().map(|_| ()).map_err(|_| {
        CommandError::new(
            ErrorCode::InvalidRequest,
            "could not open model folder",
            true,
        )
    })
}

fn model_planning_error(error: ModelPlanningError) -> CommandError {
    match error {
        ModelPlanningError::UnknownModel { model_id } => CommandError::new(
            ErrorCode::ModelProfileUnsupported,
            format!("unknown local AI model profile: {model_id}"),
            true,
        ),
        ModelPlanningError::UnsupportedQuantization {
            model_id,
            quantization,
        } => CommandError::new(
            ErrorCode::ModelProfileUnsupported,
            format!("model {model_id} does not support the requested quantization: {quantization:?}"),
            true,
        ),
        ModelPlanningError::InsufficientVram {
            model_id,
            detected_gb,
            minimum_gb,
        } => CommandError::new(
            ErrorCode::ModelProfileUnsupported,
            format!(
                "model {model_id} requires at least {minimum_gb} GB dedicated VRAM; detected {detected_gb} GB"
            ),
            true,
        ),
        ModelPlanningError::InvalidContextSize {
            requested,
            minimum,
            maximum,
        } => CommandError::new(
            ErrorCode::InvalidRequest,
            format!(
                "context size {requested} is outside the supported range {minimum}..={maximum}"
            ),
            true,
        ),
    }
}

fn model_import_error(error: ModelImportPlanError) -> CommandError {
    let message = error.to_string();
    let code = match error {
        ModelImportPlanError::PathMustBeAbsolute { .. }
        | ModelImportPlanError::PathNotFound { .. }
        | ModelImportPlanError::PathNotFile { .. }
        | ModelImportPlanError::NotGguf { .. }
        | ModelImportPlanError::InvalidRepository { .. }
        | ModelImportPlanError::InvalidRepositoryFile { .. }
        | ModelImportPlanError::InvalidOllamaModelName { .. } => ErrorCode::InvalidRequest,
    };
    CommandError::new(code, message, true)
}

fn hugging_face_error(error: HuggingFaceError) -> CommandError {
    let message = error.to_string();
    let code = match error {
        HuggingFaceError::InvalidUrl { .. } | HuggingFaceError::InvalidSearchQuery { .. } => {
            ErrorCode::InvalidRequest
        }
        HuggingFaceError::Client { .. }
        | HuggingFaceError::Request { .. }
        | HuggingFaceError::Http { .. }
        | HuggingFaceError::Decode { .. } => ErrorCode::BridgeUnavailable,
    };
    CommandError::new(code, message, true)
}

fn local_model_error(error: LocalModelError) -> CommandError {
    let message = error.to_string();
    match error {
        LocalModelError::HuggingFace(error) => hugging_face_error(error),
        LocalModelError::InvalidOllamaModelName { .. }
        | LocalModelError::ModelDirectoryMustBeAbsolute { .. }
        | LocalModelError::HomeDirectoryUnavailable
        | LocalModelError::InvalidContextSize { .. }
        | LocalModelError::InvalidDownloadLimit { .. }
        | LocalModelError::UnsafeLocalModelPath { .. }
        | LocalModelError::LocalModelPathNotFile { .. }
        | LocalModelError::DownloadTooLarge { .. }
        | LocalModelError::InvalidOllamaEndpoint { .. }
        | LocalModelError::OllamaEndpointNotLocal { .. } => {
            CommandError::new(ErrorCode::InvalidRequest, message, true)
        }
        LocalModelError::OllamaUnavailable { .. }
        | LocalModelError::OllamaHttpClient { .. }
        | LocalModelError::OllamaHttpRequest { .. }
        | LocalModelError::OllamaHttpStatus { .. }
        | LocalModelError::OllamaTimedOut { .. }
        | LocalModelError::OllamaCommandFailed { .. }
        | LocalModelError::OllamaIo { .. } => {
            CommandError::new(ErrorCode::AiRuntimeUnavailable, message, true)
        }
        LocalModelError::ReadMetadata { .. }
        | LocalModelError::CreateDirectory { .. }
        | LocalModelError::DownloadHttp { .. }
        | LocalModelError::DownloadNetwork { .. }
        | LocalModelError::WriteFile { .. }
        | LocalModelError::PersistFile { .. } => {
            CommandError::new(ErrorCode::BridgeUnavailable, message, true)
        }
    }
}

fn local_chat_error(error: LocalChatError) -> CommandError {
    let message = error.to_string();
    match error {
        LocalChatError::InvalidModelName { .. }
        | LocalChatError::EmptyPrompt
        | LocalChatError::InvalidEndpoint { .. }
        | LocalChatError::EndpointNotLocal { .. }
        | LocalChatError::InvalidTimeout { .. }
        | LocalChatError::InvalidTemperature { .. }
        | LocalChatError::InvalidMaxOutputTokens { .. }
        | LocalChatError::InvalidContextWindowTokens { .. }
        | LocalChatError::InvalidRepeatPenalty { .. }
        | LocalChatError::InvalidRepeatLastN { .. }
        | LocalChatError::InvalidTopP { .. }
        | LocalChatError::InvalidTopK { .. }
        | LocalChatError::InvalidStopSequences { .. }
        | LocalChatError::InvalidKeepAlive { .. } => {
            CommandError::new(ErrorCode::InvalidRequest, message, true)
        }
        LocalChatError::RequestTimedOut { .. }
        | LocalChatError::Request { .. }
        | LocalChatError::Http { .. }
        | LocalChatError::Decode { .. }
        | LocalChatError::EmptyResponse => {
            CommandError::new(ErrorCode::AiRuntimeUnavailable, message, true)
        }
    }
}

fn prism_runtime_error(error: PrismRuntimeError) -> CommandError {
    let message = error.to_string();
    match error {
        PrismRuntimeError::InvalidEndpoint { .. }
        | PrismRuntimeError::EndpointNotLocal { .. }
        | PrismRuntimeError::InvalidLoraAdapterPath { .. }
        | PrismRuntimeError::InvalidLoraAdapterScale { .. }
        | PrismRuntimeError::InvalidRuntimeTuning { .. }
        | PrismRuntimeError::InvalidStopTimeout { .. } => {
            CommandError::new(ErrorCode::InvalidRequest, message, true)
        }
        PrismRuntimeError::HomeDirectoryUnavailable
        | PrismRuntimeError::LauncherMissing { .. }
        | PrismRuntimeError::StartFailed { .. }
        | PrismRuntimeError::StartTimedOut { .. }
        | PrismRuntimeError::StopProcess { .. }
        | PrismRuntimeError::StopProcessFailed { .. }
        | PrismRuntimeError::StopRequest { .. }
        | PrismRuntimeError::StopRejected { .. }
        | PrismRuntimeError::StopTimedOut { .. }
        | PrismRuntimeError::RuntimeConfig { .. }
        | PrismRuntimeError::RuntimeConfigSerialize { .. } => {
            CommandError::new(ErrorCode::AiRuntimeUnavailable, message, true)
        }
    }
}
