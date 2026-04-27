use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, Serialize)]
pub struct ProjectManifest {
    pub root_label: String,
    pub framework: FrameworkKind,
    pub surface_kind: ApplicationSurfaceKind,
    pub surface_signals: Vec<String>,
    pub package_manager: Option<PackageManager>,
    pub available_scripts: Vec<String>,
}

pub fn detect_project(root: &Path) -> Result<ProjectManifest, DetectError> {
    let package_json = read_package_json(root)?;
    let available_scripts = package_json
        .as_ref()
        .map(|package| package.scripts.keys().cloned().collect())
        .unwrap_or_default();

    let framework = detect_framework(root, package_json.as_ref());
    let surface = detect_application_surface(root, package_json.as_ref(), framework);

    Ok(ProjectManifest {
        root_label: root_label(root),
        framework,
        surface_kind: surface.kind,
        surface_signals: surface.signals,
        package_manager: detect_package_manager(root),
        available_scripts,
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FrameworkKind {
    Vite,
    Next,
    Remix,
    Astro,
    SvelteKit,
    PlainStatic,
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApplicationSurfaceKind {
    Desktop,
    Web,
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PackageManager {
    Npm,
    Pnpm,
    Yarn,
    Bun,
}

#[derive(Debug, Error)]
pub enum DetectError {
    #[error("failed to read package.json")]
    ReadPackageJson {
        #[source]
        source: std::io::Error,
    },
    #[error("failed to parse package.json")]
    ParsePackageJson {
        #[source]
        source: serde_json::Error,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackageJson {
    #[serde(default)]
    main: Option<String>,
    #[serde(default)]
    scripts: BTreeMap<String, String>,
    #[serde(default)]
    dependencies: BTreeMap<String, String>,
    #[serde(default)]
    dev_dependencies: BTreeMap<String, String>,
}

impl PackageJson {
    fn dependency_names(&self) -> BTreeSet<&str> {
        self.dependencies
            .keys()
            .chain(self.dev_dependencies.keys())
            .map(String::as_str)
            .collect()
    }
}

#[derive(Debug)]
struct SurfaceDetection {
    kind: ApplicationSurfaceKind,
    signals: Vec<String>,
}

fn read_package_json(root: &Path) -> Result<Option<PackageJson>, DetectError> {
    let path = root.join("package.json");
    if !path.exists() {
        return Ok(None);
    }

    let content =
        fs::read_to_string(path).map_err(|source| DetectError::ReadPackageJson { source })?;
    serde_json::from_str(&content)
        .map(Some)
        .map_err(|source| DetectError::ParsePackageJson { source })
}

fn detect_framework(root: &Path, package_json: Option<&PackageJson>) -> FrameworkKind {
    let dependencies = package_json
        .map(PackageJson::dependency_names)
        .unwrap_or_default();

    if dependencies.contains("next") || has_any(root, &["next.config.js", "next.config.mjs"]) {
        return FrameworkKind::Next;
    }

    if dependencies.contains("@remix-run/react") || has_any(root, &["remix.config.js"]) {
        return FrameworkKind::Remix;
    }

    if dependencies.contains("astro") || has_any(root, &["astro.config.mjs", "astro.config.ts"]) {
        return FrameworkKind::Astro;
    }

    if dependencies.contains("@sveltejs/kit") || has_any(root, &["svelte.config.js"]) {
        return FrameworkKind::SvelteKit;
    }

    if dependencies.contains("vite")
        || has_any(
            root,
            &["vite.config.js", "vite.config.mjs", "vite.config.ts"],
        )
    {
        return FrameworkKind::Vite;
    }

    if root.join("index.html").exists() {
        return FrameworkKind::PlainStatic;
    }

    FrameworkKind::Unknown
}

fn detect_application_surface(
    root: &Path,
    package_json: Option<&PackageJson>,
    framework: FrameworkKind,
) -> SurfaceDetection {
    let mut desktop_signals = Vec::new();
    let mut web_signals = Vec::new();

    collect_desktop_surface_signals(root, package_json, &mut desktop_signals);
    collect_web_surface_signals(root, package_json, framework, &mut web_signals);

    if !desktop_signals.is_empty() {
        return SurfaceDetection {
            kind: ApplicationSurfaceKind::Desktop,
            signals: desktop_signals,
        };
    }

    if !web_signals.is_empty() {
        return SurfaceDetection {
            kind: ApplicationSurfaceKind::Web,
            signals: web_signals,
        };
    }

    SurfaceDetection {
        kind: ApplicationSurfaceKind::Unknown,
        signals: Vec::new(),
    }
}

fn collect_desktop_surface_signals(
    root: &Path,
    package_json: Option<&PackageJson>,
    signals: &mut Vec<String>,
) {
    for candidate_root in desktop_evidence_roots(root) {
        collect_desktop_file_signals(&candidate_root, signals);

        if candidate_root == root {
            if let Some(package_json) = package_json {
                collect_desktop_package_signals(package_json, signals);
            }
            continue;
        }

        if let Ok(Some(package_json)) = read_package_json(&candidate_root) {
            collect_desktop_package_signals(&package_json, signals);
        }
    }

    signals.sort();
    signals.dedup();
}

fn desktop_evidence_roots(root: &Path) -> Vec<PathBuf> {
    root.ancestors().take(4).map(Path::to_path_buf).collect()
}

fn collect_desktop_file_signals(root: &Path, signals: &mut Vec<String>) {
    if has_any(
        root,
        &[
            "src-tauri/tauri.conf.json",
            "src-tauri/Cargo.toml",
            "tauri.conf.json",
        ],
    ) {
        signals.push("tauri project files".to_owned());
    }
    if root.join("wails.json").exists() {
        signals.push("wails project file".to_owned());
    }
    if root.join("neutralino.config.json").exists() {
        signals.push("neutralino project file".to_owned());
    }
}

fn collect_desktop_package_signals(package_json: &PackageJson, signals: &mut Vec<String>) {
    let dependencies = package_json.dependency_names();
    if dependencies.contains("@tauri-apps/api") || dependencies.contains("@tauri-apps/cli") {
        signals.push("tauri package dependency".to_owned());
    }
    if dependencies.contains("electron")
        || dependencies.contains("@electron-forge/cli")
        || dependencies.contains("electron-builder")
    {
        signals.push("electron package dependency".to_owned());
    }
    if dependencies.contains("wails") || dependencies.contains("@wailsio/runtime") {
        signals.push("wails package dependency".to_owned());
    }
    if dependencies.contains("@neutralinojs/lib") || dependencies.contains("@neutralinojs/neu") {
        signals.push("neutralino package dependency".to_owned());
    }
    if dependencies.contains("nw") || dependencies.contains("nw-builder") {
        signals.push("nw.js package dependency".to_owned());
    }
    if package_json
        .main
        .as_deref()
        .is_some_and(is_electron_entry_path)
    {
        signals.push("electron main entrypoint".to_owned());
    }
    if package_json.scripts.values().any(|script| {
        script_contains_any(
            script,
            &["tauri", "electron", "wails", "neutralino", "neu run", "nw "],
        )
    }) {
        signals.push("desktop runtime script".to_owned());
    }
}

fn is_electron_entry_path(path: &str) -> bool {
    path.to_ascii_lowercase().contains("electron")
}

fn collect_web_surface_signals(
    root: &Path,
    package_json: Option<&PackageJson>,
    framework: FrameworkKind,
    signals: &mut Vec<String>,
) {
    match framework {
        FrameworkKind::Vite
        | FrameworkKind::Next
        | FrameworkKind::Remix
        | FrameworkKind::Astro
        | FrameworkKind::SvelteKit => signals.push(format!("{framework:?} framework")),
        FrameworkKind::PlainStatic => signals.push("static html entrypoint".to_owned()),
        FrameworkKind::Unknown => {}
    }

    let Some(package_json) = package_json else {
        return;
    };

    if package_json.scripts.values().any(|script| {
        script_contains_any(
            script,
            &[
                "vite",
                "next",
                "remix",
                "astro",
                "svelte-kit",
                "webpack",
                "parcel",
            ],
        )
    }) {
        signals.push("web dev server script".to_owned());
    }

    if root.join("public").is_dir() || root.join("index.html").exists() {
        signals.push("web asset entrypoint".to_owned());
    }
}

fn script_contains_any(script: &str, needles: &[&str]) -> bool {
    let lower = script.to_ascii_lowercase();
    needles.iter().any(|needle| lower.contains(needle))
}

fn detect_package_manager(root: &Path) -> Option<PackageManager> {
    if root.join("pnpm-lock.yaml").exists() {
        return Some(PackageManager::Pnpm);
    }

    if root.join("yarn.lock").exists() {
        return Some(PackageManager::Yarn);
    }

    if root.join("bun.lockb").exists() {
        return Some(PackageManager::Bun);
    }

    if root.join("package-lock.json").exists() {
        return Some(PackageManager::Npm);
    }

    None
}

fn has_any(root: &Path, relative_paths: &[&str]) -> bool {
    relative_paths
        .iter()
        .any(|relative_path| root.join(relative_path).exists())
}

fn root_label(root: &Path) -> String {
    root.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
        .unwrap_or_else(|| "Project".to_owned())
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path};

    use tempfile::tempdir;

    use super::*;

    fn write_package_json(root: &Path, content: &str) {
        fs::write(root.join("package.json"), content).expect("package manifest can be written");
    }

    #[test]
    fn detects_framework_from_fixture_projects() {
        let temp = tempdir().expect("temporary directory is available");
        write_package_json(
            temp.path(),
            r#"{"dependencies":{"vite":"latest"},"scripts":{"dev":"vite"}}"#,
        );

        let manifest = detect_project(temp.path()).expect("fixture can be detected");

        assert_eq!(manifest.framework, FrameworkKind::Vite);
        assert_eq!(manifest.surface_kind, ApplicationSurfaceKind::Web);
        assert!(manifest
            .surface_signals
            .iter()
            .any(|signal| signal.contains("Vite")));
        assert_eq!(manifest.available_scripts, vec!["dev".to_owned()]);
    }

    #[test]
    fn detects_desktop_surface_from_tauri_metadata() {
        let temp = tempdir().expect("temporary directory is available");
        fs::create_dir(temp.path().join("src-tauri")).expect("tauri directory can be written");
        fs::write(temp.path().join("src-tauri").join("tauri.conf.json"), "{}")
            .expect("tauri config can be written");
        write_package_json(
            temp.path(),
            r#"{"dependencies":{"@tauri-apps/api":"latest","vite":"latest"},"scripts":{"tauri":"tauri dev","dev":"vite"}}"#,
        );

        let manifest = detect_project(temp.path()).expect("fixture can be detected");

        assert_eq!(manifest.framework, FrameworkKind::Vite);
        assert_eq!(manifest.surface_kind, ApplicationSurfaceKind::Desktop);
        assert!(manifest
            .surface_signals
            .iter()
            .any(|signal| signal.contains("tauri")));
    }

    #[test]
    fn detects_tauri_wrapper_when_served_root_is_frontend_subdirectory() {
        let temp = tempdir().expect("temporary directory is available");
        let frontend = temp.path().join("frontend");
        fs::create_dir_all(temp.path().join("src-tauri")).expect("tauri directory can be written");
        fs::create_dir(&frontend).expect("frontend directory can be written");
        fs::write(temp.path().join("src-tauri").join("Cargo.toml"), "")
            .expect("tauri cargo manifest can be written");
        write_package_json(
            &frontend,
            r#"{"dependencies":{"vite":"latest"},"scripts":{"dev":"vite"}}"#,
        );

        let manifest = detect_project(&frontend).expect("fixture can be detected");

        assert_eq!(manifest.framework, FrameworkKind::Vite);
        assert_eq!(manifest.surface_kind, ApplicationSurfaceKind::Desktop);
        assert!(manifest
            .surface_signals
            .iter()
            .any(|signal| signal == "tauri project files"));
    }

    #[test]
    fn detects_electron_wrapper_from_parent_package() {
        let temp = tempdir().expect("temporary directory is available");
        let web = temp.path().join("packages").join("web");
        fs::create_dir_all(&web).expect("frontend directory can be written");
        write_package_json(
            temp.path(),
            r#"{"devDependencies":{"electron":"latest"},"main":"desktop/electron-main.ts","scripts":{"desktop":"electron ."}}"#,
        );
        write_package_json(
            &web,
            r#"{"dependencies":{"vite":"latest"},"scripts":{"dev":"vite"}}"#,
        );

        let manifest = detect_project(&web).expect("fixture can be detected");

        assert_eq!(manifest.surface_kind, ApplicationSurfaceKind::Desktop);
        assert!(manifest
            .surface_signals
            .iter()
            .any(|signal| signal.contains("electron")));
    }

    #[test]
    fn detects_wails_neutralino_and_nwjs_evidence() {
        let wails = tempdir().expect("temporary directory is available");
        fs::write(wails.path().join("wails.json"), "{}").expect("wails config can be written");
        assert_eq!(
            detect_project(wails.path())
                .expect("wails fixture can be detected")
                .surface_kind,
            ApplicationSurfaceKind::Desktop
        );

        let neutralino = tempdir().expect("temporary directory is available");
        fs::write(neutralino.path().join("neutralino.config.json"), "{}")
            .expect("neutralino config can be written");
        assert_eq!(
            detect_project(neutralino.path())
                .expect("neutralino fixture can be detected")
                .surface_kind,
            ApplicationSurfaceKind::Desktop
        );

        let nwjs = tempdir().expect("temporary directory is available");
        write_package_json(
            nwjs.path(),
            r#"{"devDependencies":{"nw-builder":"latest"}}"#,
        );
        assert_eq!(
            detect_project(nwjs.path())
                .expect("nw.js fixture can be detected")
                .surface_kind,
            ApplicationSurfaceKind::Desktop
        );
    }

    #[test]
    fn returns_unknown_without_surface_evidence() {
        let temp = tempdir().expect("temporary directory is available");

        let manifest = detect_project(temp.path()).expect("fixture can be detected");

        assert_eq!(manifest.framework, FrameworkKind::Unknown);
        assert_eq!(manifest.surface_kind, ApplicationSurfaceKind::Unknown);
        assert!(manifest.surface_signals.is_empty());
    }
}
