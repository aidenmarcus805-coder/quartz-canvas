import {
  BOUNDARY_SOURCE,
  type AiContextBundle,
  type AiContextSourceFile,
  type BoundarySource,
  type GpuMemoryProfile,
  type KvCachePlacement,
  type LocalAiJob,
  type LocalAiJobRequest,
  type LocalAiJobState,
  type LocalAiModel,
  type LocalAiProvider,
  type QwopusQuantizationTier,
  type QwopusRuntimePlan,
} from "../contracts";
import {
  parseAiModelId,
  parseContextBundleId,
  parseLocalAiJobId,
  parsePatchSetId,
  parseProjectId,
  parsePromptId,
  parseRevisionId,
  parseSessionId,
  parseUiSkillId,
} from "./ids";
import {
  parseFileHash,
  parseIsoDateTimeString,
  parseNonEmptyString,
  parsePositiveFiniteNumber,
  parsePositiveInteger,
  parseRelativeFilePath,
  parseUnitInterval,
} from "./primitives";
import { parsePromptContract } from "./prompt";
import { parseSourceCandidateResult, parseSourceRange, parseVisibleSelection } from "./preview";
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
  readBooleanField,
  rejectUnknownFields,
  type FieldResult,
  type ValidationResult,
} from "./validation";

const QWOPUS_REPO = "KyleHessling1/Qwopus-GLM-18B-Merged-GGUF" as const;
const QWOPUS_MODEL_FILE_BY_QUANTIZATION = {
  q3_k_m: "Qwopus-GLM-18B-Healed-Q3_K_M.gguf",
  q4_k_m: "Qwopus-GLM-18B-Healed-Q4_K_M.gguf",
} as const satisfies Record<QwopusQuantizationTier, string>;

function parseLocalAiProvider(value: unknown, path: string): FieldResult<LocalAiProvider> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(record, ["kind", "endpoint"], path);
  if (!unknownResult.ok) return unknownResult;

  const kind = readLiteralField(
    record,
    "kind",
    ["ollama", "lm_studio", "custom_local"] as const,
    `${path}.kind`,
  );
  if (!kind.ok) return kind;
  const endpoint = readParsedField(record, "endpoint", `${path}.endpoint`, parseLocalEndpoint);
  if (!endpoint.ok) return endpoint;

  return fieldOk({ kind: kind.value, endpoint: endpoint.value });
}

function parseLocalAiModel(value: unknown, path: string): FieldResult<LocalAiModel> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(
    record,
    ["id", "provider", "displayName", "contextWindowTokens"],
    path,
  );
  if (!unknownResult.ok) return unknownResult;

  const id = readParsedField(record, "id", `${path}.id`, parseAiModelId);
  if (!id.ok) return id;
  const provider = readParsedField(record, "provider", `${path}.provider`, parseLocalAiProvider);
  if (!provider.ok) return provider;
  const displayName = readParsedField(
    record,
    "displayName",
    `${path}.displayName`,
    parseNonEmptyString,
  );
  if (!displayName.ok) return displayName;
  const contextWindowTokens = readParsedField(
    record,
    "contextWindowTokens",
    `${path}.contextWindowTokens`,
    parsePositiveInteger,
  );
  if (!contextWindowTokens.ok) return contextWindowTokens;

  return fieldOk({
    id: id.value,
    provider: provider.value,
    displayName: displayName.value,
    contextWindowTokens: contextWindowTokens.value,
  });
}

function parseAiContextSourceFile(
  value: unknown,
  path: string,
): FieldResult<AiContextSourceFile> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(
    record,
    ["path", "selectedRanges", "contentHash", "excerpt"],
    path,
  );
  if (!unknownResult.ok) return unknownResult;

  const sourcePath = readParsedField(record, "path", `${path}.path`, parseRelativeFilePath);
  if (!sourcePath.ok) return sourcePath;
  const selectedRanges = readParsedArrayField(
    record,
    "selectedRanges",
    `${path}.selectedRanges`,
    parseSourceRange,
  );
  if (!selectedRanges.ok) return selectedRanges;
  const collapsedRangeIndex = selectedRanges.value.findIndex(
    (range) => range.startLine === range.endLine && range.startColumn === range.endColumn,
  );
  if (collapsedRangeIndex !== -1) {
    return fieldError(
      issue(
        `${path}.selectedRanges[${collapsedRangeIndex}]`,
        "non-empty source range",
        record.selectedRanges,
        "AI context source ranges must cover source text.",
      ),
    );
  }
  const contentHash = readParsedField(
    record,
    "contentHash",
    `${path}.contentHash`,
    parseFileHash,
  );
  if (!contentHash.ok) return contentHash;
  const excerpt = readParsedField(record, "excerpt", `${path}.excerpt`, parseNonEmptyString);
  if (!excerpt.ok) return excerpt;

  return fieldOk({
    path: sourcePath.value,
    selectedRanges: selectedRanges.value,
    contentHash: contentHash.value,
    excerpt: excerpt.value,
  });
}

export function parseAiContextBundle(
  value: unknown,
  path: string,
): FieldResult<AiContextBundle> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(
    record,
    [
      "contractVersion",
      "id",
      "projectId",
      "sessionId",
      "revisionId",
      "selection",
      "sourceCandidates",
      "sourceFiles",
      "promptId",
      "uiSkillIds",
      "createdAt",
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
  const id = readParsedField(record, "id", `${path}.id`, parseContextBundleId);
  if (!id.ok) return id;
  const projectId = readParsedField(record, "projectId", `${path}.projectId`, parseProjectId);
  if (!projectId.ok) return projectId;
  const sessionId = readParsedField(record, "sessionId", `${path}.sessionId`, parseSessionId);
  if (!sessionId.ok) return sessionId;
  const revisionId = readParsedField(record, "revisionId", `${path}.revisionId`, parseRevisionId);
  if (!revisionId.ok) return revisionId;
  const selection = readNullableParsedField(
    record,
    "selection",
    `${path}.selection`,
    parseVisibleSelection,
  );
  if (!selection.ok) return selection;
  const sourceCandidates = readParsedArrayField(
    record,
    "sourceCandidates",
    `${path}.sourceCandidates`,
    parseSourceCandidateResult,
  );
  if (!sourceCandidates.ok) return sourceCandidates;
  const sourceFiles = readParsedArrayField(
    record,
    "sourceFiles",
    `${path}.sourceFiles`,
    parseAiContextSourceFile,
  );
  if (!sourceFiles.ok) return sourceFiles;
  const promptId = readParsedField(record, "promptId", `${path}.promptId`, parsePromptId);
  if (!promptId.ok) return promptId;
  const uiSkillIds = readParsedArrayField(
    record,
    "uiSkillIds",
    `${path}.uiSkillIds`,
    parseUiSkillId,
  );
  if (!uiSkillIds.ok) return uiSkillIds;
  const createdAt = readParsedField(
    record,
    "createdAt",
    `${path}.createdAt`,
    parseIsoDateTimeString,
  );
  if (!createdAt.ok) return createdAt;

  const identityCheck = validateAiContextBundleIdentity(
    {
      projectId: projectId.value,
      sessionId: sessionId.value,
      revisionId: revisionId.value,
      selection: selection.value,
      sourceCandidates: sourceCandidates.value,
      sourceFiles: sourceFiles.value,
    },
    path,
    value,
  );
  if (!identityCheck.ok) return identityCheck;

  return fieldOk({
    contractVersion: contractVersion.value,
    id: id.value,
    projectId: projectId.value,
    sessionId: sessionId.value,
    revisionId: revisionId.value,
    selection: selection.value,
    sourceCandidates: sourceCandidates.value,
    sourceFiles: sourceFiles.value,
    promptId: promptId.value,
    uiSkillIds: uiSkillIds.value,
    createdAt: createdAt.value,
  });
}

function validateAiContextBundleIdentity(
  context: Pick<
    AiContextBundle,
    "projectId" | "sessionId" | "revisionId" | "selection" | "sourceCandidates" | "sourceFiles"
  >,
  path: string,
  receivedValue: unknown,
): FieldResult<void> {
  const mismatches = [
    context.selection && context.selection.projectId !== context.projectId
      ? "selection.projectId"
      : "",
    context.selection && context.selection.sessionId !== context.sessionId
      ? "selection.sessionId"
      : "",
  ].filter((field) => field.length > 0);

  if (mismatches.length > 0) {
    return fieldError(
      issue(
        path,
        "consistent AI context identity",
        receivedValue,
        `AI context identity mismatch: ${mismatches.join(", ")}.`,
      ),
    );
  }

  const sourceFileHashes = new Map<string, string>();
  for (const sourceFile of context.sourceFiles) {
    if (sourceFileHashes.has(sourceFile.path)) {
      return fieldError(
        issue(`${path}.sourceFiles`, "unique source file paths", receivedValue, "AI context has duplicate source file paths."),
      );
    }
    sourceFileHashes.set(sourceFile.path, sourceFile.contentHash);
  }

  for (const candidate of context.sourceCandidates) {
    const sourceHash = sourceFileHashes.get(candidate.path);
    if (sourceHash !== undefined && sourceHash !== candidate.fileHash) {
      return fieldError(
        issue(
          `${path}.sourceCandidates`,
          "source candidate hash matching source file contentHash",
          receivedValue,
          `AI context source hash mismatch for ${candidate.path}.`,
        ),
      );
    }
  }

  if (context.selection) {
    const bundleCandidates = new Map(
      context.sourceCandidates.map((candidate) => [candidate.candidateId, candidate]),
    );
    for (const candidate of context.selection.sourceCandidates) {
      const bundleCandidate = bundleCandidates.get(candidate.candidateId);
      if (
        bundleCandidate &&
        (bundleCandidate.path !== candidate.path || bundleCandidate.fileHash !== candidate.fileHash)
      ) {
        return fieldError(
          issue(
            `${path}.selection.sourceCandidates`,
            "selection candidates matching AI context candidates",
            receivedValue,
            `Selection source candidate ${candidate.candidateId} does not match the AI context candidate.`,
          ),
        );
      }
    }
  }

  return fieldOk(undefined);
}

function parseLocalAiJobRequest(
  value: unknown,
  path: string,
): FieldResult<LocalAiJobRequest> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(
    record,
    [
      "contractVersion",
      "projectId",
      "sessionId",
      "revisionId",
      "prompt",
      "context",
      "model",
      "requestedAt",
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
  const projectId = readParsedField(record, "projectId", `${path}.projectId`, parseProjectId);
  if (!projectId.ok) return projectId;
  const sessionId = readParsedField(record, "sessionId", `${path}.sessionId`, parseSessionId);
  if (!sessionId.ok) return sessionId;
  const revisionId = readParsedField(record, "revisionId", `${path}.revisionId`, parseRevisionId);
  if (!revisionId.ok) return revisionId;
  const prompt = readParsedField(record, "prompt", `${path}.prompt`, parsePromptContract);
  if (!prompt.ok) return prompt;
  const context = readParsedField(record, "context", `${path}.context`, parseAiContextBundle);
  if (!context.ok) return context;
  const model = readParsedField(record, "model", `${path}.model`, parseLocalAiModel);
  if (!model.ok) return model;
  const requestedAt = readParsedField(
    record,
    "requestedAt",
    `${path}.requestedAt`,
    parseIsoDateTimeString,
  );
  if (!requestedAt.ok) return requestedAt;

  const identityCheck = validateLocalAiJobRequestIdentity(
    {
      projectId: projectId.value,
      sessionId: sessionId.value,
      revisionId: revisionId.value,
      prompt: prompt.value,
      context: context.value,
    },
    path,
    value,
  );
  if (!identityCheck.ok) return identityCheck;

  return fieldOk({
    contractVersion: contractVersion.value,
    projectId: projectId.value,
    sessionId: sessionId.value,
    revisionId: revisionId.value,
    prompt: prompt.value,
    context: context.value,
    model: model.value,
    requestedAt: requestedAt.value,
  });
}

function parseLocalEndpoint(value: unknown, path: string): FieldResult<LocalAiProvider["endpoint"]> {
  const endpoint = parseNonEmptyString(value, path);
  if (!endpoint.ok) return endpoint;

  if (!isLoopbackHttpEndpoint(endpoint.value)) {
    return fieldError(
      issue(
        path,
        "loopback HTTP endpoint",
        value,
        "Local AI endpoints must resolve to localhost, 127.0.0.0/8, or ::1.",
      ),
    );
  }

  return endpoint;
}

function isLoopbackHttpEndpoint(endpoint: string): boolean {
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      hostname === "127.0.0.1" ||
      hostname.startsWith("127.")
    );
  } catch {
    return false;
  }
}

function validateLocalAiJobRequestIdentity(
  request: Pick<LocalAiJobRequest, "projectId" | "sessionId" | "revisionId" | "prompt" | "context">,
  path: string,
  receivedValue: unknown,
): FieldResult<void> {
  const mismatches = [
    request.prompt.projectId !== request.projectId ? "prompt.projectId" : "",
    request.prompt.sessionId !== request.sessionId ? "prompt.sessionId" : "",
    request.prompt.revisionId !== request.revisionId ? "prompt.revisionId" : "",
    request.context.projectId !== request.projectId ? "context.projectId" : "",
    request.context.sessionId !== request.sessionId ? "context.sessionId" : "",
    request.context.revisionId !== request.revisionId ? "context.revisionId" : "",
    request.context.promptId !== request.prompt.id ? "context.promptId" : "",
    request.context.selection && request.context.selection.projectId !== request.projectId
      ? "context.selection.projectId"
      : "",
    request.context.selection && request.context.selection.sessionId !== request.sessionId
      ? "context.selection.sessionId"
      : "",
  ].filter((field) => field.length > 0);

  if (mismatches.length > 0) {
    return fieldError(
      issue(
        path,
        "consistent project/session/revision identity",
        receivedValue,
        `Local AI request identity mismatch: ${mismatches.join(", ")}.`,
      ),
    );
  }

  return fieldOk(undefined);
}

function parseLocalAiJobState(value: unknown, path: string): FieldResult<LocalAiJobState> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const kind = readLiteralField(
    record,
    "kind",
    ["queued", "running", "completed", "failed", "cancelled"] as const,
    `${path}.kind`,
  );
  if (!kind.ok) return kind;

  switch (kind.value) {
    case "queued": {
      const unknownResult = rejectUnknownFields(record, ["kind"], path);
      if (!unknownResult.ok) return unknownResult;
      return fieldOk({ kind: kind.value });
    }
    case "running": {
      const unknownResult = rejectUnknownFields(record, ["kind", "startedAt", "progress"], path);
      if (!unknownResult.ok) return unknownResult;
      const startedAt = readParsedField(
        record,
        "startedAt",
        `${path}.startedAt`,
        parseIsoDateTimeString,
      );
      if (!startedAt.ok) return startedAt;
      const progress = readParsedField(record, "progress", `${path}.progress`, parseUnitInterval);
      if (!progress.ok) return progress;
      return fieldOk({ kind: kind.value, startedAt: startedAt.value, progress: progress.value });
    }
    case "completed": {
      const unknownResult = rejectUnknownFields(
        record,
        ["kind", "completedAt", "patchSetId", "summary"],
        path,
      );
      if (!unknownResult.ok) return unknownResult;
      const completedAt = readParsedField(
        record,
        "completedAt",
        `${path}.completedAt`,
        parseIsoDateTimeString,
      );
      if (!completedAt.ok) return completedAt;
      const patchSetId = readParsedField(
        record,
        "patchSetId",
        `${path}.patchSetId`,
        parsePatchSetId,
      );
      if (!patchSetId.ok) return patchSetId;
      const summary = readParsedField(record, "summary", `${path}.summary`, parseNonEmptyString);
      if (!summary.ok) return summary;
      return fieldOk({
        kind: kind.value,
        completedAt: completedAt.value,
        patchSetId: patchSetId.value,
        summary: summary.value,
      });
    }
    case "failed": {
      const unknownResult = rejectUnknownFields(
        record,
        ["kind", "failedAt", "reason", "recoverable"],
        path,
      );
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
      const recoverable = readBooleanField(record, "recoverable", `${path}.recoverable`);
      if (!recoverable.ok) return recoverable;
      return fieldOk({
        kind: kind.value,
        failedAt: failedAt.value,
        reason: reason.value,
        recoverable: recoverable.value,
      });
    }
    case "cancelled": {
      const unknownResult = rejectUnknownFields(record, ["kind", "cancelledAt", "reason"], path);
      if (!unknownResult.ok) return unknownResult;
      const cancelledAt = readParsedField(
        record,
        "cancelledAt",
        `${path}.cancelledAt`,
        parseIsoDateTimeString,
      );
      if (!cancelledAt.ok) return cancelledAt;
      const reason = readParsedField(record, "reason", `${path}.reason`, parseNonEmptyString);
      if (!reason.ok) return reason;
      return fieldOk({ kind: kind.value, cancelledAt: cancelledAt.value, reason: reason.value });
    }
  }
}

export function parseLocalAiJob(value: unknown, path: string): FieldResult<LocalAiJob> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(
    record,
    [
      "contractVersion",
      "id",
      "projectId",
      "sessionId",
      "request",
      "state",
      "createdAt",
      "updatedAt",
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
  const id = readParsedField(record, "id", `${path}.id`, parseLocalAiJobId);
  if (!id.ok) return id;
  const projectId = readParsedField(record, "projectId", `${path}.projectId`, parseProjectId);
  if (!projectId.ok) return projectId;
  const sessionId = readParsedField(record, "sessionId", `${path}.sessionId`, parseSessionId);
  if (!sessionId.ok) return sessionId;
  const request = readParsedField(record, "request", `${path}.request`, parseLocalAiJobRequest);
  if (!request.ok) return request;
  const state = readParsedField(record, "state", `${path}.state`, parseLocalAiJobState);
  if (!state.ok) return state;
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

  return fieldOk({
    contractVersion: contractVersion.value,
    id: id.value,
    projectId: projectId.value,
    sessionId: sessionId.value,
    request: request.value,
    state: state.value,
    createdAt: createdAt.value,
    updatedAt: updatedAt.value,
  });
}

export function parseGpuMemoryProfile(value: unknown, path: string): FieldResult<GpuMemoryProfile> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(record, ["dedicatedVramGb", "ddr5RamGb"], path);
  if (!unknownResult.ok) return unknownResult;

  const dedicatedVramGb = readParsedField(
    record,
    "dedicatedVramGb",
    `${path}.dedicatedVramGb`,
    parsePositiveInteger,
  );
  if (!dedicatedVramGb.ok) return dedicatedVramGb;

  if (record.ddr5RamGb === undefined || record.ddr5RamGb === null) {
    return fieldOk({ dedicatedVramGb: dedicatedVramGb.value, ddr5RamGb: null });
  }

  const ddr5RamGb = parsePositiveInteger(record.ddr5RamGb, `${path}.ddr5RamGb`);
  if (!ddr5RamGb.ok) return ddr5RamGb;

  return fieldOk({ dedicatedVramGb: dedicatedVramGb.value, ddr5RamGb: ddr5RamGb.value });
}

export function parseQwopusRuntimePlan(value: unknown, path: string): FieldResult<QwopusRuntimePlan> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(
    record,
    [
      "repo",
      "modelFile",
      "quantization",
      "ggufSizeGb",
      "contextSizeTokens",
      "gpuLayers",
      "flashAttention",
      "kvCache",
      "mmapModel",
      "mlockModel",
      "cpuSpillEnabled",
      "minimumRecommendedDdr5Gb",
      "llamaServerArgs",
      "notes",
    ],
    path,
  );
  if (!unknownResult.ok) return unknownResult;

  const repo = readLiteralField(record, "repo", [QWOPUS_REPO] as const, `${path}.repo`);
  if (!repo.ok) return repo;
  const modelFile = readParsedField(record, "modelFile", `${path}.modelFile`, parseNonEmptyString);
  if (!modelFile.ok) return modelFile;
  const quantization = readLiteralField(
    record,
    "quantization",
    ["q3_k_m", "q4_k_m"] as const,
    `${path}.quantization`,
  );
  if (!quantization.ok) return quantization;
  if (modelFile.value !== QWOPUS_MODEL_FILE_BY_QUANTIZATION[quantization.value]) {
    return fieldError(
      issue(
        `${path}.modelFile`,
        `model file matching ${quantization.value}`,
        record.modelFile,
        "Qwopus model file does not match the reported quantization tier.",
      ),
    );
  }
  const ggufSizeGb = readParsedField(record, "ggufSizeGb", `${path}.ggufSizeGb`, parsePositiveFiniteNumber);
  if (!ggufSizeGb.ok) return ggufSizeGb;
  const contextSizeTokens = readParsedField(
    record,
    "contextSizeTokens",
    `${path}.contextSizeTokens`,
    parsePositiveInteger,
  );
  if (!contextSizeTokens.ok) return contextSizeTokens;
  const gpuLayers = readParsedField(record, "gpuLayers", `${path}.gpuLayers`, parsePositiveInteger);
  if (!gpuLayers.ok) return gpuLayers;
  const flashAttention = readBooleanField(record, "flashAttention", `${path}.flashAttention`);
  if (!flashAttention.ok) return flashAttention;
  const kvCache = readLiteralField(
    record,
    "kvCache",
    ["gpu", "system_ram"] as const,
    `${path}.kvCache`,
  );
  if (!kvCache.ok) return kvCache;
  const mmapModel = readBooleanField(record, "mmapModel", `${path}.mmapModel`);
  if (!mmapModel.ok) return mmapModel;
  const mlockModel = readBooleanField(record, "mlockModel", `${path}.mlockModel`);
  if (!mlockModel.ok) return mlockModel;
  const cpuSpillEnabled = readBooleanField(record, "cpuSpillEnabled", `${path}.cpuSpillEnabled`);
  if (!cpuSpillEnabled.ok) return cpuSpillEnabled;
  const minimumRecommendedDdr5Gb = readParsedField(
    record,
    "minimumRecommendedDdr5Gb",
    `${path}.minimumRecommendedDdr5Gb`,
    parsePositiveInteger,
  );
  if (!minimumRecommendedDdr5Gb.ok) return minimumRecommendedDdr5Gb;
  const llamaServerArgs = readParsedArrayField(
    record,
    "llamaServerArgs",
    `${path}.llamaServerArgs`,
    parseNonEmptyString,
  );
  if (!llamaServerArgs.ok) return llamaServerArgs;
  const notes = readParsedArrayField(record, "notes", `${path}.notes`, parseNonEmptyString);
  if (!notes.ok) return notes;

  return fieldOk({
    repo: repo.value,
    modelFile: modelFile.value,
    quantization: quantization.value as QwopusQuantizationTier,
    ggufSizeGb: ggufSizeGb.value,
    contextSizeTokens: contextSizeTokens.value,
    gpuLayers: gpuLayers.value,
    flashAttention: flashAttention.value,
    kvCache: kvCache.value as KvCachePlacement,
    mmapModel: mmapModel.value,
    mlockModel: mlockModel.value,
    cpuSpillEnabled: cpuSpillEnabled.value,
    minimumRecommendedDdr5Gb: minimumRecommendedDdr5Gb.value,
    llamaServerArgs: llamaServerArgs.value,
    notes: notes.value,
  });
}

export function parseAiContextBundlePayload(
  value: unknown,
  source: BoundarySource = BOUNDARY_SOURCE.LocalAi,
): ValidationResult<AiContextBundle> {
  return fromFieldResult(source, parseAiContextBundle(value, "$"));
}

export function parseLocalAiJobPayload(
  value: unknown,
  source: BoundarySource = BOUNDARY_SOURCE.LocalAi,
): ValidationResult<LocalAiJob> {
  return fromFieldResult(source, parseLocalAiJob(value, "$"));
}

export function parseGpuMemoryProfilePayload(
  value: unknown,
  source: BoundarySource = BOUNDARY_SOURCE.Ipc,
): ValidationResult<GpuMemoryProfile> {
  return fromFieldResult(source, parseGpuMemoryProfile(value, "$"));
}

export function parseQwopusRuntimePlanPayload(
  value: unknown,
  source: BoundarySource = BOUNDARY_SOURCE.Ipc,
): ValidationResult<QwopusRuntimePlan> {
  return fromFieldResult(source, parseQwopusRuntimePlan(value, "$"));
}
