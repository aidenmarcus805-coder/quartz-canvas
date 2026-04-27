use std::{
    path::{Path, PathBuf},
    process::Stdio,
};

use serde::{Deserialize, Serialize};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    process::Command,
    task::JoinSet,
    time::{timeout, Duration},
};
use url::Url;

use crate::{
    error::{CommandError, ErrorCode},
    project::detect::{detect_project, ApplicationSurfaceKind},
};

const MAX_PREVIEW_DOCUMENT_BYTES: usize = 8 * 1024 * 1024;
const MAX_REDIRECTS: usize = 3;
const PREVIEW_DOCUMENT_FETCH_TIMEOUT: Duration = Duration::from_secs(5);
const LOCALHOST_SCAN_TIMEOUT: Duration = Duration::from_millis(900);
const LOCALHOST_ROOT_DETECTION_TIMEOUT: Duration = Duration::from_millis(900);
const LOCALHOST_SCAN_HOSTS: &[&str] = &["localhost", "127.0.0.1", "::1"];
const LOCALHOST_SCAN_PORTS: &[u16] = &[
    3000, 3001, 3002, 3003, 4000, 4173, 4174, 4200, 4321, 5000, 5173, 5174, 5175, 5176, 5177, 5178,
    5179, 6006, 7000, 8000, 8080, 9000, 1420,
];
const QUARTZ_CANVAS_TITLE: &str = "quartz canvas";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchPreviewDocumentRequest {
    pub url: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchPreviewDocumentResponse {
    pub url: String,
    pub content_type: String,
    pub html: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalhostProject {
    pub url: String,
    pub port: u16,
    pub title: String,
    pub framework: Option<String>,
    pub source: String,
    pub surface_kind: ApplicationSurfaceKind,
    pub surface_signals: Vec<String>,
    pub root_path: Option<PathBuf>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanLocalhostProjectsResponse {
    pub projects: Vec<LocalhostProject>,
}

#[tauri::command]
pub async fn fetch_preview_document(
    request: FetchPreviewDocumentRequest,
) -> Result<FetchPreviewDocumentResponse, CommandError> {
    let url = parse_local_http_url(&request.url)?;
    fetch_with_redirects(url, 0).await
}

#[tauri::command]
pub async fn scan_localhost_projects() -> Result<ScanLocalhostProjectsResponse, CommandError> {
    let mut tasks = JoinSet::new();
    for &port in LOCALHOST_SCAN_PORTS {
        tasks.spawn(async move { probe_localhost_port(port).await });
    }

    let mut projects = Vec::new();
    while let Some(joined) = tasks.join_next().await {
        if let Ok(Some(project)) = joined {
            projects.push(project);
        }
    }

    projects.sort_by_key(|project| localhost_scan_rank(project.port));

    Ok(ScanLocalhostProjectsResponse { projects })
}

async fn fetch_with_redirects(
    url: Url,
    redirect_count: usize,
) -> Result<FetchPreviewDocumentResponse, CommandError> {
    let document = timeout(
        PREVIEW_DOCUMENT_FETCH_TIMEOUT,
        fetch_http_with_redirects(url, redirect_count),
    )
    .await
    .map_err(|_| bridge_unavailable("preview document request timed out"))??;
    let response = document.response;

    if !(200..=299).contains(&response.status) {
        return Err(CommandError::new(
            ErrorCode::BridgeUnavailable,
            format!("preview server returned HTTP {}", response.status),
            true,
        ));
    }

    let body = decode_body(&response)?;
    let html = String::from_utf8_lossy(&body).into_owned();

    Ok(FetchPreviewDocumentResponse {
        url: document.url.to_string(),
        content_type: response.content_type().unwrap_or("text/html").to_owned(),
        html,
    })
}

async fn probe_localhost_port(port: u16) -> Option<LocalhostProject> {
    probe_localhost_port_with_root_detection(port, true).await
}

async fn probe_localhost_port_with_root_detection(
    port: u16,
    detect_root: bool,
) -> Option<LocalhostProject> {
    for host in LOCALHOST_SCAN_HOSTS {
        let url = localhost_url(host, port)?;
        let Ok(Ok(document)) = timeout(
            LOCALHOST_SCAN_TIMEOUT,
            fetch_http_with_redirects(url.clone(), 0),
        )
        .await
        else {
            continue;
        };
        let response = document.response;

        if !(200..=299).contains(&response.status) {
            continue;
        }

        let body = decode_body(&response).ok()?;
        let html = String::from_utf8_lossy(&body);
        if !looks_like_application_document(&response, &html) {
            continue;
        }

        let title = extract_page_title(&html).unwrap_or_else(|| format!("localhost:{port}"));
        if is_quartz_canvas_dev_server(port, &title) {
            return None;
        }

        let process_evidence = if detect_root {
            detect_project_evidence_for_port_with_timeout(port).await
        } else {
            None
        };
        let root_path = process_evidence
            .as_ref()
            .and_then(|evidence| evidence.root_path.clone());
        let process_desktop_signals = process_evidence
            .as_ref()
            .map(|evidence| evidence.desktop_signals.as_slice())
            .unwrap_or(&[]);
        let surface = detect_localhost_surface(port, root_path.as_deref(), process_desktop_signals);
        return Some(LocalhostProject {
            url: document.url.to_string(),
            port,
            title,
            framework: detect_framework(response.header("server"), &html),
            source: legacy_surface_source(surface.kind).to_owned(),
            surface_kind: surface.kind,
            surface_signals: surface.signals,
            root_path,
        });
    }

    None
}

struct FetchedHttpDocument {
    url: Url,
    response: HttpResponse,
}

async fn fetch_http_with_redirects(
    url: Url,
    redirect_count: usize,
) -> Result<FetchedHttpDocument, CommandError> {
    let response = fetch_once(&url).await?;
    if let Some(location) = redirect_location(&response, &url)? {
        if redirect_count >= MAX_REDIRECTS {
            return Err(invalid_preview_request("preview redirect limit exceeded"));
        }
        return Box::pin(fetch_http_with_redirects(location, redirect_count + 1)).await;
    }

    Ok(FetchedHttpDocument { url, response })
}

fn localhost_url(host: &str, port: u16) -> Option<Url> {
    let host = if host.contains(':') {
        format!("[{host}]")
    } else {
        host.to_owned()
    };
    Url::parse(&format!("http://{host}:{port}/")).ok()
}

fn is_quartz_canvas_dev_server(_port: u16, title: &str) -> bool {
    compact_text(title).eq_ignore_ascii_case(QUARTZ_CANVAS_TITLE)
}

#[derive(Debug)]
struct LocalhostSurfaceDetection {
    kind: ApplicationSurfaceKind,
    signals: Vec<String>,
}

#[derive(Clone, Debug, Default)]
struct LocalhostProcessEvidence {
    root_path: Option<PathBuf>,
    desktop_signals: Vec<String>,
}

fn detect_localhost_surface(
    port: u16,
    root_path: Option<&Path>,
    process_desktop_signals: &[String],
) -> LocalhostSurfaceDetection {
    if let Some(manifest) = root_path.and_then(|root| detect_project(root).ok()) {
        if manifest.surface_kind == ApplicationSurfaceKind::Desktop {
            let mut signals = manifest.surface_signals;
            extend_unique_signals(&mut signals, process_desktop_signals);
            return LocalhostSurfaceDetection {
                kind: ApplicationSurfaceKind::Desktop,
                signals,
            };
        }

        if !process_desktop_signals.is_empty() {
            return LocalhostSurfaceDetection {
                kind: ApplicationSurfaceKind::Desktop,
                signals: process_desktop_signals.to_vec(),
            };
        }

        if manifest.surface_kind != ApplicationSurfaceKind::Unknown {
            return LocalhostSurfaceDetection {
                kind: manifest.surface_kind,
                signals: manifest.surface_signals,
            };
        }
    }

    if !process_desktop_signals.is_empty() {
        return LocalhostSurfaceDetection {
            kind: ApplicationSurfaceKind::Desktop,
            signals: process_desktop_signals.to_vec(),
        };
    }

    if port == 1420 {
        return LocalhostSurfaceDetection {
            kind: ApplicationSurfaceKind::Desktop,
            signals: vec!["default Tauri dev port 1420".to_owned()],
        };
    }

    LocalhostSurfaceDetection {
        kind: ApplicationSurfaceKind::Unknown,
        signals: vec!["reachable localhost HTTP application".to_owned()],
    }
}

fn extend_unique_signals(signals: &mut Vec<String>, extra_signals: &[String]) {
    for signal in extra_signals {
        if !signals.contains(signal) {
            signals.push(signal.clone());
        }
    }
}

fn legacy_surface_source(kind: ApplicationSurfaceKind) -> &'static str {
    match kind {
        ApplicationSurfaceKind::Desktop => "desktop",
        ApplicationSurfaceKind::Web | ApplicationSurfaceKind::Unknown => "web",
    }
}

async fn detect_project_evidence_for_port(port: u16) -> Option<LocalhostProcessEvidence> {
    #[cfg(target_os = "windows")]
    {
        return detect_windows_project_evidence_for_port(port).await;
    }

    #[cfg(all(unix, not(target_os = "windows")))]
    {
        return detect_unix_project_evidence_for_port(port).await;
    }

    #[cfg(not(any(target_os = "windows", unix)))]
    {
        let _ = port;
        None
    }
}

async fn detect_project_evidence_for_port_with_timeout(
    port: u16,
) -> Option<LocalhostProcessEvidence> {
    timeout(
        LOCALHOST_ROOT_DETECTION_TIMEOUT,
        detect_project_evidence_for_port(port),
    )
    .await
    .ok()
    .flatten()
}

#[cfg(target_os = "windows")]
async fn detect_windows_project_evidence_for_port(port: u16) -> Option<LocalhostProcessEvidence> {
    for process_id in windows_listener_pids_for_port(port).await {
        for command_line in windows_process_command_lines(process_id).await {
            if let Some(evidence) = localhost_process_evidence_from_command_line(&command_line) {
                return Some(evidence);
            }
        }
    }

    None
}

#[cfg(target_os = "windows")]
async fn windows_listener_pids_for_port(port: u16) -> Vec<u32> {
    let Ok(output) = Command::new("netstat")
        .args(["-ano", "-p", "tcp"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await
    else {
        return Vec::new();
    };

    if !output.status.success() {
        return Vec::new();
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut process_ids = Vec::new();
    for line in text.lines() {
        let Some(process_id) = parse_netstat_listener_pid(line, port) else {
            continue;
        };
        if !process_ids.contains(&process_id) {
            process_ids.push(process_id);
        }
    }

    process_ids
}

#[cfg(target_os = "windows")]
fn parse_netstat_listener_pid(line: &str, port: u16) -> Option<u32> {
    let parts = line.split_whitespace().collect::<Vec<_>>();
    if parts.len() < 5 || !parts[0].eq_ignore_ascii_case("tcp") {
        return None;
    }

    let local_address = parts[1];
    let state = parts[3];
    if !state.eq_ignore_ascii_case("listening") || !address_uses_port(local_address, port) {
        return None;
    }

    parts[4].parse().ok()
}

#[cfg(target_os = "windows")]
async fn windows_process_command_lines(process_id: u32) -> Vec<String> {
    let script = format!(
        "$id={process_id}; for ($i = 0; $i -lt 6 -and $id; $i++) {{ \
         $p = Get-CimInstance Win32_Process -Filter \"ProcessId=$id\"; \
         if (!$p) {{ break }}; \
         $cmd = [string]$p.CommandLine; \
         $cmd = $cmd -replace \"[`r`n`t]\", \" \"; \
         Write-Output (\"$($p.ProcessId)`t$($p.ParentProcessId)`t\" + $cmd); \
         $id = $p.ParentProcessId \
         }}"
    );
    let Ok(output) = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await
    else {
        return Vec::new();
    };

    if !output.status.success() {
        return Vec::new();
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.splitn(3, '\t').nth(2))
        .map(str::trim)
        .filter(|command_line| !command_line.is_empty())
        .map(str::to_owned)
        .collect()
}

#[cfg(all(unix, not(target_os = "windows")))]
async fn detect_unix_project_evidence_for_port(port: u16) -> Option<LocalhostProcessEvidence> {
    for process_id in unix_listener_pids_for_port(port).await {
        #[cfg(target_os = "linux")]
        if let Ok(current_dir) = std::fs::read_link(format!("/proc/{process_id}/cwd")) {
            if let Some(root_path) = project_root_from_path(&current_dir) {
                return Some(LocalhostProcessEvidence {
                    root_path: Some(root_path),
                    desktop_signals: Vec::new(),
                });
            }
        }

        for command_line in unix_process_command_lines(process_id).await {
            if let Some(evidence) = localhost_process_evidence_from_command_line(&command_line) {
                return Some(evidence);
            }
        }
    }

    None
}

#[cfg(all(unix, not(target_os = "windows")))]
async fn unix_listener_pids_for_port(port: u16) -> Vec<u32> {
    let port_arg = format!("-iTCP:{port}");
    let Ok(output) = Command::new("lsof")
        .args(["-nP", port_arg.as_str(), "-sTCP:LISTEN", "-Fp"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await
    else {
        return Vec::new();
    };

    if !output.status.success() {
        return Vec::new();
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.strip_prefix('p'))
        .filter_map(|raw| raw.parse().ok())
        .collect()
}

#[cfg(all(unix, not(target_os = "windows")))]
async fn unix_process_command_lines(process_id: u32) -> Vec<String> {
    let mut current_id = process_id;
    let mut command_lines = Vec::new();

    for _ in 0..6 {
        let Ok(output) = Command::new("ps")
            .args([
                "-p",
                &current_id.to_string(),
                "-o",
                "ppid=",
                "-o",
                "command=",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .await
        else {
            break;
        };
        if !output.status.success() {
            break;
        }

        let text = String::from_utf8_lossy(&output.stdout);
        let Some(line) = text.lines().map(str::trim).find(|line| !line.is_empty()) else {
            break;
        };
        let mut parts = line.splitn(2, char::is_whitespace);
        let Some(parent_id) = parts.next().and_then(|raw| raw.trim().parse::<u32>().ok()) else {
            break;
        };
        if let Some(command_line) = parts
            .next()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            command_lines.push(command_line.to_owned());
        }
        if parent_id == 0 || parent_id == current_id {
            break;
        }
        current_id = parent_id;
    }

    command_lines
}

fn address_uses_port(address: &str, port: u16) -> bool {
    address
        .rsplit(':')
        .next()
        .and_then(|raw| raw.parse::<u16>().ok())
        == Some(port)
}

fn infer_project_root_from_command_line(command_line: &str) -> Option<PathBuf> {
    for candidate in command_line_path_candidates(command_line) {
        if let Some(root_path) = project_root_from_path(&candidate) {
            return Some(root_path);
        }
    }

    None
}

fn localhost_process_evidence_from_command_line(
    command_line: &str,
) -> Option<LocalhostProcessEvidence> {
    let root_path = infer_project_root_from_command_line(command_line);
    let desktop_signals = command_line_desktop_surface_signals(command_line);
    if root_path.is_none() && desktop_signals.is_empty() {
        return None;
    }

    Some(LocalhostProcessEvidence {
        root_path,
        desktop_signals,
    })
}

fn command_line_desktop_surface_signals(command_line: &str) -> Vec<String> {
    let lower = command_line.to_ascii_lowercase();
    let mut signals = Vec::new();

    if lower.contains("tauri") {
        signals.push("tauri process command line".to_owned());
    }
    if lower.contains("electron") {
        signals.push("electron process command line".to_owned());
    }
    if lower.contains("wails") {
        signals.push("wails process command line".to_owned());
    }
    if lower.contains("neutralino") || lower.contains("@neutralinojs") || lower.contains("neu run")
    {
        signals.push("neutralino process command line".to_owned());
    }
    if lower.contains("nwjs")
        || lower.contains("nw-builder")
        || lower.contains(" node-webkit")
        || lower.contains(" nw ")
        || lower.contains("\\nw ")
        || lower.contains("/nw ")
    {
        signals.push("nw.js process command line".to_owned());
    }

    signals
}

fn command_line_path_candidates(command_line: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    collect_quoted_path_candidates(command_line, '"', &mut candidates);
    collect_quoted_path_candidates(command_line, '\'', &mut candidates);

    for token in command_line.split_whitespace() {
        push_path_candidate(token, &mut candidates);
    }

    candidates
}

fn collect_quoted_path_candidates(command_line: &str, quote: char, candidates: &mut Vec<PathBuf>) {
    let mut remaining = command_line;
    while let Some(start) = remaining.find(quote) {
        let after_start = &remaining[start + quote.len_utf8()..];
        let Some(end) = after_start.find(quote) else {
            break;
        };
        push_path_candidate(&after_start[..end], candidates);
        remaining = &after_start[end + quote.len_utf8()..];
    }
}

fn push_path_candidate(raw: &str, candidates: &mut Vec<PathBuf>) {
    let trimmed = raw.trim_matches(|character| matches!(character, '"' | '\'' | ',' | ';'));
    if trimmed.is_empty() || trimmed.contains("://") || !looks_like_filesystem_path(trimmed) {
        return;
    }

    let path = PathBuf::from(trimmed);
    if !candidates.iter().any(|candidate| candidate == &path) {
        candidates.push(path);
    }
}

fn looks_like_filesystem_path(value: &str) -> bool {
    Path::new(value).is_absolute() || value.contains('\\') || value.contains('/')
}

fn project_root_from_path(candidate: &Path) -> Option<PathBuf> {
    let mut paths = Vec::from([candidate.to_path_buf()]);
    if let Ok(canonical) = std::fs::canonicalize(candidate) {
        paths.push(canonical);
    }

    for path in paths {
        if let Some(root) = root_before_node_modules(&path).and_then(preferred_project_root) {
            return Some(root);
        }

        let start = if path.is_file() {
            path.parent().map(Path::to_path_buf)?
        } else {
            path
        };

        if let Some(root) = preferred_project_root(start) {
            return Some(root);
        }
    }

    None
}

fn root_before_node_modules(path: &Path) -> Option<PathBuf> {
    for ancestor in path.ancestors() {
        let is_node_modules = ancestor
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.eq_ignore_ascii_case("node_modules"))
            .unwrap_or(false);
        if is_node_modules {
            return ancestor.parent().map(Path::to_path_buf);
        }
    }

    None
}

fn preferred_project_root(start: impl AsRef<Path>) -> Option<PathBuf> {
    let mut first_root = None;

    for ancestor in start.as_ref().ancestors() {
        let Some(root) = canonical_project_root(ancestor.to_path_buf()) else {
            continue;
        };
        if project_root_has_desktop_surface(&root) {
            return Some(root);
        }
        first_root.get_or_insert(root);
    }

    first_root
}

fn canonical_project_root(path: PathBuf) -> Option<PathBuf> {
    if !looks_like_project_root(&path) {
        return None;
    }

    std::fs::canonicalize(path).ok()
}

fn project_root_has_desktop_surface(root: &Path) -> bool {
    if root.join("src-tauri").join("tauri.conf.json").exists()
        || root.join("src-tauri").join("Cargo.toml").exists()
        || root.join("tauri.conf.json").exists()
        || root.join("wails.json").exists()
        || root.join("neutralino.config.json").exists()
    {
        return true;
    }

    let Ok(package_json) = std::fs::read_to_string(root.join("package.json")) else {
        return false;
    };
    let lower = package_json.to_ascii_lowercase();
    lower.contains("@tauri-apps/")
        || lower.contains("\"electron\"")
        || lower.contains("@electron-forge/")
        || lower.contains("electron-builder")
        || lower.contains("\"wails\"")
        || lower.contains("@wailsio/runtime")
        || lower.contains("@neutralinojs/")
        || lower.contains("\"nw\"")
        || lower.contains("nw-builder")
        || lower.contains("tauri dev")
        || lower.contains("electron .")
}

fn looks_like_project_root(path: &Path) -> bool {
    path.is_dir()
        && (path.join("package.json").exists()
            || path.join("src-tauri").join("tauri.conf.json").exists()
            || path.join("src-tauri").join("Cargo.toml").exists()
            || path.join("tauri.conf.json").exists()
            || path.join("wails.json").exists()
            || path.join("neutralino.config.json").exists()
            || path.join("vite.config.ts").exists()
            || path.join("vite.config.js").exists()
            || path.join("next.config.js").exists()
            || path.join("next.config.mjs").exists())
}

fn localhost_scan_rank(port: u16) -> usize {
    LOCALHOST_SCAN_PORTS
        .iter()
        .position(|candidate| *candidate == port)
        .unwrap_or(usize::MAX)
}

fn looks_like_application_document(response: &HttpResponse, html: &str) -> bool {
    let content_type = response.content_type().unwrap_or("").to_ascii_lowercase();
    content_type.contains("text/html")
        || content_type.contains("application/xhtml+xml")
        || html.to_ascii_lowercase().contains("<html")
}

fn extract_page_title(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let title_start = lower.find("<title")?;
    let content_start = lower[title_start..].find('>')? + title_start + 1;
    let content_end = lower[content_start..].find("</title>")? + content_start;
    let title = compact_text(&decode_common_html_entities(
        html[content_start..content_end].trim(),
    ));

    if title.is_empty() {
        None
    } else {
        Some(title.chars().take(96).collect())
    }
}

fn detect_framework(server_header: Option<&str>, html: &str) -> Option<String> {
    let haystack = format!("{} {}", server_header.unwrap_or(""), html).to_ascii_lowercase();
    if haystack.contains("/@vite/client") || haystack.contains("vite") {
        return Some("Vite".to_owned());
    }
    if haystack.contains("/_next/") || haystack.contains("__next") {
        return Some("Next.js".to_owned());
    }
    if haystack.contains("data-astro") || haystack.contains("/_astro/") {
        return Some("Astro".to_owned());
    }
    if haystack.contains("svelte") || haystack.contains("__sveltekit") {
        return Some("SvelteKit".to_owned());
    }
    if haystack.contains("/_nuxt/") || haystack.contains("__nuxt") {
        return Some("Nuxt".to_owned());
    }
    if haystack.contains("data-v-app") || haystack.contains("vue") {
        return Some("Vue".to_owned());
    }
    if haystack.contains("ng-version") || haystack.contains("angular") {
        return Some("Angular".to_owned());
    }
    if haystack.contains("@react-refresh") || haystack.contains("data-reactroot") {
        return Some("React".to_owned());
    }
    if haystack.contains("webpack") {
        return Some("Webpack".to_owned());
    }

    None
}

fn compact_text(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn decode_common_html_entities(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

struct HttpResponse {
    status: u16,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl HttpResponse {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(header_name, _)| header_name.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    fn content_type(&self) -> Option<&str> {
        self.header("content-type")
    }
}

async fn fetch_once(url: &Url) -> Result<HttpResponse, CommandError> {
    let host = url
        .host_str()
        .ok_or_else(|| invalid_preview_request("preview URL is missing a host"))?;
    let port = url
        .port_or_known_default()
        .ok_or_else(|| invalid_preview_request("preview URL is missing a port"))?;
    let mut stream = TcpStream::connect((host, port))
        .await
        .map_err(|_| bridge_unavailable("could not connect to preview server"))?;

    let path = match url.query() {
        Some(query) => format!("{}?{query}", url.path()),
        None => {
            if url.path().is_empty() {
                "/".to_owned()
            } else {
                url.path().to_owned()
            }
        }
    };
    let host_header = match url.port() {
        Some(explicit_port) => format!("{host}:{explicit_port}"),
        None => host.to_owned(),
    };
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: {host_header}\r\nUser-Agent: QuartzCanvas/0.1\r\nAccept: text/html,application/xhtml+xml,*/*;q=0.8\r\nConnection: close\r\n\r\n"
    );

    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|_| bridge_unavailable("failed to request preview document"))?;

    let mut response_bytes = Vec::new();
    stream
        .take(MAX_PREVIEW_DOCUMENT_BYTES as u64 + 1)
        .read_to_end(&mut response_bytes)
        .await
        .map_err(|_| bridge_unavailable("failed to read preview response"))?;

    if response_bytes.len() > MAX_PREVIEW_DOCUMENT_BYTES {
        return Err(invalid_preview_request("preview document is too large"));
    }

    parse_http_response(response_bytes)
}

fn parse_http_response(response_bytes: Vec<u8>) -> Result<HttpResponse, CommandError> {
    let header_end = response_bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| bridge_unavailable("preview server returned malformed headers"))?;
    let header_bytes = &response_bytes[..header_end];
    let body = response_bytes[header_end + 4..].to_vec();
    let header_text = String::from_utf8_lossy(header_bytes);
    let mut lines = header_text.split("\r\n");
    let status_line = lines
        .next()
        .ok_or_else(|| bridge_unavailable("preview server returned an empty response"))?;
    let status = parse_status(status_line)?;
    let mut headers = Vec::new();

    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            headers.push((name.trim().to_owned(), value.trim().to_owned()));
        }
    }

    Ok(HttpResponse {
        status,
        headers,
        body,
    })
}

fn parse_status(status_line: &str) -> Result<u16, CommandError> {
    let status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or_else(|| bridge_unavailable("preview server returned an invalid status line"))?;
    Ok(status)
}

fn decode_body(response: &HttpResponse) -> Result<Vec<u8>, CommandError> {
    match response.header("transfer-encoding") {
        Some(value) if value.to_ascii_lowercase().contains("chunked") => {
            decode_chunked_body(&response.body)
        }
        _ => Ok(response.body.clone()),
    }
}

fn decode_chunked_body(body: &[u8]) -> Result<Vec<u8>, CommandError> {
    let mut decoded = Vec::new();
    let mut cursor = 0;

    loop {
        let size_end = find_crlf(body, cursor)
            .ok_or_else(|| bridge_unavailable("preview server returned malformed chunks"))?;
        let size_line = String::from_utf8_lossy(&body[cursor..size_end]);
        let size_text = size_line.split(';').next().unwrap_or("").trim();
        let size = usize::from_str_radix(size_text, 16)
            .map_err(|_| bridge_unavailable("preview server returned an invalid chunk size"))?;
        cursor = size_end + 2;

        if size == 0 {
            break;
        }
        if cursor + size + 2 > body.len() {
            return Err(bridge_unavailable(
                "preview server returned a truncated chunk",
            ));
        }

        decoded.extend_from_slice(&body[cursor..cursor + size]);
        cursor += size + 2;
    }

    Ok(decoded)
}

fn find_crlf(body: &[u8], start: usize) -> Option<usize> {
    body[start..]
        .windows(2)
        .position(|window| window == b"\r\n")
        .map(|index| start + index)
}

fn redirect_location(response: &HttpResponse, base_url: &Url) -> Result<Option<Url>, CommandError> {
    if !matches!(response.status, 301 | 302 | 303 | 307 | 308) {
        return Ok(None);
    }

    let Some(location) = response.header("location") else {
        return Err(bridge_unavailable(
            "preview server redirected without a location",
        ));
    };
    let next_url = base_url
        .join(location)
        .map_err(|_| bridge_unavailable("preview server returned an invalid redirect"))?;

    parse_local_http_url(next_url.as_str()).map(Some)
}

fn parse_local_http_url(value: &str) -> Result<Url, CommandError> {
    let url = Url::parse(value).map_err(|_| invalid_preview_request("preview URL is invalid"))?;
    if url.scheme() != "http" {
        return Err(invalid_preview_request(
            "selection snapshot only supports local http URLs",
        ));
    }

    let host = url
        .host_str()
        .ok_or_else(|| invalid_preview_request("preview URL is missing a host"))?
        .to_ascii_lowercase();
    let allowed = host == "localhost" || host == "127.0.0.1" || host == "::1";
    if !allowed {
        return Err(invalid_preview_request(
            "selection snapshot only supports localhost previews",
        ));
    }

    Ok(url)
}

fn invalid_preview_request(message: impl Into<String>) -> CommandError {
    CommandError::new(ErrorCode::InvalidRequest, message, true)
}

fn bridge_unavailable(message: impl Into<String>) -> CommandError {
    CommandError::new(ErrorCode::BridgeUnavailable, message, true)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    use super::*;

    #[test]
    fn infers_project_root_from_node_modules_command_line() {
        let temp = tempdir().expect("temporary directory is available");
        fs::write(
            temp.path().join("package.json"),
            r#"{"scripts":{"dev":"next dev"}}"#,
        )
        .expect("package manifest can be written");

        let next_bin = temp
            .path()
            .join("node_modules")
            .join("next")
            .join("dist")
            .join("bin")
            .join("next");
        fs::create_dir_all(next_bin.parent().expect("fixture path has a parent"))
            .expect("node_modules fixture can be created");
        fs::write(&next_bin, "").expect("bin fixture can be written");

        let command_line = format!("\"node\" \"{}\" dev -p 3000", next_bin.display());
        let root = infer_project_root_from_command_line(&command_line)
            .expect("project root can be inferred");

        assert_eq!(
            std::fs::canonicalize(temp.path()).expect("temp root can be canonicalized"),
            root
        );
    }

    #[test]
    fn prefers_desktop_ancestor_root_from_command_line_path() {
        let temp = tempdir().expect("temporary directory is available");
        fs::create_dir(temp.path().join("src-tauri")).expect("tauri directory can be written");
        fs::write(temp.path().join("src-tauri").join("tauri.conf.json"), "{}")
            .expect("tauri config can be written");
        fs::write(
            temp.path().join("package.json"),
            r#"{"dependencies":{"@tauri-apps/api":"latest","vite":"latest"}}"#,
        )
        .expect("desktop package manifest can be written");

        let nested_app = temp.path().join("apps").join("shell");
        fs::create_dir_all(&nested_app).expect("nested app directory can be written");
        fs::write(
            nested_app.join("package.json"),
            r#"{"dependencies":{"vite":"latest"},"scripts":{"dev":"vite"}}"#,
        )
        .expect("nested package manifest can be written");

        let vite_bin = nested_app
            .join("node_modules")
            .join("vite")
            .join("bin")
            .join("openChrome.applescript");
        fs::create_dir_all(vite_bin.parent().expect("fixture path has a parent"))
            .expect("node_modules fixture can be created");
        fs::write(&vite_bin, "").expect("bin fixture can be written");

        let command_line = format!("node \"{}\" --host 127.0.0.1", vite_bin.display());
        let root = infer_project_root_from_command_line(&command_line)
            .expect("project root can be inferred");

        assert_eq!(
            std::fs::canonicalize(temp.path()).expect("temp root can be canonicalized"),
            root
        );
    }

    #[test]
    fn keeps_desktop_surface_from_process_command_line_for_vite_root() {
        let temp = tempdir().expect("temporary directory is available");
        fs::write(
            temp.path().join("package.json"),
            r#"{"dependencies":{"vite":"latest"},"scripts":{"dev":"vite"}}"#,
        )
        .expect("package manifest can be written");

        let command_line = format!("npm exec tauri dev -- --root \"{}\"", temp.path().display());
        let evidence = localhost_process_evidence_from_command_line(&command_line)
            .expect("process evidence can be inferred");
        let surface = detect_localhost_surface(
            5173,
            evidence.root_path.as_deref(),
            &evidence.desktop_signals,
        );

        assert_eq!(ApplicationSurfaceKind::Desktop, surface.kind);
        assert!(surface
            .signals
            .iter()
            .any(|signal| signal == "tauri process command line"));
    }

    #[test]
    fn combines_root_and_process_desktop_surface_signals() {
        let temp = tempdir().expect("temporary directory is available");
        fs::create_dir(temp.path().join("src-tauri")).expect("tauri directory can be written");
        fs::write(temp.path().join("src-tauri").join("tauri.conf.json"), "{}")
            .expect("tauri config can be written");
        fs::write(
            temp.path().join("package.json"),
            r#"{"dependencies":{"@tauri-apps/api":"latest","vite":"latest"},"scripts":{"dev":"vite"}}"#,
        )
        .expect("package manifest can be written");

        let command_line = format!("tauri dev --cwd \"{}\"", temp.path().display());
        let evidence = localhost_process_evidence_from_command_line(&command_line)
            .expect("process evidence can be inferred");
        let surface = detect_localhost_surface(
            5173,
            evidence.root_path.as_deref(),
            &evidence.desktop_signals,
        );

        assert_eq!(ApplicationSurfaceKind::Desktop, surface.kind);
        assert!(surface
            .signals
            .iter()
            .any(|signal| signal == "tauri project files"));
        assert!(surface
            .signals
            .iter()
            .any(|signal| signal == "tauri process command line"));
    }

    #[test]
    fn leaves_reachable_localhost_unknown_without_repo_or_process_evidence() {
        let surface = detect_localhost_surface(3000, None, &[]);

        assert_eq!(ApplicationSurfaceKind::Unknown, surface.kind);
        assert!(surface
            .signals
            .iter()
            .any(|signal| signal == "reachable localhost HTTP application"));
    }

    #[test]
    fn recognizes_additional_desktop_runtime_command_lines() {
        for (command_line, expected_signal) in [
            (
                "wails dev -frontend:devserver=http://localhost:5173",
                "wails process command line",
            ),
            ("npx neutralino dev", "neutralino process command line"),
            ("npx neu run", "neutralino process command line"),
            (
                "node ./node_modules/.bin/nw .",
                "nw.js process command line",
            ),
        ] {
            let signals = command_line_desktop_surface_signals(command_line);

            assert!(
                signals.iter().any(|signal| signal == expected_signal),
                "expected {expected_signal} in {signals:?}"
            );
        }
    }

    #[test]
    fn includes_common_local_web_dev_ports() {
        for port in [3000, 3001, 4173, 4174, 5173, 1420] {
            assert!(
                LOCALHOST_SCAN_PORTS.contains(&port),
                "expected localhost scanner to include port {port}"
            );
        }
    }

    #[test]
    fn formats_ipv6_loopback_url_with_brackets() {
        let url = localhost_url("::1", 3000).expect("IPv6 localhost URL can be parsed");

        assert_eq!("http://[::1]:3000/", url.as_str());
    }

    #[test]
    fn identifies_quartz_canvas_dev_server_by_title_on_any_port() {
        assert!(is_quartz_canvas_dev_server(1420, " Quartz Canvas "));
        assert!(is_quartz_canvas_dev_server(3000, "Quartz Canvas"));
        assert!(!is_quartz_canvas_dev_server(1420, "Customer App"));
    }

    #[tokio::test]
    async fn detects_redirected_localhost_application() {
        let port = serve_http_responses([
            "HTTP/1.1 302 Found\r\nLocation: /app\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n<!doctype html><html><head><title>Redirected App</title></head><body><div id=\"root\"></div><script type=\"module\" src=\"/@vite/client\"></script></body></html>",
        ])
        .await;

        let project = probe_localhost_port_with_root_detection(port, false)
            .await
            .expect("redirected localhost app should be detected");

        assert_eq!(port, project.port);
        assert_eq!("Redirected App", project.title);
        assert_eq!(Some("Vite".to_owned()), project.framework);
        assert!(project.url.ends_with("/app"));
    }

    async fn serve_http_responses<const N: usize>(responses: [&'static str; N]) -> u16 {
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("test server can bind to loopback");
        let port = listener
            .local_addr()
            .expect("test server has a local address")
            .port();

        tokio::spawn(async move {
            for response in responses {
                let Ok((mut stream, _)) = listener.accept().await else {
                    return;
                };
                let mut request = [0_u8; 1024];
                let _ = stream.read(&mut request).await;
                let _ = stream.write_all(response.as_bytes()).await;
            }
        });

        port
    }
}
