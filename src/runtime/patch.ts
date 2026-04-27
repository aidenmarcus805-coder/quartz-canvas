import {
  BOUNDARY_SOURCE,
  type BoundarySource,
  type DiffHunk,
  type DiffLine,
  type FilePatch,
  type PatchFileChange,
  type PatchOperation,
  type PatchProposal,
  type PatchSet,
  type PatchValidationCheck,
  type PatchValidationReport,
  type RollbackPlan,
  type RollbackPlanState,
  type RollbackSnapshot,
  type RollbackSnapshotFile,
  type SourceRange,
} from "../contracts";
import {
  parseAiRequestId,
  parseLocalAiJobId,
  parsePatchSetId,
  parseProposalId,
  parseProjectId,
  parseRevisionId,
  parseRollbackId,
  parseSelectionId,
  parseSourceFileId,
  parseValidationRunId,
} from "./ids";
import {
  parseFileHash,
  parseIsoDateTimeString,
  parseNonEmptyString,
  parseNonNegativeInteger,
  parseRelativeFilePath,
} from "./primitives";
import { parseSourceRange } from "./preview";
import {
  fieldError,
  fieldOk,
  fromFieldResult,
  issue,
  parseContractVersion,
  readLiteralField,
  readNullableParsedField,
  readParsedArrayField,
  readParsedField,
  readRecord,
  readStringField,
  rejectUnknownFields,
  type FieldResult,
  type ValidationResult,
} from "./validation";

function isCollapsedSourceRange(range: SourceRange): boolean {
  return range.startLine === range.endLine && range.startColumn === range.endColumn;
}

function requireCollapsedSourceRange(
  range: SourceRange,
  path: string,
  receivedValue: unknown,
): FieldResult<void> {
  if (!isCollapsedSourceRange(range)) {
    return fieldError(
      issue(path, "collapsed source range", receivedValue, "Insert operations must target a single source position."),
    );
  }

  return fieldOk(undefined);
}

function requireNonEmptySourceRange(
  range: SourceRange,
  path: string,
  receivedValue: unknown,
): FieldResult<void> {
  if (isCollapsedSourceRange(range)) {
    return fieldError(
      issue(path, "non-empty source range", receivedValue, "Replace and delete operations must cover source text."),
    );
  }

  return fieldOk(undefined);
}

function parseDiffLine(value: unknown, path: string): FieldResult<DiffLine> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const kind = readLiteralField(
    record,
    "kind",
    ["context", "added", "removed"] as const,
    `${path}.kind`,
  );
  if (!kind.ok) return kind;

  switch (kind.value) {
    case "context": {
      const unknownResult = rejectUnknownFields(record, ["kind", "oldLine", "newLine", "text"], path);
      if (!unknownResult.ok) return unknownResult;
      const oldLine = readParsedField(record, "oldLine", `${path}.oldLine`, parseNonNegativeInteger);
      if (!oldLine.ok) return oldLine;
      const newLine = readParsedField(record, "newLine", `${path}.newLine`, parseNonNegativeInteger);
      if (!newLine.ok) return newLine;
      const text = readStringField(record, "text", `${path}.text`);
      if (!text.ok) return text;
      return fieldOk({
        kind: kind.value,
        oldLine: oldLine.value,
        newLine: newLine.value,
        text: text.value,
      });
    }
    case "added": {
      const unknownResult = rejectUnknownFields(record, ["kind", "newLine", "text"], path);
      if (!unknownResult.ok) return unknownResult;
      const newLine = readParsedField(record, "newLine", `${path}.newLine`, parseNonNegativeInteger);
      if (!newLine.ok) return newLine;
      const text = readStringField(record, "text", `${path}.text`);
      if (!text.ok) return text;
      return fieldOk({ kind: kind.value, newLine: newLine.value, text: text.value });
    }
    case "removed": {
      const unknownResult = rejectUnknownFields(record, ["kind", "oldLine", "text"], path);
      if (!unknownResult.ok) return unknownResult;
      const oldLine = readParsedField(record, "oldLine", `${path}.oldLine`, parseNonNegativeInteger);
      if (!oldLine.ok) return oldLine;
      const text = readStringField(record, "text", `${path}.text`);
      if (!text.ok) return text;
      return fieldOk({ kind: kind.value, oldLine: oldLine.value, text: text.value });
    }
  }
}

function parseDiffHunk(value: unknown, path: string): FieldResult<DiffHunk> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(
    record,
    ["oldStart", "oldLines", "newStart", "newLines", "header", "lines"],
    path,
  );
  if (!unknownResult.ok) return unknownResult;

  const oldStart = readParsedField(record, "oldStart", `${path}.oldStart`, parseNonNegativeInteger);
  if (!oldStart.ok) return oldStart;
  const oldLines = readParsedField(record, "oldLines", `${path}.oldLines`, parseNonNegativeInteger);
  if (!oldLines.ok) return oldLines;
  const newStart = readParsedField(record, "newStart", `${path}.newStart`, parseNonNegativeInteger);
  if (!newStart.ok) return newStart;
  const newLines = readParsedField(record, "newLines", `${path}.newLines`, parseNonNegativeInteger);
  if (!newLines.ok) return newLines;
  const header = readStringField(record, "header", `${path}.header`);
  if (!header.ok) return header;
  const lines = readParsedArrayField(record, "lines", `${path}.lines`, parseDiffLine);
  if (!lines.ok) return lines;

  const countedOldLines = lines.value.filter((line) => line.kind !== "added").length;
  const countedNewLines = lines.value.filter((line) => line.kind !== "removed").length;
  if (countedOldLines !== oldLines.value || countedNewLines !== newLines.value) {
    return fieldError(
      issue(path, "consistent diff hunk line counts", value, "Diff hunk line counts do not match the hunk body."),
    );
  }

  return fieldOk({
    oldStart: oldStart.value,
    oldLines: oldLines.value,
    newStart: newStart.value,
    newLines: newLines.value,
    header: header.value,
    lines: lines.value,
  });
}

function parsePatchOperation(value: unknown, path: string): FieldResult<PatchOperation> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const kind = readLiteralField(
    record,
    "kind",
    ["insert", "replace", "delete"] as const,
    `${path}.kind`,
  );
  if (!kind.ok) return kind;

  switch (kind.value) {
    case "insert": {
      const unknownResult = rejectUnknownFields(record, ["kind", "at", "newText"], path);
      if (!unknownResult.ok) return unknownResult;
      const at = readParsedField(record, "at", `${path}.at`, parseSourceRange);
      if (!at.ok) return at;
      const collapsed = requireCollapsedSourceRange(at.value, `${path}.at`, record.at);
      if (!collapsed.ok) return collapsed;
      const newText = readStringField(record, "newText", `${path}.newText`);
      if (!newText.ok) return newText;
      return fieldOk({ kind: kind.value, at: at.value, newText: newText.value });
    }
    case "replace": {
      const unknownResult = rejectUnknownFields(
        record,
        ["kind", "range", "oldText", "newText"],
        path,
      );
      if (!unknownResult.ok) return unknownResult;
      const range = readParsedField(record, "range", `${path}.range`, parseSourceRange);
      if (!range.ok) return range;
      const nonEmpty = requireNonEmptySourceRange(range.value, `${path}.range`, record.range);
      if (!nonEmpty.ok) return nonEmpty;
      const oldText = readStringField(record, "oldText", `${path}.oldText`);
      if (!oldText.ok) return oldText;
      const newText = readStringField(record, "newText", `${path}.newText`);
      if (!newText.ok) return newText;
      return fieldOk({
        kind: kind.value,
        range: range.value,
        oldText: oldText.value,
        newText: newText.value,
      });
    }
    case "delete": {
      const unknownResult = rejectUnknownFields(record, ["kind", "range", "oldText"], path);
      if (!unknownResult.ok) return unknownResult;
      const range = readParsedField(record, "range", `${path}.range`, parseSourceRange);
      if (!range.ok) return range;
      const nonEmpty = requireNonEmptySourceRange(range.value, `${path}.range`, record.range);
      if (!nonEmpty.ok) return nonEmpty;
      const oldText = readStringField(record, "oldText", `${path}.oldText`);
      if (!oldText.ok) return oldText;
      return fieldOk({ kind: kind.value, range: range.value, oldText: oldText.value });
    }
  }
}

function parseFilePatch(value: unknown, path: string): FieldResult<FilePatch> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(
    record,
    ["sourceFileId", "path", "beforeHash", "afterHash", "operations", "hunks"],
    path,
  );
  if (!unknownResult.ok) return unknownResult;

  const sourceFileId = readParsedField(
    record,
    "sourceFileId",
    `${path}.sourceFileId`,
    parseSourceFileId,
  );
  if (!sourceFileId.ok) return sourceFileId;
  const sourcePath = readParsedField(record, "path", `${path}.path`, parseRelativeFilePath);
  if (!sourcePath.ok) return sourcePath;
  const beforeHash = readParsedField(record, "beforeHash", `${path}.beforeHash`, parseFileHash);
  if (!beforeHash.ok) return beforeHash;
  const afterHash = readNullableParsedField(record, "afterHash", `${path}.afterHash`, parseFileHash);
  if (!afterHash.ok) return afterHash;
  const operations = readParsedArrayField(
    record,
    "operations",
    `${path}.operations`,
    parsePatchOperation,
  );
  if (!operations.ok) return operations;
  const hunks = readParsedArrayField(record, "hunks", `${path}.hunks`, parseDiffHunk);
  if (!hunks.ok) return hunks;

  return fieldOk({
    sourceFileId: sourceFileId.value,
    path: sourcePath.value,
    beforeHash: beforeHash.value,
    afterHash: afterHash.value,
    operations: operations.value,
    hunks: hunks.value,
  });
}

function parsePatchFileChange(value: unknown, path: string): FieldResult<PatchFileChange> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const operation = readLiteralField(
    record,
    "operation",
    ["create", "modify", "delete", "rename"] as const,
    `${path}.operation`,
  );
  if (!operation.ok) return operation;

  switch (operation.value) {
    case "create": {
      const unknownResult = rejectUnknownFields(record, ["operation", "path", "content"], path);
      if (!unknownResult.ok) return unknownResult;
      const sourcePath = readParsedField(record, "path", `${path}.path`, parseRelativeFilePath);
      if (!sourcePath.ok) return sourcePath;
      const content = readStringField(record, "content", `${path}.content`);
      if (!content.ok) return content;
      return fieldOk({ operation: operation.value, path: sourcePath.value, content: content.value });
    }
    case "modify": {
      const unknownResult = rejectUnknownFields(
        record,
        ["operation", "path", "old_hash", "unified_diff"],
        path,
      );
      if (!unknownResult.ok) return unknownResult;
      const sourcePath = readParsedField(record, "path", `${path}.path`, parseRelativeFilePath);
      if (!sourcePath.ok) return sourcePath;
      const oldHash = readParsedField(record, "old_hash", `${path}.old_hash`, parseFileHash);
      if (!oldHash.ok) return oldHash;
      const unifiedDiff = readParsedField(
        record,
        "unified_diff",
        `${path}.unified_diff`,
        parseNonEmptyString,
      );
      if (!unifiedDiff.ok) return unifiedDiff;
      return fieldOk({
        operation: operation.value,
        path: sourcePath.value,
        old_hash: oldHash.value,
        unified_diff: unifiedDiff.value,
      });
    }
    case "delete": {
      const unknownResult = rejectUnknownFields(record, ["operation", "path", "old_hash"], path);
      if (!unknownResult.ok) return unknownResult;
      const sourcePath = readParsedField(record, "path", `${path}.path`, parseRelativeFilePath);
      if (!sourcePath.ok) return sourcePath;
      const oldHash = readParsedField(record, "old_hash", `${path}.old_hash`, parseFileHash);
      if (!oldHash.ok) return oldHash;
      return fieldOk({ operation: operation.value, path: sourcePath.value, old_hash: oldHash.value });
    }
    case "rename": {
      const unknownResult = rejectUnknownFields(
        record,
        ["operation", "from", "to", "old_hash"],
        path,
      );
      if (!unknownResult.ok) return unknownResult;
      const from = readParsedField(record, "from", `${path}.from`, parseRelativeFilePath);
      if (!from.ok) return from;
      const to = readParsedField(record, "to", `${path}.to`, parseRelativeFilePath);
      if (!to.ok) return to;
      if (from.value === to.value) {
        return fieldError(
          issue(`${path}.to`, "different relative file path", record.to, "Rename target must differ from source."),
        );
      }
      const oldHash = readParsedField(record, "old_hash", `${path}.old_hash`, parseFileHash);
      if (!oldHash.ok) return oldHash;
      return fieldOk({
        operation: operation.value,
        from: from.value,
        to: to.value,
        old_hash: oldHash.value,
      });
    }
  }
}

export function parsePatchProposal(value: unknown, path: string): FieldResult<PatchProposal> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(
    record,
    ["proposalId", "projectId", "requestId", "summary", "files"],
    path,
  );
  if (!unknownResult.ok) return unknownResult;

  const proposalId = readParsedField(record, "proposalId", `${path}.proposalId`, parseProposalId);
  if (!proposalId.ok) return proposalId;
  const projectId = readParsedField(record, "projectId", `${path}.projectId`, parseProjectId);
  if (!projectId.ok) return projectId;
  const requestId = readParsedField(record, "requestId", `${path}.requestId`, parseAiRequestId);
  if (!requestId.ok) return requestId;
  const summary = readParsedField(record, "summary", `${path}.summary`, parseNonEmptyString);
  if (!summary.ok) return summary;
  const files = readParsedArrayField(record, "files", `${path}.files`, parsePatchFileChange);
  if (!files.ok) return files;
  if (files.value.length === 0) {
    return fieldError(
      issue(`${path}.files`, "non-empty array", record.files, "Patch proposal must include file changes."),
    );
  }

  return fieldOk({
    proposalId: proposalId.value,
    projectId: projectId.value,
    requestId: requestId.value,
    summary: summary.value,
    files: files.value,
  });
}

export function parsePatchSet(value: unknown, path: string): FieldResult<PatchSet> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(
    record,
    [
      "contractVersion",
      "id",
      "projectId",
      "baseRevisionId",
      "targetRevisionId",
      "selectionId",
      "aiJobId",
      "createdAt",
      "summary",
      "files",
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
  const id = readParsedField(record, "id", `${path}.id`, parsePatchSetId);
  if (!id.ok) return id;
  const projectId = readParsedField(record, "projectId", `${path}.projectId`, parseProjectId);
  if (!projectId.ok) return projectId;
  const baseRevisionId = readParsedField(
    record,
    "baseRevisionId",
    `${path}.baseRevisionId`,
    parseRevisionId,
  );
  if (!baseRevisionId.ok) return baseRevisionId;
  const targetRevisionId = readNullableParsedField(
    record,
    "targetRevisionId",
    `${path}.targetRevisionId`,
    parseRevisionId,
  );
  if (!targetRevisionId.ok) return targetRevisionId;
  const selectionId = readNullableParsedField(
    record,
    "selectionId",
    `${path}.selectionId`,
    parseSelectionId,
  );
  if (!selectionId.ok) return selectionId;
  const aiJobId = readNullableParsedField(record, "aiJobId", `${path}.aiJobId`, parseLocalAiJobId);
  if (!aiJobId.ok) return aiJobId;
  const createdAt = readParsedField(
    record,
    "createdAt",
    `${path}.createdAt`,
    parseIsoDateTimeString,
  );
  if (!createdAt.ok) return createdAt;
  const summary = readParsedField(record, "summary", `${path}.summary`, parseNonEmptyString);
  if (!summary.ok) return summary;
  const files = readParsedArrayField(record, "files", `${path}.files`, parseFilePatch);
  if (!files.ok) return files;

  return fieldOk({
    contractVersion: contractVersion.value,
    id: id.value,
    projectId: projectId.value,
    baseRevisionId: baseRevisionId.value,
    targetRevisionId: targetRevisionId.value,
    selectionId: selectionId.value,
    aiJobId: aiJobId.value,
    createdAt: createdAt.value,
    summary: summary.value,
    files: files.value,
  });
}

function parsePatchValidationCheck(
  value: unknown,
  path: string,
): FieldResult<PatchValidationCheck> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const kind = readLiteralField(
    record,
    "kind",
    ["source_hash", "source_range", "shell_constraint", "typecheck"] as const,
    `${path}.kind`,
  );
  if (!kind.ok) return kind;

  switch (kind.value) {
    case "source_hash": {
      const unknownResult = rejectUnknownFields(
        record,
        ["kind", "status", "path", "expectedHash", "actualHash"],
        path,
      );
      if (!unknownResult.ok) return unknownResult;
      const status = readLiteralField(record, "status", ["passed", "failed"] as const, `${path}.status`);
      if (!status.ok) return status;
      const sourcePath = readParsedField(record, "path", `${path}.path`, parseRelativeFilePath);
      if (!sourcePath.ok) return sourcePath;
      const expectedHash = readParsedField(
        record,
        "expectedHash",
        `${path}.expectedHash`,
        parseFileHash,
      );
      if (!expectedHash.ok) return expectedHash;
      const actualHash = readNullableParsedField(
        record,
        "actualHash",
        `${path}.actualHash`,
        parseFileHash,
      );
      if (!actualHash.ok) return actualHash;
      return fieldOk({
        kind: kind.value,
        status: status.value,
        path: sourcePath.value,
        expectedHash: expectedHash.value,
        actualHash: actualHash.value,
      });
    }
    case "source_range": {
      const unknownResult = rejectUnknownFields(
        record,
        ["kind", "status", "path", "range", "reason"],
        path,
      );
      if (!unknownResult.ok) return unknownResult;
      const status = readLiteralField(record, "status", ["passed", "failed"] as const, `${path}.status`);
      if (!status.ok) return status;
      const sourcePath = readParsedField(record, "path", `${path}.path`, parseRelativeFilePath);
      if (!sourcePath.ok) return sourcePath;
      const range = readParsedField(record, "range", `${path}.range`, parseSourceRange);
      if (!range.ok) return range;
      if (record.reason === undefined) {
        return fieldOk({
          kind: kind.value,
          status: status.value,
          path: sourcePath.value,
          range: range.value,
        });
      }
      const reason = parseNonEmptyString(record.reason, `${path}.reason`);
      if (!reason.ok) return reason;
      return fieldOk({
        kind: kind.value,
        status: status.value,
        path: sourcePath.value,
        range: range.value,
        reason: reason.value,
      });
    }
    case "shell_constraint": {
      const unknownResult = rejectUnknownFields(record, ["kind", "status", "reason"], path);
      if (!unknownResult.ok) return unknownResult;
      const status = readLiteralField(record, "status", ["passed", "failed"] as const, `${path}.status`);
      if (!status.ok) return status;
      const reason = readParsedField(record, "reason", `${path}.reason`, parseNonEmptyString);
      if (!reason.ok) return reason;
      return fieldOk({ kind: kind.value, status: status.value, reason: reason.value });
    }
    case "typecheck": {
      const unknownResult = rejectUnknownFields(
        record,
        ["kind", "status", "command", "output"],
        path,
      );
      if (!unknownResult.ok) return unknownResult;
      const status = readLiteralField(
        record,
        "status",
        ["not_run", "passed", "failed"] as const,
        `${path}.status`,
      );
      if (!status.ok) return status;
      const command = readParsedField(record, "command", `${path}.command`, parseNonEmptyString);
      if (!command.ok) return command;
      if (record.output === undefined) {
        return fieldOk({ kind: kind.value, status: status.value, command: command.value });
      }
      const output = readStringField(record, "output", `${path}.output`);
      if (!output.ok) return output;
      return fieldOk({
        kind: kind.value,
        status: status.value,
        command: command.value,
        output: output.value,
      });
    }
  }
}

export function parsePatchValidationReport(
  value: unknown,
  path: string,
): FieldResult<PatchValidationReport> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(
    record,
    ["contractVersion", "id", "patchSetId", "projectId", "status", "checks", "createdAt"],
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
  const id = readParsedField(record, "id", `${path}.id`, parseValidationRunId);
  if (!id.ok) return id;
  const patchSetId = readParsedField(record, "patchSetId", `${path}.patchSetId`, parsePatchSetId);
  if (!patchSetId.ok) return patchSetId;
  const projectId = readParsedField(record, "projectId", `${path}.projectId`, parseProjectId);
  if (!projectId.ok) return projectId;
  const status = readLiteralField(
    record,
    "status",
    ["not_run", "passed", "failed", "blocked"] as const,
    `${path}.status`,
  );
  if (!status.ok) return status;
  const checks = readParsedArrayField(
    record,
    "checks",
    `${path}.checks`,
    parsePatchValidationCheck,
  );
  if (!checks.ok) return checks;
  const createdAt = readParsedField(
    record,
    "createdAt",
    `${path}.createdAt`,
    parseIsoDateTimeString,
  );
  if (!createdAt.ok) return createdAt;

  return fieldOk({
    contractVersion: contractVersion.value,
    id: id.value,
    patchSetId: patchSetId.value,
    projectId: projectId.value,
    status: status.value,
    checks: checks.value,
    createdAt: createdAt.value,
  });
}

function parseRollbackSnapshotFile(
  value: unknown,
  path: string,
): FieldResult<RollbackSnapshotFile> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(record, ["sourceFileId", "path", "hash", "content"], path);
  if (!unknownResult.ok) return unknownResult;

  const sourceFileId = readParsedField(
    record,
    "sourceFileId",
    `${path}.sourceFileId`,
    parseSourceFileId,
  );
  if (!sourceFileId.ok) return sourceFileId;
  const sourcePath = readParsedField(record, "path", `${path}.path`, parseRelativeFilePath);
  if (!sourcePath.ok) return sourcePath;
  const hash = readParsedField(record, "hash", `${path}.hash`, parseFileHash);
  if (!hash.ok) return hash;
  const content = readStringField(record, "content", `${path}.content`);
  if (!content.ok) return content;

  return fieldOk({
    sourceFileId: sourceFileId.value,
    path: sourcePath.value,
    hash: hash.value,
    content: content.value,
  });
}

export function parseRollbackSnapshot(
  value: unknown,
  path: string,
): FieldResult<RollbackSnapshot> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(
    record,
    ["contractVersion", "id", "projectId", "revisionId", "patchSetId", "createdAt", "files"],
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
  const id = readParsedField(record, "id", `${path}.id`, parseRollbackId);
  if (!id.ok) return id;
  const projectId = readParsedField(record, "projectId", `${path}.projectId`, parseProjectId);
  if (!projectId.ok) return projectId;
  const revisionId = readParsedField(record, "revisionId", `${path}.revisionId`, parseRevisionId);
  if (!revisionId.ok) return revisionId;
  const patchSetId = readParsedField(record, "patchSetId", `${path}.patchSetId`, parsePatchSetId);
  if (!patchSetId.ok) return patchSetId;
  const createdAt = readParsedField(
    record,
    "createdAt",
    `${path}.createdAt`,
    parseIsoDateTimeString,
  );
  if (!createdAt.ok) return createdAt;
  const files = readParsedArrayField(
    record,
    "files",
    `${path}.files`,
    parseRollbackSnapshotFile,
  );
  if (!files.ok) return files;

  return fieldOk({
    contractVersion: contractVersion.value,
    id: id.value,
    projectId: projectId.value,
    revisionId: revisionId.value,
    patchSetId: patchSetId.value,
    createdAt: createdAt.value,
    files: files.value,
  });
}

function parseRollbackPlanState(
  value: unknown,
  path: string,
): FieldResult<RollbackPlanState> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const kind = readLiteralField(
    record,
    "kind",
    ["ready", "applied", "failed"] as const,
    `${path}.kind`,
  );
  if (!kind.ok) return kind;

  switch (kind.value) {
    case "ready": {
      const unknownResult = rejectUnknownFields(record, ["kind"], path);
      if (!unknownResult.ok) return unknownResult;
      return fieldOk({ kind: kind.value });
    }
    case "applied": {
      const unknownResult = rejectUnknownFields(record, ["kind", "appliedAt"], path);
      if (!unknownResult.ok) return unknownResult;
      const appliedAt = readParsedField(
        record,
        "appliedAt",
        `${path}.appliedAt`,
        parseIsoDateTimeString,
      );
      if (!appliedAt.ok) return appliedAt;
      return fieldOk({ kind: kind.value, appliedAt: appliedAt.value });
    }
    case "failed": {
      const unknownResult = rejectUnknownFields(record, ["kind", "failedAt", "reason"], path);
      if (!unknownResult.ok) return unknownResult;
      const failedAt = readParsedField(
        record,
        "failedAt",
        `${path}.failedAt`,
        parseIsoDateTimeString,
      );
      if (!failedAt.ok) return failedAt;
      const reason = readParsedField(record, "reason", `${path}.reason`, parseNonEmptyString);
      if (!reason.ok) return reason;
      return fieldOk({ kind: kind.value, failedAt: failedAt.value, reason: reason.value });
    }
  }
}

export function parseRollbackPlan(value: unknown, path: string): FieldResult<RollbackPlan> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(
    record,
    ["contractVersion", "id", "projectId", "snapshotId", "patchSetId", "state", "createdAt"],
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
  const id = readParsedField(record, "id", `${path}.id`, parseRollbackId);
  if (!id.ok) return id;
  const projectId = readParsedField(record, "projectId", `${path}.projectId`, parseProjectId);
  if (!projectId.ok) return projectId;
  const snapshotId = readParsedField(record, "snapshotId", `${path}.snapshotId`, parseRollbackId);
  if (!snapshotId.ok) return snapshotId;
  const patchSetId = readParsedField(record, "patchSetId", `${path}.patchSetId`, parsePatchSetId);
  if (!patchSetId.ok) return patchSetId;
  const state = readParsedField(record, "state", `${path}.state`, parseRollbackPlanState);
  if (!state.ok) return state;
  const createdAt = readParsedField(
    record,
    "createdAt",
    `${path}.createdAt`,
    parseIsoDateTimeString,
  );
  if (!createdAt.ok) return createdAt;

  return fieldOk({
    contractVersion: contractVersion.value,
    id: id.value,
    projectId: projectId.value,
    snapshotId: snapshotId.value,
    patchSetId: patchSetId.value,
    state: state.value,
    createdAt: createdAt.value,
  });
}

export function parsePatchSetPayload(
  value: unknown,
  source: BoundarySource = BOUNDARY_SOURCE.Ipc,
): ValidationResult<PatchSet> {
  return fromFieldResult(source, parsePatchSet(value, "$"));
}

export function parsePatchProposalPayload(
  value: unknown,
  source: BoundarySource = BOUNDARY_SOURCE.Ipc,
): ValidationResult<PatchProposal> {
  return fromFieldResult(source, parsePatchProposal(value, "$"));
}

export function parsePatchValidationReportPayload(
  value: unknown,
  source: BoundarySource = BOUNDARY_SOURCE.Ipc,
): ValidationResult<PatchValidationReport> {
  return fromFieldResult(source, parsePatchValidationReport(value, "$"));
}

export function parseRollbackSnapshotPayload(
  value: unknown,
  source: BoundarySource = BOUNDARY_SOURCE.FileSystem,
): ValidationResult<RollbackSnapshot> {
  return fromFieldResult(source, parseRollbackSnapshot(value, "$"));
}

export function parseRollbackPlanPayload(
  value: unknown,
  source: BoundarySource = BOUNDARY_SOURCE.Ipc,
): ValidationResult<RollbackPlan> {
  return fromFieldResult(source, parseRollbackPlan(value, "$"));
}
