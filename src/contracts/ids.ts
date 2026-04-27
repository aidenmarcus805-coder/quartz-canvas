import type { Brand } from "./common";

export type ProjectId = Brand<string, "ProjectId">;
export type SessionId = Brand<string, "SessionId">;
export type RevisionId = Brand<string, "RevisionId">;
export type SourceSnapshotId = Brand<string, "SourceSnapshotId">;
export type SourceFileId = Brand<string, "SourceFileId">;

export type AiRequestId = Brand<string, "AiRequestId">;
export type ProposalId = Brand<string, "ProposalId">;

export type PreviewFrameId = Brand<string, "PreviewFrameId">;
export type SelectionId = Brand<string, "SelectionId">;
export type CandidateId = Brand<string, "CandidateId">;
export type DomNodePath = Brand<string, "DomNodePath">;

export type LocalAiJobId = Brand<string, "LocalAiJobId">;
export type AiModelId = Brand<string, "AiModelId">;
export type ContextBundleId = Brand<string, "ContextBundleId">;

export type PromptId = Brand<string, "PromptId">;
export type UiSkillId = Brand<string, "UiSkillId">;

export type PatchSetId = Brand<string, "PatchSetId">;
export type ValidationRunId = Brand<string, "ValidationRunId">;
export type RollbackId = Brand<string, "RollbackId">;

export type EventId = Brand<string, "EventId">;
export type CorrelationId = Brand<string, "CorrelationId">;
