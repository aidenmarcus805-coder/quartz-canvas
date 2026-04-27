use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::{
    domain::{ContextPackageId, ProjectId, SourceIndexVersion},
    fs::{ContentHash, PathError, PathPolicy, ProjectPath},
    indexer::{IndexSnapshot, IndexStatus},
    project::ActiveProject,
};

#[derive(Debug)]
pub struct SourceContextAuthority {
    policy: PathPolicy,
}

impl SourceContextAuthority {
    pub fn new() -> Self {
        Self {
            policy: PathPolicy::strict(),
        }
    }

    pub fn freeze(
        &self,
        active: &ActiveProject,
        index: &IndexSnapshot,
        candidate: SourceCandidate,
    ) -> FrozenContextSummary {
        let mut reasons = Vec::new();
        let mut blocked = false;
        let mut stale = false;
        let mut actual_hash = None;

        if candidate.project_epoch == active.project_epoch {
            reasons.push(AuthorityReason::new(
                AuthorityReasonCode::ProjectEpochCurrent,
                format!(
                    "selection epoch {} matches the active project",
                    active.project_epoch
                ),
            ));
        } else {
            stale = true;
            reasons.push(AuthorityReason::new(
                AuthorityReasonCode::StaleProjectEpoch,
                format!(
                    "selection epoch {} does not match active project epoch {}",
                    candidate.project_epoch, active.project_epoch
                ),
            ));
        }

        if candidate.range.is_ordered() {
            reasons.push(AuthorityReason::new(
                AuthorityReasonCode::RangeValid,
                "selection range is ordered and non-empty",
            ));
        } else {
            blocked = true;
            reasons.push(AuthorityReason::new(
                AuthorityReasonCode::InvalidRange,
                "selection range is empty or inverted",
            ));
        }

        let path_allowed = match self.policy.require_allowed(&candidate.path) {
            Ok(()) => {
                reasons.push(AuthorityReason::new(
                    AuthorityReasonCode::PathAllowed,
                    format!("{} is allowed by project path policy", candidate.path),
                ));
                true
            }
            Err(PathError::ProtectedPath) => {
                blocked = true;
                reasons.push(AuthorityReason::new(
                    AuthorityReasonCode::ProtectedPath,
                    format!("{} is protected by project path policy", candidate.path),
                ));
                false
            }
            Err(PathError::IgnoredPath) => {
                blocked = true;
                reasons.push(AuthorityReason::new(
                    AuthorityReasonCode::IgnoredPath,
                    format!("{} is ignored by project path policy", candidate.path),
                ));
                false
            }
            Err(error) => {
                blocked = true;
                reasons.push(AuthorityReason::new(
                    AuthorityReasonCode::PathBlocked,
                    format!(
                        "{} is not a valid project source path: {error}",
                        candidate.path
                    ),
                ));
                false
            }
        };

        if path_allowed {
            match active.root.existing_file(&candidate.path) {
                Ok(full_path) => match ContentHash::from_file(&full_path) {
                    Ok(current_hash) if current_hash == candidate.file_hash => {
                        actual_hash = Some(current_hash);
                        reasons.push(AuthorityReason::new(
                            AuthorityReasonCode::HashMatched,
                            format!("{} matches the selected file hash", candidate.path),
                        ));
                    }
                    Ok(current_hash) => {
                        if candidate.intent == SourceAuthorityIntent::Patch {
                            stale = true;
                        }
                        reasons.push(AuthorityReason::new(
                            AuthorityReasonCode::HashMismatch,
                            format!(
                                "{} changed since the source candidate was captured",
                                candidate.path
                            ),
                        ));
                        actual_hash = Some(current_hash);
                    }
                    Err(error) => {
                        blocked = true;
                        reasons.push(AuthorityReason::new(
                            AuthorityReasonCode::HashUnavailable,
                            format!("{} could not be hashed: {error}", candidate.path),
                        ));
                    }
                },
                Err(PathError::PathUnavailable { .. }) => {
                    blocked = true;
                    reasons.push(AuthorityReason::new(
                        AuthorityReasonCode::MissingFile,
                        format!("{} no longer exists in the active project", candidate.path),
                    ));
                }
                Err(error) => {
                    blocked = true;
                    reasons.push(AuthorityReason::new(
                        AuthorityReasonCode::PathBlocked,
                        format!("{} could not be opened safely: {error}", candidate.path),
                    ));
                }
            }
        }

        let index_summary = FrozenIndexSummary::from_snapshot(index);
        if index_is_fresh(active, index) {
            reasons.push(AuthorityReason::new(
                AuthorityReasonCode::IndexFresh,
                "source index is ready for the active project epoch",
            ));
        } else {
            stale = true;
            reasons.push(AuthorityReason::new(
                AuthorityReasonCode::IndexStale,
                "source index is not ready for the active project epoch",
            ));
        }

        if candidate.intent == SourceAuthorityIntent::Inspect {
            reasons.push(AuthorityReason::new(
                AuthorityReasonCode::InspectOnlyRequested,
                "candidate was requested for inspection, not patch authority",
            ));
        }

        let authority = if blocked {
            SourceAuthorityLevel::Blocked
        } else if stale {
            SourceAuthorityLevel::Stale
        } else if candidate.intent == SourceAuthorityIntent::Inspect {
            SourceAuthorityLevel::InspectOnly
        } else {
            SourceAuthorityLevel::PatchAuthoritative
        };

        FrozenContextSummary {
            context_package_id: ContextPackageId::new(),
            project_id: active.project_id.clone(),
            project_epoch: active.project_epoch,
            authority,
            reasons,
            source: FrozenSourceSummary {
                path: candidate.path,
                range: candidate.range,
                excerpt: candidate.excerpt,
                expected_hash: candidate.file_hash,
                actual_hash,
                intent: candidate.intent,
            },
            index: index_summary,
            frozen_at: Utc::now(),
        }
    }
}

impl Default for SourceContextAuthority {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceCandidate {
    pub project_epoch: u64,
    pub path: ProjectPath,
    pub range: SourceRange,
    pub excerpt: String,
    pub file_hash: ContentHash,
    pub intent: SourceAuthorityIntent,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceAuthorityIntent {
    Patch,
    Inspect,
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRange {
    pub start_line: u32,
    pub start_column: u32,
    pub end_line: u32,
    pub end_column: u32,
}

impl SourceRange {
    fn is_ordered(&self) -> bool {
        if self.start_line == 0 || self.end_line == 0 {
            return false;
        }

        self.start_line < self.end_line
            || self.start_line == self.end_line && self.start_column < self.end_column
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrozenContextSummary {
    pub context_package_id: ContextPackageId,
    pub project_id: ProjectId,
    pub project_epoch: u64,
    pub authority: SourceAuthorityLevel,
    pub reasons: Vec<AuthorityReason>,
    pub source: FrozenSourceSummary,
    pub index: FrozenIndexSummary,
    pub frozen_at: DateTime<Utc>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceAuthorityLevel {
    PatchAuthoritative,
    InspectOnly,
    Stale,
    Blocked,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorityReason {
    pub code: AuthorityReasonCode,
    pub message: String,
}

impl AuthorityReason {
    fn new(code: AuthorityReasonCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthorityReasonCode {
    ProjectEpochCurrent,
    StaleProjectEpoch,
    RangeValid,
    InvalidRange,
    PathAllowed,
    ProtectedPath,
    IgnoredPath,
    PathBlocked,
    MissingFile,
    HashMatched,
    HashMismatch,
    HashUnavailable,
    IndexFresh,
    IndexStale,
    InspectOnlyRequested,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrozenSourceSummary {
    pub path: ProjectPath,
    pub range: SourceRange,
    pub excerpt: String,
    pub expected_hash: ContentHash,
    pub actual_hash: Option<ContentHash>,
    pub intent: SourceAuthorityIntent,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrozenIndexSummary {
    pub status: IndexStatus,
    pub project_id: Option<ProjectId>,
    pub project_epoch: Option<u64>,
    pub version: Option<SourceIndexVersion>,
    pub updated_at: DateTime<Utc>,
}

impl FrozenIndexSummary {
    fn from_snapshot(snapshot: &IndexSnapshot) -> Self {
        Self {
            status: snapshot.status.clone(),
            project_id: snapshot.project_id.clone(),
            project_epoch: snapshot.project_epoch,
            version: snapshot.version.clone(),
            updated_at: snapshot.updated_at,
        }
    }
}

fn index_is_fresh(active: &ActiveProject, index: &IndexSnapshot) -> bool {
    matches!(&index.status, IndexStatus::Ready)
        && index.project_id.as_ref() == Some(&active.project_id)
        && index.project_epoch == Some(active.project_epoch)
        && index.version.is_some()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::{tempdir, TempDir};

    use super::*;
    use crate::{
        domain::SourceIndexVersion,
        fs::SafeProjectRoot,
        project::{
            detect::{ApplicationSurfaceKind, FrameworkKind, ProjectManifest},
            ActiveProject,
        },
    };

    const EPOCH: u64 = 7;

    #[test]
    fn returns_stale_for_stale_project_epoch() {
        let fixture = ProjectFixture::new();
        let hash = fixture.write("src/App.tsx", "export function App() { return null; }");
        let index = fixture.ready_index(EPOCH);
        let candidate =
            fixture.candidate("src/App.tsx", EPOCH - 1, hash, SourceAuthorityIntent::Patch);

        let summary = SourceContextAuthority::new().freeze(&fixture.active, &index, candidate);

        assert_eq!(summary.authority, SourceAuthorityLevel::Stale);
        assert!(has_reason(&summary, AuthorityReasonCode::StaleProjectEpoch));
    }

    #[test]
    fn blocks_protected_source_path() {
        let fixture = ProjectFixture::new();
        let index = fixture.ready_index(EPOCH);
        let candidate = fixture.candidate(
            ".env.local",
            EPOCH,
            ContentHash::from_text("SECRET=1"),
            SourceAuthorityIntent::Patch,
        );

        let summary = SourceContextAuthority::new().freeze(&fixture.active, &index, candidate);

        assert_eq!(summary.authority, SourceAuthorityLevel::Blocked);
        assert!(has_reason(&summary, AuthorityReasonCode::ProtectedPath));
        assert!(!has_reason(&summary, AuthorityReasonCode::MissingFile));
    }

    #[test]
    fn blocks_missing_source_file() {
        let fixture = ProjectFixture::new();
        let index = fixture.ready_index(EPOCH);
        let candidate = fixture.candidate(
            "src/Missing.tsx",
            EPOCH,
            ContentHash::from_text("old"),
            SourceAuthorityIntent::Patch,
        );

        let summary = SourceContextAuthority::new().freeze(&fixture.active, &index, candidate);

        assert_eq!(summary.authority, SourceAuthorityLevel::Blocked);
        assert!(has_reason(&summary, AuthorityReasonCode::MissingFile));
    }

    #[test]
    fn grants_patch_authority_when_hash_matches() {
        let fixture = ProjectFixture::new();
        let content = "export const value = 1;";
        let hash = fixture.write("src/value.ts", content);
        let index = fixture.ready_index(EPOCH);
        let candidate = fixture.candidate(
            "src/value.ts",
            EPOCH,
            hash.clone(),
            SourceAuthorityIntent::Patch,
        );

        let summary = SourceContextAuthority::new().freeze(&fixture.active, &index, candidate);

        assert_eq!(summary.authority, SourceAuthorityLevel::PatchAuthoritative);
        assert_eq!(summary.source.actual_hash, Some(hash));
        assert!(has_reason(&summary, AuthorityReasonCode::HashMatched));
    }

    #[test]
    fn downgrades_hash_mismatch_by_intent() {
        let fixture = ProjectFixture::new();
        fixture.write("src/value.ts", "export const value = 2;");
        let old_hash = ContentHash::from_text("export const value = 1;");
        let index = fixture.ready_index(EPOCH);

        let patch_candidate = fixture.candidate(
            "src/value.ts",
            EPOCH,
            old_hash.clone(),
            SourceAuthorityIntent::Patch,
        );
        let patch_summary =
            SourceContextAuthority::new().freeze(&fixture.active, &index, patch_candidate);

        let inspect_candidate = fixture.candidate(
            "src/value.ts",
            EPOCH,
            old_hash,
            SourceAuthorityIntent::Inspect,
        );
        let inspect_summary =
            SourceContextAuthority::new().freeze(&fixture.active, &index, inspect_candidate);

        assert_eq!(patch_summary.authority, SourceAuthorityLevel::Stale);
        assert_eq!(inspect_summary.authority, SourceAuthorityLevel::InspectOnly);
        assert!(has_reason(
            &patch_summary,
            AuthorityReasonCode::HashMismatch
        ));
        assert!(has_reason(
            &inspect_summary,
            AuthorityReasonCode::HashMismatch
        ));
    }

    #[test]
    fn returns_stale_when_index_epoch_is_old() {
        let fixture = ProjectFixture::new();
        let hash = fixture.write("src/App.tsx", "export const App = () => null;");
        let index = fixture.ready_index(EPOCH - 1);
        let candidate = fixture.candidate("src/App.tsx", EPOCH, hash, SourceAuthorityIntent::Patch);

        let summary = SourceContextAuthority::new().freeze(&fixture.active, &index, candidate);

        assert_eq!(summary.authority, SourceAuthorityLevel::Stale);
        assert!(has_reason(&summary, AuthorityReasonCode::IndexStale));
    }

    struct ProjectFixture {
        _temp: TempDir,
        active: ActiveProject,
    }

    impl ProjectFixture {
        fn new() -> Self {
            let temp = tempdir().expect("temporary directory is available");
            fs::create_dir_all(temp.path().join("src"))
                .expect("fixture src directory can be created");
            let policy = PathPolicy::strict();
            let root = SafeProjectRoot::open(temp.path(), &policy).expect("fixture root is safe");
            let active = ActiveProject {
                project_id: ProjectId::new(),
                project_epoch: EPOCH,
                root,
                manifest: ProjectManifest {
                    root_label: "fixture".to_owned(),
                    framework: FrameworkKind::Vite,
                    surface_kind: ApplicationSurfaceKind::Web,
                    surface_signals: vec!["fixture".to_owned()],
                    package_manager: None,
                    available_scripts: Vec::new(),
                },
                opened_at: Utc::now(),
            };

            Self {
                _temp: temp,
                active,
            }
        }

        fn write(&self, path: &str, content: &str) -> ContentHash {
            let relative = ProjectPath::parse(path).expect("fixture path is project-relative");
            let full_path = self.active.root.path().join(relative.as_std_path());
            if let Some(parent) = full_path.parent() {
                fs::create_dir_all(parent).expect("fixture parent directory can be created");
            }
            fs::write(full_path, content).expect("fixture source can be written");
            ContentHash::from_text(content)
        }

        fn candidate(
            &self,
            path: &str,
            project_epoch: u64,
            file_hash: ContentHash,
            intent: SourceAuthorityIntent,
        ) -> SourceCandidate {
            SourceCandidate {
                project_epoch,
                path: ProjectPath::parse(path).expect("fixture path is project-relative"),
                range: SourceRange {
                    start_line: 1,
                    start_column: 0,
                    end_line: 1,
                    end_column: 1,
                },
                excerpt: "x".to_owned(),
                file_hash,
                intent,
            }
        }

        fn ready_index(&self, project_epoch: u64) -> IndexSnapshot {
            IndexSnapshot {
                status: IndexStatus::Ready,
                project_id: Some(self.active.project_id.clone()),
                project_epoch: Some(project_epoch),
                version: Some(SourceIndexVersion::new()),
                indexed_files: 1,
                source_files: 1,
                skipped_files: 0,
                protected_files: 0,
                updated_at: Utc::now(),
            }
        }
    }

    fn has_reason(summary: &FrozenContextSummary, code: AuthorityReasonCode) -> bool {
        summary.reasons.iter().any(|reason| reason.code == code)
    }
}
