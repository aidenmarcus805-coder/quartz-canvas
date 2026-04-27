use std::{
    fs, io,
    path::{Path, PathBuf},
};

use thiserror::Error;

use crate::fs::{PathError, ProjectPath, SafeProjectRoot};

pub(super) fn writable_path(
    root: &SafeProjectRoot,
    path: &ProjectPath,
) -> Result<PathBuf, WritablePathError> {
    let target = root.path().join(path.as_std_path());
    let parent = target
        .parent()
        .ok_or_else(|| WritablePathError::MissingParent {
            path: target.clone(),
        })?;
    let ancestor = nearest_existing_ancestor(parent)?;
    let canonical =
        fs::canonicalize(&ancestor).map_err(|source| WritablePathError::Canonicalize {
            path: ancestor,
            source,
        })?;
    root.ensure_inside(&canonical)
        .map_err(WritablePathError::Path)?;
    Ok(target)
}

fn nearest_existing_ancestor(path: &Path) -> Result<PathBuf, WritablePathError> {
    let mut current = Some(path);
    while let Some(candidate) = current {
        match candidate.try_exists() {
            Ok(true) => return Ok(candidate.to_path_buf()),
            Ok(false) => current = candidate.parent(),
            Err(source) => {
                return Err(WritablePathError::Probe {
                    path: candidate.to_path_buf(),
                    source,
                })
            }
        }
    }

    Err(WritablePathError::MissingParent {
        path: path.to_path_buf(),
    })
}

#[derive(Debug, Error)]
pub(super) enum WritablePathError {
    #[error("target path has no parent directory: {path}")]
    MissingParent { path: PathBuf },
    #[error("failed to check target ancestor: {path}")]
    Probe {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("failed to canonicalize target ancestor: {path}")]
    Canonicalize {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("target path is outside the active project")]
    Path(#[source] PathError),
}
