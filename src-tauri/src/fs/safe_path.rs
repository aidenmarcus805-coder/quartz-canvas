use std::{
    env,
    ffi::OsStr,
    fmt,
    path::{Component, Path, PathBuf},
};

use camino::Utf8PathBuf;
use serde::{de, Deserialize, Deserializer, Serialize, Serializer};
use thiserror::Error;

#[derive(Clone, Debug)]
pub struct SafeProjectRoot {
    canonical: PathBuf,
}

impl SafeProjectRoot {
    pub fn open(path: impl AsRef<Path>, policy: &PathPolicy) -> Result<Self, PathError> {
        let canonical = std::fs::canonicalize(path.as_ref())
            .map_err(|source| PathError::RootUnavailable { source })?;

        if !canonical.is_dir() {
            return Err(PathError::RootNotDirectory);
        }

        policy.validate_root(&canonical)?;
        Ok(Self { canonical })
    }

    pub fn path(&self) -> &Path {
        &self.canonical
    }

    pub fn label(&self) -> String {
        self.canonical
            .file_name()
            .and_then(OsStr::to_str)
            .map(str::to_owned)
            .unwrap_or_else(|| "Project".to_owned())
    }

    pub fn existing_file(&self, path: &ProjectPath) -> Result<PathBuf, PathError> {
        let candidate = self.canonical.join(path.as_std_path());
        let canonical = std::fs::canonicalize(&candidate)
            .map_err(|source| PathError::PathUnavailable { source })?;
        self.ensure_inside(&canonical)?;
        Ok(canonical)
    }

    pub fn writable_path(&self, path: &ProjectPath) -> Result<PathBuf, PathError> {
        let target = self.canonical.join(path.as_std_path());
        let parent = target.parent().ok_or(PathError::ParentUnavailable)?;
        let canonical_parent = std::fs::canonicalize(parent)
            .map_err(|source| PathError::PathUnavailable { source })?;
        self.ensure_inside(&canonical_parent)?;
        Ok(target)
    }

    pub fn ensure_inside(&self, path: &Path) -> Result<(), PathError> {
        if path.starts_with(&self.canonical) {
            return Ok(());
        }

        Err(PathError::PathOutsideProject)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Hash)]
pub struct ProjectPath {
    relative: Utf8PathBuf,
}

impl ProjectPath {
    pub fn parse(raw: &str) -> Result<Self, PathError> {
        let normalized = raw.trim().replace('\\', "/");
        if normalized.is_empty() {
            return Err(PathError::EmptyProjectPath);
        }

        if looks_absolute(&normalized) {
            return Err(PathError::AbsoluteProjectPath);
        }

        let mut segments = Vec::new();
        for segment in normalized.split('/') {
            match segment {
                "" | "." => {}
                ".." => return Err(PathError::PathTraversal),
                clean if clean.contains(':') => return Err(PathError::AbsoluteProjectPath),
                clean => segments.push(clean),
            }
        }

        if segments.is_empty() {
            return Err(PathError::EmptyProjectPath);
        }

        Ok(Self {
            relative: Utf8PathBuf::from(segments.join("/")),
        })
    }

    pub fn as_str(&self) -> &str {
        self.relative.as_str()
    }

    pub fn as_std_path(&self) -> &Path {
        self.relative.as_std_path()
    }

    pub fn components(&self) -> impl Iterator<Item = &str> {
        self.relative.as_str().split('/')
    }
}

impl fmt::Display for ProjectPath {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.relative.as_str())
    }
}

impl Serialize for ProjectPath {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for ProjectPath {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(de::Error::custom)
    }
}

#[derive(Clone, Debug)]
pub struct PathPolicy {
    ignored_dirs: &'static [&'static str],
    protected_names: &'static [&'static str],
}

impl PathPolicy {
    pub fn strict() -> Self {
        Self {
            ignored_dirs: &[
                ".git",
                ".next",
                ".svelte-kit",
                ".turbo",
                "build",
                "dist",
                "node_modules",
                "target",
            ],
            protected_names: &[
                ".npmrc",
                ".pypirc",
                "bun.lockb",
                "credentials.json",
                "id_rsa",
                "package-lock.json",
                "pnpm-lock.yaml",
                "yarn.lock",
            ],
        }
    }

    pub fn validate_root(&self, path: &Path) -> Result<(), PathError> {
        if path.parent().is_none() {
            return Err(PathError::RootTooBroad);
        }

        if is_home(path) || is_os_folder(path) || is_credential_folder(path) {
            return Err(PathError::RootUnsafe);
        }

        Ok(())
    }

    pub fn classify(&self, path: &ProjectPath) -> PathDecision {
        for component in path.components() {
            let lower = component.to_ascii_lowercase();
            if self.ignored_dirs.iter().any(|name| *name == lower) {
                return PathDecision::Ignored;
            }
        }

        let file_name = path
            .components()
            .last()
            .map(str::to_ascii_lowercase)
            .unwrap_or_default();

        if file_name.starts_with(".env") || has_protected_extension(&file_name) {
            return PathDecision::Protected;
        }

        if self.protected_names.iter().any(|name| *name == file_name) {
            return PathDecision::Protected;
        }

        PathDecision::Allowed
    }

    pub fn require_allowed(&self, path: &ProjectPath) -> Result<(), PathError> {
        match self.classify(path) {
            PathDecision::Allowed => Ok(()),
            PathDecision::Ignored => Err(PathError::IgnoredPath),
            PathDecision::Protected => Err(PathError::ProtectedPath),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PathDecision {
    Allowed,
    Ignored,
    Protected,
}

#[derive(Debug, Error)]
pub enum PathError {
    #[error("project root is unavailable")]
    RootUnavailable {
        #[source]
        source: std::io::Error,
    },
    #[error("project root is not a directory")]
    RootNotDirectory,
    #[error("project root is too broad")]
    RootTooBroad,
    #[error("project root is unsafe")]
    RootUnsafe,
    #[error("project path is empty")]
    EmptyProjectPath,
    #[error("absolute project paths are not allowed")]
    AbsoluteProjectPath,
    #[error("project path traversal is not allowed")]
    PathTraversal,
    #[error("path is outside the active project")]
    PathOutsideProject,
    #[error("project path points to a protected file")]
    ProtectedPath,
    #[error("project path points to an ignored directory")]
    IgnoredPath,
    #[error("parent directory is unavailable")]
    ParentUnavailable,
    #[error("project path is unavailable")]
    PathUnavailable {
        #[source]
        source: std::io::Error,
    },
}

fn looks_absolute(path: &str) -> bool {
    let raw_path = Path::new(path);
    raw_path.is_absolute()
        || path.starts_with('/')
        || path.starts_with('\\')
        || path.as_bytes().get(1) == Some(&b':')
}

fn is_home(path: &Path) -> bool {
    ["USERPROFILE", "HOME"]
        .iter()
        .filter_map(env::var_os)
        .map(PathBuf::from)
        .filter_map(|home| std::fs::canonicalize(home).ok())
        .any(|home| home == path)
}

fn is_os_folder(path: &Path) -> bool {
    let lower = path.to_string_lossy().to_ascii_lowercase();
    lower.ends_with("\\windows")
        || lower.ends_with("\\program files")
        || lower.ends_with("\\program files (x86)")
        || matches!(path.components().next(), Some(Component::RootDir))
            && matches!(path.components().nth(1), Some(Component::Normal(name)) if name == "etc")
}

fn is_credential_folder(path: &Path) -> bool {
    path.file_name()
        .and_then(OsStr::to_str)
        .map(|name| {
            matches!(
                name.to_ascii_lowercase().as_str(),
                ".aws" | ".azure" | ".config" | ".gnupg" | ".ssh"
            )
        })
        .unwrap_or(false)
}

fn has_protected_extension(file_name: &str) -> bool {
    file_name.ends_with(".key") || file_name.ends_with(".pem") || file_name.ends_with(".p12")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_path_traversal_outside_project_root() {
        let error = ProjectPath::parse("../secret.txt").err();
        assert!(matches!(error, Some(PathError::PathTraversal)));
    }

    #[test]
    fn rejects_absolute_project_path() {
        let error = ProjectPath::parse("C:/Users/a/file.ts").err();
        assert!(matches!(error, Some(PathError::AbsoluteProjectPath)));
    }

    #[test]
    fn rejects_protected_patch_targets() {
        let path = ProjectPath::parse(".env.local").expect("valid relative path");
        let policy = PathPolicy::strict();
        let error = policy.require_allowed(&path).err();
        assert!(matches!(error, Some(PathError::ProtectedPath)));
    }

    #[test]
    fn accepts_normal_project_paths() {
        let path = ProjectPath::parse("src/components/App.tsx");
        assert!(path.is_ok(), "{path:?}");
    }
}
