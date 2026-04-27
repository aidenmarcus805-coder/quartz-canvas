import {
  BOUNDARY_SOURCE,
  type BoundarySource,
  type DomRectSnapshot,
  type PreviewBridgeEvent,
  type PreviewFrame,
  type SelectionAuthority,
  type SelectionAuthorityLevel,
  type SelectedElementSnapshot,
  type SourceCandidateConfidence,
  type SourceCandidateResult,
  type SourceRange,
  type ViewportSnapshot,
  type VisibleSelection,
} from "../contracts";
import {
  parseCandidateId,
  parseDomNodePath,
  parsePreviewFrameId,
  parseProjectId,
  parseSelectionId,
  parseSessionId,
} from "./ids";
import { parseJsonObject } from "./json";
import {
  parseFileHash,
  parseIsoDateTimeString,
  parseNonEmptyString,
  parseNonNegativeFiniteNumber,
  parseNonNegativeInteger,
  parsePositiveFiniteNumber,
  parsePositiveInteger,
  parseRelativeFilePath,
} from "./primitives";
import {
  fieldError,
  fieldOk,
  fromFieldResult,
  issue,
  parseContractVersion,
  readLiteralField,
  readNullableParsedField,
  readNumberField,
  readParsedArrayField,
  readParsedField,
  readRecord,
  readRecordField,
  readStringField,
  rejectUnknownFields,
  type FieldResult,
  type ValidationResult,
} from "./validation";
import {
  isAllowedElementAttribute,
  sanitizeAttributeValue,
  sanitizeTextHint,
} from "../preview/sanitization";

const MAX_SELECTION_TEXT_CONTENT_LENGTH = 2_000;
const MAX_SELECTION_OUTER_HTML_LENGTH = 4_000;
const MAX_SELECTION_ATTRIBUTE_COUNT = 64;
const MAX_SELECTION_ATTRIBUTE_NAME_LENGTH = 80;
const MAX_SELECTION_ATTRIBUTE_VALUE_LENGTH = 1_024;

const AUTHORITY_LEVELS = [
  "patch_authoritative",
  "source_confirm_required",
  "inspect_only",
  "visual_only",
  "stale",
  "blocked",
] as const satisfies readonly SelectionAuthorityLevel[];

const CONFIDENCE_BANDS = ["high", "likely", "ambiguous", "low", "blocked"] as const;

export function isSelectionAuthorityLevel(
  value: unknown,
): value is SelectionAuthorityLevel {
  return typeof value === "string" && AUTHORITY_LEVELS.some((level) => level === value);
}

export function parseSelectionAuthorityLevel(
  value: unknown,
  path: string,
): FieldResult<SelectionAuthorityLevel> {
  if (!isSelectionAuthorityLevel(value)) {
    return fieldError(
      issue(path, AUTHORITY_LEVELS.join(" | "), value, "Invalid selection authority level."),
    );
  }

  return fieldOk(value);
}

export function parseSourceRange(value: unknown, path: string): FieldResult<SourceRange> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) {
    return recordResult;
  }
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(
    record,
    ["startLine", "startColumn", "endLine", "endColumn"],
    path,
  );
  if (!unknownResult.ok) {
    return unknownResult;
  }

  const startLine = parsePositiveInteger(record.startLine, `${path}.startLine`);
  if (!startLine.ok) return startLine;
  const startColumn = parsePositiveInteger(record.startColumn, `${path}.startColumn`);
  if (!startColumn.ok) return startColumn;
  const endLine = parsePositiveInteger(record.endLine, `${path}.endLine`);
  if (!endLine.ok) return endLine;
  const endColumn = parsePositiveInteger(record.endColumn, `${path}.endColumn`);
  if (!endColumn.ok) return endColumn;

  if (
    endLine.value < startLine.value ||
    (endLine.value === startLine.value && endColumn.value < startColumn.value)
  ) {
    return fieldError(
      issue(path, "ordered source range", value, "Source range end must not precede start."),
    );
  }

  return fieldOk({
    startLine: startLine.value,
    startColumn: startColumn.value,
    endLine: endLine.value,
    endColumn: endColumn.value,
  });
}

function parseDomRectSnapshot(value: unknown, path: string): FieldResult<DomRectSnapshot> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(record, ["x", "y", "width", "height"], path);
  if (!unknownResult.ok) return unknownResult;

  const x = readNumberField(record, "x", `${path}.x`);
  if (!x.ok) return x;
  const y = readNumberField(record, "y", `${path}.y`);
  if (!y.ok) return y;
  const width = readParsedField(record, "width", `${path}.width`, parseNonNegativeFiniteNumber);
  if (!width.ok) return width;
  const height = readParsedField(record, "height", `${path}.height`, parseNonNegativeFiniteNumber);
  if (!height.ok) return height;

  return fieldOk({ x: x.value, y: y.value, width: width.value, height: height.value });
}

function parseViewportSnapshot(value: unknown, path: string): FieldResult<ViewportSnapshot> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(
    record,
    ["width", "height", "scrollX", "scrollY", "devicePixelRatio"],
    path,
  );
  if (!unknownResult.ok) return unknownResult;

  const width = readParsedField(record, "width", `${path}.width`, parsePositiveFiniteNumber);
  if (!width.ok) return width;
  const height = readParsedField(record, "height", `${path}.height`, parsePositiveFiniteNumber);
  if (!height.ok) return height;
  const scrollX = readParsedField(record, "scrollX", `${path}.scrollX`, parseNonNegativeFiniteNumber);
  if (!scrollX.ok) return scrollX;
  const scrollY = readParsedField(record, "scrollY", `${path}.scrollY`, parseNonNegativeFiniteNumber);
  if (!scrollY.ok) return scrollY;
  const devicePixelRatio = readParsedField(
    record,
    "devicePixelRatio",
    `${path}.devicePixelRatio`,
    parsePositiveFiniteNumber,
  );
  if (!devicePixelRatio.ok) return devicePixelRatio;

  return fieldOk({
    width: width.value,
    height: height.value,
    scrollX: scrollX.value,
    scrollY: scrollY.value,
    devicePixelRatio: devicePixelRatio.value,
  });
}

function parseSelectionAuthority(
  value: unknown,
  path: string,
): FieldResult<SelectionAuthority> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(record, ["level", "reasons", "decidedAt"], path);
  if (!unknownResult.ok) return unknownResult;

  const level = readParsedField(record, "level", `${path}.level`, parseSelectionAuthorityLevel);
  if (!level.ok) return level;
  const reasons = readParsedArrayField(
    record,
    "reasons",
    `${path}.reasons`,
    parseNonEmptyString,
  );
  if (!reasons.ok) return reasons;
  const decidedAt = readParsedField(
    record,
    "decidedAt",
    `${path}.decidedAt`,
    parseIsoDateTimeString,
  );
  if (!decidedAt.ok) return decidedAt;

  return fieldOk({ level: level.value, reasons: reasons.value, decidedAt: decidedAt.value });
}

function parseSourceCandidateConfidence(
  value: unknown,
  path: string,
): FieldResult<SourceCandidateConfidence> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(record, ["score", "band", "reasons"], path);
  if (!unknownResult.ok) return unknownResult;

  const score = readParsedField(record, "score", `${path}.score`, parseSourceCandidateScore);
  if (!score.ok) return score;
  const band = readLiteralField(record, "band", CONFIDENCE_BANDS, `${path}.band`);
  if (!band.ok) return band;
  const reasons = readParsedArrayField(
    record,
    "reasons",
    `${path}.reasons`,
    parseNonEmptyString,
  );
  if (!reasons.ok) return reasons;

  return fieldOk({ score: score.value, band: band.value, reasons: reasons.value });
}

export function parseSourceCandidateResult(
  value: unknown,
  path: string,
): FieldResult<SourceCandidateResult> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(
    record,
    ["candidateId", "path", "range", "fileHash", "confidence"],
    path,
  );
  if (!unknownResult.ok) return unknownResult;

  const candidateId = readParsedField(
    record,
    "candidateId",
    `${path}.candidateId`,
    parseCandidateId,
  );
  if (!candidateId.ok) return candidateId;
  const sourcePath = readParsedField(record, "path", `${path}.path`, parseRelativeFilePath);
  if (!sourcePath.ok) return sourcePath;
  const fileHash = readParsedField(record, "fileHash", `${path}.fileHash`, parseFileHash);
  if (!fileHash.ok) return fileHash;
  const confidence = readParsedField(
    record,
    "confidence",
    `${path}.confidence`,
    parseSourceCandidateConfidence,
  );
  if (!confidence.ok) return confidence;

  if (record.range === undefined) {
    return fieldOk({
      candidateId: candidateId.value,
      path: sourcePath.value,
      fileHash: fileHash.value,
      confidence: confidence.value,
    });
  }

  const range = parseSourceRange(record.range, `${path}.range`);
  if (!range.ok) return range;

  return fieldOk({
    candidateId: candidateId.value,
    path: sourcePath.value,
    range: range.value,
    fileHash: fileHash.value,
    confidence: confidence.value,
  });
}

function parseSelectedElementSnapshot(
  value: unknown,
  path: string,
): FieldResult<SelectedElementSnapshot> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const unknownResult = rejectUnknownFields(
    record,
    ["nodePath", "tagName", "selector", "rect", "attributes", "textContent", "outerHtml"],
    path,
  );
  if (!unknownResult.ok) return unknownResult;

  const nodePath = readParsedField(record, "nodePath", `${path}.nodePath`, parseDomNodePath);
  if (!nodePath.ok) return nodePath;
  const tagName = readParsedField(record, "tagName", `${path}.tagName`, parseNonEmptyString);
  if (!tagName.ok) return tagName;
  const selector = readNullableParsedField(
    record,
    "selector",
    `${path}.selector`,
    parseNonEmptyString,
  );
  if (!selector.ok) return selector;
  const rect = readParsedField(record, "rect", `${path}.rect`, parseDomRectSnapshot);
  if (!rect.ok) return rect;
  const attributes = readParsedField(record, "attributes", `${path}.attributes`, parseSafeElementAttributes);
  if (!attributes.ok) return attributes;
  const textContent = readParsedField(record, "textContent", `${path}.textContent`, parseSelectionTextContent);
  if (!textContent.ok) return textContent;
  const outerHtml = readParsedField(record, "outerHtml", `${path}.outerHtml`, parseSelectionOuterHtml);
  if (!outerHtml.ok) return outerHtml;

  return fieldOk({
    nodePath: nodePath.value,
    tagName: tagName.value,
    selector: selector.value,
    rect: rect.value,
    attributes: attributes.value,
    textContent: textContent.value,
    outerHtml: outerHtml.value,
  });
}

function parseSourceCandidateScore(value: unknown, path: string): FieldResult<number> {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    return fieldError(issue(path, "number from 0 to 100", value, "Expected a normalized 0..100 score."));
  }

  return fieldOk(value);
}

function parseSafeElementAttributes(value: unknown, path: string): FieldResult<Record<string, string>> {
  const objectResult = parseJsonObject(value, path);
  if (!objectResult.ok) return objectResult;

  const entries = Object.entries(objectResult.value);
  if (entries.length > MAX_SELECTION_ATTRIBUTE_COUNT) {
    return fieldError(
      issue(path, `at most ${MAX_SELECTION_ATTRIBUTE_COUNT} attributes`, value, "Selected element contains too many raw attributes."),
    );
  }

  const attributes: Record<string, string> = {};
  for (const [name, rawValue] of entries) {
    if (name.length > MAX_SELECTION_ATTRIBUTE_NAME_LENGTH) {
      return fieldError(
        issue(`${path}.${name}`, `attribute name up to ${MAX_SELECTION_ATTRIBUTE_NAME_LENGTH} characters`, name, "Element attribute name is too long."),
      );
    }
    if (!isAllowedElementAttribute(name)) {
      continue;
    }
    if (typeof rawValue !== "string") {
      return fieldError(issue(`${path}.${name}`, "string", rawValue, "Element attributes must be strings."));
    }
    if (rawValue.length > MAX_SELECTION_ATTRIBUTE_VALUE_LENGTH) {
      return fieldError(
        issue(`${path}.${name}`, `string up to ${MAX_SELECTION_ATTRIBUTE_VALUE_LENGTH} characters`, rawValue, "Element attribute value is too large."),
      );
    }
    const sanitized = sanitizeAttributeValue(name, rawValue);
    if (sanitized.value.length > 0) {
      attributes[name.toLowerCase()] = sanitized.value;
    }
  }

  return fieldOk(attributes);
}

function parseSelectionTextContent(value: unknown, path: string): FieldResult<string> {
  if (typeof value !== "string") {
    return fieldError(issue(path, "string", value, "Expected selected element text content."));
  }
  if (value.length > MAX_SELECTION_TEXT_CONTENT_LENGTH) {
    return fieldError(
      issue(path, `string up to ${MAX_SELECTION_TEXT_CONTENT_LENGTH} characters`, value, "Selected element text content is too large."),
    );
  }

  return fieldOk(sanitizeTextHint(value, path, MAX_SELECTION_TEXT_CONTENT_LENGTH).value);
}

function parseSelectionOuterHtml(value: unknown, path: string): FieldResult<string> {
  if (typeof value !== "string") {
    return fieldError(issue(path, "string", value, "Expected selected element outer HTML."));
  }
  if (value.length > MAX_SELECTION_OUTER_HTML_LENGTH) {
    return fieldError(
      issue(path, `string up to ${MAX_SELECTION_OUTER_HTML_LENGTH} characters`, value, "Selected element outer HTML is too large."),
    );
  }

  return fieldOk(sanitizeTextHint(value, path, MAX_SELECTION_OUTER_HTML_LENGTH).value);
}

export function parseVisibleSelection(
  value: unknown,
  path: string,
): FieldResult<VisibleSelection> {
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
      "previewFrameId",
      "capturedAt",
      "viewport",
      "element",
      "authority",
      "sourceCandidates",
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
  const id = readParsedField(record, "id", `${path}.id`, parseSelectionId);
  if (!id.ok) return id;
  const projectId = readParsedField(record, "projectId", `${path}.projectId`, parseProjectId);
  if (!projectId.ok) return projectId;
  const sessionId = readParsedField(record, "sessionId", `${path}.sessionId`, parseSessionId);
  if (!sessionId.ok) return sessionId;
  const previewFrameId = readParsedField(
    record,
    "previewFrameId",
    `${path}.previewFrameId`,
    parsePreviewFrameId,
  );
  if (!previewFrameId.ok) return previewFrameId;
  const capturedAt = readParsedField(
    record,
    "capturedAt",
    `${path}.capturedAt`,
    parseIsoDateTimeString,
  );
  if (!capturedAt.ok) return capturedAt;
  const viewport = readParsedField(record, "viewport", `${path}.viewport`, parseViewportSnapshot);
  if (!viewport.ok) return viewport;
  const element = readParsedField(
    record,
    "element",
    `${path}.element`,
    parseSelectedElementSnapshot,
  );
  if (!element.ok) return element;
  const authority = readParsedField(
    record,
    "authority",
    `${path}.authority`,
    parseSelectionAuthority,
  );
  if (!authority.ok) return authority;
  const sourceCandidates = readParsedArrayField(
    record,
    "sourceCandidates",
    `${path}.sourceCandidates`,
    parseSourceCandidateResult,
  );
  if (!sourceCandidates.ok) return sourceCandidates;
  const authorityCheck = validateVisibleSelectionAuthority(
    authority.value,
    sourceCandidates.value,
    path,
    value,
  );
  if (!authorityCheck.ok) return authorityCheck;

  return fieldOk({
    contractVersion: contractVersion.value,
    id: id.value,
    projectId: projectId.value,
    sessionId: sessionId.value,
    previewFrameId: previewFrameId.value,
    capturedAt: capturedAt.value,
    viewport: viewport.value,
    element: element.value,
    authority: authority.value,
    sourceCandidates: sourceCandidates.value,
  });
}

function validateVisibleSelectionAuthority(
  authority: SelectionAuthority,
  sourceCandidates: readonly SourceCandidateResult[],
  path: string,
  receivedValue: unknown,
): FieldResult<void> {
  if (authority.level === "patch_authoritative") {
    const hasHighCandidate = sourceCandidates.some(
      (candidate) => candidate.confidence.band === "high" && candidate.confidence.score >= 85,
    );
    if (!hasHighCandidate) {
      return fieldError(
        issue(
          `${path}.authority`,
          "patch_authoritative selection backed by a high-confidence source candidate",
          receivedValue,
          "Selection authority does not match its source candidates.",
        ),
      );
    }
  }

  if ((authority.level === "blocked" || authority.level === "stale") && authority.reasons.length === 0) {
    return fieldError(
      issue(
        `${path}.authority.reasons`,
        "non-empty reasons",
        receivedValue,
        "Blocked and stale selection authority must explain why patching is unsafe.",
      ),
    );
  }

  return fieldOk(undefined);
}

function parsePreviewFrame(value: unknown, path: string): FieldResult<PreviewFrame> {
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
      "url",
      "connectedAt",
      "lastNavigatedAt",
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
  const id = readParsedField(record, "id", `${path}.id`, parsePreviewFrameId);
  if (!id.ok) return id;
  const projectId = readParsedField(record, "projectId", `${path}.projectId`, parseProjectId);
  if (!projectId.ok) return projectId;
  const sessionId = readParsedField(record, "sessionId", `${path}.sessionId`, parseSessionId);
  if (!sessionId.ok) return sessionId;
  const url = readParsedField(record, "url", `${path}.url`, parseNonEmptyString);
  if (!url.ok) return url;
  const connectedAt = readParsedField(
    record,
    "connectedAt",
    `${path}.connectedAt`,
    parseIsoDateTimeString,
  );
  if (!connectedAt.ok) return connectedAt;
  const lastNavigatedAt = readNullableParsedField(
    record,
    "lastNavigatedAt",
    `${path}.lastNavigatedAt`,
    parseIsoDateTimeString,
  );
  if (!lastNavigatedAt.ok) return lastNavigatedAt;

  return fieldOk({
    contractVersion: contractVersion.value,
    id: id.value,
    projectId: projectId.value,
    sessionId: sessionId.value,
    url: url.value,
    connectedAt: connectedAt.value,
    lastNavigatedAt: lastNavigatedAt.value,
  });
}

export function parsePreviewBridgeEvent(
  value: unknown,
  path: string,
): FieldResult<PreviewBridgeEvent> {
  const recordResult = readRecord(value, path);
  if (!recordResult.ok) return recordResult;
  const record = recordResult.value;
  const kind = readLiteralField(
    record,
    "kind",
    [
      "preview_connected",
      "selection_changed",
      "source_candidates_resolved",
      "preview_disconnected",
    ] as const,
    `${path}.kind`,
  );
  if (!kind.ok) return kind;

  switch (kind.value) {
    case "preview_connected": {
      const unknownResult = rejectUnknownFields(record, ["kind", "frame"], path);
      if (!unknownResult.ok) return unknownResult;
      const frame = readParsedField(record, "frame", `${path}.frame`, parsePreviewFrame);
      if (!frame.ok) return frame;
      return fieldOk({ kind: kind.value, frame: frame.value });
    }
    case "selection_changed": {
      const unknownResult = rejectUnknownFields(record, ["kind", "selection"], path);
      if (!unknownResult.ok) return unknownResult;
      const selection = readParsedField(
        record,
        "selection",
        `${path}.selection`,
        parseVisibleSelection,
      );
      if (!selection.ok) return selection;
      return fieldOk({ kind: kind.value, selection: selection.value });
    }
    case "source_candidates_resolved": {
      const unknownResult = rejectUnknownFields(
        record,
        ["kind", "selectionId", "candidates", "authority"],
        path,
      );
      if (!unknownResult.ok) return unknownResult;
      const selectionId = readParsedField(
        record,
        "selectionId",
        `${path}.selectionId`,
        parseSelectionId,
      );
      if (!selectionId.ok) return selectionId;
      const candidates = readParsedArrayField(
        record,
        "candidates",
        `${path}.candidates`,
        parseSourceCandidateResult,
      );
      if (!candidates.ok) return candidates;
      const authority = readParsedField(
        record,
        "authority",
        `${path}.authority`,
        parseSelectionAuthority,
      );
      if (!authority.ok) return authority;
      return fieldOk({
        kind: kind.value,
        selectionId: selectionId.value,
        candidates: candidates.value,
        authority: authority.value,
      });
    }
    case "preview_disconnected": {
      const unknownResult = rejectUnknownFields(
        record,
        ["kind", "previewFrameId", "reason", "disconnectedAt"],
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
      const reason = readParsedField(record, "reason", `${path}.reason`, parseNonEmptyString);
      if (!reason.ok) return reason;
      const disconnectedAt = readParsedField(
        record,
        "disconnectedAt",
        `${path}.disconnectedAt`,
        parseIsoDateTimeString,
      );
      if (!disconnectedAt.ok) return disconnectedAt;
      return fieldOk({
        kind: kind.value,
        previewFrameId: previewFrameId.value,
        reason: reason.value,
        disconnectedAt: disconnectedAt.value,
      });
    }
  }
}

export function parseVisibleSelectionPayload(
  value: unknown,
  source: BoundarySource = BOUNDARY_SOURCE.PreviewBridge,
): ValidationResult<VisibleSelection> {
  return fromFieldResult(source, parseVisibleSelection(value, "$"));
}

export function parseSourceCandidateResultPayload(
  value: unknown,
  source: BoundarySource = BOUNDARY_SOURCE.SourceMapBridge,
): ValidationResult<SourceCandidateResult> {
  return fromFieldResult(source, parseSourceCandidateResult(value, "$"));
}

export function parsePreviewBridgeEventPayload(
  value: unknown,
  source: BoundarySource = BOUNDARY_SOURCE.PreviewBridge,
): ValidationResult<PreviewBridgeEvent> {
  return fromFieldResult(source, parsePreviewBridgeEvent(value, "$"));
}
