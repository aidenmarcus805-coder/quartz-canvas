use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

use crate::{
    domain::PatchId,
    fs::{PathError, ProjectPath, SafeProjectRoot},
    patch::{
        diff::{apply_unified_diff, DiffApplyError},
        model::{PatchFileChange, PatchProposal},
        paths::{self, WritablePathError},
        validate::{PatchValidator, ValidationReport, ValidationStatus},
    },
    project::ActiveProject,
};

#[derive(Debug)]
pub struct PatchService {
    validator: PatchValidator,
    rollback_snapshots: Mutex<HashMap<PatchId, RollbackSnapshot>>,
}

impl PatchService {
    pub fn new() -> Self {
        Self {
            validator: PatchValidator::new(),
            rollback_snapshots: Mutex::new(HashMap::new()),
        }
    }

    pub fn validate(&self, active: &ActiveProject, proposal: &PatchProposal) -> ValidationReport {
        self.validator.validate(active, proposal)
    }

    pub fn apply(
        &self,
        active: &ActiveProject,
        request: ApplyPatchRequest,
    ) -> Result<PatchApplyResponse, PatchError> {
        if !request.review_approved {
            return Err(PatchError::ReviewRequired);
        }

        let report = self.validate(active, &request.proposal);
        if report.status != ValidationStatus::Passed {
            return Err(PatchError::Rejected { report });
        }

        let plan = PatchPlan::build(&active.root, &request.proposal)
            .map_err(|_error| PatchError::ApplyEngineUnavailable)?;
        verify_entries_match(&plan.rollback_entries, SnapshotSide::Before)
            .map_err(|_error| PatchError::ApplyEngineUnavailable)?;

        let patch_id = PatchId::new();
        let snapshot = RollbackSnapshot {
            entries: plan.rollback_entries.clone(),
        };
        let mut snapshots = self
            .rollback_snapshots
            .lock()
            .map_err(|_| PatchError::RollbackUnavailable)?;

        if let Err(_error) = execute_mutations(&plan.mutations) {
            let _ = restore_entries(&snapshot.entries);
            return Err(PatchError::ApplyEngineUnavailable);
        }

        snapshots.insert(patch_id.clone(), snapshot);
        Ok(PatchApplyResponse { patch_id })
    }

    pub fn rollback(
        &self,
        request: RollbackPatchRequest,
    ) -> Result<PatchRollbackResponse, PatchError> {
        let mut snapshots = self
            .rollback_snapshots
            .lock()
            .map_err(|_| PatchError::RollbackUnavailable)?;
        let snapshot = snapshots
            .get(&request.patch_id)
            .cloned()
            .ok_or(PatchError::RollbackUnavailable)?;

        if !request.allow_conflicts {
            verify_entries_match(&snapshot.entries, SnapshotSide::After)
                .map_err(|_error| PatchError::RollbackUnavailable)?;
        }

        restore_entries(&snapshot.entries).map_err(|_error| PatchError::RollbackUnavailable)?;
        snapshots.remove(&request.patch_id);

        Ok(PatchRollbackResponse {
            patch_id: request.patch_id,
        })
    }

    pub fn rollback_stack(
        &self,
        request: RollbackPatchStackRequest,
    ) -> Result<PatchRollbackStackResponse, PatchError> {
        let mut snapshots = self
            .rollback_snapshots
            .lock()
            .map_err(|_| PatchError::RollbackUnavailable)?;
        let rollback_items = rollback_items(&snapshots, &request.patch_ids)?;

        if !request.allow_conflicts {
            verify_stack_entries_match(&rollback_items)
                .map_err(|_| PatchError::RollbackUnavailable)?;
        }

        for (_, snapshot) in &rollback_items {
            restore_entries(&snapshot.entries).map_err(|_| PatchError::RollbackUnavailable)?;
        }

        for patch_id in &request.patch_ids {
            snapshots.remove(patch_id);
        }

        Ok(PatchRollbackStackResponse {
            patch_ids: request.patch_ids,
        })
    }
}

impl Default for PatchService {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyPatchRequest {
    pub proposal: PatchProposal,
    pub review_approved: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackPatchRequest {
    pub patch_id: crate::domain::PatchId,
    pub allow_conflicts: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackPatchStackRequest {
    pub patch_ids: Vec<crate::domain::PatchId>,
    pub allow_conflicts: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchApplyResponse {
    pub patch_id: crate::domain::PatchId,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchRollbackResponse {
    pub patch_id: crate::domain::PatchId,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchRollbackStackResponse {
    pub patch_ids: Vec<crate::domain::PatchId>,
}

#[derive(Debug, Error)]
pub enum PatchError {
    #[error("patch review approval is required before apply")]
    ReviewRequired,
    #[error("patch was rejected by validation")]
    Rejected { report: ValidationReport },
    #[error("patch application failed")]
    ApplyEngineUnavailable,
    #[error("rollback data is unavailable")]
    RollbackUnavailable,
}

#[derive(Clone, Debug)]
struct RollbackSnapshot {
    entries: Vec<RollbackEntry>,
}

fn rollback_items(
    snapshots: &HashMap<PatchId, RollbackSnapshot>,
    patch_ids: &[PatchId],
) -> Result<Vec<(PatchId, RollbackSnapshot)>, PatchError> {
    patch_ids
        .iter()
        .map(|patch_id| {
            snapshots
                .get(patch_id)
                .cloned()
                .map(|snapshot| (patch_id.clone(), snapshot))
                .ok_or(PatchError::RollbackUnavailable)
        })
        .collect()
}

fn verify_stack_entries_match(
    rollback_items: &[(PatchId, RollbackSnapshot)],
) -> Result<(), PatchRollbackError> {
    let mut virtual_files: HashMap<PathBuf, FileSnapshot> = HashMap::new();

    for (_, snapshot) in rollback_items {
        for entry in &snapshot.entries {
            match virtual_files.get(&entry.path) {
                Some(current) if current == &entry.after => {}
                Some(_) => {
                    return Err(PatchRollbackError::SnapshotMismatch {
                        path: entry.path.clone(),
                    })
                }
                None if snapshot_matches(&entry.path, &entry.after)? => {}
                None => {
                    return Err(PatchRollbackError::SnapshotMismatch {
                        path: entry.path.clone(),
                    })
                }
            }
        }

        for entry in &snapshot.entries {
            virtual_files.insert(entry.path.clone(), entry.before.clone());
        }
    }

    Ok(())
}

#[derive(Clone, Debug)]
struct RollbackEntry {
    path: PathBuf,
    before: FileSnapshot,
    after: FileSnapshot,
}

#[derive(Clone, Debug, PartialEq)]
enum FileSnapshot {
    Present(String),
    Absent,
}

#[derive(Debug)]
struct PatchPlan {
    mutations: Vec<FileMutation>,
    rollback_entries: Vec<RollbackEntry>,
}

impl PatchPlan {
    fn build(root: &SafeProjectRoot, proposal: &PatchProposal) -> Result<Self, PatchApplyError> {
        let mut plan = Self {
            mutations: Vec::new(),
            rollback_entries: Vec::new(),
        };

        for change in &proposal.files {
            plan.push_change(root, change)?;
        }

        Ok(plan)
    }

    fn push_change(
        &mut self,
        root: &SafeProjectRoot,
        change: &PatchFileChange,
    ) -> Result<(), PatchApplyError> {
        match change {
            PatchFileChange::Create { path, content } => self.push_create(root, path, content),
            PatchFileChange::Modify {
                path, unified_diff, ..
            } => self.push_modify(root, path, unified_diff),
            PatchFileChange::Delete { path, .. } => self.push_delete(root, path),
            PatchFileChange::Rename { from, to, .. } => self.push_rename(root, from, to),
        }
    }

    fn push_create(
        &mut self,
        root: &SafeProjectRoot,
        path: &ProjectPath,
        content: &str,
    ) -> Result<(), PatchApplyError> {
        let target = writable_path(root, path)?;
        require_absent(&target)?;
        self.mutations.push(FileMutation::Write {
            path: target.clone(),
            content: content.to_owned(),
        });
        self.rollback_entries.push(RollbackEntry {
            path: target,
            before: FileSnapshot::Absent,
            after: FileSnapshot::Present(content.to_owned()),
        });
        Ok(())
    }

    fn push_modify(
        &mut self,
        root: &SafeProjectRoot,
        path: &ProjectPath,
        unified_diff: &str,
    ) -> Result<(), PatchApplyError> {
        let target = existing_path(root, path)?;
        let before = read_text(&target)?;
        let after =
            apply_unified_diff(&before, unified_diff).map_err(|source| PatchApplyError::Diff {
                path: path.clone(),
                source,
            })?;
        self.mutations.push(FileMutation::Write {
            path: target.clone(),
            content: after.clone(),
        });
        self.rollback_entries.push(RollbackEntry {
            path: target,
            before: FileSnapshot::Present(before),
            after: FileSnapshot::Present(after),
        });
        Ok(())
    }

    fn push_delete(
        &mut self,
        root: &SafeProjectRoot,
        path: &ProjectPath,
    ) -> Result<(), PatchApplyError> {
        let target = existing_path(root, path)?;
        let before = read_text(&target)?;
        self.mutations.push(FileMutation::Delete {
            path: target.clone(),
        });
        self.rollback_entries.push(RollbackEntry {
            path: target,
            before: FileSnapshot::Present(before),
            after: FileSnapshot::Absent,
        });
        Ok(())
    }

    fn push_rename(
        &mut self,
        root: &SafeProjectRoot,
        from: &ProjectPath,
        to: &ProjectPath,
    ) -> Result<(), PatchApplyError> {
        let source = existing_path(root, from)?;
        let target = writable_path(root, to)?;
        require_absent(&target)?;
        let content = read_text(&source)?;
        self.mutations.push(FileMutation::Rename {
            from: source.clone(),
            to: target.clone(),
        });
        self.rollback_entries.push(RollbackEntry {
            path: source,
            before: FileSnapshot::Present(content.clone()),
            after: FileSnapshot::Absent,
        });
        self.rollback_entries.push(RollbackEntry {
            path: target,
            before: FileSnapshot::Absent,
            after: FileSnapshot::Present(content),
        });
        Ok(())
    }
}

#[derive(Debug)]
enum FileMutation {
    Write { path: PathBuf, content: String },
    Delete { path: PathBuf },
    Rename { from: PathBuf, to: PathBuf },
}

fn existing_path(root: &SafeProjectRoot, path: &ProjectPath) -> Result<PathBuf, PatchApplyError> {
    root.existing_file(path)
        .map_err(|source| PatchApplyError::Path {
            path: path.clone(),
            source,
        })
}

fn writable_path(root: &SafeProjectRoot, path: &ProjectPath) -> Result<PathBuf, PatchApplyError> {
    paths::writable_path(root, path).map_err(|source| PatchApplyError::WritablePath {
        path: path.clone(),
        source,
    })
}

fn require_absent(path: &Path) -> Result<(), PatchApplyError> {
    match path.try_exists() {
        Ok(false) => Ok(()),
        Ok(true) => Err(PatchApplyError::TargetExists {
            path: path.to_path_buf(),
        }),
        Err(source) => Err(PatchApplyError::Probe {
            path: path.to_path_buf(),
            source,
        }),
    }
}

fn read_text(path: &Path) -> Result<String, PatchApplyError> {
    fs::read_to_string(path).map_err(|source| PatchApplyError::Read {
        path: path.to_path_buf(),
        source,
    })
}

fn execute_mutations(mutations: &[FileMutation]) -> Result<(), PatchApplyError> {
    for mutation in mutations {
        match mutation {
            FileMutation::Write { path, content } => {
                write_text_atomic(path, content).map_err(|source| PatchApplyError::Write {
                    path: path.clone(),
                    source,
                })?
            }
            FileMutation::Delete { path } => delete_for_apply(path)?,
            FileMutation::Rename { from, to } => {
                fs::rename(from, to).map_err(|source| PatchApplyError::Rename {
                    from: from.clone(),
                    to: to.clone(),
                    source,
                })?;
            }
        }
    }

    Ok(())
}

fn delete_for_apply(path: &Path) -> Result<(), PatchApplyError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(source) => Err(PatchApplyError::Delete {
            path: path.to_path_buf(),
            source,
        }),
    }
}

#[derive(Clone, Copy)]
enum SnapshotSide {
    Before,
    After,
}

fn verify_entries_match(
    entries: &[RollbackEntry],
    side: SnapshotSide,
) -> Result<(), PatchRollbackError> {
    for entry in entries {
        let expected = match side {
            SnapshotSide::Before => &entry.before,
            SnapshotSide::After => &entry.after,
        };

        if !snapshot_matches(&entry.path, expected)? {
            return Err(PatchRollbackError::SnapshotMismatch {
                path: entry.path.clone(),
            });
        }
    }

    Ok(())
}

fn snapshot_matches(path: &Path, expected: &FileSnapshot) -> Result<bool, PatchRollbackError> {
    match expected {
        FileSnapshot::Absent => {
            path.try_exists()
                .map(|exists| !exists)
                .map_err(|source| PatchRollbackError::Probe {
                    path: path.to_path_buf(),
                    source,
                })
        }
        FileSnapshot::Present(content) => match fs::read_to_string(path) {
            Ok(current) => Ok(current == *content),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
            Err(source) => Err(PatchRollbackError::Read {
                path: path.to_path_buf(),
                source,
            }),
        },
    }
}

fn restore_entries(entries: &[RollbackEntry]) -> Result<(), PatchRollbackError> {
    for entry in entries.iter().rev() {
        restore_snapshot(&entry.path, &entry.before)?;
    }

    Ok(())
}

fn restore_snapshot(path: &Path, snapshot: &FileSnapshot) -> Result<(), PatchRollbackError> {
    match snapshot {
        FileSnapshot::Present(content) => {
            write_text_atomic(path, content).map_err(|source| PatchRollbackError::Write {
                path: path.to_path_buf(),
                source,
            })
        }
        FileSnapshot::Absent => delete_for_rollback(path),
    }
}

fn delete_for_rollback(path: &Path) -> Result<(), PatchRollbackError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(source) => Err(PatchRollbackError::Delete {
            path: path.to_path_buf(),
            source,
        }),
    }
}

fn write_text_atomic(path: &Path, content: &str) -> Result<(), AtomicTextWriteError> {
    let parent = path
        .parent()
        .ok_or_else(|| AtomicTextWriteError::MissingParent {
            path: path.to_path_buf(),
        })?;
    fs::create_dir_all(parent).map_err(|source| AtomicTextWriteError::CreateParent {
        path: parent.to_path_buf(),
        source,
    })?;

    let temp_path = parent.join(format!(".quartz-canvas-patch-{}.tmp", Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp_path)
        .map_err(|source| AtomicTextWriteError::OpenTemp {
            path: temp_path.clone(),
            source,
        })?;

    if let Err(source) = file.write_all(content.as_bytes()) {
        let _ = fs::remove_file(&temp_path);
        return Err(AtomicTextWriteError::WriteTemp {
            path: temp_path,
            source,
        });
    }
    if let Err(source) = file.sync_all() {
        let _ = fs::remove_file(&temp_path);
        return Err(AtomicTextWriteError::FlushTemp {
            path: temp_path,
            source,
        });
    }
    drop(file);

    replace_file(&temp_path, path).map_err(|source| {
        let _ = fs::remove_file(&temp_path);
        AtomicTextWriteError::Replace {
            path: path.to_path_buf(),
            source,
        }
    })
}

#[cfg(not(windows))]
fn replace_file(from: &Path, to: &Path) -> io::Result<()> {
    fs::rename(from, to)
}

#[cfg(windows)]
fn replace_file(from: &Path, to: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;

    extern "system" {
        fn MoveFileExW(
            existing_file_name: *const u16,
            new_file_name: *const u16,
            flags: u32,
        ) -> i32;
    }

    fn wide_path(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain(Some(0)).collect()
    }

    let from_wide = wide_path(from);
    let to_wide = wide_path(to);
    // SAFETY: both path buffers are NUL-terminated, valid for this call, and the OS does not retain them.
    let replaced = unsafe {
        MoveFileExW(
            from_wide.as_ptr(),
            to_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };

    if replaced == 0 {
        return Err(io::Error::last_os_error());
    }

    Ok(())
}

#[derive(Debug, Error)]
enum PatchApplyError {
    #[error("patch path {path} is not writable")]
    Path {
        path: ProjectPath,
        #[source]
        source: PathError,
    },
    #[error("patch path {path} is not writable")]
    WritablePath {
        path: ProjectPath,
        #[source]
        source: WritablePathError,
    },
    #[error("patch target already exists: {path}")]
    TargetExists { path: PathBuf },
    #[error("failed to check patch path: {path}")]
    Probe {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("failed to read patch source file: {path}")]
    Read {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("failed to apply unified diff to {path}")]
    Diff {
        path: ProjectPath,
        #[source]
        source: DiffApplyError,
    },
    #[error("failed to write patch target file: {path}")]
    Write {
        path: PathBuf,
        #[source]
        source: AtomicTextWriteError,
    },
    #[error("failed to delete patch target file: {path}")]
    Delete {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("failed to rename patch target from {from} to {to}")]
    Rename {
        from: PathBuf,
        to: PathBuf,
        #[source]
        source: io::Error,
    },
}

#[derive(Debug, Error)]
enum PatchRollbackError {
    #[error("file changed after patch application: {path}")]
    SnapshotMismatch { path: PathBuf },
    #[error("failed to check rollback path: {path}")]
    Probe {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("failed to read rollback path: {path}")]
    Read {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("failed to restore rollback file: {path}")]
    Write {
        path: PathBuf,
        #[source]
        source: AtomicTextWriteError,
    },
    #[error("failed to remove rollback-created file: {path}")]
    Delete {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
}

#[derive(Debug, Error)]
enum AtomicTextWriteError {
    #[error("target path has no parent directory: {path}")]
    MissingParent { path: PathBuf },
    #[error("failed to create parent directory: {path}")]
    CreateParent {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("failed to create temporary file: {path}")]
    OpenTemp {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("failed to write temporary file: {path}")]
    WriteTemp {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("failed to flush temporary file: {path}")]
    FlushTemp {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("failed to replace target file: {path}")]
    Replace {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
}

#[cfg(test)]
mod tests {
    use std::fs;

    use chrono::Utc;
    use tempfile::{tempdir, TempDir};

    use crate::{
        domain::{AiRequestId, ProjectId, ProposalId},
        fs::{ContentHash, PathPolicy},
        project::detect::{ApplicationSurfaceKind, FrameworkKind, ProjectManifest},
    };

    use super::*;

    #[test]
    fn apply_creates_file_and_rollback_deletes_it() {
        let temp = tempdir().expect("temporary directory is available");
        let active = active_project(&temp);
        let service = PatchService::new();
        let target = temp.path().join("created.txt");
        let proposal = proposal(
            &active,
            vec![PatchFileChange::Create {
                path: project_path("created.txt"),
                content: "hello\n".to_owned(),
            }],
        );

        let response = service
            .apply(
                &active,
                ApplyPatchRequest {
                    proposal,
                    review_approved: true,
                },
            )
            .expect("approved create patch applies");

        assert_eq!(
            fs::read_to_string(&target).expect("created file can be read"),
            "hello\n"
        );

        service
            .rollback(RollbackPatchRequest {
                patch_id: response.patch_id,
                allow_conflicts: false,
            })
            .expect("created file rollback succeeds");

        assert!(!target.exists());
    }

    #[test]
    fn rejects_modify_delete_and_rename_when_base_hash_is_stale() {
        let temp = tempdir().expect("temporary directory is available");
        fs::write(temp.path().join("file.txt"), "changed\n").expect("fixture file is written");
        let active = active_project(&temp);
        let service = PatchService::new();
        let stale_hash = ContentHash::from_text("original\n");
        let changes = vec![
            PatchFileChange::Modify {
                path: project_path("file.txt"),
                old_hash: stale_hash.clone(),
                unified_diff: "--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-original\n+updated\n"
                    .to_owned(),
            },
            PatchFileChange::Delete {
                path: project_path("file.txt"),
                old_hash: stale_hash.clone(),
            },
            PatchFileChange::Rename {
                from: project_path("file.txt"),
                to: project_path("renamed.txt"),
                old_hash: stale_hash,
            },
        ];

        for change in changes {
            let error = service
                .apply(
                    &active,
                    ApplyPatchRequest {
                        proposal: proposal(&active, vec![change]),
                        review_approved: true,
                    },
                )
                .err();

            assert!(matches!(error, Some(PatchError::Rejected { .. })));
        }
    }

    #[test]
    fn rejects_apply_without_review_approval() {
        let temp = tempdir().expect("temporary directory is available");
        let active = active_project(&temp);
        let service = PatchService::new();
        let proposal = proposal(
            &active,
            vec![PatchFileChange::Create {
                path: project_path("created.txt"),
                content: "hello\n".to_owned(),
            }],
        );

        let error = service
            .apply(
                &active,
                ApplyPatchRequest {
                    proposal,
                    review_approved: false,
                },
            )
            .err();

        assert!(matches!(error, Some(PatchError::ReviewRequired)));
        assert!(!temp.path().join("created.txt").exists());
    }

    #[test]
    fn rollback_restores_modified_content() {
        let temp = tempdir().expect("temporary directory is available");
        let target = temp.path().join("file.txt");
        fs::write(&target, "alpha\nbeta\n").expect("fixture file is written");
        let active = active_project(&temp);
        let service = PatchService::new();
        let proposal = proposal(
            &active,
            vec![PatchFileChange::Modify {
                path: project_path("file.txt"),
                old_hash: ContentHash::from_text("alpha\nbeta\n"),
                unified_diff:
                    "--- a/file.txt\n+++ b/file.txt\n@@ -1,2 +1,2 @@\n alpha\n-beta\n+gamma\n"
                        .to_owned(),
            }],
        );

        let response = service
            .apply(
                &active,
                ApplyPatchRequest {
                    proposal,
                    review_approved: true,
                },
            )
            .expect("approved modify patch applies");

        assert_eq!(
            fs::read_to_string(&target).expect("modified file can be read"),
            "alpha\ngamma\n"
        );

        service
            .rollback(RollbackPatchRequest {
                patch_id: response.patch_id,
                allow_conflicts: false,
            })
            .expect("modified file rollback succeeds");

        assert_eq!(
            fs::read_to_string(&target).expect("restored file can be read"),
            "alpha\nbeta\n"
        );
    }

    #[test]
    fn rollback_stack_restores_multiple_patches_in_order() {
        let temp = tempdir().expect("temporary directory is available");
        let target = temp.path().join("file.txt");
        fs::write(&target, "one\n").expect("fixture file is written");
        let active = active_project(&temp);
        let service = PatchService::new();

        let first = service
            .apply(
                &active,
                ApplyPatchRequest {
                    proposal: proposal(
                        &active,
                        vec![PatchFileChange::Modify {
                            path: project_path("file.txt"),
                            old_hash: ContentHash::from_text("one\n"),
                            unified_diff:
                                "--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-one\n+two\n"
                                    .to_owned(),
                        }],
                    ),
                    review_approved: true,
                },
            )
            .expect("first patch applies");
        let second = service
            .apply(
                &active,
                ApplyPatchRequest {
                    proposal: proposal(
                        &active,
                        vec![PatchFileChange::Modify {
                            path: project_path("file.txt"),
                            old_hash: ContentHash::from_text("two\n"),
                            unified_diff:
                                "--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-two\n+three\n"
                                    .to_owned(),
                        }],
                    ),
                    review_approved: true,
                },
            )
            .expect("second patch applies");

        service
            .rollback_stack(RollbackPatchStackRequest {
                patch_ids: vec![second.patch_id, first.patch_id],
                allow_conflicts: false,
            })
            .expect("patch stack rollback succeeds");

        assert_eq!(
            fs::read_to_string(&target).expect("restored file can be read"),
            "one\n"
        );
    }

    #[test]
    fn rollback_stack_rejects_before_partial_restore_when_conflicted() {
        let temp = tempdir().expect("temporary directory is available");
        let target = temp.path().join("file.txt");
        fs::write(&target, "one\n").expect("fixture file is written");
        let active = active_project(&temp);
        let service = PatchService::new();

        let first = service
            .apply(
                &active,
                ApplyPatchRequest {
                    proposal: proposal(
                        &active,
                        vec![PatchFileChange::Modify {
                            path: project_path("file.txt"),
                            old_hash: ContentHash::from_text("one\n"),
                            unified_diff:
                                "--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-one\n+two\n"
                                    .to_owned(),
                        }],
                    ),
                    review_approved: true,
                },
            )
            .expect("first patch applies");
        let second = service
            .apply(
                &active,
                ApplyPatchRequest {
                    proposal: proposal(
                        &active,
                        vec![PatchFileChange::Modify {
                            path: project_path("file.txt"),
                            old_hash: ContentHash::from_text("two\n"),
                            unified_diff:
                                "--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-two\n+three\n"
                                    .to_owned(),
                        }],
                    ),
                    review_approved: true,
                },
            )
            .expect("second patch applies");
        fs::write(&target, "manual\n").expect("manual edit fixture is written");

        let error = service
            .rollback_stack(RollbackPatchStackRequest {
                patch_ids: vec![second.patch_id, first.patch_id],
                allow_conflicts: false,
            })
            .err();

        assert!(matches!(error, Some(PatchError::RollbackUnavailable)));
        assert_eq!(
            fs::read_to_string(&target).expect("manual file can be read"),
            "manual\n"
        );
    }

    #[test]
    fn rollback_restores_created_deleted_and_renamed_paths() {
        let temp = tempdir().expect("temporary directory is available");
        fs::write(temp.path().join("delete-me.txt"), "delete\n")
            .expect("delete fixture is written");
        fs::write(temp.path().join("rename-me.txt"), "rename\n")
            .expect("rename fixture is written");
        let active = active_project(&temp);
        let service = PatchService::new();
        let proposal = proposal(
            &active,
            vec![
                PatchFileChange::Create {
                    path: project_path("created.txt"),
                    content: "created\n".to_owned(),
                },
                PatchFileChange::Delete {
                    path: project_path("delete-me.txt"),
                    old_hash: ContentHash::from_text("delete\n"),
                },
                PatchFileChange::Rename {
                    from: project_path("rename-me.txt"),
                    to: project_path("renamed.txt"),
                    old_hash: ContentHash::from_text("rename\n"),
                },
            ],
        );

        let response = service
            .apply(
                &active,
                ApplyPatchRequest {
                    proposal,
                    review_approved: true,
                },
            )
            .expect("mixed patch applies");

        assert!(temp.path().join("created.txt").exists());
        assert!(!temp.path().join("delete-me.txt").exists());
        assert!(!temp.path().join("rename-me.txt").exists());
        assert_eq!(
            fs::read_to_string(temp.path().join("renamed.txt")).expect("renamed file can be read"),
            "rename\n"
        );

        service
            .rollback(RollbackPatchRequest {
                patch_id: response.patch_id,
                allow_conflicts: false,
            })
            .expect("mixed rollback succeeds");

        assert!(!temp.path().join("created.txt").exists());
        assert_eq!(
            fs::read_to_string(temp.path().join("delete-me.txt"))
                .expect("deleted file is restored"),
            "delete\n"
        );
        assert_eq!(
            fs::read_to_string(temp.path().join("rename-me.txt"))
                .expect("renamed source is restored"),
            "rename\n"
        );
        assert!(!temp.path().join("renamed.txt").exists());
    }

    fn active_project(temp: &TempDir) -> ActiveProject {
        ActiveProject {
            project_id: ProjectId::new(),
            project_epoch: 1,
            root: SafeProjectRoot::open(temp.path(), &PathPolicy::strict())
                .expect("temporary project root opens"),
            manifest: ProjectManifest {
                root_label: "fixture".to_owned(),
                framework: FrameworkKind::Unknown,
                surface_kind: ApplicationSurfaceKind::Unknown,
                surface_signals: Vec::new(),
                package_manager: None,
                available_scripts: Vec::new(),
            },
            opened_at: Utc::now(),
        }
    }

    fn proposal(active: &ActiveProject, files: Vec<PatchFileChange>) -> PatchProposal {
        PatchProposal {
            proposal_id: ProposalId::new(),
            project_id: active.project_id.clone(),
            request_id: AiRequestId::new(),
            summary: "test patch".to_owned(),
            files,
        }
    }

    fn project_path(raw: &str) -> ProjectPath {
        ProjectPath::parse(raw).expect("test project path is valid")
    }
}
