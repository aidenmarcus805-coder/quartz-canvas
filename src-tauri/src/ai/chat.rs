use std::time::Duration;

use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::time;
use url::{Host, Url};

const DEFAULT_OLLAMA_ENDPOINT: &str = "http://127.0.0.1:11434";
const DEFAULT_TIMEOUT_MS: u64 = 180_000;
const MIN_TIMEOUT_MS: u64 = 1_000;
const MAX_TIMEOUT_MS: u64 = 600_000;
const DEFAULT_KEEP_ALIVE: &str = "30s";
const UNLOAD_KEEP_ALIVE: u8 = 0;
const MAX_KEEP_ALIVE_CHARS: usize = 32;
const MAX_CHAT_MESSAGES: usize = 24;
const MAX_MESSAGE_CHARS: usize = 8_000;
const MAX_SYSTEM_CHARS: usize = 4_000;
const CHARS_PER_TOKEN_ESTIMATE: usize = 4;
const DEFAULT_CONTEXT_TOKENS: u32 = 8_192;
const DEFAULT_OUTPUT_TOKENS: u32 = 1_024;
const MIN_CONTEXT_TOKENS: u32 = 512;
const MAX_CONTEXT_TOKENS: u32 = 65_536;
const MAX_OUTPUT_TOKENS: u32 = 8_192;
const DEFAULT_REPEAT_PENALTY: f32 = 1.18;
const DEFAULT_REPEAT_LAST_N: u32 = 512;
const DEFAULT_TOP_P: f32 = 0.86;
const DEFAULT_TOP_K: u32 = 40;
const MAX_REPEAT_LAST_N: u32 = 8_192;
const MAX_TOP_K: u32 = 500;
const MAX_STOP_SEQUENCE_COUNT: usize = 12;
const MAX_STOP_SEQUENCE_CHARS: usize = 96;
const DEFAULT_STOP_SEQUENCES: [&str; 7] = [
    "\nUser:",
    "\nuser:",
    "\nAssistant:",
    "\nassistant:",
    "<|im_start|>",
    "<|im_end|>",
    "<|eot_id|>",
];
const MIN_INPUT_BUDGET_TOKENS: usize = 256;
const PROMPT_SAFETY_MARGIN_TOKENS: usize = 128;
const COMPACTED_HISTORY_TOKENS: usize = 256;
const COMPACTED_HISTORY_MESSAGES: usize = 6;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateChatResponseRequest {
    pub ollama_model_name: String,
    pub endpoint: Option<String>,
    pub keep_alive: Option<String>,
    #[serde(default)]
    pub think: Option<bool>,
    #[serde(default)]
    pub system_prompt: Option<String>,
    pub messages: Vec<ChatMessageRequest>,
    #[serde(default)]
    pub options: ChatGenerationOptions,
    pub timeout_ms: Option<u64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageRequest {
    pub role: ChatRole,
    pub content: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatRole {
    System,
    User,
    Assistant,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatGenerationOptions {
    pub temperature: Option<f32>,
    pub max_output_tokens: Option<u32>,
    pub context_window_tokens: Option<u32>,
    pub repeat_penalty: Option<f32>,
    pub repeat_last_n: Option<u32>,
    pub top_p: Option<f32>,
    pub top_k: Option<u32>,
    pub stop: Option<Vec<String>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateChatResponse {
    pub ollama_model_name: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
    pub prompt_eval_count: Option<u32>,
    pub eval_count: Option<u32>,
    pub total_duration_ns: Option<u64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnloadOllamaModelRequest {
    pub ollama_model_name: String,
    pub endpoint: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Serialize)]
struct OllamaChatRequest {
    model: String,
    messages: Vec<OllamaChatMessage>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    think: Option<bool>,
    #[serde(rename = "keep_alive")]
    keep_alive: String,
    options: OllamaChatOptions,
}

#[derive(Serialize)]
struct OllamaGenerateUnloadRequest {
    model: String,
    prompt: &'static str,
    stream: bool,
    #[serde(rename = "keep_alive")]
    keep_alive: u8,
}

#[derive(Clone, Serialize)]
struct OllamaChatMessage {
    role: &'static str,
    content: String,
}

#[derive(Clone)]
struct PreparedChatMessage {
    role: ChatRole,
    content: String,
}

#[derive(Default, Serialize)]
struct OllamaChatOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    num_predict: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    num_ctx: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    repeat_penalty: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    repeat_last_n: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    top_p: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    top_k: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stop: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct OllamaChatResponse {
    model: String,
    message: Option<OllamaChatResponseMessage>,
    prompt_eval_count: Option<u32>,
    eval_count: Option<u32>,
    total_duration: Option<u64>,
}

#[derive(Deserialize)]
struct OllamaChatResponseMessage {
    content: String,
    thinking: Option<String>,
}

pub async fn generate_ollama_chat_response(
    request: GenerateChatResponseRequest,
) -> Result<GenerateChatResponse, LocalChatError> {
    let chat_request = build_ollama_chat_request(&request)?;
    let endpoint = chat_endpoint(request.endpoint.as_deref())?;
    let timeout = request_timeout(request.timeout_ms)?;
    let client = reqwest::Client::new();

    let response = time::timeout(
        timeout,
        client.post(endpoint.clone()).json(&chat_request).send(),
    )
    .await
    .map_err(|_| LocalChatError::RequestTimedOut { timeout })?
    .map_err(|source| LocalChatError::Request { endpoint, source })?;

    let status = response.status();
    if !status.is_success() {
        let message = response.text().await.unwrap_or_default();
        return Err(LocalChatError::Http {
            status,
            message: trim_error_message(&message),
        });
    }

    let response = response
        .json::<OllamaChatResponse>()
        .await
        .map_err(|source| LocalChatError::Decode { source })?;

    generate_chat_response_from_ollama(response)
}

fn generate_chat_response_from_ollama(
    response: OllamaChatResponse,
) -> Result<GenerateChatResponse, LocalChatError> {
    let message = response.message.ok_or(LocalChatError::EmptyResponse)?;
    let content = message.content.trim().to_owned();
    if content.is_empty() {
        return Err(LocalChatError::EmptyResponse);
    }
    let thinking = message
        .thinking
        .map(|thinking| thinking.trim().to_owned())
        .filter(|thinking| !thinking.is_empty());

    Ok(GenerateChatResponse {
        ollama_model_name: response.model,
        content,
        thinking,
        prompt_eval_count: response.prompt_eval_count,
        eval_count: response.eval_count,
        total_duration_ns: response.total_duration,
    })
}

pub async fn unload_ollama_model(request: UnloadOllamaModelRequest) -> Result<(), LocalChatError> {
    let unload_request = OllamaGenerateUnloadRequest {
        model: normalize_ollama_model_name(&request.ollama_model_name)?,
        prompt: "",
        stream: false,
        keep_alive: UNLOAD_KEEP_ALIVE,
    };
    let endpoint = generate_endpoint(request.endpoint.as_deref())?;
    let timeout = request_timeout(request.timeout_ms.or(Some(15_000)))?;
    let client = reqwest::Client::new();

    let response = time::timeout(
        timeout,
        client.post(endpoint.clone()).json(&unload_request).send(),
    )
    .await
    .map_err(|_| LocalChatError::RequestTimedOut { timeout })?
    .map_err(|source| LocalChatError::Request { endpoint, source })?;

    let status = response.status();
    if !status.is_success() {
        let message = response.text().await.unwrap_or_default();
        return Err(LocalChatError::Http {
            status,
            message: trim_error_message(&message),
        });
    }

    Ok(())
}

fn build_ollama_chat_request(
    request: &GenerateChatResponseRequest,
) -> Result<OllamaChatRequest, LocalChatError> {
    let model = normalize_ollama_model_name(&request.ollama_model_name)?;
    let options = chat_options(&request.options)?;
    let keep_alive = validate_keep_alive(request.keep_alive.as_deref())?;
    let messages = prompt_messages(
        &request.system_prompt,
        &request.messages,
        prompt_input_budget_tokens(&options),
    );

    if !messages.iter().any(|message| message.role == "user") {
        return Err(LocalChatError::EmptyPrompt);
    }

    Ok(OllamaChatRequest {
        model,
        messages,
        stream: false,
        think: request.think,
        keep_alive,
        options,
    })
}

fn prompt_messages(
    system_prompt: &Option<String>,
    messages: &[ChatMessageRequest],
    input_budget_tokens: usize,
) -> Vec<OllamaChatMessage> {
    let prepared_messages = prepare_chat_messages(messages);
    let mut prompt = Vec::new();
    let mut remaining_tokens = input_budget_tokens.max(1);
    let has_user_message = prepared_messages
        .iter()
        .any(|message| matches!(message.role, ChatRole::User));

    if let Some(system_prompt) =
        budgeted_system_prompt(system_prompt, remaining_tokens, has_user_message)
    {
        remaining_tokens = remaining_tokens.saturating_sub(estimate_tokens(&system_prompt));
        prompt.push(OllamaChatMessage {
            role: "system",
            content: system_prompt,
        });
    }

    let mut compacted = compact_chat_history(&prepared_messages, remaining_tokens);
    prompt.append(&mut compacted);
    prompt
}

fn prepare_chat_messages(messages: &[ChatMessageRequest]) -> Vec<PreparedChatMessage> {
    messages
        .iter()
        .filter_map(|message| {
            let content = truncate_message(&message.content, MAX_MESSAGE_CHARS);
            (!content.is_empty()).then_some(PreparedChatMessage {
                role: message.role,
                content,
            })
        })
        .collect()
}

fn budgeted_system_prompt(
    system_prompt: &Option<String>,
    input_budget_tokens: usize,
    has_user_message: bool,
) -> Option<String> {
    let reserved_for_user = if has_user_message {
        MIN_INPUT_BUDGET_TOKENS.min(input_budget_tokens / 2)
    } else {
        0
    };
    let system_budget = input_budget_tokens.saturating_sub(reserved_for_user);
    truncate_optional_message_to_tokens(system_prompt, MAX_SYSTEM_CHARS, system_budget)
}

fn compact_chat_history(
    messages: &[PreparedChatMessage],
    input_budget_tokens: usize,
) -> Vec<OllamaChatMessage> {
    let Some(latest_user_index) = messages
        .iter()
        .rposition(|message| matches!(message.role, ChatRole::User))
    else {
        return Vec::new();
    };

    let mut selected = select_recent_messages(messages, latest_user_index, input_budget_tokens);
    selected.sort_by_key(|(index, _)| *index);

    let first_selected_index = selected.first().map(|(index, _)| *index).unwrap_or(0);
    let selected_tokens = selected
        .iter()
        .map(|(_, message)| estimate_tokens(&message.content))
        .sum::<usize>();
    let mut output = Vec::new();
    if first_selected_index > 0 {
        let summary_budget = input_budget_tokens.saturating_sub(selected_tokens);
        if let Some(summary) =
            compacted_history_summary(&messages[..first_selected_index], summary_budget)
        {
            output.push(OllamaChatMessage {
                role: "system",
                content: summary,
            });
        }
    }

    output.extend(selected.into_iter().map(|(_, message)| OllamaChatMessage {
        role: role_name(message.role),
        content: message.content,
    }));
    output
}

fn select_recent_messages(
    messages: &[PreparedChatMessage],
    latest_user_index: usize,
    input_budget_tokens: usize,
) -> Vec<(usize, PreparedChatMessage)> {
    let mut selected = Vec::new();
    let mut remaining_tokens = input_budget_tokens;
    let summary_reserve = if latest_user_index > 0 {
        COMPACTED_HISTORY_TOKENS.min(remaining_tokens / 4)
    } else {
        0
    };

    if let Some(message) = truncate_prepared_message(
        &messages[latest_user_index],
        remaining_tokens.saturating_sub(summary_reserve).max(1),
    ) {
        remaining_tokens = remaining_tokens.saturating_sub(estimate_tokens(&message.content));
        selected.push((latest_user_index, message));
    }

    for index in latest_user_index + 1..messages.len() {
        if selected.len() >= MAX_CHAT_MESSAGES {
            break;
        }
        let available = remaining_tokens.saturating_sub(summary_reserve);
        if let Some(message) = message_when_it_fits(&messages[index], available) {
            remaining_tokens = remaining_tokens.saturating_sub(estimate_tokens(&message.content));
            selected.push((index, message));
        }
    }

    for index in (0..latest_user_index).rev() {
        if selected.len() >= MAX_CHAT_MESSAGES {
            break;
        }
        let available = remaining_tokens.saturating_sub(summary_reserve);
        let Some(message) = message_when_it_fits(&messages[index], available) else {
            break;
        };
        remaining_tokens = remaining_tokens.saturating_sub(estimate_tokens(&message.content));
        selected.push((index, message));
    }

    selected
}

fn message_when_it_fits(
    message: &PreparedChatMessage,
    available_tokens: usize,
) -> Option<PreparedChatMessage> {
    (estimate_tokens(&message.content) <= available_tokens).then(|| message.clone())
}

fn truncate_prepared_message(
    message: &PreparedChatMessage,
    token_budget: usize,
) -> Option<PreparedChatMessage> {
    truncate_message_to_tokens(&message.content, token_budget).map(|content| PreparedChatMessage {
        role: message.role,
        content,
    })
}

fn compacted_history_summary(
    omitted_messages: &[PreparedChatMessage],
    token_budget: usize,
) -> Option<String> {
    if omitted_messages.is_empty() || token_budget == 0 {
        return None;
    }

    let mut summary = format!(
        "Earlier conversation summary ({} older messages compacted):",
        omitted_messages.len()
    );
    for message in omitted_messages
        .iter()
        .rev()
        .take(COMPACTED_HISTORY_MESSAGES)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
    {
        summary.push_str("\n- ");
        summary.push_str(role_name(message.role));
        summary.push_str(": ");
        summary.push_str(&truncate_message(&message.content, 160));
    }

    truncate_message_to_tokens(&summary, token_budget)
}

fn prompt_input_budget_tokens(options: &OllamaChatOptions) -> usize {
    let context_tokens = options.num_ctx.unwrap_or(DEFAULT_CONTEXT_TOKENS) as usize;
    let requested_output_tokens = options.num_predict.unwrap_or(DEFAULT_OUTPUT_TOKENS) as usize;
    let max_reserve = context_tokens
        .saturating_sub(MIN_INPUT_BUDGET_TOKENS)
        .saturating_sub(PROMPT_SAFETY_MARGIN_TOKENS);
    let output_reserve = requested_output_tokens.min(max_reserve);

    context_tokens
        .saturating_sub(output_reserve)
        .saturating_sub(PROMPT_SAFETY_MARGIN_TOKENS)
        .max(1)
}

fn chat_endpoint(raw_endpoint: Option<&str>) -> Result<Url, LocalChatError> {
    api_endpoint(raw_endpoint, "/api/chat")
}

fn generate_endpoint(raw_endpoint: Option<&str>) -> Result<Url, LocalChatError> {
    api_endpoint(raw_endpoint, "/api/generate")
}

fn api_endpoint(raw_endpoint: Option<&str>, path: &str) -> Result<Url, LocalChatError> {
    let endpoint = raw_endpoint
        .map(str::trim)
        .filter(|endpoint| !endpoint.is_empty())
        .unwrap_or(DEFAULT_OLLAMA_ENDPOINT);
    let mut url = Url::parse(endpoint).map_err(|source| LocalChatError::InvalidEndpoint {
        endpoint: endpoint.to_owned(),
        source,
    })?;

    if !matches!(url.scheme(), "http" | "https") || !is_loopback_host(url.host()) {
        return Err(LocalChatError::EndpointNotLocal {
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

fn request_timeout(timeout_ms: Option<u64>) -> Result<Duration, LocalChatError> {
    let timeout_ms = timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS);
    if !(MIN_TIMEOUT_MS..=MAX_TIMEOUT_MS).contains(&timeout_ms) {
        return Err(LocalChatError::InvalidTimeout { timeout_ms });
    }
    Ok(Duration::from_millis(timeout_ms))
}

fn validate_keep_alive(value: Option<&str>) -> Result<String, LocalChatError> {
    let keep_alive = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_KEEP_ALIVE);

    if keep_alive.chars().count() > MAX_KEEP_ALIVE_CHARS {
        return Err(LocalChatError::InvalidKeepAlive {
            value: keep_alive.to_owned(),
        });
    }

    let valid = keep_alive
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '.');
    if !valid {
        return Err(LocalChatError::InvalidKeepAlive {
            value: keep_alive.to_owned(),
        });
    }

    Ok(keep_alive.to_owned())
}

fn chat_options(options: &ChatGenerationOptions) -> Result<OllamaChatOptions, LocalChatError> {
    let max_output_tokens =
        validate_max_output_tokens(options.max_output_tokens)?.unwrap_or(DEFAULT_OUTPUT_TOKENS);
    let context_window_tokens = validate_context_window_tokens(options.context_window_tokens)?
        .unwrap_or(DEFAULT_CONTEXT_TOKENS);

    Ok(OllamaChatOptions {
        temperature: validate_temperature(options.temperature)?,
        num_predict: Some(max_output_tokens),
        num_ctx: Some(context_window_tokens),
        repeat_penalty: Some(validate_repeat_penalty(options.repeat_penalty)?),
        repeat_last_n: Some(validate_repeat_last_n(options.repeat_last_n)?),
        top_p: Some(validate_top_p(options.top_p)?),
        top_k: Some(validate_top_k(options.top_k)?),
        stop: Some(validate_stop_sequences(options.stop.as_deref())?),
    })
}

fn validate_temperature(temperature: Option<f32>) -> Result<Option<f32>, LocalChatError> {
    match temperature {
        Some(temperature) if !temperature.is_finite() || !(0.0..=2.0).contains(&temperature) => {
            Err(LocalChatError::InvalidTemperature { temperature })
        }
        _ => Ok(temperature),
    }
}

fn validate_max_output_tokens(tokens: Option<u32>) -> Result<Option<u32>, LocalChatError> {
    match tokens {
        Some(0) => Err(LocalChatError::InvalidMaxOutputTokens {
            tokens: 0,
            maximum: MAX_OUTPUT_TOKENS,
        }),
        Some(tokens) if tokens > MAX_OUTPUT_TOKENS => Err(LocalChatError::InvalidMaxOutputTokens {
            tokens,
            maximum: MAX_OUTPUT_TOKENS,
        }),
        _ => Ok(tokens),
    }
}

fn validate_context_window_tokens(tokens: Option<u32>) -> Result<Option<u32>, LocalChatError> {
    match tokens {
        Some(tokens) if !(MIN_CONTEXT_TOKENS..=MAX_CONTEXT_TOKENS).contains(&tokens) => {
            Err(LocalChatError::InvalidContextWindowTokens {
                tokens,
                minimum: MIN_CONTEXT_TOKENS,
                maximum: MAX_CONTEXT_TOKENS,
            })
        }
        _ => Ok(tokens),
    }
}

fn validate_repeat_penalty(value: Option<f32>) -> Result<f32, LocalChatError> {
    match value {
        Some(value) if !value.is_finite() || !(0.8..=2.0).contains(&value) => {
            Err(LocalChatError::InvalidRepeatPenalty { value })
        }
        Some(value) => Ok(value),
        None => Ok(DEFAULT_REPEAT_PENALTY),
    }
}

fn validate_repeat_last_n(value: Option<u32>) -> Result<u32, LocalChatError> {
    match value {
        Some(0) => Err(LocalChatError::InvalidRepeatLastN {
            value: 0,
            maximum: MAX_REPEAT_LAST_N,
        }),
        Some(value) if value > MAX_REPEAT_LAST_N => Err(LocalChatError::InvalidRepeatLastN {
            value,
            maximum: MAX_REPEAT_LAST_N,
        }),
        Some(value) => Ok(value),
        None => Ok(DEFAULT_REPEAT_LAST_N),
    }
}

fn validate_top_p(value: Option<f32>) -> Result<f32, LocalChatError> {
    match value {
        Some(value) if !value.is_finite() || !(0.05..=1.0).contains(&value) => {
            Err(LocalChatError::InvalidTopP { value })
        }
        Some(value) => Ok(value),
        None => Ok(DEFAULT_TOP_P),
    }
}

fn validate_top_k(value: Option<u32>) -> Result<u32, LocalChatError> {
    match value {
        Some(0) => Err(LocalChatError::InvalidTopK {
            value: 0,
            maximum: MAX_TOP_K,
        }),
        Some(value) if value > MAX_TOP_K => Err(LocalChatError::InvalidTopK {
            value,
            maximum: MAX_TOP_K,
        }),
        Some(value) => Ok(value),
        None => Ok(DEFAULT_TOP_K),
    }
}

fn validate_stop_sequences(value: Option<&[String]>) -> Result<Vec<String>, LocalChatError> {
    let sequences: Vec<String> = match value {
        Some(value) if !value.is_empty() => {
            value.iter().map(|item| item.trim().to_owned()).collect()
        }
        _ => DEFAULT_STOP_SEQUENCES
            .iter()
            .map(|item| (*item).to_owned())
            .collect(),
    };

    if sequences.len() > MAX_STOP_SEQUENCE_COUNT {
        return Err(LocalChatError::InvalidStopSequences {
            reason: format!("too many stop sequences: {}", sequences.len()),
        });
    }

    let mut cleaned = Vec::with_capacity(sequences.len());
    for sequence in sequences {
        if sequence.is_empty() {
            return Err(LocalChatError::InvalidStopSequences {
                reason: "empty stop sequence".to_owned(),
            });
        }
        if sequence.chars().count() > MAX_STOP_SEQUENCE_CHARS {
            return Err(LocalChatError::InvalidStopSequences {
                reason: "stop sequence is too long".to_owned(),
            });
        }
        if !cleaned.iter().any(|item| item == &sequence) {
            cleaned.push(sequence);
        }
    }

    Ok(cleaned)
}

fn normalize_ollama_model_name(name: &str) -> Result<String, LocalChatError> {
    let trimmed = name.trim();
    if !trimmed.is_empty()
        && trimmed.len() <= 128
        && !trimmed.starts_with(':')
        && !trimmed.ends_with(':')
        && trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':'))
    {
        Ok(trimmed.to_owned())
    } else {
        Err(LocalChatError::InvalidModelName {
            model: name.to_owned(),
        })
    }
}

fn role_name(role: ChatRole) -> &'static str {
    match role {
        ChatRole::System => "system",
        ChatRole::User => "user",
        ChatRole::Assistant => "assistant",
    }
}

fn truncate_optional_message_to_tokens(
    value: &Option<String>,
    max_chars: usize,
    token_budget: usize,
) -> Option<String> {
    value
        .as_deref()
        .map(|content| truncate_message(content, max_chars))
        .and_then(|content| truncate_message_to_tokens(&content, token_budget))
        .filter(|content| !content.is_empty())
}

fn truncate_message(value: &str, max_chars: usize) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_owned();
    }
    trimmed.chars().take(max_chars).collect()
}

fn truncate_message_to_tokens(value: &str, token_budget: usize) -> Option<String> {
    if token_budget == 0 {
        return None;
    }

    let max_chars = token_budget.saturating_mul(CHARS_PER_TOKEN_ESTIMATE);
    let truncated = truncate_message(value, max_chars);
    (!truncated.is_empty()).then_some(truncated)
}

fn estimate_tokens(value: &str) -> usize {
    let chars = value.chars().count();
    chars.saturating_add(CHARS_PER_TOKEN_ESTIMATE - 1) / CHARS_PER_TOKEN_ESTIMATE
}

fn trim_error_message(message: &str) -> String {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return "Ollama request failed".to_owned();
    }
    truncate_message(trimmed, 500)
}

#[derive(Debug, Error)]
pub enum LocalChatError {
    #[error("Ollama model name is invalid: {model}")]
    InvalidModelName { model: String },
    #[error("chat prompt is empty")]
    EmptyPrompt,
    #[error("Ollama endpoint is invalid: {endpoint}")]
    InvalidEndpoint {
        endpoint: String,
        #[source]
        source: url::ParseError,
    },
    #[error("Ollama endpoint must be a local loopback HTTP endpoint: {endpoint}")]
    EndpointNotLocal { endpoint: String },
    #[error("chat timeout must be between 1000 and 600000 ms: {timeout_ms}")]
    InvalidTimeout { timeout_ms: u64 },
    #[error("temperature must be finite and within 0.0..=2.0: {temperature}")]
    InvalidTemperature { temperature: f32 },
    #[error("max output tokens must be within 1..={maximum}: {tokens}")]
    InvalidMaxOutputTokens { tokens: u32, maximum: u32 },
    #[error("context window tokens must be within {minimum}..={maximum}: {tokens}")]
    InvalidContextWindowTokens {
        tokens: u32,
        minimum: u32,
        maximum: u32,
    },
    #[error("repeat penalty must be finite and within 0.8..=2.0: {value}")]
    InvalidRepeatPenalty { value: f32 },
    #[error("repeat last n must be within 1..={maximum}: {value}")]
    InvalidRepeatLastN { value: u32, maximum: u32 },
    #[error("top p must be finite and within 0.05..=1.0: {value}")]
    InvalidTopP { value: f32 },
    #[error("top k must be within 1..={maximum}: {value}")]
    InvalidTopK { value: u32, maximum: u32 },
    #[error("stop sequences are invalid: {reason}")]
    InvalidStopSequences { reason: String },
    #[error("keep alive duration is invalid: {value}")]
    InvalidKeepAlive { value: String },
    #[error("Ollama chat request timed out after {timeout:?}")]
    RequestTimedOut { timeout: Duration },
    #[error("Ollama chat request failed: {endpoint}")]
    Request {
        endpoint: Url,
        #[source]
        source: reqwest::Error,
    },
    #[error("Ollama returned HTTP {status}: {message}")]
    Http { status: StatusCode, message: String },
    #[error("could not decode Ollama chat response")]
    Decode {
        #[source]
        source: reqwest::Error,
    },
    #[error("Ollama returned an empty response")]
    EmptyResponse,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_local_endpoints() {
        let error = chat_endpoint(Some("https://example.com")).err();

        assert!(matches!(
            error,
            Some(LocalChatError::EndpointNotLocal { .. })
        ));
    }

    #[test]
    fn builds_local_chat_endpoint() {
        let endpoint =
            chat_endpoint(Some("http://localhost:11434/custom")).expect("endpoint is local");

        assert_eq!(endpoint.as_str(), "http://localhost:11434/api/chat");
    }

    #[test]
    fn builds_local_generate_endpoint() {
        let endpoint =
            generate_endpoint(Some("http://127.0.0.1:11434/custom")).expect("endpoint is local");

        assert_eq!(endpoint.as_str(), "http://127.0.0.1:11434/api/generate");
    }

    #[test]
    fn builds_ollama_request_with_recent_messages() {
        let request = GenerateChatResponseRequest {
            ollama_model_name: "qwopus:q4_k_m".to_owned(),
            endpoint: None,
            keep_alive: None,
            think: None,
            system_prompt: Some("system".to_owned()),
            messages: vec![
                ChatMessageRequest {
                    role: ChatRole::User,
                    content: "hello".to_owned(),
                },
                ChatMessageRequest {
                    role: ChatRole::Assistant,
                    content: "hi".to_owned(),
                },
            ],
            options: ChatGenerationOptions {
                temperature: Some(0.2),
                max_output_tokens: Some(512),
                context_window_tokens: Some(8192),
                ..Default::default()
            },
            timeout_ms: None,
        };

        let built = build_ollama_chat_request(&request).expect("request is valid");

        assert_eq!(built.model, "qwopus:q4_k_m");
        assert_eq!(built.messages.len(), 3);
        assert_eq!(built.messages[0].role, "system");
        assert_eq!(built.messages[1].role, "user");
        assert_eq!(built.messages[2].role, "assistant");
        assert_eq!(built.keep_alive, DEFAULT_KEEP_ALIVE);
        assert_eq!(built.options.num_ctx, Some(8192));
        assert_eq!(built.options.repeat_penalty, Some(DEFAULT_REPEAT_PENALTY));
        assert_eq!(built.options.repeat_last_n, Some(DEFAULT_REPEAT_LAST_N));
        assert_eq!(built.options.top_p, Some(DEFAULT_TOP_P));
        assert_eq!(built.options.top_k, Some(DEFAULT_TOP_K));
        assert_eq!(
            built.options.stop,
            Some(
                DEFAULT_STOP_SEQUENCES
                    .iter()
                    .map(|item| (*item).to_owned())
                    .collect()
            )
        );
    }

    #[test]
    fn serializes_ollama_request_with_think_enabled() {
        let request = GenerateChatResponseRequest {
            ollama_model_name: "qwen3:latest".to_owned(),
            endpoint: None,
            keep_alive: None,
            think: Some(true),
            system_prompt: None,
            messages: vec![ChatMessageRequest {
                role: ChatRole::User,
                content: "show your work".to_owned(),
            }],
            options: ChatGenerationOptions::default(),
            timeout_ms: None,
        };

        let built = build_ollama_chat_request(&request).expect("request is valid");
        let json = serde_json::to_value(&built).expect("request serializes");

        assert_eq!(json.get("think"), Some(&serde_json::Value::Bool(true)));
    }

    #[test]
    fn parses_thinking_response_without_changing_content() {
        let response = serde_json::from_str::<OllamaChatResponse>(
            r#"{
                "model": "qwen3:latest",
                "message": {
                    "role": "assistant",
                    "thinking": " reasoning trace ",
                    "content": " final answer "
                },
                "prompt_eval_count": 12,
                "eval_count": 34,
                "total_duration": 56
            }"#,
        )
        .expect("response shape is valid");

        let parsed =
            generate_chat_response_from_ollama(response).expect("response content is present");

        assert_eq!(parsed.ollama_model_name, "qwen3:latest");
        assert_eq!(parsed.content, "final answer");
        assert_eq!(parsed.thinking.as_deref(), Some("reasoning trace"));
        assert_eq!(parsed.prompt_eval_count, Some(12));
        assert_eq!(parsed.eval_count, Some(34));
        assert_eq!(parsed.total_duration_ns, Some(56));
    }

    #[test]
    fn accepts_custom_keep_alive() {
        let request = GenerateChatResponseRequest {
            ollama_model_name: "qwopus:q4_k_m".to_owned(),
            endpoint: None,
            keep_alive: Some("2m".to_owned()),
            think: None,
            system_prompt: None,
            messages: vec![ChatMessageRequest {
                role: ChatRole::User,
                content: "hello".to_owned(),
            }],
            options: ChatGenerationOptions::default(),
            timeout_ms: None,
        };

        let built = build_ollama_chat_request(&request).expect("request is valid");

        assert_eq!(built.keep_alive, "2m");
    }

    #[test]
    fn rejects_invalid_keep_alive() {
        let request = GenerateChatResponseRequest {
            ollama_model_name: "qwopus:q4_k_m".to_owned(),
            endpoint: None,
            keep_alive: Some("2 minutes".to_owned()),
            think: None,
            system_prompt: None,
            messages: vec![ChatMessageRequest {
                role: ChatRole::User,
                content: "hello".to_owned(),
            }],
            options: ChatGenerationOptions::default(),
            timeout_ms: None,
        };

        let error = build_ollama_chat_request(&request).err();

        assert!(matches!(
            error,
            Some(LocalChatError::InvalidKeepAlive { .. })
        ));
    }

    #[test]
    fn rejects_empty_user_prompt() {
        let request = GenerateChatResponseRequest {
            ollama_model_name: "qwopus:q4_k_m".to_owned(),
            endpoint: None,
            keep_alive: None,
            think: None,
            system_prompt: Some("system".to_owned()),
            messages: Vec::new(),
            options: ChatGenerationOptions::default(),
            timeout_ms: None,
        };

        let error = build_ollama_chat_request(&request).err();

        assert!(matches!(error, Some(LocalChatError::EmptyPrompt)));
    }

    #[test]
    fn rejects_invalid_generation_options_before_calling_ollama() {
        let request = GenerateChatResponseRequest {
            ollama_model_name: "qwopus:q4_k_m".to_owned(),
            endpoint: None,
            keep_alive: None,
            think: None,
            system_prompt: None,
            messages: vec![ChatMessageRequest {
                role: ChatRole::User,
                content: "hello".to_owned(),
            }],
            options: ChatGenerationOptions {
                temperature: Some(2.1),
                max_output_tokens: Some(512),
                context_window_tokens: Some(8192),
                ..Default::default()
            },
            timeout_ms: None,
        };

        let error = build_ollama_chat_request(&request).err();

        assert!(matches!(
            error,
            Some(LocalChatError::InvalidTemperature { .. })
        ));
    }

    #[test]
    fn rejects_invalid_context_window_before_calling_ollama() {
        let request = GenerateChatResponseRequest {
            ollama_model_name: "qwopus:q4_k_m".to_owned(),
            endpoint: None,
            keep_alive: None,
            think: None,
            system_prompt: None,
            messages: vec![ChatMessageRequest {
                role: ChatRole::User,
                content: "hello".to_owned(),
            }],
            options: ChatGenerationOptions {
                temperature: None,
                max_output_tokens: Some(512),
                context_window_tokens: Some(MIN_CONTEXT_TOKENS - 1),
                ..Default::default()
            },
            timeout_ms: None,
        };

        let error = build_ollama_chat_request(&request).err();

        assert!(matches!(
            error,
            Some(LocalChatError::InvalidContextWindowTokens { .. })
        ));
    }

    #[test]
    fn compacts_old_long_history_under_input_budget() {
        let mut messages = Vec::new();
        for index in 0..30 {
            messages.push(ChatMessageRequest {
                role: ChatRole::User,
                content: format!("old-user-{index} {}", "x".repeat(2_400)),
            });
            messages.push(ChatMessageRequest {
                role: ChatRole::Assistant,
                content: format!("old-assistant-{index} {}", "y".repeat(2_400)),
            });
        }
        messages.push(ChatMessageRequest {
            role: ChatRole::User,
            content: "RECENT_USER_SENTINEL: keep this request".to_owned(),
        });
        let original_message_count = messages.len();
        let request = GenerateChatResponseRequest {
            ollama_model_name: "qwopus:q4_k_m".to_owned(),
            endpoint: None,
            keep_alive: None,
            think: None,
            system_prompt: None,
            messages,
            options: ChatGenerationOptions {
                temperature: None,
                max_output_tokens: Some(512),
                context_window_tokens: Some(2_048),
                ..Default::default()
            },
            timeout_ms: None,
        };

        let built = build_ollama_chat_request(&request).expect("request is valid");
        let prompt_tokens = built
            .messages
            .iter()
            .map(|message| estimate_tokens(&message.content))
            .sum::<usize>();
        let input_budget = prompt_input_budget_tokens(&built.options);

        assert!(
            prompt_tokens <= input_budget,
            "prompt tokens {prompt_tokens} exceeded input budget {input_budget}"
        );
        assert!(built.messages.len() < original_message_count);
        assert!(built.messages.iter().any(|message| {
            message.role == "system" && message.content.contains("older messages compacted")
        }));
        assert!(!built
            .messages
            .iter()
            .any(|message| message.content.contains("old-user-0")));
    }

    #[test]
    fn preserves_recent_user_message_when_history_exceeds_budget() {
        let mut messages = Vec::new();
        for index in 0..12 {
            messages.push(ChatMessageRequest {
                role: ChatRole::Assistant,
                content: format!("stale-assistant-{index} {}", "a".repeat(1_200)),
            });
        }
        messages.push(ChatMessageRequest {
            role: ChatRole::User,
            content: format!("RECENT_USER_SENTINEL {}", "z".repeat(6_000)),
        });
        let request = GenerateChatResponseRequest {
            ollama_model_name: "qwopus:q4_k_m".to_owned(),
            endpoint: None,
            keep_alive: None,
            think: None,
            system_prompt: Some("system prompt".to_owned()),
            messages,
            options: ChatGenerationOptions {
                temperature: None,
                max_output_tokens: Some(256),
                context_window_tokens: Some(512),
                ..Default::default()
            },
            timeout_ms: None,
        };

        let built = build_ollama_chat_request(&request).expect("request is valid");

        assert!(built.messages.iter().any(|message| {
            message.role == "user" && message.content.starts_with("RECENT_USER_SENTINEL")
        }));
        assert!(!built
            .messages
            .iter()
            .any(|message| message.content.contains("stale-assistant-0")));
    }
}
