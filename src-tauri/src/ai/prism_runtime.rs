use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, Instant},
};

use reqwest::Url;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::time;
use url::Host;

use super::model_profiles::QUARTZ_NANO_MODEL_ID;
use super::provider_config::{PRISM_LLAMA_CPP_DEFAULT_ENDPOINT, QUARTZ_NANO_PRISM_MODEL_NAME};

const DEFAULT_START_TIMEOUT_MS: u64 = 120_000;
const DEFAULT_STOP_TIMEOUT_MS: u64 = 15_000;
const HEALTH_CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const HEALTH_REQUEST_TIMEOUT: Duration = Duration::from_secs(3);
const HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(750);
const DEFAULT_LORA_ADAPTER_SCALE: f32 = 1.0;
const DEFAULT_QUARTZ_NANO_LORA_ADAPTER_FILE: &str = "quartz-nano-runtime-lora-f16.gguf";
const DEFAULT_PARALLEL_SLOTS: u8 = 2;
const DEFAULT_HTTP_THREADS: u8 = 4;
const DEFAULT_CACHE_RAM_MIB: u32 = 8_192;
const DEFAULT_CACHE_REUSE_TOKENS: u32 = 256;
const DEFAULT_SPEC_TYPE: &str = "none";
const DEFAULT_DRAFT_TOKENS: u8 = 8;
const DEFAULT_DRAFT_MIN: u8 = 2;
const DEFAULT_DRAFT_PROBABILITY_MIN: f32 = 0.75;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct PrismLaunchConfig {
    endpoint: String,
    model_name: String,
    lora_adapter_path: Option<String>,
    lora_adapter_scale: f32,
    runtime_tuning: PrismRuntimeTuning,
}

impl PrismLaunchConfig {
    fn from_request(
        endpoint: &Url,
        lora_adapter_path: Option<&Path>,
        lora_adapter_scale: f32,
        runtime_tuning: PrismRuntimeTuning,
    ) -> Self {
        Self {
            endpoint: endpoint.to_string(),
            model_name: QUARTZ_NANO_PRISM_MODEL_NAME.to_owned(),
            lora_adapter_path: lora_adapter_path.map(|path| path.display().to_string()),
            lora_adapter_scale,
            runtime_tuning,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct PrismRuntimeTuning {
    parallel_slots: u8,
    http_threads: u8,
    cache_ram_mib: u32,
    cache_reuse_tokens: u32,
    spec_type: String,
    draft_tokens: u8,
    draft_min: u8,
    draft_probability_min: f32,
}

impl Default for PrismRuntimeTuning {
    fn default() -> Self {
        Self {
            parallel_slots: DEFAULT_PARALLEL_SLOTS,
            http_threads: DEFAULT_HTTP_THREADS,
            cache_ram_mib: DEFAULT_CACHE_RAM_MIB,
            cache_reuse_tokens: DEFAULT_CACHE_REUSE_TOKENS,
            spec_type: DEFAULT_SPEC_TYPE.to_owned(),
            draft_tokens: DEFAULT_DRAFT_TOKENS,
            draft_min: DEFAULT_DRAFT_MIN,
            draft_probability_min: DEFAULT_DRAFT_PROBABILITY_MIN,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsurePrismLlamaServerRequest {
    pub endpoint: Option<String>,
    pub model_key: Option<String>,
    pub lora_adapter_path: Option<PathBuf>,
    pub lora_adapter_scale: Option<f32>,
    pub parallel_slots: Option<u8>,
    pub http_threads: Option<u8>,
    pub cache_ram_mib: Option<u32>,
    pub cache_reuse_tokens: Option<u32>,
    pub spec_type: Option<String>,
    pub draft_tokens: Option<u8>,
    pub draft_min: Option<u8>,
    pub draft_probability_min: Option<f32>,
    pub timeout_ms: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsurePrismLlamaServerResponse {
    pub endpoint: String,
    pub model_name: &'static str,
    pub already_running: bool,
    pub started: bool,
    pub restarted: bool,
    pub lora_adapter_path: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopPrismLlamaServerRequest {
    pub endpoint: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StopPrismLlamaServerResponse {
    pub endpoint: String,
    pub stopped: bool,
}

pub async fn ensure_prism_llama_server(
    request: EnsurePrismLlamaServerRequest,
) -> Result<EnsurePrismLlamaServerResponse, PrismRuntimeError> {
    let endpoint = validate_endpoint(request.endpoint.as_deref())?;
    let timeout = Duration::from_millis(request.timeout_ms.unwrap_or(DEFAULT_START_TIMEOUT_MS));
    let lora_adapter_path = resolve_lora_adapter_path(
        request.lora_adapter_path.as_deref(),
        request.model_key.as_deref(),
    )?;
    let lora_adapter_scale = validate_lora_adapter_scale(request.lora_adapter_scale)?;
    let runtime_tuning = validate_runtime_tuning(&request)?;
    let launch_config = PrismLaunchConfig::from_request(
        &endpoint,
        lora_adapter_path.as_deref(),
        lora_adapter_scale,
        runtime_tuning.clone(),
    );
    stop_stale_configured_server(
        &launch_config,
        request_stop_timeout(Some(DEFAULT_STOP_TIMEOUT_MS))?,
    )
    .await?;

    if prism_server_ready(&endpoint).await {
        if launch_config_matches(&launch_config) {
            return Ok(response(endpoint, true, false, false, lora_adapter_path));
        }
        stop_running_server(
            &endpoint,
            request_stop_timeout(Some(DEFAULT_STOP_TIMEOUT_MS))?,
        )
        .await?;
        start_prism_server(
            &endpoint,
            lora_adapter_path.as_deref(),
            lora_adapter_scale,
            &runtime_tuning,
        )?;
        wait_for_ready(&endpoint, timeout).await?;
        write_runtime_config(&launch_config)?;
        return Ok(response(endpoint, false, true, true, lora_adapter_path));
    }

    start_prism_server(
        &endpoint,
        lora_adapter_path.as_deref(),
        lora_adapter_scale,
        &runtime_tuning,
    )?;
    wait_for_ready(&endpoint, timeout).await?;
    write_runtime_config(&launch_config)?;
    Ok(response(endpoint, false, true, false, lora_adapter_path))
}

pub async fn stop_prism_llama_server(
    request: StopPrismLlamaServerRequest,
) -> Result<StopPrismLlamaServerResponse, PrismRuntimeError> {
    let endpoint = validate_endpoint(request.endpoint.as_deref())?;
    if !prism_server_ready(&endpoint).await {
        return Ok(stop_response(endpoint, false));
    }

    let timeout = request_stop_timeout(request.timeout_ms)?;
    stop_running_server(&endpoint, timeout).await?;
    remove_runtime_config();
    Ok(stop_response(endpoint, true))
}

fn response(
    endpoint: Url,
    already_running: bool,
    started: bool,
    restarted: bool,
    lora_adapter_path: Option<PathBuf>,
) -> EnsurePrismLlamaServerResponse {
    EnsurePrismLlamaServerResponse {
        endpoint: endpoint.to_string(),
        model_name: QUARTZ_NANO_PRISM_MODEL_NAME,
        already_running,
        started,
        restarted,
        lora_adapter_path: lora_adapter_path.map(|path| path.display().to_string()),
    }
}

fn stop_response(endpoint: Url, stopped: bool) -> StopPrismLlamaServerResponse {
    StopPrismLlamaServerResponse {
        endpoint: endpoint.to_string(),
        stopped,
    }
}

async fn wait_for_ready(endpoint: &Url, timeout: Duration) -> Result<(), PrismRuntimeError> {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if prism_server_ready(endpoint).await {
            return Ok(());
        }
        time::sleep(HEALTH_POLL_INTERVAL).await;
    }

    Err(PrismRuntimeError::StartTimedOut { timeout })
}

async fn wait_for_stopped(endpoint: &Url, timeout: Duration) -> Result<(), PrismRuntimeError> {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if !prism_server_ready(endpoint).await {
            return Ok(());
        }
        time::sleep(HEALTH_POLL_INTERVAL).await;
    }

    Err(PrismRuntimeError::StopTimedOut { timeout })
}

async fn prism_server_ready(endpoint: &Url) -> bool {
    let health_url = health_endpoint(endpoint);
    let Ok(client) = reqwest::Client::builder()
        .connect_timeout(HEALTH_CONNECT_TIMEOUT)
        .timeout(HEALTH_REQUEST_TIMEOUT)
        .build()
    else {
        return false;
    };

    match client.get(health_url).send().await {
        Ok(response) => response.status().is_success(),
        Err(_) => false,
    }
}

async fn request_shutdown(endpoint: &Url, timeout: Duration) -> Result<(), PrismRuntimeError> {
    let shutdown_url = shutdown_endpoint(endpoint);
    let client = reqwest::Client::builder()
        .connect_timeout(HEALTH_CONNECT_TIMEOUT)
        .timeout(timeout)
        .build()
        .map_err(|source| PrismRuntimeError::StopRequest {
            endpoint: endpoint.to_string(),
            source,
        })?;

    let response = time::timeout(timeout, client.post(shutdown_url).send())
        .await
        .map_err(|_| PrismRuntimeError::StopTimedOut { timeout })?
        .map_err(|source| PrismRuntimeError::StopRequest {
            endpoint: endpoint.to_string(),
            source,
        })?;

    if !response.status().is_success() {
        return Err(PrismRuntimeError::StopRejected {
            endpoint: endpoint.to_string(),
            status: response.status(),
        });
    }

    Ok(())
}

async fn stop_running_server(endpoint: &Url, timeout: Duration) -> Result<(), PrismRuntimeError> {
    if request_shutdown(endpoint, timeout).await.is_err() {
        stop_wsl_prism_process(endpoint)?;
    }
    wait_for_stopped(endpoint, timeout).await
}

async fn stop_stale_configured_server(
    expected: &PrismLaunchConfig,
    timeout: Duration,
) -> Result<(), PrismRuntimeError> {
    let Some(actual) = read_runtime_config() else {
        return Ok(());
    };
    if actual.endpoint == expected.endpoint {
        return Ok(());
    }

    let Ok(actual_endpoint) = validate_endpoint(Some(&actual.endpoint)) else {
        remove_runtime_config();
        return Ok(());
    };
    if prism_server_ready(&actual_endpoint).await {
        stop_running_server(&actual_endpoint, timeout).await?;
    }
    remove_runtime_config();
    Ok(())
}

fn health_endpoint(endpoint: &Url) -> Url {
    let mut url = endpoint.clone();
    url.set_path("/health");
    url.set_query(None);
    url.set_fragment(None);
    url
}

fn shutdown_endpoint(endpoint: &Url) -> Url {
    let mut url = endpoint.clone();
    url.set_path("/shutdown");
    url.set_query(None);
    url.set_fragment(None);
    url
}

fn request_stop_timeout(timeout_ms: Option<u64>) -> Result<Duration, PrismRuntimeError> {
    let timeout_ms = timeout_ms.unwrap_or(DEFAULT_STOP_TIMEOUT_MS);
    if timeout_ms == 0 || timeout_ms > DEFAULT_START_TIMEOUT_MS {
        return Err(PrismRuntimeError::InvalidStopTimeout { timeout_ms });
    }

    Ok(Duration::from_millis(timeout_ms))
}

fn validate_lora_adapter_scale(raw_scale: Option<f32>) -> Result<f32, PrismRuntimeError> {
    let scale = raw_scale.unwrap_or(DEFAULT_LORA_ADAPTER_SCALE);
    if !scale.is_finite() || scale <= 0.0 || scale > 4.0 {
        return Err(PrismRuntimeError::InvalidLoraAdapterScale { scale });
    }

    Ok(scale)
}

fn validate_lora_adapter_path(
    raw_path: Option<&Path>,
) -> Result<Option<PathBuf>, PrismRuntimeError> {
    let Some(path) = raw_path else {
        return Ok(None);
    };
    if path.as_os_str().is_empty() {
        return Ok(None);
    }
    if !path.is_absolute() {
        return Err(PrismRuntimeError::InvalidLoraAdapterPath {
            path: path.to_path_buf(),
            reason: "path must be absolute",
        });
    }
    if !path.is_file() {
        return Err(PrismRuntimeError::InvalidLoraAdapterPath {
            path: path.to_path_buf(),
            reason: "file does not exist",
        });
    }
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .map_or(true, |extension| !extension.eq_ignore_ascii_case("gguf"))
    {
        return Err(PrismRuntimeError::InvalidLoraAdapterPath {
            path: path.to_path_buf(),
            reason: "adapter must be a GGUF file",
        });
    }

    Ok(Some(path.to_path_buf()))
}

fn validate_runtime_tuning(
    request: &EnsurePrismLlamaServerRequest,
) -> Result<PrismRuntimeTuning, PrismRuntimeError> {
    let tuning = PrismRuntimeTuning {
        parallel_slots: request.parallel_slots.unwrap_or(DEFAULT_PARALLEL_SLOTS),
        http_threads: request.http_threads.unwrap_or(DEFAULT_HTTP_THREADS),
        cache_ram_mib: request.cache_ram_mib.unwrap_or(DEFAULT_CACHE_RAM_MIB),
        cache_reuse_tokens: request
            .cache_reuse_tokens
            .unwrap_or(DEFAULT_CACHE_REUSE_TOKENS),
        spec_type: request
            .spec_type
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(DEFAULT_SPEC_TYPE)
            .to_owned(),
        draft_tokens: request.draft_tokens.unwrap_or(DEFAULT_DRAFT_TOKENS),
        draft_min: request.draft_min.unwrap_or(DEFAULT_DRAFT_MIN),
        draft_probability_min: request
            .draft_probability_min
            .unwrap_or(DEFAULT_DRAFT_PROBABILITY_MIN),
    };
    validate_runtime_tuning_values(tuning)
}

fn validate_runtime_tuning_values(
    tuning: PrismRuntimeTuning,
) -> Result<PrismRuntimeTuning, PrismRuntimeError> {
    if !(1..=8).contains(&tuning.parallel_slots) {
        return Err(PrismRuntimeError::InvalidRuntimeTuning {
            field: "parallelSlots",
            reason: "must be between 1 and 8",
        });
    }
    if !(1..=32).contains(&tuning.http_threads) {
        return Err(PrismRuntimeError::InvalidRuntimeTuning {
            field: "httpThreads",
            reason: "must be between 1 and 32",
        });
    }
    if tuning.cache_ram_mib > 32_768 {
        return Err(PrismRuntimeError::InvalidRuntimeTuning {
            field: "cacheRamMib",
            reason: "must be no more than 32768",
        });
    }
    if tuning.cache_reuse_tokens > 4_096 {
        return Err(PrismRuntimeError::InvalidRuntimeTuning {
            field: "cacheReuseTokens",
            reason: "must be no more than 4096",
        });
    }
    if !matches!(
        tuning.spec_type.as_str(),
        "none" | "ngram-cache" | "ngram-simple" | "ngram-map-k" | "ngram-map-k4v" | "ngram-mod"
    ) {
        return Err(PrismRuntimeError::InvalidRuntimeTuning {
            field: "specType",
            reason: "must be none or a supported n-gram speculative mode",
        });
    }
    if !(1..=64).contains(&tuning.draft_tokens) {
        return Err(PrismRuntimeError::InvalidRuntimeTuning {
            field: "draftTokens",
            reason: "must be between 1 and 64",
        });
    }
    if tuning.draft_min == 0 || tuning.draft_min > tuning.draft_tokens {
        return Err(PrismRuntimeError::InvalidRuntimeTuning {
            field: "draftMin",
            reason: "must be between 1 and draftTokens",
        });
    }
    if !tuning.draft_probability_min.is_finite()
        || !(0.0..=1.0).contains(&tuning.draft_probability_min)
    {
        return Err(PrismRuntimeError::InvalidRuntimeTuning {
            field: "draftProbabilityMin",
            reason: "must be between 0 and 1",
        });
    }

    Ok(tuning)
}

fn resolve_lora_adapter_path(
    raw_path: Option<&Path>,
    model_key: Option<&str>,
) -> Result<Option<PathBuf>, PrismRuntimeError> {
    resolve_lora_adapter_path_with_default(raw_path, model_key, default_quartz_nano_adapter_path())
}

fn resolve_lora_adapter_path_with_default(
    raw_path: Option<&Path>,
    model_key: Option<&str>,
    default_adapter_path: Option<PathBuf>,
) -> Result<Option<PathBuf>, PrismRuntimeError> {
    let explicit_path = validate_lora_adapter_path(raw_path)?;
    if explicit_path.is_some() || !model_key_requests_default_adapter(model_key) {
        return Ok(explicit_path);
    }

    Ok(default_adapter_path.filter(|path| path.is_file()))
}

fn model_key_requests_default_adapter(model_key: Option<&str>) -> bool {
    model_key
        .map(str::trim)
        .is_some_and(|model_key| model_key == QUARTZ_NANO_MODEL_ID)
}

fn validate_endpoint(raw_endpoint: Option<&str>) -> Result<Url, PrismRuntimeError> {
    let endpoint = raw_endpoint
        .map(str::trim)
        .filter(|endpoint| !endpoint.is_empty())
        .unwrap_or(PRISM_LLAMA_CPP_DEFAULT_ENDPOINT);
    let url = Url::parse(endpoint).map_err(|source| PrismRuntimeError::InvalidEndpoint {
        endpoint: endpoint.to_owned(),
        source,
    })?;

    if !matches!(url.scheme(), "http") || !is_supported_prism_host(url.host()) {
        return Err(PrismRuntimeError::EndpointNotLocal {
            endpoint: endpoint.to_owned(),
        });
    }

    Ok(url)
}

fn start_prism_server(
    endpoint: &Url,
    lora_adapter_path: Option<&Path>,
    lora_adapter_scale: f32,
    runtime_tuning: &PrismRuntimeTuning,
) -> Result<(), PrismRuntimeError> {
    let script = prism_launcher_path()?;
    let port = endpoint
        .port_or_known_default()
        .unwrap_or(11435)
        .to_string();
    spawn_launcher(
        &script,
        &port,
        lora_adapter_path,
        lora_adapter_scale,
        runtime_tuning,
    )
}

fn prism_launcher_path() -> Result<PathBuf, PrismRuntimeError> {
    let home = home::home_dir().ok_or(PrismRuntimeError::HomeDirectoryUnavailable)?;
    let path = home
        .join("Documents")
        .join("quartz-nano")
        .join("scripts")
        .join("start-prism-bonsai-server.ps1");

    if !path.is_file() {
        return Err(PrismRuntimeError::LauncherMissing { path });
    }

    Ok(path)
}

fn spawn_launcher(
    script: &Path,
    port: &str,
    lora_adapter_path: Option<&Path>,
    lora_adapter_scale: f32,
    runtime_tuning: &PrismRuntimeTuning,
) -> Result<(), PrismRuntimeError> {
    let mut command = Command::new("powershell.exe");
    command
        .arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-File")
        .arg(script)
        .arg("-Port")
        .arg(port)
        .arg("-ParallelSlots")
        .arg(runtime_tuning.parallel_slots.to_string())
        .arg("-HttpThreads")
        .arg(runtime_tuning.http_threads.to_string())
        .arg("-CacheRamMiB")
        .arg(runtime_tuning.cache_ram_mib.to_string())
        .arg("-CacheReuse")
        .arg(runtime_tuning.cache_reuse_tokens.to_string())
        .arg("-SpecType")
        .arg(&runtime_tuning.spec_type)
        .arg("-DraftTokens")
        .arg(runtime_tuning.draft_tokens.to_string())
        .arg("-DraftMin")
        .arg(runtime_tuning.draft_min.to_string())
        .arg("-DraftProbabilityMin")
        .arg(format!("{:.4}", runtime_tuning.draft_probability_min));
    if let Some(path) = lora_adapter_path {
        command
            .arg("-LoraAdapterPath")
            .arg(path)
            .arg("-LoraAdapterScale")
            .arg(format!("{lora_adapter_scale:.4}"));
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    command
        .spawn()
        .map(|_| ())
        .map_err(|source| PrismRuntimeError::StartFailed {
            launcher: script.to_path_buf(),
            source,
        })
}

fn launch_config_matches(expected: &PrismLaunchConfig) -> bool {
    read_runtime_config().is_some_and(|actual| actual == *expected)
}

fn read_runtime_config() -> Option<PrismLaunchConfig> {
    let raw_config = fs::read_to_string(runtime_config_path()).ok()?;
    serde_json::from_str::<PrismLaunchConfig>(&raw_config).ok()
}

fn write_runtime_config(config: &PrismLaunchConfig) -> Result<(), PrismRuntimeError> {
    let path = runtime_config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| PrismRuntimeError::RuntimeConfig {
            path: parent.to_path_buf(),
            source,
        })?;
    }
    let encoded =
        serde_json::to_string_pretty(config).map_err(PrismRuntimeError::RuntimeConfigSerialize)?;
    fs::write(&path, encoded).map_err(|source| PrismRuntimeError::RuntimeConfig { path, source })
}

fn remove_runtime_config() {
    let _ = fs::remove_file(runtime_config_path());
}

fn runtime_config_path() -> PathBuf {
    quartz_nano_runtime_dir().join("prism-launch.json")
}

fn quartz_nano_runtime_dir() -> PathBuf {
    home::home_dir()
        .map(|home| quartz_nano_runtime_dir_from_home(&home))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn quartz_nano_runtime_dir_from_home(home: &Path) -> PathBuf {
    home.join("Documents")
        .join("quartz-nano")
        .join("artifacts")
        .join("runtime")
}

fn default_quartz_nano_adapter_path() -> Option<PathBuf> {
    let home = home::home_dir()?;
    Some(default_quartz_nano_adapter_path_from_home(&home))
}

fn default_quartz_nano_adapter_path_from_home(home: &Path) -> PathBuf {
    quartz_nano_runtime_dir_from_home(home).join(DEFAULT_QUARTZ_NANO_LORA_ADAPTER_FILE)
}

fn stop_wsl_prism_process(endpoint: &Url) -> Result<(), PrismRuntimeError> {
    let port = endpoint.port_or_known_default().unwrap_or(11435);
    let pattern = format!("llama-server.*--port {port}.*Ternary-Bonsai-8B-Q2_0\\.gguf");
    let command = format!("pkill -f '{}' || true", shell_single_quote(&pattern));
    let status = Command::new("wsl.exe")
        .arg("--exec")
        .arg("sh")
        .arg("-lc")
        .arg(command)
        .status()
        .map_err(|source| PrismRuntimeError::StopProcess { source })?;

    if !status.success() {
        return Err(PrismRuntimeError::StopProcessFailed {
            status: status.code(),
        });
    }

    Ok(())
}

fn shell_single_quote(value: &str) -> String {
    value.replace('\'', "'\"'\"'")
}

fn is_supported_prism_host(host: Option<Host<&str>>) -> bool {
    match host {
        Some(Host::Domain(domain)) => domain.eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(address)) => address.is_loopback(),
        Some(Host::Ipv6(_)) => false,
        None => false,
    }
}

#[derive(Debug, Error)]
pub enum PrismRuntimeError {
    #[error("Prism endpoint is invalid: {endpoint}")]
    InvalidEndpoint {
        endpoint: String,
        #[source]
        source: url::ParseError,
    },
    #[error("Prism endpoint must be a local loopback HTTP endpoint: {endpoint}")]
    EndpointNotLocal { endpoint: String },
    #[error("could not resolve the user home directory")]
    HomeDirectoryUnavailable,
    #[error("Quartz Nano Prism launcher is missing: {path}")]
    LauncherMissing { path: PathBuf },
    #[error("could not start Quartz Nano Prism launcher: {launcher}")]
    StartFailed {
        launcher: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("Quartz Nano Prism server did not become ready after {timeout:?}")]
    StartTimedOut { timeout: Duration },
    #[error("Prism stop timeout must be between 1 and 120000 ms: {timeout_ms}")]
    InvalidStopTimeout { timeout_ms: u64 },
    #[error("Prism LoRA adapter path is invalid: {path} ({reason})")]
    InvalidLoraAdapterPath { path: PathBuf, reason: &'static str },
    #[error("Prism LoRA adapter scale must be greater than 0 and no more than 4: {scale}")]
    InvalidLoraAdapterScale { scale: f32 },
    #[error("Prism runtime tuning is invalid: {field} ({reason})")]
    InvalidRuntimeTuning {
        field: &'static str,
        reason: &'static str,
    },
    #[error("Prism shutdown request failed: {endpoint}")]
    StopRequest {
        endpoint: String,
        #[source]
        source: reqwest::Error,
    },
    #[error("Prism shutdown request returned HTTP {status}: {endpoint}")]
    StopRejected {
        endpoint: String,
        status: reqwest::StatusCode,
    },
    #[error("Prism shutdown request timed out after {timeout:?}")]
    StopTimedOut { timeout: Duration },
    #[error("Prism process stop failed")]
    StopProcess {
        #[source]
        source: std::io::Error,
    },
    #[error("Prism process stop exited unsuccessfully: {status:?}")]
    StopProcessFailed { status: Option<i32> },
    #[error("could not update Prism launch config: {path}")]
    RuntimeConfig {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("could not serialize Prism launch config")]
    RuntimeConfigSerialize(#[source] serde_json::Error),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_health_endpoint() {
        let endpoint = validate_endpoint(Some("http://127.0.0.1:11435/v1/chat/completions"))
            .expect("endpoint is local");

        assert_eq!(
            health_endpoint(&endpoint).as_str(),
            "http://127.0.0.1:11435/health"
        );
    }

    #[test]
    fn builds_shutdown_endpoint() {
        let endpoint = validate_endpoint(Some("http://127.0.0.1:11435/v1/chat/completions"))
            .expect("endpoint is local");

        assert_eq!(
            shutdown_endpoint(&endpoint).as_str(),
            "http://127.0.0.1:11435/shutdown"
        );
    }

    #[test]
    fn rejects_non_local_prism_endpoint() {
        let error = validate_endpoint(Some("https://example.com")).err();

        assert!(matches!(
            error,
            Some(PrismRuntimeError::EndpointNotLocal { .. })
        ));
    }

    #[test]
    fn rejects_https_prism_endpoint() {
        let error = validate_endpoint(Some("https://localhost:11435")).err();

        assert!(matches!(
            error,
            Some(PrismRuntimeError::EndpointNotLocal { .. })
        ));
    }

    #[test]
    fn rejects_ipv6_prism_endpoint_until_launcher_binds_ipv6() {
        let error = validate_endpoint(Some("http://[::1]:11435")).err();

        assert!(matches!(
            error,
            Some(PrismRuntimeError::EndpointNotLocal { .. })
        ));
    }

    #[test]
    fn rejects_relative_lora_adapter_path() {
        let error = validate_lora_adapter_path(Some(Path::new("adapter.gguf"))).err();

        assert!(matches!(
            error,
            Some(PrismRuntimeError::InvalidLoraAdapterPath { .. })
        ));
    }

    #[test]
    fn rejects_invalid_lora_adapter_scale() {
        let error = validate_lora_adapter_scale(Some(0.0)).err();

        assert!(matches!(
            error,
            Some(PrismRuntimeError::InvalidLoraAdapterScale { .. })
        ));
    }

    #[test]
    fn builds_default_runtime_tuning() {
        let request = EnsurePrismLlamaServerRequest {
            endpoint: None,
            model_key: None,
            lora_adapter_path: None,
            lora_adapter_scale: None,
            parallel_slots: None,
            http_threads: None,
            cache_ram_mib: None,
            cache_reuse_tokens: None,
            spec_type: None,
            draft_tokens: None,
            draft_min: None,
            draft_probability_min: None,
            timeout_ms: None,
        };

        let tuning = validate_runtime_tuning(&request).expect("default tuning");

        assert_eq!(tuning, PrismRuntimeTuning::default());
    }

    #[test]
    fn rejects_unknown_speculative_runtime_mode() {
        let error = validate_runtime_tuning_values(PrismRuntimeTuning {
            spec_type: "draft-model".to_owned(),
            ..PrismRuntimeTuning::default()
        })
        .err();

        assert!(matches!(
            error,
            Some(PrismRuntimeError::InvalidRuntimeTuning {
                field: "specType",
                ..
            })
        ));
    }

    #[test]
    fn rejects_runtime_draft_min_above_draft_tokens() {
        let error = validate_runtime_tuning_values(PrismRuntimeTuning {
            draft_tokens: 4,
            draft_min: 5,
            ..PrismRuntimeTuning::default()
        })
        .err();

        assert!(matches!(
            error,
            Some(PrismRuntimeError::InvalidRuntimeTuning {
                field: "draftMin",
                ..
            })
        ));
    }

    #[test]
    fn builds_default_quartz_nano_adapter_path() {
        let home = PathBuf::from("home").join("aiden");

        assert_eq!(
            default_quartz_nano_adapter_path_from_home(&home),
            home.join("Documents")
                .join("quartz-nano")
                .join("artifacts")
                .join("runtime")
                .join(DEFAULT_QUARTZ_NANO_LORA_ADAPTER_FILE)
        );
    }

    #[test]
    fn keeps_bonsai_without_default_lora_adapter() {
        let path = resolve_lora_adapter_path_with_default(
            None,
            Some("ternary-bonsai-8b"),
            Some(PathBuf::from("adapter.gguf")),
        )
        .expect("no lora is valid");

        assert!(path.is_none());
    }

    #[test]
    fn recognizes_quartz_nano_default_lora_model_key() {
        assert!(model_key_requests_default_adapter(Some(
            QUARTZ_NANO_MODEL_ID
        )));
        assert!(!model_key_requests_default_adapter(Some(
            "ternary-bonsai-8b"
        )));
        assert!(!model_key_requests_default_adapter(None));
    }

    #[test]
    fn explicit_lora_adapter_path_overrides_quartz_nano_default() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let adapter = temp_dir.path().join("adapter.gguf");
        let default_adapter = temp_dir.path().join("default.gguf");
        fs::write(&adapter, b"gguf").expect("adapter file");
        fs::write(default_adapter, b"gguf").expect("default adapter file");

        let path = resolve_lora_adapter_path_with_default(
            Some(&adapter),
            Some(QUARTZ_NANO_MODEL_ID),
            Some(temp_dir.path().join("default.gguf")),
        )
        .expect("explicit lora path");

        assert_eq!(path.as_deref(), Some(adapter.as_path()));
    }

    #[test]
    fn uses_default_quartz_nano_lora_adapter_when_no_explicit_path() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let default_adapter = temp_dir.path().join(DEFAULT_QUARTZ_NANO_LORA_ADAPTER_FILE);
        fs::write(&default_adapter, b"gguf").expect("default adapter file");

        let path = resolve_lora_adapter_path_with_default(
            None,
            Some(QUARTZ_NANO_MODEL_ID),
            Some(default_adapter.clone()),
        )
        .expect("default lora path");

        assert_eq!(path.as_deref(), Some(default_adapter.as_path()));
    }

    #[test]
    fn escapes_shell_single_quotes_for_wsl_stop_pattern() {
        assert_eq!(shell_single_quote("a'b"), "a'\"'\"'b");
    }
}
