import type {
  AiModelId,
  AiRequestId,
  Brand,
  CandidateId,
  ContextBundleId,
  CorrelationId,
  DomNodePath,
  EventId,
  LocalAiJobId,
  PatchSetId,
  PreviewFrameId,
  ProposalId,
  ProjectId,
  PromptId,
  RevisionId,
  RollbackId,
  SelectionId,
  SessionId,
  SourceFileId,
  SourceSnapshotId,
  UiSkillId,
  ValidationRunId,
} from "../contracts";
import { fieldError, fieldOk, issue, type FieldResult } from "./validation";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
const DOM_NODE_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_./#> -]{0,255}$/;

export function isBrandedId<BrandName extends string>(
  value: unknown,
): value is Brand<string, BrandName> {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function parseBrandedId<BrandName extends string>(
  value: unknown,
  path: string,
  expected: string,
): FieldResult<Brand<string, BrandName>> {
  if (!isBrandedId<BrandName>(value)) {
    return fieldError(issue(path, expected, value, `Expected a valid ${expected}.`));
  }

  return fieldOk(value);
}

export function parseProjectId(value: unknown, path: string): FieldResult<ProjectId> {
  return parseBrandedId<"ProjectId">(value, path, "ProjectId");
}

export function parseSessionId(value: unknown, path: string): FieldResult<SessionId> {
  return parseBrandedId<"SessionId">(value, path, "SessionId");
}

export function parseRevisionId(value: unknown, path: string): FieldResult<RevisionId> {
  return parseBrandedId<"RevisionId">(value, path, "RevisionId");
}

export function parseSourceSnapshotId(
  value: unknown,
  path: string,
): FieldResult<SourceSnapshotId> {
  return parseBrandedId<"SourceSnapshotId">(value, path, "SourceSnapshotId");
}

export function parseSourceFileId(value: unknown, path: string): FieldResult<SourceFileId> {
  return parseBrandedId<"SourceFileId">(value, path, "SourceFileId");
}

export function parseAiRequestId(value: unknown, path: string): FieldResult<AiRequestId> {
  return parseBrandedId<"AiRequestId">(value, path, "AiRequestId");
}

export function parseProposalId(value: unknown, path: string): FieldResult<ProposalId> {
  return parseBrandedId<"ProposalId">(value, path, "ProposalId");
}

export function parsePreviewFrameId(
  value: unknown,
  path: string,
): FieldResult<PreviewFrameId> {
  return parseBrandedId<"PreviewFrameId">(value, path, "PreviewFrameId");
}

export function parseSelectionId(value: unknown, path: string): FieldResult<SelectionId> {
  return parseBrandedId<"SelectionId">(value, path, "SelectionId");
}

export function parseCandidateId(value: unknown, path: string): FieldResult<CandidateId> {
  return parseBrandedId<"CandidateId">(value, path, "CandidateId");
}

export function isDomNodePath(value: unknown): value is DomNodePath {
  return typeof value === "string" && DOM_NODE_PATH_PATTERN.test(value);
}

export function parseDomNodePath(value: unknown, path: string): FieldResult<DomNodePath> {
  if (!isDomNodePath(value)) {
    return fieldError(issue(path, "DomNodePath", value, "Expected a DOM node path."));
  }

  return fieldOk(value);
}

export function parseLocalAiJobId(value: unknown, path: string): FieldResult<LocalAiJobId> {
  return parseBrandedId<"LocalAiJobId">(value, path, "LocalAiJobId");
}

export function parseAiModelId(value: unknown, path: string): FieldResult<AiModelId> {
  return parseBrandedId<"AiModelId">(value, path, "AiModelId");
}

export function parseContextBundleId(
  value: unknown,
  path: string,
): FieldResult<ContextBundleId> {
  return parseBrandedId<"ContextBundleId">(value, path, "ContextBundleId");
}

export function parsePromptId(value: unknown, path: string): FieldResult<PromptId> {
  return parseBrandedId<"PromptId">(value, path, "PromptId");
}

export function parseUiSkillId(value: unknown, path: string): FieldResult<UiSkillId> {
  return parseBrandedId<"UiSkillId">(value, path, "UiSkillId");
}

export function parsePatchSetId(value: unknown, path: string): FieldResult<PatchSetId> {
  return parseBrandedId<"PatchSetId">(value, path, "PatchSetId");
}

export function parseValidationRunId(
  value: unknown,
  path: string,
): FieldResult<ValidationRunId> {
  return parseBrandedId<"ValidationRunId">(value, path, "ValidationRunId");
}

export function parseRollbackId(value: unknown, path: string): FieldResult<RollbackId> {
  return parseBrandedId<"RollbackId">(value, path, "RollbackId");
}

export function parseEventId(value: unknown, path: string): FieldResult<EventId> {
  return parseBrandedId<"EventId">(value, path, "EventId");
}

export function parseCorrelationId(value: unknown, path: string): FieldResult<CorrelationId> {
  return parseBrandedId<"CorrelationId">(value, path, "CorrelationId");
}
