use std::time::Duration;

use reqwest::{redirect::Policy, StatusCode};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use thiserror::Error;
use url::Url;

const DEFAULT_SEARCH_LIMIT: u8 = 12;
const MAX_SEARCH_LIMIT: u8 = 25;
const SEARCH_CANDIDATE_MULTIPLIER: u8 = 3;
const MAX_SEARCH_CANDIDATES: u8 = 50;
const SEARCH_QUERY_MAX_LEN: usize = 80;

#[derive(Clone, Debug)]
pub struct ValidatedHuggingFaceGgufUrl {
    pub owner: String,
    pub repo_name: String,
    pub repo: String,
    pub revision: String,
    pub file_path: String,
    pub file_name: String,
    pub download_url: Url,
}

impl ValidatedHuggingFaceGgufUrl {
    pub fn source(&self) -> HuggingFaceGgufSource {
        HuggingFaceGgufSource {
            repo: self.repo.clone(),
            revision: self.revision.clone(),
            file: self.file_path.clone(),
            file_name: self.file_name.clone(),
            download_url: self.download_url.to_string(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HuggingFaceGgufSource {
    pub repo: String,
    pub revision: String,
    pub file: String,
    pub file_name: String,
    pub download_url: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHuggingFaceGgufModelsRequest {
    pub query: String,
    pub limit: Option<u8>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HuggingFaceGgufSearchResponse {
    pub query: String,
    pub models: Vec<HuggingFaceGgufModel>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HuggingFaceGgufModel {
    pub repo: String,
    pub owner: String,
    pub author: Option<String>,
    pub downloads: Option<u64>,
    pub likes: Option<u64>,
    pub tags: Vec<String>,
    pub last_modified: Option<String>,
    pub gguf_files: Vec<HuggingFaceGgufFile>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HuggingFaceGgufFile {
    pub file: String,
    pub file_name: String,
    pub size_bytes: Option<u64>,
    pub download_url: String,
}

pub async fn search_hugging_face_gguf_models(
    request: SearchHuggingFaceGgufModelsRequest,
) -> Result<HuggingFaceGgufSearchResponse, HuggingFaceError> {
    let query = validate_search_query(&request.query)?;
    let limit = request
        .limit
        .unwrap_or(DEFAULT_SEARCH_LIMIT)
        .clamp(1, MAX_SEARCH_LIMIT);
    let client = hugging_face_client()?;
    let summaries: Vec<HfModelSummary> =
        fetch_json(&client, search_url(&query, search_candidate_limit(limit))?).await?;
    let mut models = Vec::new();

    for summary in summaries {
        if models.len() >= usize::from(limit) {
            break;
        }

        let Some(repo) = summary.repo_id() else {
            continue;
        };
        if !is_valid_hf_repo_id(&repo) {
            continue;
        }

        let summary = summary_with_gguf_files(&client, &repo, summary).await?;
        if let Some(model) = gguf_model_from_summary(&repo, summary) {
            models.push(model);
        }
    }

    Ok(HuggingFaceGgufSearchResponse { query, models })
}

pub fn validate_hugging_face_gguf_url(
    raw_url: &str,
) -> Result<ValidatedHuggingFaceGgufUrl, HuggingFaceError> {
    let url = Url::parse(raw_url.trim()).map_err(|_| HuggingFaceError::InvalidUrl {
        reason: "URL could not be parsed".to_owned(),
    })?;

    if url.scheme() != "https" || url.host_str() != Some("huggingface.co") {
        return Err(HuggingFaceError::InvalidUrl {
            reason: "URL must use https://huggingface.co".to_owned(),
        });
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(HuggingFaceError::InvalidUrl {
            reason: "URL must not include credentials, ports, query strings, or fragments"
                .to_owned(),
        });
    }

    let segments = url
        .path_segments()
        .map(|segments| segments.map(str::to_owned).collect::<Vec<_>>())
        .ok_or_else(|| HuggingFaceError::InvalidUrl {
            reason: "URL path is missing".to_owned(),
        })?;
    if segments.len() < 5 {
        return Err(HuggingFaceError::InvalidUrl {
            reason: "URL must include owner, repository, resolve/blob, revision, and GGUF file"
                .to_owned(),
        });
    }

    let owner = segments[0].clone();
    let repo_name = segments[1].clone();
    let mode = segments[2].as_str();
    let revision = segments[3].clone();
    let file_path = segments[4..].join("/");

    if !is_repo_component(&owner) || !is_repo_component(&repo_name) {
        return Err(HuggingFaceError::InvalidUrl {
            reason: "repository id is invalid".to_owned(),
        });
    }
    if !matches!(mode, "resolve" | "blob") {
        return Err(HuggingFaceError::InvalidUrl {
            reason: "URL must point to a resolve or blob file path".to_owned(),
        });
    }
    if !is_safe_hf_path_component(&revision) {
        return Err(HuggingFaceError::InvalidUrl {
            reason: "revision is invalid".to_owned(),
        });
    }
    if !is_safe_relative_gguf_path(&file_path) {
        return Err(HuggingFaceError::InvalidUrl {
            reason: "file path must be a safe relative .gguf path".to_owned(),
        });
    }

    let file_name = file_path
        .rsplit('/')
        .next()
        .filter(|name| is_safe_hf_path_component(name))
        .ok_or_else(|| HuggingFaceError::InvalidUrl {
            reason: "file name is invalid".to_owned(),
        })?
        .to_owned();
    let repo = format!("{owner}/{repo_name}");
    let download_url = download_url_for(&repo, &revision, &file_path)?;

    Ok(ValidatedHuggingFaceGgufUrl {
        owner,
        repo_name,
        repo,
        revision,
        file_path,
        file_name,
        download_url,
    })
}

pub fn hugging_face_client() -> Result<reqwest::Client, HuggingFaceError> {
    reqwest::Client::builder()
        .user_agent("Quartz Canvas local model marketplace")
        .connect_timeout(Duration::from_secs(15))
        .redirect(hugging_face_redirect_policy())
        .build()
        .map_err(|source| HuggingFaceError::Client { source })
}

pub fn is_valid_hf_repo_id(repo: &str) -> bool {
    let mut parts = repo.split('/');
    let Some(owner) = parts.next() else {
        return false;
    };
    let Some(name) = parts.next() else {
        return false;
    };
    parts.next().is_none() && is_repo_component(owner) && is_repo_component(name)
}

fn validate_search_query(query: &str) -> Result<String, HuggingFaceError> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Err(HuggingFaceError::InvalidSearchQuery {
            reason: "query is empty".to_owned(),
        });
    }
    if trimmed.len() > SEARCH_QUERY_MAX_LEN {
        return Err(HuggingFaceError::InvalidSearchQuery {
            reason: format!("query must be at most {SEARCH_QUERY_MAX_LEN} characters"),
        });
    }
    Ok(trimmed.to_owned())
}

fn search_url(query: &str, limit: u8) -> Result<Url, HuggingFaceError> {
    let mut url =
        Url::parse("https://huggingface.co/api/models").map_err(HuggingFaceError::from)?;
    url.query_pairs_mut()
        .append_pair("search", query)
        .append_pair("filter", "gguf")
        .append_pair("sort", "downloads")
        .append_pair("direction", "-1")
        .append_pair("limit", &limit.to_string())
        .append_pair("full", "true");
    Ok(url)
}

fn search_candidate_limit(limit: u8) -> u8 {
    limit
        .saturating_mul(SEARCH_CANDIDATE_MULTIPLIER)
        .min(MAX_SEARCH_CANDIDATES)
        .max(limit)
}

fn model_detail_url(repo: &str) -> Result<Url, HuggingFaceError> {
    Url::parse(&format!("https://huggingface.co/api/models/{repo}")).map_err(HuggingFaceError::from)
}

fn download_url_for(repo: &str, revision: &str, file_path: &str) -> Result<Url, HuggingFaceError> {
    Url::parse(&format!(
        "https://huggingface.co/{repo}/resolve/{revision}/{file_path}"
    ))
    .map_err(HuggingFaceError::from)
}

async fn fetch_json<T: DeserializeOwned>(
    client: &reqwest::Client,
    url: Url,
) -> Result<T, HuggingFaceError> {
    let raw_url = url.to_string();
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|source| HuggingFaceError::Request {
            url: raw_url.clone(),
            source,
        })?;
    let status = response.status();
    if !status.is_success() {
        return Err(HuggingFaceError::Http {
            url: raw_url,
            status,
        });
    }
    response
        .json::<T>()
        .await
        .map_err(|source| HuggingFaceError::Decode {
            url: raw_url,
            source,
        })
}

async fn summary_with_gguf_files(
    client: &reqwest::Client,
    repo: &str,
    summary: HfModelSummary,
) -> Result<HfModelSummary, HuggingFaceError> {
    if summary_has_gguf_files(&summary) {
        return Ok(summary);
    }

    fetch_json(client, model_detail_url(repo)?).await
}

fn gguf_model_from_summary(repo: &str, summary: HfModelSummary) -> Option<HuggingFaceGgufModel> {
    let owner = repo_owner(repo)?.to_owned();
    let siblings = summary.siblings.as_deref().unwrap_or_default();
    let gguf_files = gguf_files_for_repo(repo, siblings);
    if gguf_files.is_empty() || !is_usable_text_gguf_model(repo, &summary, &gguf_files) {
        return None;
    }

    Some(HuggingFaceGgufModel {
        repo: repo.to_owned(),
        owner,
        author: summary.author,
        downloads: summary.downloads,
        likes: summary.likes,
        tags: summary.tags.unwrap_or_default(),
        last_modified: summary.last_modified,
        gguf_files,
    })
}

fn summary_has_gguf_files(summary: &HfModelSummary) -> bool {
    summary.siblings.as_deref().is_some_and(|siblings| {
        siblings
            .iter()
            .any(|file| is_safe_relative_gguf_path(&file.rfilename))
    })
}

fn gguf_files_for_repo(repo: &str, siblings: &[HfSibling]) -> Vec<HuggingFaceGgufFile> {
    siblings
        .iter()
        .filter_map(|sibling| {
            if !is_searchable_gguf_model_file(&sibling.rfilename) {
                return None;
            }
            let file_name = sibling.rfilename.rsplit('/').next()?.to_owned();
            let download_url = download_url_for(repo, "main", &sibling.rfilename).ok()?;
            Some(HuggingFaceGgufFile {
                file: sibling.rfilename.clone(),
                file_name,
                size_bytes: sibling
                    .size
                    .or_else(|| sibling.lfs.as_ref().map(|lfs| lfs.size)),
                download_url: download_url.to_string(),
            })
        })
        .collect()
}

fn is_usable_text_gguf_model(
    repo: &str,
    summary: &HfModelSummary,
    gguf_files: &[HuggingFaceGgufFile],
) -> bool {
    if has_blocked_task_tag(summary) {
        return false;
    }

    let index = ModelTextIndex::new(repo_name(repo).unwrap_or(repo), summary, gguf_files);
    if index.has_blocked_model_family() {
        return false;
    }

    has_accepted_text_task(summary) || index.has_chat_like_marker()
}

fn has_accepted_text_task(summary: &HfModelSummary) -> bool {
    summary
        .pipeline_tag
        .as_deref()
        .is_some_and(is_accepted_text_task)
        || summary
            .tags
            .as_deref()
            .is_some_and(|tags| tags.iter().any(|tag| is_accepted_text_task(tag.as_str())))
}

fn is_accepted_text_task(tag: &str) -> bool {
    let tag = tag.trim().to_ascii_lowercase();
    matches!(
        tag.as_str(),
        "text-generation" | "text2text-generation" | "image-text-to-text" | "conversational"
    )
}

fn has_blocked_task_tag(summary: &HfModelSummary) -> bool {
    summary
        .pipeline_tag
        .as_deref()
        .is_some_and(is_blocked_task_tag)
        || summary
            .tags
            .as_deref()
            .is_some_and(|tags| tags.iter().any(|tag| is_blocked_task_tag(tag.as_str())))
}

fn is_blocked_task_tag(tag: &str) -> bool {
    let tag = tag.trim().to_ascii_lowercase();
    matches!(
        tag.as_str(),
        "audio-classification"
            | "audio-to-audio"
            | "automatic-speech-recognition"
            | "document-question-answering"
            | "depth-estimation"
            | "feature-extraction"
            | "fill-mask"
            | "image-feature-extraction"
            | "image-classification"
            | "image-segmentation"
            | "image-to-3d"
            | "image-to-image"
            | "image-to-text"
            | "image-to-video"
            | "keypoint-detection"
            | "mask-generation"
            | "object-detection"
            | "question-answering"
            | "reinforcement-learning"
            | "robotics"
            | "sentence-similarity"
            | "summarization"
            | "tabular-classification"
            | "tabular-regression"
            | "table-question-answering"
            | "text-classification"
            | "text-ranking"
            | "text-to-3d"
            | "text-to-audio"
            | "text-to-image"
            | "text-to-music"
            | "text-to-speech"
            | "text-to-video"
            | "time-series-forecasting"
            | "token-classification"
            | "translation"
            | "unconditional-image-generation"
            | "video-classification"
            | "visual-question-answering"
            | "zero-shot-object-detection"
            | "zero-shot-classification"
            | "zero-shot-image-classification"
    )
}

fn repo_owner(repo: &str) -> Option<&str> {
    repo.split_once('/').map(|(owner, _)| owner)
}

fn repo_name(repo: &str) -> Option<&str> {
    repo.split_once('/').map(|(_, name)| name)
}

fn is_repo_component(component: &str) -> bool {
    is_safe_hf_path_component(component) && component != "." && component != ".."
}

fn is_searchable_gguf_model_file(file_path: &str) -> bool {
    is_safe_relative_gguf_path(file_path) && !is_non_text_gguf_file(file_path)
}

fn is_non_text_gguf_file(file_path: &str) -> bool {
    let index = ModelTextIndex::from_values([file_path]);
    index.contains_any_word(&["clip", "mmproj", "projector", "siglip"])
        || index.contains_any_phrase(&[
            "image encoder",
            "mm proj",
            "visual encoder",
            "vision encoder",
            "vision projector",
        ])
}

fn is_safe_relative_gguf_path(file_path: &str) -> bool {
    let mut parts = file_path.split('/').peekable();
    if parts.peek().is_none() {
        return false;
    }

    let mut last = "";
    for part in parts {
        if !is_safe_hf_path_component(part) || matches!(part, "." | "..") {
            return false;
        }
        last = part;
    }

    last.to_ascii_lowercase().ends_with(".gguf")
}

fn is_safe_hf_path_component(component: &str) -> bool {
    !component.is_empty()
        && component
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
}

fn hugging_face_redirect_policy() -> Policy {
    Policy::custom(|attempt| {
        if attempt.previous().len() >= 5 {
            return attempt.stop();
        }

        let url = attempt.url();
        let host = url.host_str().unwrap_or_default();
        if url.scheme() == "https" && is_allowed_download_host(host) {
            attempt.follow()
        } else {
            attempt.stop()
        }
    })
}

fn is_allowed_download_host(host: &str) -> bool {
    host == "huggingface.co" || host.ends_with(".huggingface.co") || host.ends_with(".hf.co")
}

struct ModelTextIndex {
    text: String,
    words: Vec<String>,
}

impl ModelTextIndex {
    fn new(repo: &str, summary: &HfModelSummary, gguf_files: &[HuggingFaceGgufFile]) -> Self {
        let tag_terms = summary
            .tags
            .iter()
            .flat_map(|tags| tags.iter().map(String::as_str));
        let file_terms = gguf_files.iter().map(|file| file.file.as_str());
        Self::from_values(
            std::iter::once(repo)
                .chain(summary.pipeline_tag.as_deref())
                .chain(tag_terms)
                .chain(file_terms),
        )
    }

    fn from_values<'a>(values: impl IntoIterator<Item = &'a str>) -> Self {
        let mut words = Vec::new();
        for value in values {
            words.extend(normalized_words(value));
        }

        let text = format!(" {} ", words.join(" "));
        Self { text, words }
    }

    fn has_blocked_model_family(&self) -> bool {
        self.contains_any_word(&[
            "asr",
            "bark",
            "bert",
            "bge",
            "clip",
            "coqui",
            "convnext",
            "deberta",
            "deit",
            "diffusers",
            "diffusion",
            "dinov2",
            "distilbert",
            "e5",
            "embed",
            "embedding",
            "embeddings",
            "efficientnet",
            "flux",
            "gte",
            "hubert",
            "openclip",
            "piper",
            "rerank",
            "reranker",
            "reranking",
            "resnet",
            "roberta",
            "sam",
            "sd15",
            "sd3",
            "sdxl",
            "segformer",
            "siglip",
            "speecht5",
            "tts",
            "unet",
            "vits",
            "wav2vec",
            "wav2vec2",
            "whisper",
            "xclip",
            "xlm",
            "xtts",
            "yolo",
        ]) || self.contains_any_phrase(&[
            "audio encoder",
            "cross encoder",
            "image encoder",
            "sentence similarity",
            "sentence transformer",
            "stable diffusion",
            "text to image",
            "text to speech",
            "vision encoder",
            "visual encoder",
        ])
    }

    fn has_chat_like_marker(&self) -> bool {
        self.contains_any_word(&[
            "airoboros",
            "alpaca",
            "assistant",
            "chat",
            "conversational",
            "dolphin",
            "guanaco",
            "hermes",
            "instruct",
            "openchat",
            "orca",
            "qwq",
            "r1",
            "reasoning",
            "roleplay",
            "vicuna",
            "wizardlm",
            "zephyr",
        ]) || self.contains_any_phrase(&[
            "deepseek r1",
            "dialogue model",
            "instruction tuned",
            "nous hermes",
        ])
    }

    fn contains_any_word(&self, words: &[&str]) -> bool {
        words
            .iter()
            .any(|word| self.words.iter().any(|existing| existing == word))
    }

    fn contains_any_phrase(&self, phrases: &[&str]) -> bool {
        phrases.iter().any(|phrase| {
            let needle = format!(" {phrase} ");
            self.text.contains(&needle)
        })
    }
}

fn normalized_words(value: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut current = String::new();

    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            current.push(ch.to_ascii_lowercase());
        } else if !current.is_empty() {
            words.push(std::mem::take(&mut current));
        }
    }

    if !current.is_empty() {
        words.push(current);
    }

    words
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HfModelSummary {
    id: Option<String>,
    model_id: Option<String>,
    author: Option<String>,
    downloads: Option<u64>,
    likes: Option<u64>,
    #[serde(alias = "pipeline_tag")]
    pipeline_tag: Option<String>,
    tags: Option<Vec<String>>,
    last_modified: Option<String>,
    siblings: Option<Vec<HfSibling>>,
}

impl HfModelSummary {
    fn repo_id(&self) -> Option<String> {
        self.model_id.clone().or_else(|| self.id.clone())
    }
}

#[derive(Debug, Deserialize)]
struct HfSibling {
    rfilename: String,
    size: Option<u64>,
    lfs: Option<HfLfs>,
}

#[derive(Debug, Deserialize)]
struct HfLfs {
    size: u64,
}

#[derive(Debug, Error)]
pub enum HuggingFaceError {
    #[error("Hugging Face URL is invalid: {reason}")]
    InvalidUrl { reason: String },
    #[error("Hugging Face search query is invalid: {reason}")]
    InvalidSearchQuery { reason: String },
    #[error("could not create Hugging Face HTTP client")]
    Client {
        #[source]
        source: reqwest::Error,
    },
    #[error("Hugging Face request failed for {url}")]
    Request {
        url: String,
        #[source]
        source: reqwest::Error,
    },
    #[error("Hugging Face returned HTTP {status} for {url}")]
    Http { url: String, status: StatusCode },
    #[error("Hugging Face response was invalid for {url}")]
    Decode {
        url: String,
        #[source]
        source: reqwest::Error,
    },
}

impl From<url::ParseError> for HuggingFaceError {
    fn from(source: url::ParseError) -> Self {
        Self::InvalidUrl {
            reason: source.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_resolve_gguf_url() {
        let source = validate_hugging_face_gguf_url(
            "https://huggingface.co/owner/model-GGUF/resolve/main/model-Q4_K_M.gguf",
        )
        .expect("valid Hugging Face GGUF URL should be accepted");

        assert_eq!(source.repo, "owner/model-GGUF");
        assert_eq!(source.revision, "main");
        assert_eq!(source.file_name, "model-Q4_K_M.gguf");
    }

    #[test]
    fn normalizes_blob_url_to_resolve_url() {
        let source = validate_hugging_face_gguf_url(
            "https://huggingface.co/owner/model/blob/main/model.gguf",
        )
        .expect("blob URLs should be accepted");

        assert_eq!(
            source.download_url.as_str(),
            "https://huggingface.co/owner/model/resolve/main/model.gguf"
        );
    }

    #[test]
    fn rejects_non_hugging_face_url() {
        let error = validate_hugging_face_gguf_url(
            "https://example.com/owner/model/resolve/main/model.gguf",
        )
        .expect_err("non-Hugging Face hosts must be rejected");

        assert!(matches!(error, HuggingFaceError::InvalidUrl { .. }));
    }

    #[test]
    fn rejects_unsafe_file_path() {
        let error = validate_hugging_face_gguf_url(
            "https://huggingface.co/owner/model/resolve/main/../model.gguf",
        )
        .expect_err("path traversal must be rejected");

        assert!(matches!(error, HuggingFaceError::InvalidUrl { .. }));
    }

    #[test]
    fn accepts_text_generation_model_and_includes_owner() {
        let summary = model_summary(
            Some("text-generation"),
            &["gguf", "text-generation"],
            &["mistral-7b-instruct.Q4_K_M.gguf"],
        );

        let model = gguf_model_from_summary("TheBloke/Mistral-7B-Instruct-v0.2-GGUF", summary)
            .expect("text-generation GGUF models should be returned");

        assert_eq!(model.owner, "TheBloke");
        assert_eq!(model.author.as_deref(), Some("TheBloke"));
        assert_eq!(model.gguf_files.len(), 1);
    }

    #[test]
    fn accepts_chat_like_gguf_without_pipeline_tag() {
        let summary = model_summary(None, &["gguf"], &["Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf"]);

        let model = gguf_model_from_summary("bartowski/Qwen2.5-Coder-7B-Instruct-GGUF", summary);

        assert!(model.is_some(), "chat-like GGUF models should be returned");
    }

    #[test]
    fn accepts_image_text_to_text_model() {
        let summary = model_summary(
            Some("image-text-to-text"),
            &["gguf", "image-text-to-text"],
            &["qwen2-vl-7b-instruct-q4_k_m.gguf"],
        );

        let model = gguf_model_from_summary("Qwen/Qwen2-VL-7B-Instruct-GGUF", summary);

        assert!(
            model.is_some(),
            "image-text-to-text GGUF models should be returned"
        );
    }

    #[test]
    fn rejects_embedding_only_model() {
        let summary = model_summary(
            Some("sentence-similarity"),
            &["gguf", "sentence-similarity", "sentence-transformers"],
            &["nomic-embed-text-v1.5.Q4_K_M.gguf"],
        );

        let model = gguf_model_from_summary("nomic-ai/nomic-embed-text-v1.5-GGUF", summary);

        assert!(
            model.is_none(),
            "embedding-only GGUF models must be filtered out"
        );
    }

    #[test]
    fn rejects_clip_diffusion_speech_and_tts_families() {
        assert_rejected_model(
            "owner/SigLIP-GGUF",
            Some("zero-shot-image-classification"),
            &["gguf", "zero-shot-image-classification"],
            &["siglip-model-f16.gguf"],
        );
        assert_rejected_model(
            "owner/FLUX.1-dev-GGUF",
            Some("text-to-image"),
            &["gguf", "diffusion"],
            &["flux1-dev-q8_0.gguf"],
        );
        assert_rejected_model(
            "owner/Whisper-large-v3-GGUF",
            Some("automatic-speech-recognition"),
            &["gguf", "automatic-speech-recognition"],
            &["whisper-large-v3-q5_0.gguf"],
        );
        assert_rejected_model(
            "owner/Piper-TTS-GGUF",
            Some("text-to-speech"),
            &["gguf", "text-to-speech"],
            &["piper-voice-q8_0.gguf"],
        );
    }

    #[test]
    fn ignores_projector_only_gguf_files() {
        let files = gguf_files_for_repo(
            "owner/vision-projector-GGUF",
            &[sibling("mmproj-model-f16.gguf")],
        );

        assert!(
            files.is_empty(),
            "projector-only GGUF files are not importable text models"
        );
    }

    #[test]
    fn expands_search_candidates_with_hard_cap() {
        assert_eq!(search_candidate_limit(1), 3);
        assert_eq!(
            search_candidate_limit(MAX_SEARCH_LIMIT),
            MAX_SEARCH_CANDIDATES
        );
    }

    fn assert_rejected_model(
        repo: &str,
        pipeline_tag: Option<&str>,
        tags: &[&str],
        files: &[&str],
    ) {
        let summary = model_summary(pipeline_tag, tags, files);

        assert!(
            gguf_model_from_summary(repo, summary).is_none(),
            "{repo} should be filtered out"
        );
    }

    fn model_summary(pipeline_tag: Option<&str>, tags: &[&str], files: &[&str]) -> HfModelSummary {
        HfModelSummary {
            id: None,
            model_id: None,
            author: Some("TheBloke".to_owned()),
            downloads: Some(1000),
            likes: Some(10),
            pipeline_tag: pipeline_tag.map(str::to_owned),
            tags: Some(tags.iter().map(|tag| (*tag).to_owned()).collect()),
            last_modified: Some("2026-01-01T00:00:00.000Z".to_owned()),
            siblings: Some(files.iter().map(|file| sibling(file)).collect()),
        }
    }

    fn sibling(file: &str) -> HfSibling {
        HfSibling {
            rfilename: file.to_owned(),
            size: Some(1024),
            lfs: None,
        }
    }
}
