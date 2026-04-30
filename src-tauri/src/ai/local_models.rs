use std::{
    io,
    path::{Path, PathBuf},
    process::Output,
    time::Duration,
};

use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::{io::AsyncWriteExt, process::Command, time};
use url::{Host, Url};

use crate::ai::hugging_face::{
    hugging_face_client, validate_hugging_face_gguf_url, HuggingFaceError, HuggingFaceGgufSource,
    ValidatedHuggingFaceGgufUrl,
};

const DEFAULT_MAX_DOWNLOAD_BYTES: u64 = 64 * 1024 * 1024 * 1024;
const DEFAULT_OLLAMA_ENDPOINT: &str = "http://127.0.0.1:11434";
const MAX_CONFIGURABLE_DOWNLOAD_BYTES: u64 = 128 * 1024 * 1024 * 1024;
const MIN_CONTEXT_TOKENS: u32 = 512;
const MAX_CONTEXT_TOKENS: u32 = 65_536;
const OLLAMA_CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const OLLAMA_INSPECT_TIMEOUT: Duration = Duration::from_secs(10);
const OLLAMA_CREATE_TIMEOUT: Duration = Duration::from_secs(600);

pub const MODEL_INSTALL_PROGRESS_EVENT: &str = "ai_model_install_progress";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureOllamaModelRequest {
    pub ollama_model_name: String,
    pub hugging_face_url: String,
    pub endpoint: Option<String>,
    pub model_directory: Option<PathBuf>,
    pub context_size_tokens: Option<u32>,
    pub max_download_bytes: Option<u64>,
    pub operation_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureOllamaModelResponse {
    pub ollama_model_name: String,
    pub model_already_present: bool,
    pub downloaded: bool,
    pub created: bool,
    pub gguf_path: String,
    pub modelfile_path: String,
    pub source: HuggingFaceGgufSource,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInstallProgressEvent {
    pub operation_id: Option<String>,
    pub ollama_model_name: String,
    pub phase: ModelInstallPhase,
    pub downloaded_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub message: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelInstallPhase {
    CheckingOllama,
    Downloading,
    WritingModelfile,
    CreatingOllamaModel,
    Ready,
}

pub async fn ensure_ollama_model(
    request: EnsureOllamaModelRequest,
    mut progress: impl FnMut(ModelInstallProgressEvent) + Send,
) -> Result<EnsureOllamaModelResponse, LocalModelError> {
    let config = EnsureModelConfig::from_request(request)?;
    let gguf_path = target_gguf_path(&config);
    let modelfile_path = modelfile_path_for(&gguf_path)?;

    emit_progress(
        &mut progress,
        &config,
        ModelInstallPhase::CheckingOllama,
        None,
        None,
        "Checking Ollama for the selected model",
    );
    if ollama_model_exists(&config).await? {
        emit_progress(
            &mut progress,
            &config,
            ModelInstallPhase::Ready,
            None,
            None,
            "Ollama model is already available",
        );
        return Ok(EnsureOllamaModelResponse {
            ollama_model_name: config.ollama_model_name,
            model_already_present: true,
            downloaded: false,
            created: false,
            gguf_path: path_to_string(&gguf_path),
            modelfile_path: path_to_string(&modelfile_path),
            source: config.source.source(),
        });
    }

    let client = hugging_face_client()?;
    let downloaded = ensure_gguf_file(&config, &client, &gguf_path, &mut progress).await?;

    emit_progress(
        &mut progress,
        &config,
        ModelInstallPhase::WritingModelfile,
        None,
        None,
        "Writing Ollama Modelfile",
    );
    write_modelfile(
        &modelfile_path,
        &config.source.file_name,
        config.context_size_tokens,
    )
    .await?;

    emit_progress(
        &mut progress,
        &config,
        ModelInstallPhase::CreatingOllamaModel,
        None,
        None,
        "Creating Ollama model",
    );
    create_ollama_model(
        &config.ollama_model_name,
        config.endpoint.as_str(),
        &modelfile_path,
    )
    .await?;

    emit_progress(
        &mut progress,
        &config,
        ModelInstallPhase::Ready,
        None,
        None,
        "Ollama model is ready",
    );

    Ok(EnsureOllamaModelResponse {
        ollama_model_name: config.ollama_model_name,
        model_already_present: false,
        downloaded,
        created: true,
        gguf_path: path_to_string(&gguf_path),
        modelfile_path: path_to_string(&modelfile_path),
        source: config.source.source(),
    })
}

struct EnsureModelConfig {
    ollama_model_name: String,
    source: ValidatedHuggingFaceGgufUrl,
    endpoint: String,
    model_directory: PathBuf,
    context_size_tokens: Option<u32>,
    max_download_bytes: u64,
    operation_id: Option<String>,
}

impl EnsureModelConfig {
    fn from_request(request: EnsureOllamaModelRequest) -> Result<Self, LocalModelError> {
        let ollama_model_name = normalize_ollama_model_name(&request.ollama_model_name)?;
        let source = validate_hugging_face_gguf_url(&request.hugging_face_url)?;
        let endpoint = validate_ollama_endpoint(request.endpoint.as_deref())?;
        let model_directory = model_directory_or_default(request.model_directory)?;
        let context_size_tokens = validate_context_size(request.context_size_tokens)?;
        let max_download_bytes = validate_max_download_bytes(request.max_download_bytes)?;
        let operation_id = request
            .operation_id
            .map(|id| id.trim().to_owned())
            .filter(|id| !id.is_empty());

        Ok(Self {
            ollama_model_name,
            source,
            endpoint,
            model_directory,
            context_size_tokens,
            max_download_bytes,
            operation_id,
        })
    }
}

async fn ensure_gguf_file(
    config: &EnsureModelConfig,
    client: &reqwest::Client,
    gguf_path: &Path,
    progress: &mut (dyn FnMut(ModelInstallProgressEvent) + Send),
) -> Result<bool, LocalModelError> {
    if existing_nonempty_file(gguf_path).await? {
        return Ok(false);
    }

    let parent = gguf_path
        .parent()
        .ok_or_else(|| LocalModelError::UnsafeLocalModelPath {
            path: gguf_path.to_path_buf(),
        })?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|source| LocalModelError::CreateDirectory {
            path: parent.to_path_buf(),
            source,
        })?;

    download_gguf(config, client, gguf_path, progress).await?;
    Ok(true)
}

async fn existing_nonempty_file(path: &Path) -> Result<bool, LocalModelError> {
    match tokio::fs::symlink_metadata(path).await {
        Ok(metadata) => {
            if !metadata.file_type().is_file() {
                return Err(LocalModelError::LocalModelPathNotFile {
                    path: path.to_path_buf(),
                });
            }
            Ok(metadata.len() > 0)
        }
        Err(source) if source.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(source) => Err(LocalModelError::ReadMetadata {
            path: path.to_path_buf(),
            source,
        }),
    }
}

async fn download_gguf(
    config: &EnsureModelConfig,
    client: &reqwest::Client,
    gguf_path: &Path,
    progress: &mut (dyn FnMut(ModelInstallProgressEvent) + Send),
) -> Result<(), LocalModelError> {
    let url = config.source.download_url.clone();
    let raw_url = url.to_string();
    let response =
        client
            .get(url)
            .send()
            .await
            .map_err(|source| LocalModelError::DownloadNetwork {
                url: raw_url.clone(),
                source,
            })?;
    let status = response.status();
    if !status.is_success() {
        return Err(LocalModelError::DownloadHttp {
            url: raw_url,
            status,
        });
    }

    let total_bytes = response.content_length();
    if let Some(total_bytes) = total_bytes {
        if total_bytes > config.max_download_bytes {
            return Err(LocalModelError::DownloadTooLarge {
                downloaded_bytes: total_bytes,
                max_bytes: config.max_download_bytes,
            });
        }
    }

    let partial_path = partial_path_for(gguf_path, &config.source.file_name);
    remove_partial_file(&partial_path).await?;
    let mut file = tokio::fs::File::create(&partial_path)
        .await
        .map_err(|source| LocalModelError::WriteFile {
            path: partial_path.clone(),
            source,
        })?;
    let mut response = response;
    let mut downloaded_bytes = 0_u64;

    emit_progress(
        progress,
        config,
        ModelInstallPhase::Downloading,
        Some(downloaded_bytes),
        total_bytes,
        "Downloading GGUF model",
    );

    while let Some(chunk) =
        response
            .chunk()
            .await
            .map_err(|source| LocalModelError::DownloadNetwork {
                url: raw_url.clone(),
                source,
            })?
    {
        downloaded_bytes += u64::try_from(chunk.len()).unwrap_or(u64::MAX);
        if downloaded_bytes > config.max_download_bytes {
            return Err(LocalModelError::DownloadTooLarge {
                downloaded_bytes,
                max_bytes: config.max_download_bytes,
            });
        }
        file.write_all(&chunk)
            .await
            .map_err(|source| LocalModelError::WriteFile {
                path: partial_path.clone(),
                source,
            })?;
        emit_progress(
            progress,
            config,
            ModelInstallPhase::Downloading,
            Some(downloaded_bytes),
            total_bytes,
            "Downloading GGUF model",
        );
    }

    file.flush()
        .await
        .map_err(|source| LocalModelError::WriteFile {
            path: partial_path.clone(),
            source,
        })?;
    drop(file);

    tokio::fs::rename(&partial_path, gguf_path)
        .await
        .map_err(|source| LocalModelError::PersistFile {
            path: gguf_path.to_path_buf(),
            source,
        })
}

async fn write_modelfile(
    modelfile_path: &Path,
    gguf_file_name: &str,
    context_size_tokens: Option<u32>,
) -> Result<(), LocalModelError> {
    let contents = modelfile_contents(gguf_file_name, context_size_tokens);
    tokio::fs::write(modelfile_path, contents)
        .await
        .map_err(|source| LocalModelError::WriteFile {
            path: modelfile_path.to_path_buf(),
            source,
        })
}

#[derive(Debug, Deserialize)]
struct OllamaTagsResponse {
    #[serde(default)]
    models: Vec<OllamaTagsModel>,
}

#[derive(Debug, Deserialize)]
struct OllamaTagsModel {
    name: Option<String>,
    model: Option<String>,
}

async fn ollama_model_exists(config: &EnsureModelConfig) -> Result<bool, LocalModelError> {
    let endpoint = ollama_api_endpoint(Some(config.endpoint.as_str()), "/api/tags")?;
    let client = reqwest::Client::builder()
        .connect_timeout(OLLAMA_CONNECT_TIMEOUT)
        .timeout(OLLAMA_INSPECT_TIMEOUT)
        .build()
        .map_err(|source| LocalModelError::OllamaHttpClient { source })?;

    let response = time::timeout(OLLAMA_INSPECT_TIMEOUT, client.get(endpoint.clone()).send())
        .await
        .map_err(|_| LocalModelError::OllamaTimedOut {
            action: "inspect model",
        })?
        .map_err(|source| LocalModelError::OllamaHttpRequest {
            action: "inspect model",
            endpoint: endpoint.clone(),
            source,
        })?;

    let status = response.status();
    if !status.is_success() {
        return Err(LocalModelError::OllamaHttpStatus {
            action: "inspect model",
            endpoint,
            status,
        });
    }

    let tags = response
        .json::<OllamaTagsResponse>()
        .await
        .map_err(|source| LocalModelError::OllamaHttpRequest {
            action: "inspect model",
            endpoint,
            source,
        })?;

    Ok(tags.models.iter().any(|model| {
        model.name.as_deref() == Some(config.ollama_model_name.as_str())
            || model.model.as_deref() == Some(config.ollama_model_name.as_str())
    }))
}

async fn create_ollama_model(
    model_name: &str,
    endpoint: &str,
    modelfile_path: &Path,
) -> Result<(), LocalModelError> {
    let working_directory =
        modelfile_path
            .parent()
            .ok_or_else(|| LocalModelError::UnsafeLocalModelPath {
                path: modelfile_path.to_path_buf(),
            })?;
    let output = run_ollama_command(
        "create model",
        ["create", model_name, "-f", "Modelfile"],
        Some(working_directory),
        Some(endpoint),
    )
    .await?;

    if output.status.success() {
        Ok(())
    } else {
        Err(LocalModelError::OllamaCommandFailed {
            action: "create model",
            status: output.status.code(),
            stderr: stderr_text(&output),
        })
    }
}

async fn run_ollama_command<const N: usize>(
    action: &'static str,
    args: [&str; N],
    working_directory: Option<&Path>,
    endpoint: Option<&str>,
) -> Result<Output, LocalModelError> {
    let mut command = Command::new("ollama");
    command.args(args).kill_on_drop(true);
    if let Some(working_directory) = working_directory {
        command.current_dir(working_directory);
    }
    if let Some(endpoint) = endpoint {
        command.env("OLLAMA_HOST", endpoint);
    }

    let output = time::timeout(OLLAMA_CREATE_TIMEOUT, command.output())
        .await
        .map_err(|_| LocalModelError::OllamaTimedOut { action })?
        .map_err(|source| {
            if source.kind() == io::ErrorKind::NotFound {
                LocalModelError::OllamaUnavailable { source }
            } else {
                LocalModelError::OllamaIo { action, source }
            }
        })?;
    Ok(output)
}

fn emit_progress(
    progress: &mut (dyn FnMut(ModelInstallProgressEvent) + Send),
    config: &EnsureModelConfig,
    phase: ModelInstallPhase,
    downloaded_bytes: Option<u64>,
    total_bytes: Option<u64>,
    message: &str,
) {
    progress(ModelInstallProgressEvent {
        operation_id: config.operation_id.clone(),
        ollama_model_name: config.ollama_model_name.clone(),
        phase,
        downloaded_bytes,
        total_bytes,
        message: message.to_owned(),
    });
}

fn normalize_ollama_model_name(name: &str) -> Result<String, LocalModelError> {
    let trimmed = name.trim();
    if is_valid_ollama_model_name(trimmed) {
        Ok(trimmed.to_owned())
    } else {
        Err(LocalModelError::InvalidOllamaModelName {
            name: name.to_owned(),
        })
    }
}

fn validate_ollama_endpoint(endpoint: Option<&str>) -> Result<String, LocalModelError> {
    let endpoint = endpoint
        .map(str::trim)
        .filter(|endpoint| !endpoint.is_empty())
        .unwrap_or(DEFAULT_OLLAMA_ENDPOINT);
    let url = parse_local_ollama_endpoint(endpoint, "/api/tags")?;
    let mut base_url = url;
    base_url.set_path("");
    base_url.set_query(None);
    base_url.set_fragment(None);
    Ok(base_url.as_str().trim_end_matches('/').to_owned())
}

fn ollama_api_endpoint(endpoint: Option<&str>, path: &str) -> Result<Url, LocalModelError> {
    let endpoint = endpoint
        .map(str::trim)
        .filter(|endpoint| !endpoint.is_empty())
        .unwrap_or(DEFAULT_OLLAMA_ENDPOINT);
    parse_local_ollama_endpoint(endpoint, path)
}

fn parse_local_ollama_endpoint(endpoint: &str, path: &str) -> Result<Url, LocalModelError> {
    let mut url =
        Url::parse(endpoint).map_err(|source| LocalModelError::InvalidOllamaEndpoint {
            endpoint: endpoint.to_owned(),
            source,
        })?;

    if !matches!(url.scheme(), "http" | "https") || !is_loopback_host(url.host()) {
        return Err(LocalModelError::OllamaEndpointNotLocal {
            endpoint: endpoint.to_owned(),
        });
    }

    url.set_path(path);
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

fn is_loopback_host(host: Option<Host<&str>>) -> bool {
    match host {
        Some(Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(address)) => address.is_loopback(),
        Some(Host::Ipv6(address)) => address.is_loopback(),
        None => false,
    }
}

fn model_directory_or_default(directory: Option<PathBuf>) -> Result<PathBuf, LocalModelError> {
    match directory {
        Some(directory) if directory.is_absolute() => Ok(directory),
        Some(directory) => Err(LocalModelError::ModelDirectoryMustBeAbsolute {
            path: path_to_string(&directory),
        }),
        None => {
            let home = home::home_dir().ok_or(LocalModelError::HomeDirectoryUnavailable)?;
            Ok(home.join(".quartz-canvas").join("ai-models"))
        }
    }
}

fn validate_context_size(context_size: Option<u32>) -> Result<Option<u32>, LocalModelError> {
    match context_size {
        Some(context_size)
            if !(MIN_CONTEXT_TOKENS..=MAX_CONTEXT_TOKENS).contains(&context_size) =>
        {
            Err(LocalModelError::InvalidContextSize {
                requested: context_size,
                minimum: MIN_CONTEXT_TOKENS,
                maximum: MAX_CONTEXT_TOKENS,
            })
        }
        _ => Ok(context_size),
    }
}

fn validate_max_download_bytes(max_bytes: Option<u64>) -> Result<u64, LocalModelError> {
    match max_bytes {
        Some(0) => Err(LocalModelError::InvalidDownloadLimit {
            requested: 0,
            maximum: MAX_CONFIGURABLE_DOWNLOAD_BYTES,
        }),
        Some(max_bytes) if max_bytes > MAX_CONFIGURABLE_DOWNLOAD_BYTES => {
            Err(LocalModelError::InvalidDownloadLimit {
                requested: max_bytes,
                maximum: MAX_CONFIGURABLE_DOWNLOAD_BYTES,
            })
        }
        Some(max_bytes) => Ok(max_bytes),
        None => Ok(DEFAULT_MAX_DOWNLOAD_BYTES),
    }
}

fn target_gguf_path(config: &EnsureModelConfig) -> PathBuf {
    let mut path = config
        .model_directory
        .join(&config.source.owner)
        .join(&config.source.repo_name)
        .join(&config.source.revision);
    for component in config.source.file_path.split('/') {
        path = path.join(component);
    }
    path
}

fn modelfile_path_for(gguf_path: &Path) -> Result<PathBuf, LocalModelError> {
    let parent = gguf_path
        .parent()
        .ok_or_else(|| LocalModelError::UnsafeLocalModelPath {
            path: gguf_path.to_path_buf(),
        })?;
    Ok(parent.join("Modelfile"))
}

fn partial_path_for(gguf_path: &Path, file_name: &str) -> PathBuf {
    gguf_path.with_file_name(format!("{file_name}.part"))
}

async fn remove_partial_file(partial_path: &Path) -> Result<(), LocalModelError> {
    match tokio::fs::remove_file(partial_path).await {
        Ok(()) => Ok(()),
        Err(source) if source.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(source) => Err(LocalModelError::PersistFile {
            path: partial_path.to_path_buf(),
            source,
        }),
    }
}

fn modelfile_contents(gguf_file_name: &str, context_size_tokens: Option<u32>) -> String {
    let mut contents = format!("FROM ./{gguf_file_name}\n");
    if let Some(context_size_tokens) = context_size_tokens {
        contents.push_str(&format!("PARAMETER num_ctx {context_size_tokens}\n"));
    }
    contents.push_str("PARAMETER repeat_penalty 1.18\n");
    contents.push_str("PARAMETER repeat_last_n 512\n");
    contents.push_str("PARAMETER top_p 0.86\n");
    contents.push_str("PARAMETER top_k 40\n");
    contents.push_str("PARAMETER stop \"\\nUser:\"\n");
    contents.push_str("PARAMETER stop \"\\nAssistant:\"\n");
    contents.push_str("PARAMETER stop \"<|im_start|>\"\n");
    contents.push_str("PARAMETER stop \"<|im_end|>\"\n");
    contents
}

fn stderr_text(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).trim().to_owned()
}

fn is_valid_ollama_model_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && !name.starts_with(':')
        && !name.ends_with(':')
        && name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':'))
}

fn path_to_string(path: &Path) -> String {
    path.display().to_string()
}

#[derive(Debug, Error)]
pub enum LocalModelError {
    #[error(transparent)]
    HuggingFace(#[from] HuggingFaceError),
    #[error("Ollama model name is invalid: {name}")]
    InvalidOllamaModelName { name: String },
    #[error("model directory must be an absolute path: {path}")]
    ModelDirectoryMustBeAbsolute { path: String },
    #[error("could not resolve the user home directory")]
    HomeDirectoryUnavailable,
    #[error("context size {requested} is outside the supported range {minimum}..={maximum}")]
    InvalidContextSize {
        requested: u32,
        minimum: u32,
        maximum: u32,
    },
    #[error("download limit {requested} is outside the supported range 1..={maximum}")]
    InvalidDownloadLimit { requested: u64, maximum: u64 },
    #[error("local model path is unsafe: {path}")]
    UnsafeLocalModelPath { path: PathBuf },
    #[error("local model path exists but is not a regular file: {path}")]
    LocalModelPathNotFile { path: PathBuf },
    #[error("could not read local model metadata at {path}")]
    ReadMetadata {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("could not create local model directory at {path}")]
    CreateDirectory {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("Hugging Face returned HTTP {status} while downloading {url}")]
    DownloadHttp { url: String, status: StatusCode },
    #[error("download failed for {url}")]
    DownloadNetwork {
        url: String,
        #[source]
        source: reqwest::Error,
    },
    #[error("download exceeded the maximum allowed size: {downloaded_bytes} > {max_bytes}")]
    DownloadTooLarge {
        downloaded_bytes: u64,
        max_bytes: u64,
    },
    #[error("could not write model file at {path}")]
    WriteFile {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("could not persist model file at {path}")]
    PersistFile {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("Ollama CLI is not available")]
    OllamaUnavailable {
        #[source]
        source: io::Error,
    },
    #[error("Ollama endpoint is invalid: {endpoint}")]
    InvalidOllamaEndpoint {
        endpoint: String,
        #[source]
        source: url::ParseError,
    },
    #[error("Ollama endpoint must be a local loopback HTTP endpoint: {endpoint}")]
    OllamaEndpointNotLocal { endpoint: String },
    #[error("could not create Ollama HTTP client")]
    OllamaHttpClient {
        #[source]
        source: reqwest::Error,
    },
    #[error("Ollama HTTP request failed during {action}: {endpoint}")]
    OllamaHttpRequest {
        action: &'static str,
        endpoint: Url,
        #[source]
        source: reqwest::Error,
    },
    #[error("Ollama returned HTTP {status} during {action}: {endpoint}")]
    OllamaHttpStatus {
        action: &'static str,
        endpoint: Url,
        status: StatusCode,
    },
    #[error("Ollama command timed out during {action}")]
    OllamaTimedOut { action: &'static str },
    #[error("Ollama command failed during {action}: {stderr}")]
    OllamaCommandFailed {
        action: &'static str,
        status: Option<i32>,
        stderr: String,
    },
    #[error("could not run Ollama command during {action}")]
    OllamaIo {
        action: &'static str,
        #[source]
        source: io::Error,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_ollama_model_names() {
        assert!(normalize_ollama_model_name("quartz-model:q4_k_m").is_ok());
        assert!(normalize_ollama_model_name(" quartz model ").is_err());
        assert!(normalize_ollama_model_name(":q4").is_err());
    }

    #[test]
    fn validates_context_size_bounds() {
        assert_eq!(
            validate_context_size(Some(MIN_CONTEXT_TOKENS)).unwrap(),
            Some(512)
        );
        assert!(matches!(
            validate_context_size(Some(MIN_CONTEXT_TOKENS - 1)),
            Err(LocalModelError::InvalidContextSize { .. })
        ));
    }

    #[test]
    fn validates_loopback_ollama_endpoints() {
        assert_eq!(
            validate_ollama_endpoint(Some("http://127.0.0.1:11434")).unwrap(),
            "http://127.0.0.1:11434"
        );
        assert_eq!(
            validate_ollama_endpoint(Some("http://localhost:11434/api/tags")).unwrap(),
            "http://localhost:11434"
        );
        assert!(matches!(
            validate_ollama_endpoint(Some("https://example.com:11434")),
            Err(LocalModelError::OllamaEndpointNotLocal { .. })
        ));
    }

    #[test]
    fn generates_minimal_modelfile() {
        let contents = modelfile_contents("model-Q4_K_M.gguf", Some(8192));

        assert_eq!(
            contents,
            concat!(
                "FROM ./model-Q4_K_M.gguf\n",
                "PARAMETER num_ctx 8192\n",
                "PARAMETER repeat_penalty 1.18\n",
                "PARAMETER repeat_last_n 512\n",
                "PARAMETER top_p 0.86\n",
                "PARAMETER top_k 40\n",
                "PARAMETER stop \"\\nUser:\"\n",
                "PARAMETER stop \"\\nAssistant:\"\n",
                "PARAMETER stop \"<|im_start|>\"\n",
                "PARAMETER stop \"<|im_end|>\"\n"
            )
        );
    }
}
