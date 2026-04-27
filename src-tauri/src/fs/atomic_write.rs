use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use thiserror::Error;
use uuid::Uuid;

use super::ContentHash;

pub fn write_text_atomic(path: &Path, content: &str) -> Result<ContentHash, AtomicWriteError> {
    let parent = path.parent().ok_or(AtomicWriteError::MissingParent)?;
    fs::create_dir_all(parent).map_err(|source| AtomicWriteError::CreateParent { source })?;

    let temp_path = temp_path(parent);
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp_path)
        .map_err(|source| AtomicWriteError::OpenTemp { source })?;

    if let Err(source) = file.write_all(content.as_bytes()) {
        let _ = fs::remove_file(&temp_path);
        return Err(AtomicWriteError::WriteTemp { source });
    }

    if let Err(source) = file.sync_all() {
        let _ = fs::remove_file(&temp_path);
        return Err(AtomicWriteError::FlushTemp { source });
    }

    drop(file);
    fs::rename(&temp_path, path).map_err(|source| AtomicWriteError::Rename { source })?;
    ContentHash::from_file(path).map_err(|source| AtomicWriteError::Hash { source })
}

fn temp_path(parent: &Path) -> PathBuf {
    parent.join(format!(".quartz-canvas-{}.tmp", Uuid::new_v4()))
}

#[derive(Debug, Error)]
pub enum AtomicWriteError {
    #[error("target path has no parent directory")]
    MissingParent,
    #[error("failed to create parent directory")]
    CreateParent {
        #[source]
        source: std::io::Error,
    },
    #[error("failed to create temporary file")]
    OpenTemp {
        #[source]
        source: std::io::Error,
    },
    #[error("failed to write temporary file")]
    WriteTemp {
        #[source]
        source: std::io::Error,
    },
    #[error("failed to flush temporary file")]
    FlushTemp {
        #[source]
        source: std::io::Error,
    },
    #[error("failed to replace target file")]
    Rename {
        #[source]
        source: std::io::Error,
    },
    #[error("failed to hash target file after write")]
    Hash {
        #[source]
        source: super::content_hash::ContentHashError,
    },
}
