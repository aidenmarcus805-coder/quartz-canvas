use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    domain::{AiRequestId, ProjectId, ProposalId},
    fs::{ContentHash, ProjectPath},
};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchProposal {
    pub proposal_id: ProposalId,
    pub project_id: ProjectId,
    pub request_id: AiRequestId,
    pub summary: String,
    #[serde(default)]
    pub files: Vec<PatchFileChange>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", tag = "operation")]
pub enum PatchFileChange {
    Create {
        path: ProjectPath,
        content: String,
    },
    Modify {
        path: ProjectPath,
        old_hash: ContentHash,
        unified_diff: String,
    },
    Delete {
        path: ProjectPath,
        old_hash: ContentHash,
    },
    Rename {
        from: ProjectPath,
        to: ProjectPath,
        old_hash: ContentHash,
    },
}

impl PatchFileChange {
    pub fn touched_paths(&self) -> Vec<&ProjectPath> {
        match self {
            PatchFileChange::Create { path, .. }
            | PatchFileChange::Modify { path, .. }
            | PatchFileChange::Delete { path, .. } => vec![path],
            PatchFileChange::Rename { from, to, .. } => vec![from, to],
        }
    }

    pub fn operation_name(&self) -> &'static str {
        match self {
            PatchFileChange::Create { .. } => "create",
            PatchFileChange::Modify { .. } => "modify",
            PatchFileChange::Delete { .. } => "delete",
            PatchFileChange::Rename { .. } => "rename",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PatchState {
    Proposed,
    Validating,
    Validated,
    Applying,
    Applied,
    RollbackPending,
    RolledBack,
    Rejected,
    Failed,
    Interrupted,
}

impl PatchState {
    pub fn transition_to(self, next: PatchState) -> Result<PatchState, PatchStateError> {
        if self.can_transition_to(next) {
            return Ok(next);
        }

        Err(PatchStateError::InvalidTransition {
            from: self,
            to: next,
        })
    }

    fn can_transition_to(self, next: PatchState) -> bool {
        matches!(
            (self, next),
            (PatchState::Proposed, PatchState::Validating)
                | (PatchState::Proposed, PatchState::Rejected)
                | (PatchState::Validating, PatchState::Validated)
                | (PatchState::Validating, PatchState::Rejected)
                | (PatchState::Validating, PatchState::Failed)
                | (PatchState::Validated, PatchState::Applying)
                | (PatchState::Applying, PatchState::Applied)
                | (PatchState::Applying, PatchState::Failed)
                | (PatchState::Applying, PatchState::Interrupted)
                | (PatchState::Applied, PatchState::RollbackPending)
                | (PatchState::RollbackPending, PatchState::RolledBack)
                | (PatchState::RollbackPending, PatchState::Failed)
                | (PatchState::Interrupted, PatchState::RollbackPending)
        )
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RollbackAvailability {
    Available,
    Conflicted,
    Partial,
    Completed,
    Failed,
    Unavailable,
}

#[derive(Debug, Error)]
pub enum PatchStateError {
    #[error("invalid patch state transition from {from:?} to {to:?}")]
    InvalidTransition { from: PatchState, to: PatchState },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transitions_to_validated_after_validation() {
        let next = PatchState::Proposed
            .transition_to(PatchState::Validating)
            .and_then(|state| state.transition_to(PatchState::Validated));

        assert!(matches!(next, Ok(PatchState::Validated)));
    }

    #[test]
    fn rejects_patch_apply_before_validation() {
        let next = PatchState::Proposed.transition_to(PatchState::Applying);

        assert!(matches!(
            next,
            Err(PatchStateError::InvalidTransition {
                from: PatchState::Proposed,
                to: PatchState::Applying
            })
        ));
    }
}
