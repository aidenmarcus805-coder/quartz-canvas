use std::{collections::BTreeSet, fs, time::Instant};

use serde::{Deserialize, Serialize};

use crate::{
    fs::{ContentHash, PathError, PathPolicy, ProjectPath, SafeProjectRoot},
    patch::{
        diff::apply_unified_diff,
        model::{PatchFileChange, PatchProposal},
        paths,
    },
    project::ActiveProject,
};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatePatchRequest {
    pub proposal: PatchProposal,
}

#[derive(Debug)]
pub struct PatchValidator {
    policy: PathPolicy,
}

impl PatchValidator {
    pub fn new() -> Self {
        Self {
            policy: PathPolicy::strict(),
        }
    }

    pub fn validate(&self, active: &ActiveProject, proposal: &PatchProposal) -> ValidationReport {
        let checks = vec![
            self.check_project_identity(active, proposal),
            self.check_has_files(proposal),
            self.check_paths_allowed(proposal),
            self.check_unique_paths(proposal),
            self.check_base_hashes(&active.root, proposal),
            self.check_targets_available(&active.root, proposal),
            self.check_diffs_supported(&active.root, proposal),
        ];
        ValidationReport::from_checks(checks)
    }

    fn check_project_identity(
        &self,
        active: &ActiveProject,
        proposal: &PatchProposal,
    ) -> ValidationCheck {
        timed_check("patch.project_identity", || {
            if proposal.project_id != active.project_id {
                return ValidationCheckStatus::Failed {
                    message: "patch proposal targets a different project".to_owned(),
                };
            }

            ValidationCheckStatus::Passed {
                message: "patch proposal targets the active project".to_owned(),
            }
        })
    }

    fn check_has_files(&self, proposal: &PatchProposal) -> ValidationCheck {
        timed_check("patch.files_present", || {
            if proposal.files.is_empty() {
                return ValidationCheckStatus::Failed {
                    message: "patch proposal does not include file changes".to_owned(),
                };
            }

            ValidationCheckStatus::Passed {
                message: "patch proposal includes file changes".to_owned(),
            }
        })
    }

    fn check_paths_allowed(&self, proposal: &PatchProposal) -> ValidationCheck {
        timed_check("patch.paths_allowed", || {
            for change in &proposal.files {
                for path in change.touched_paths() {
                    if let Err(error) = self.policy.require_allowed(path) {
                        return failed_from_path(path, error);
                    }
                }
            }

            ValidationCheckStatus::Passed {
                message: "all patch paths are project-relative and allowed".to_owned(),
            }
        })
    }

    fn check_base_hashes(
        &self,
        root: &SafeProjectRoot,
        proposal: &PatchProposal,
    ) -> ValidationCheck {
        timed_check("patch.base_hashes_match", || {
            for change in &proposal.files {
                let mismatch = match change {
                    PatchFileChange::Modify { path, old_hash, .. }
                    | PatchFileChange::Delete { path, old_hash } => {
                        hash_mismatch(root, path, old_hash)
                    }
                    PatchFileChange::Rename { from, old_hash, .. } => {
                        hash_mismatch(root, from, old_hash)
                    }
                    PatchFileChange::Create { .. } => None,
                };

                if let Some(message) = mismatch {
                    return ValidationCheckStatus::Failed { message };
                }
            }

            ValidationCheckStatus::Passed {
                message: "base hashes match current files".to_owned(),
            }
        })
    }

    fn check_unique_paths(&self, proposal: &PatchProposal) -> ValidationCheck {
        timed_check("patch.unique_paths", || {
            let mut seen = BTreeSet::new();
            for change in &proposal.files {
                for path in change.touched_paths() {
                    if !seen.insert(path.as_str().to_owned()) {
                        return ValidationCheckStatus::Failed {
                            message: format!("{} is touched more than once", path.as_str()),
                        };
                    }
                }
            }

            ValidationCheckStatus::Passed {
                message: "patch paths are unique".to_owned(),
            }
        })
    }

    fn check_targets_available(
        &self,
        root: &SafeProjectRoot,
        proposal: &PatchProposal,
    ) -> ValidationCheck {
        timed_check("patch.targets_available", || {
            for change in &proposal.files {
                let target = match change {
                    PatchFileChange::Create { path, .. } => Some(path),
                    PatchFileChange::Rename { to, .. } => Some(to),
                    PatchFileChange::Modify { .. } | PatchFileChange::Delete { .. } => None,
                };

                let Some(path) = target else {
                    continue;
                };

                if let Some(message) = target_conflict(root, path) {
                    return ValidationCheckStatus::Failed { message };
                }
            }

            ValidationCheckStatus::Passed {
                message: "create and rename targets are available".to_owned(),
            }
        })
    }

    fn check_diffs_supported(
        &self,
        root: &SafeProjectRoot,
        proposal: &PatchProposal,
    ) -> ValidationCheck {
        timed_check("patch.unified_diffs_supported", || {
            for change in &proposal.files {
                let PatchFileChange::Modify {
                    path, unified_diff, ..
                } = change
                else {
                    continue;
                };

                if !looks_like_unified_diff(unified_diff) {
                    return ValidationCheckStatus::Failed {
                        message: "modify change does not contain a unified diff".to_owned(),
                    };
                }

                let full_path = match root.existing_file(path) {
                    Ok(full_path) => full_path,
                    Err(error) => return failed_from_path(path, error),
                };
                let content = match fs::read_to_string(&full_path) {
                    Ok(content) => content,
                    Err(error) => {
                        return ValidationCheckStatus::Failed {
                            message: format!(
                                "{} could not be read as UTF-8 text: {error}",
                                path.as_str()
                            ),
                        }
                    }
                };
                if let Err(error) = apply_unified_diff(&content, unified_diff) {
                    return ValidationCheckStatus::Failed {
                        message: format!("{} has unsupported unified diff: {error}", path.as_str()),
                    };
                }
            }

            ValidationCheckStatus::Passed {
                message: "modify changes contain supported unified diffs".to_owned(),
            }
        })
    }
}

impl Default for PatchValidator {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationReport {
    pub status: ValidationStatus,
    pub checks: Vec<ValidationCheck>,
    pub confidence: f32,
    pub blocking_reason: Option<String>,
}

impl ValidationReport {
    fn from_checks(checks: Vec<ValidationCheck>) -> Self {
        let failed = checks.iter().find_map(|check| match &check.status {
            ValidationCheckStatus::Failed { message } => Some(message.clone()),
            _ => None,
        });

        let passed_count = checks
            .iter()
            .filter(|check| matches!(check.status, ValidationCheckStatus::Passed { .. }))
            .count();
        let confidence = if checks.is_empty() {
            0.0
        } else {
            passed_count as f32 / checks.len() as f32
        };

        Self {
            status: if failed.is_some() {
                ValidationStatus::Failed
            } else {
                ValidationStatus::Passed
            },
            checks,
            confidence,
            blocking_reason: failed,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ValidationStatus {
    Passed,
    Failed,
    NeedsReview,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationCheck {
    pub id: String,
    pub status: ValidationCheckStatus,
    pub duration_ms: u128,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case", tag = "status")]
pub enum ValidationCheckStatus {
    Passed { message: String },
    Failed { message: String },
    Skipped { message: String },
}

fn timed_check(id: &'static str, check: impl FnOnce() -> ValidationCheckStatus) -> ValidationCheck {
    let started = Instant::now();
    let status = check();
    ValidationCheck {
        id: id.to_owned(),
        status,
        duration_ms: started.elapsed().as_millis(),
    }
}

fn failed_from_path(path: &ProjectPath, error: PathError) -> ValidationCheckStatus {
    ValidationCheckStatus::Failed {
        message: format!("{} is not writable: {error}", path.as_str()),
    }
}

fn hash_mismatch(
    root: &SafeProjectRoot,
    path: &ProjectPath,
    expected_hash: &ContentHash,
) -> Option<String> {
    let full_path = match root.existing_file(path) {
        Ok(full_path) => full_path,
        Err(error) => return Some(format!("{} is unavailable: {error}", path.as_str())),
    };

    match ContentHash::from_file(&full_path) {
        Ok(actual_hash) if actual_hash == *expected_hash => None,
        Ok(_) => Some(format!(
            "{} changed since proposal generation",
            path.as_str()
        )),
        Err(error) => Some(format!("{} could not be hashed: {error}", path.as_str())),
    }
}

fn target_conflict(root: &SafeProjectRoot, path: &ProjectPath) -> Option<String> {
    let full_path = match paths::writable_path(root, path) {
        Ok(full_path) => full_path,
        Err(error) => return Some(format!("{} is not writable: {error}", path.as_str())),
    };

    match full_path.try_exists() {
        Ok(false) => None,
        Ok(true) => Some(format!("{} already exists", path.as_str())),
        Err(error) => Some(format!("{} could not be checked: {error}", path.as_str())),
    }
}

fn looks_like_unified_diff(diff: &str) -> bool {
    diff.lines().any(|line| line.starts_with("--- "))
        && diff.lines().any(|line| line.starts_with("+++ "))
        && diff.lines().any(|line| line.starts_with("@@ "))
}
