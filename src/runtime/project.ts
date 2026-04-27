import {
  BOUNDARY_SOURCE,
  type BoundarySource,
  type ProjectManifest,
  type ProjectRoot,
  type ProjectSession,
  type ProjectSessionState,
  type Revision,
  type RevisionState,
  type SourceFileSnapshot,
  type SourceSnapshot,
} from "../contracts";
import {
  parseLocalAiJobId,
  parsePatchSetId,
  parsePreviewFrameId,
  parseProjectId,
  parseRevisionId,
  parseRollbackId,
  parseSelectionId,
  parseSessionId,
  parseSourceFileId,
  parseSourceSnapshotId,
} from "./ids";
import {
  parseAbsoluteFilePath,
  parseFileHash,
  parseIsoDateTimeString,
  parseNonEmptyString,
  parseNonNegativeInteger,
  parseRelativeFilePath,
} from "./primitives";
import { parseSelectionAuthorityLevel } from "./preview";
import {
  fieldOk,
  fromFieldResult,
  parseContractVersion,
  readLiteralField,
  readNullableParsedField,
  readParsedArrayField,
  readParsedField,
  readRecord,
  rejectUnknownFields,
  type FieldResult,
  type ValidationResult,
} from "./validation";

function parseProjectRoot(value: unknown, path: string): FieldResult<ProjectRoot> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(record, ["kind", "path", "displayName"], path);
  if (!unknownResult.ok) return unknownResult;

  const kind = readLiteralField(record, "kind", ["local_directory"] as const, `${path}.kind`);
  if (!kind.ok) return kind;
  const rootPath = readParsedField(record, "path", `${path}.path`, parseAbsoluteFilePath);
  if (!rootPath.ok) return rootPath;
  const displayName = readParsedField(
    record,
    "displayName",
    `${path}.displayName`,
    parseNonEmptyString,
  );
  if (!displayName.ok) return displayName;

  return fieldOk({
    kind: kind.value,
    path: rootPath.value,
    displayName: displayName.value,
  });
}

export function parseProjectManifest(
  value: unknown,
  path: string,
): FieldResult<ProjectManifest> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(
    record,
    [
      "contractVersion",
      "id",
      "name",
      "root",
      "createdAt",
      "updatedAt",
      "activeSessionId",
      "latestRevisionId",
    ],
    path,
  );
  if (!unknownResult.ok) return unknownResult;

  const contractVersion = readParsedField(
    record,
    "contractVersion",
    `${path}.contractVersion`,
    parseContractVersion,
  );
  if (!contractVersion.ok) return contractVersion;
  const id = readParsedField(record, "id", `${path}.id`, parseProjectId);
  if (!id.ok) return id;
  const name = readParsedField(record, "name", `${path}.name`, parseNonEmptyString);
  if (!name.ok) return name;
  const root = readParsedField(record, "root", `${path}.root`, parseProjectRoot);
  if (!root.ok) return root;
  const createdAt = readParsedField(
    record,
    "createdAt",
    `${path}.createdAt`,
    parseIsoDateTimeString,
  );
  if (!createdAt.ok) return createdAt;
  const updatedAt = readParsedField(
    record,
    "updatedAt",
    `${path}.updatedAt`,
    parseIsoDateTimeString,
  );
  if (!updatedAt.ok) return updatedAt;
  const activeSessionId = readNullableParsedField(
    record,
    "activeSessionId",
    `${path}.activeSessionId`,
    parseSessionId,
  );
  if (!activeSessionId.ok) return activeSessionId;
  const latestRevisionId = readNullableParsedField(
    record,
    "latestRevisionId",
    `${path}.latestRevisionId`,
    parseRevisionId,
  );
  if (!latestRevisionId.ok) return latestRevisionId;

  return fieldOk({
    contractVersion: contractVersion.value,
    id: id.value,
    name: name.value,
    root: root.value,
    createdAt: createdAt.value,
    updatedAt: updatedAt.value,
    activeSessionId: activeSessionId.value,
    latestRevisionId: latestRevisionId.value,
  });
}

function parseProjectSessionState(
  value: unknown,
  path: string,
): FieldResult<ProjectSessionState> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const kind = readLiteralField(
    record,
    "kind",
    [
      "empty",
      "preview_connected",
      "selection_active",
      "ai_running",
      "reviewing_patch",
    ] as const,
    `${path}.kind`,
  );
  if (!kind.ok) return kind;

  switch (kind.value) {
    case "empty": {
      const unknownResult = rejectUnknownFields(record, ["kind"], path);
      if (!unknownResult.ok) return unknownResult;
      return fieldOk({ kind: kind.value });
    }
    case "preview_connected": {
      const unknownResult = rejectUnknownFields(record, ["kind", "previewFrameId"], path);
      if (!unknownResult.ok) return unknownResult;
      const previewFrameId = readParsedField(
        record,
        "previewFrameId",
        `${path}.previewFrameId`,
        parsePreviewFrameId,
      );
      if (!previewFrameId.ok) return previewFrameId;
      return fieldOk({ kind: kind.value, previewFrameId: previewFrameId.value });
    }
    case "selection_active": {
      const unknownResult = rejectUnknownFields(
        record,
        ["kind", "previewFrameId", "selectionId", "authority"],
        path,
      );
      if (!unknownResult.ok) return unknownResult;
      const previewFrameId = readParsedField(
        record,
        "previewFrameId",
        `${path}.previewFrameId`,
        parsePreviewFrameId,
      );
      if (!previewFrameId.ok) return previewFrameId;
      const selectionId = readParsedField(
        record,
        "selectionId",
        `${path}.selectionId`,
        parseSelectionId,
      );
      if (!selectionId.ok) return selectionId;
      const authority = readParsedField(
        record,
        "authority",
        `${path}.authority`,
        parseSelectionAuthorityLevel,
      );
      if (!authority.ok) return authority;
      return fieldOk({
        kind: kind.value,
        previewFrameId: previewFrameId.value,
        selectionId: selectionId.value,
        authority: authority.value,
      });
    }
    case "ai_running": {
      const unknownResult = rejectUnknownFields(record, ["kind", "selectionId", "jobId"], path);
      if (!unknownResult.ok) return unknownResult;
      const selectionId = readParsedField(
        record,
        "selectionId",
        `${path}.selectionId`,
        parseSelectionId,
      );
      if (!selectionId.ok) return selectionId;
      const jobId = readParsedField(record, "jobId", `${path}.jobId`, parseLocalAiJobId);
      if (!jobId.ok) return jobId;
      return fieldOk({ kind: kind.value, selectionId: selectionId.value, jobId: jobId.value });
    }
    case "reviewing_patch": {
      const unknownResult = rejectUnknownFields(
        record,
        ["kind", "patchSetId", "selectionId"],
        path,
      );
      if (!unknownResult.ok) return unknownResult;
      const patchSetId = readParsedField(
        record,
        "patchSetId",
        `${path}.patchSetId`,
        parsePatchSetId,
      );
      if (!patchSetId.ok) return patchSetId;
      const selectionId = readNullableParsedField(
        record,
        "selectionId",
        `${path}.selectionId`,
        parseSelectionId,
      );
      if (!selectionId.ok) return selectionId;
      return fieldOk({
        kind: kind.value,
        patchSetId: patchSetId.value,
        selectionId: selectionId.value,
      });
    }
  }
}

export function parseProjectSession(
  value: unknown,
  path: string,
): FieldResult<ProjectSession> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(
    record,
    [
      "contractVersion",
      "id",
      "projectId",
      "createdAt",
      "lastActiveAt",
      "currentRevisionId",
      "state",
    ],
    path,
  );
  if (!unknownResult.ok) return unknownResult;

  const contractVersion = readParsedField(
    record,
    "contractVersion",
    `${path}.contractVersion`,
    parseContractVersion,
  );
  if (!contractVersion.ok) return contractVersion;
  const id = readParsedField(record, "id", `${path}.id`, parseSessionId);
  if (!id.ok) return id;
  const projectId = readParsedField(record, "projectId", `${path}.projectId`, parseProjectId);
  if (!projectId.ok) return projectId;
  const createdAt = readParsedField(
    record,
    "createdAt",
    `${path}.createdAt`,
    parseIsoDateTimeString,
  );
  if (!createdAt.ok) return createdAt;
  const lastActiveAt = readParsedField(
    record,
    "lastActiveAt",
    `${path}.lastActiveAt`,
    parseIsoDateTimeString,
  );
  if (!lastActiveAt.ok) return lastActiveAt;
  const currentRevisionId = readNullableParsedField(
    record,
    "currentRevisionId",
    `${path}.currentRevisionId`,
    parseRevisionId,
  );
  if (!currentRevisionId.ok) return currentRevisionId;
  const state = readParsedField(record, "state", `${path}.state`, parseProjectSessionState);
  if (!state.ok) return state;

  return fieldOk({
    contractVersion: contractVersion.value,
    id: id.value,
    projectId: projectId.value,
    createdAt: createdAt.value,
    lastActiveAt: lastActiveAt.value,
    currentRevisionId: currentRevisionId.value,
    state: state.value,
  });
}

function parseRevisionState(value: unknown, path: string): FieldResult<RevisionState> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const kind = readLiteralField(
    record,
    "kind",
    ["clean", "dirty", "applied", "rolled_back", "invalid"] as const,
    `${path}.kind`,
  );
  if (!kind.ok) return kind;

  switch (kind.value) {
    case "clean": {
      const unknownResult = rejectUnknownFields(record, ["kind"], path);
      if (!unknownResult.ok) return unknownResult;
      return fieldOk({ kind: kind.value });
    }
    case "dirty":
    case "invalid": {
      const unknownResult = rejectUnknownFields(record, ["kind", "reason"], path);
      if (!unknownResult.ok) return unknownResult;
      const reason = readParsedField(record, "reason", `${path}.reason`, parseNonEmptyString);
      if (!reason.ok) return reason;
      return fieldOk({ kind: kind.value, reason: reason.value });
    }
    case "applied": {
      const unknownResult = rejectUnknownFields(record, ["kind", "patchSetId"], path);
      if (!unknownResult.ok) return unknownResult;
      const patchSetId = readParsedField(
        record,
        "patchSetId",
        `${path}.patchSetId`,
        parsePatchSetId,
      );
      if (!patchSetId.ok) return patchSetId;
      return fieldOk({ kind: kind.value, patchSetId: patchSetId.value });
    }
    case "rolled_back": {
      const unknownResult = rejectUnknownFields(record, ["kind", "rollbackId"], path);
      if (!unknownResult.ok) return unknownResult;
      const rollbackId = readParsedField(
        record,
        "rollbackId",
        `${path}.rollbackId`,
        parseRollbackId,
      );
      if (!rollbackId.ok) return rollbackId;
      return fieldOk({ kind: kind.value, rollbackId: rollbackId.value });
    }
  }
}

export function parseRevision(value: unknown, path: string): FieldResult<Revision> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(
    record,
    [
      "contractVersion",
      "id",
      "projectId",
      "parentRevisionId",
      "sourceSnapshotId",
      "createdAt",
      "label",
      "state",
    ],
    path,
  );
  if (!unknownResult.ok) return unknownResult;

  const contractVersion = readParsedField(
    record,
    "contractVersion",
    `${path}.contractVersion`,
    parseContractVersion,
  );
  if (!contractVersion.ok) return contractVersion;
  const id = readParsedField(record, "id", `${path}.id`, parseRevisionId);
  if (!id.ok) return id;
  const projectId = readParsedField(record, "projectId", `${path}.projectId`, parseProjectId);
  if (!projectId.ok) return projectId;
  const parentRevisionId = readNullableParsedField(
    record,
    "parentRevisionId",
    `${path}.parentRevisionId`,
    parseRevisionId,
  );
  if (!parentRevisionId.ok) return parentRevisionId;
  const sourceSnapshotId = readParsedField(
    record,
    "sourceSnapshotId",
    `${path}.sourceSnapshotId`,
    parseSourceSnapshotId,
  );
  if (!sourceSnapshotId.ok) return sourceSnapshotId;
  const createdAt = readParsedField(
    record,
    "createdAt",
    `${path}.createdAt`,
    parseIsoDateTimeString,
  );
  if (!createdAt.ok) return createdAt;
  const label = readParsedField(record, "label", `${path}.label`, parseNonEmptyString);
  if (!label.ok) return label;
  const state = readParsedField(record, "state", `${path}.state`, parseRevisionState);
  if (!state.ok) return state;

  return fieldOk({
    contractVersion: contractVersion.value,
    id: id.value,
    projectId: projectId.value,
    parentRevisionId: parentRevisionId.value,
    sourceSnapshotId: sourceSnapshotId.value,
    createdAt: createdAt.value,
    label: label.value,
    state: state.value,
  });
}

function parseSourceFileSnapshot(
  value: unknown,
  path: string,
): FieldResult<SourceFileSnapshot> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(
    record,
    ["fileId", "path", "hash", "sizeBytes", "language", "lastModifiedAt"],
    path,
  );
  if (!unknownResult.ok) return unknownResult;

  const fileId = readParsedField(record, "fileId", `${path}.fileId`, parseSourceFileId);
  if (!fileId.ok) return fileId;
  const sourcePath = readParsedField(record, "path", `${path}.path`, parseRelativeFilePath);
  if (!sourcePath.ok) return sourcePath;
  const hash = readParsedField(record, "hash", `${path}.hash`, parseFileHash);
  if (!hash.ok) return hash;
  const sizeBytes = readParsedField(
    record,
    "sizeBytes",
    `${path}.sizeBytes`,
    parseNonNegativeInteger,
  );
  if (!sizeBytes.ok) return sizeBytes;
  const language = readNullableParsedField(
    record,
    "language",
    `${path}.language`,
    parseNonEmptyString,
  );
  if (!language.ok) return language;
  const lastModifiedAt = readParsedField(
    record,
    "lastModifiedAt",
    `${path}.lastModifiedAt`,
    parseIsoDateTimeString,
  );
  if (!lastModifiedAt.ok) return lastModifiedAt;

  return fieldOk({
    fileId: fileId.value,
    path: sourcePath.value,
    hash: hash.value,
    sizeBytes: sizeBytes.value,
    language: language.value,
    lastModifiedAt: lastModifiedAt.value,
  });
}

export function parseSourceSnapshot(
  value: unknown,
  path: string,
): FieldResult<SourceSnapshot> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(
    record,
    ["contractVersion", "id", "projectId", "revisionId", "createdAt", "files"],
    path,
  );
  if (!unknownResult.ok) return unknownResult;

  const contractVersion = readParsedField(
    record,
    "contractVersion",
    `${path}.contractVersion`,
    parseContractVersion,
  );
  if (!contractVersion.ok) return contractVersion;
  const id = readParsedField(record, "id", `${path}.id`, parseSourceSnapshotId);
  if (!id.ok) return id;
  const projectId = readParsedField(record, "projectId", `${path}.projectId`, parseProjectId);
  if (!projectId.ok) return projectId;
  const revisionId = readNullableParsedField(
    record,
    "revisionId",
    `${path}.revisionId`,
    parseRevisionId,
  );
  if (!revisionId.ok) return revisionId;
  const createdAt = readParsedField(
    record,
    "createdAt",
    `${path}.createdAt`,
    parseIsoDateTimeString,
  );
  if (!createdAt.ok) return createdAt;
  const files = readParsedArrayField(record, "files", `${path}.files`, parseSourceFileSnapshot);
  if (!files.ok) return files;

  return fieldOk({
    contractVersion: contractVersion.value,
    id: id.value,
    projectId: projectId.value,
    revisionId: revisionId.value,
    createdAt: createdAt.value,
    files: files.value,
  });
}

export function parseProjectManifestPayload(
  value: unknown,
  source: BoundarySource = BOUNDARY_SOURCE.Ipc,
): ValidationResult<ProjectManifest> {
  return fromFieldResult(source, parseProjectManifest(value, "$"));
}

export function parseProjectSessionPayload(
  value: unknown,
  source: BoundarySource = BOUNDARY_SOURCE.Ipc,
): ValidationResult<ProjectSession> {
  return fromFieldResult(source, parseProjectSession(value, "$"));
}

export function parseRevisionPayload(
  value: unknown,
  source: BoundarySource = BOUNDARY_SOURCE.Ipc,
): ValidationResult<Revision> {
  return fromFieldResult(source, parseRevision(value, "$"));
}

export function parseSourceSnapshotPayload(
  value: unknown,
  source: BoundarySource = BOUNDARY_SOURCE.FileSystem,
): ValidationResult<SourceSnapshot> {
  return fromFieldResult(source, parseSourceSnapshot(value, "$"));
}
