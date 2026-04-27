import type { AppError, SelectionId } from "../shared/types";
import type { ElementReferencePayload } from "./elementReference";
import type {
  BridgeIdentitySnapshot,
  BridgeSessionId,
  ElementBoundingBox,
  ElementDomPathSegment,
  PageNavigationId,
  PreviewSessionId,
  RouteFingerprint,
  ElementRoleHints,
  ElementVisibilitySnapshot,
  SelectorReliability,
} from "./elementReference";
import type { RedactedField, RedactionReason } from "./sanitization";

export const DOM_BRIDGE_PROTOCOL_VERSION = "quartz.domBridge.v1" as const;

export const DOM_BRIDGE_EVENT_TYPES = [
  "quartz.bridge.ready",
  "quartz.bridge.blocked",
  "quartz.preview.navigation",
  "quartz.element.hovered",
  "quartz.element.selected",
  "quartz.selection.revalidated",
] as const;

export type DomBridgeEventType = (typeof DOM_BRIDGE_EVENT_TYPES)[number];

const BRIDGE_ENVELOPE_FIELDS = [
  "protocol",
  "type",
  "eventId",
  "emittedAt",
  "projectId",
  "projectEpoch",
  "previewSessionId",
  "bridgeSessionId",
  "pageNavigationId",
  "routeFingerprint",
  "bridgeRevision",
  "payload",
] as const;

const BRIDGE_IDENTITY_FIELDS = [
  "projectId",
  "projectEpoch",
  "previewSessionId",
  "bridgeSessionId",
  "pageNavigationId",
  "routeFingerprint",
  "bridgeRevision",
] as const;

const MAX_BRIDGE_STRING_LENGTH = 4_096;
const MAX_BRIDGE_STRING_ARRAY_ITEMS = 64;
const MAX_DOM_PATH_SEGMENTS = 32;
const MAX_ROLE_HINT_LENGTH = 512;
const MAX_ELEMENT_ATTRIBUTE_COUNT = 64;
const MAX_ELEMENT_ATTRIBUTE_NAME_LENGTH = 80;
const MAX_ELEMENT_ATTRIBUTE_VALUE_LENGTH = 1_024;
const MAX_FRAME_PATH_SEGMENTS = 16;
const MAX_REDACTIONS = 32;
const MAX_REASONS = 16;

export type BridgeEventEnvelope = BridgeIdentitySnapshot &
  Readonly<{
    protocol: typeof DOM_BRIDGE_PROTOCOL_VERSION;
    type: DomBridgeEventType;
    eventId: string;
    emittedAt: string;
  }>;

export type BridgePointerSnapshot = Readonly<{
  clientX: number;
  clientY: number;
  button: number;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}>;

export type DomBridgeReadyEvent = BridgeEventEnvelope &
  Readonly<{
    type: "quartz.bridge.ready";
    payload: Readonly<{
      capabilities: readonly string[];
      bridgeBuildId: string;
    }>;
  }>;

export type DomBridgeBlockedEvent = BridgeEventEnvelope &
  Readonly<{
    type: "quartz.bridge.blocked";
    payload: Readonly<{
      reason: "cross_origin_frame" | "bridge_policy" | "redaction_policy" | "unsupported_document";
      message: string;
    }>;
  }>;

export type DomBridgeNavigationEvent = BridgeEventEnvelope &
  Readonly<{
    type: "quartz.preview.navigation";
    payload: Readonly<{
      pageNavigationId: PageNavigationId;
      routeFingerprint: RouteFingerprint;
      urlWithoutQuery: string;
    }>;
  }>;

export type DomBridgeElementHoveredEvent = BridgeEventEnvelope &
  Readonly<{
    type: "quartz.element.hovered";
    payload: Readonly<{
      element: ElementReferencePayload;
      pointer: BridgePointerSnapshot;
    }>;
  }>;

export type DomBridgeElementSelectedEvent = BridgeEventEnvelope &
  Readonly<{
    type: "quartz.element.selected";
    payload: Readonly<{
      selectionId: SelectionId;
      element: ElementReferencePayload;
      pointer: BridgePointerSnapshot;
      inputModality: "keyboard" | "mouse" | "pen" | "touch";
    }>;
  }>;

export type DomBridgeSelectionRevalidatedEvent = BridgeEventEnvelope &
  Readonly<{
    type: "quartz.selection.revalidated";
    payload: Readonly<{
      selectionId: SelectionId;
      element: ElementReferencePayload;
      valid: boolean;
      reasons: readonly string[];
    }>;
  }>;

export type DomBridgeEvent =
  | DomBridgeReadyEvent
  | DomBridgeBlockedEvent
  | DomBridgeNavigationEvent
  | DomBridgeElementHoveredEvent
  | DomBridgeElementSelectedEvent
  | DomBridgeSelectionRevalidatedEvent;

export type BridgeCommand =
  | Readonly<{ type: "quartz.preview.setMode"; mode: "interact" | "select" | "compare" | "paused" }>
  | Readonly<{ type: "quartz.preview.reload"; previewSessionId: PreviewSessionId }>
  | Readonly<{ type: "quartz.selection.clear"; selectionId?: SelectionId }>
  | Readonly<{ type: "quartz.selection.revalidate"; selectionId: SelectionId }>
  | Readonly<{ type: "quartz.bridge.ping"; bridgeSessionId: BridgeSessionId }>;

export type BridgeContractError = AppError &
  Readonly<{
    code:
      | "bridge_event_not_object"
      | "bridge_event_bad_protocol"
      | "bridge_event_bad_type"
      | "bridge_event_missing_field"
      | "bridge_event_bad_payload"
      | "bridge_event_identity_mismatch"
      | "bridge_event_unknown_field"
      | "bridge_event_unsafe_dom_size";
    field?: string;
  }>;

export type BridgeEventParseResult =
  | Readonly<{ ok: true; event: BridgeEventEnvelope & Readonly<{ payload: unknown }> }>
  | Readonly<{ ok: false; error: BridgeContractError }>;

type BridgeFieldResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; error: BridgeContractError }>;

export function isDomBridgeEventType(value: string): value is DomBridgeEventType {
  return DOM_BRIDGE_EVENT_TYPES.includes(value as DomBridgeEventType);
}

export function sanitizeBridgeEventEnvelope(message: unknown): BridgeEventParseResult {
  const record = asRecord(message);
  if (!record) {
    return { ok: false, error: bridgeContractError("bridge_event_not_object", "message") };
  }

  const unknownField = rejectUnknownFields(record, BRIDGE_ENVELOPE_FIELDS, "message");
  if (unknownField) {
    return { ok: false, error: unknownField };
  }

  const protocol = readString(record, "protocol");
  if (protocol !== DOM_BRIDGE_PROTOCOL_VERSION) {
    return { ok: false, error: bridgeContractError("bridge_event_bad_protocol", "protocol") };
  }

  const type = readString(record, "type");
  if (!type || !isDomBridgeEventType(type)) {
    return { ok: false, error: bridgeContractError("bridge_event_bad_type", "type") };
  }

  const envelope = readBridgeEnvelope(record, type);
  if (!envelope.ok) {
    return envelope;
  }

  const payload = readBridgePayload(record.payload, type, envelope.event);
  if (!payload.ok) {
    return payload;
  }

  return { ok: true, event: { ...envelope.event, payload: payload.payload } };
}

function readBridgeEnvelope(
  record: Readonly<Record<string, unknown>>,
  type: DomBridgeEventType,
): BridgeEventParseResult {
  const requiredStrings = [
    "eventId",
    "emittedAt",
    "projectId",
    "projectEpoch",
    "previewSessionId",
    "bridgeSessionId",
    "pageNavigationId",
    "routeFingerprint",
  ] as const;

  for (const field of requiredStrings) {
    if (!readString(record, field)) {
      return { ok: false, error: bridgeContractError("bridge_event_missing_field", field) };
    }
  }

  const bridgeRevision = readNonNegativeInteger(record, "bridgeRevision");
  if (bridgeRevision === undefined) {
    return { ok: false, error: bridgeContractError("bridge_event_missing_field", "bridgeRevision") };
  }

  return {
    ok: true,
    event: {
      protocol: DOM_BRIDGE_PROTOCOL_VERSION,
      type,
      eventId: readString(record, "eventId"),
      emittedAt: readString(record, "emittedAt"),
      projectId: readString(record, "projectId"),
      projectEpoch: readString(record, "projectEpoch"),
      previewSessionId: readString(record, "previewSessionId"),
      bridgeSessionId: readString(record, "bridgeSessionId"),
      pageNavigationId: readString(record, "pageNavigationId"),
      routeFingerprint: readString(record, "routeFingerprint"),
      bridgeRevision,
      payload: record.payload,
    },
  };
}

type BridgePayloadParseResult =
  | Readonly<{ ok: true; payload: unknown }>
  | Readonly<{ ok: false; error: BridgeContractError }>;

function readBridgePayload(
  payload: unknown,
  type: DomBridgeEventType,
  envelope: BridgeEventEnvelope & Readonly<{ payload: unknown }>,
): BridgePayloadParseResult {
  const record = asRecord(payload);
  if (!record) {
    return { ok: false, error: bridgeContractError("bridge_event_bad_payload", "payload") };
  }

  switch (type) {
    case "quartz.bridge.ready":
      return readReadyPayload(record);
    case "quartz.bridge.blocked":
      return readBlockedPayload(record);
    case "quartz.preview.navigation":
      return readNavigationPayload(record, envelope);
    case "quartz.element.hovered":
      return readElementPointerPayload(record, envelope, false);
    case "quartz.element.selected":
      return readElementPointerPayload(record, envelope, true);
    case "quartz.selection.revalidated":
      return readSelectionRevalidatedPayload(record, envelope);
  }
}

function readReadyPayload(record: Readonly<Record<string, unknown>>): BridgePayloadParseResult {
  const unknownField = rejectUnknownFields(record, ["capabilities", "bridgeBuildId"], "payload");
  if (unknownField) {
    return { ok: false, error: unknownField };
  }

  const capabilities = readStringArray(record, "capabilities", MAX_BRIDGE_STRING_ARRAY_ITEMS);
  const bridgeBuildId = readString(record, "bridgeBuildId");
  if (!capabilities || !bridgeBuildId) {
    return { ok: false, error: bridgeContractError("bridge_event_bad_payload", "payload") };
  }

  return { ok: true, payload: { capabilities, bridgeBuildId } };
}

function readBlockedPayload(record: Readonly<Record<string, unknown>>): BridgePayloadParseResult {
  const unknownField = rejectUnknownFields(record, ["reason", "message"], "payload");
  if (unknownField) {
    return { ok: false, error: unknownField };
  }

  const reason = readString(record, "reason");
  const message = readString(record, "message");
  const allowedReasons = new Set([
    "cross_origin_frame",
    "bridge_policy",
    "redaction_policy",
    "unsupported_document",
  ]);
  if (!allowedReasons.has(reason) || !message) {
    return { ok: false, error: bridgeContractError("bridge_event_bad_payload", "payload") };
  }

  return { ok: true, payload: { reason, message } };
}

function readNavigationPayload(
  record: Readonly<Record<string, unknown>>,
  envelope: BridgeEventEnvelope,
): BridgePayloadParseResult {
  const unknownField = rejectUnknownFields(
    record,
    ["pageNavigationId", "routeFingerprint", "urlWithoutQuery"],
    "payload",
  );
  if (unknownField) {
    return { ok: false, error: unknownField };
  }

  const pageNavigationId = readString(record, "pageNavigationId");
  const routeFingerprint = readString(record, "routeFingerprint");
  const urlWithoutQuery = readString(record, "urlWithoutQuery");
  if (!pageNavigationId || !routeFingerprint || !urlWithoutQuery) {
    return { ok: false, error: bridgeContractError("bridge_event_bad_payload", "payload") };
  }
  if (
    pageNavigationId !== envelope.pageNavigationId ||
    routeFingerprint !== envelope.routeFingerprint
  ) {
    return { ok: false, error: bridgeContractError("bridge_event_identity_mismatch", "payload") };
  }

  return { ok: true, payload: { pageNavigationId, routeFingerprint, urlWithoutQuery } };
}

function readElementPointerPayload(
  record: Readonly<Record<string, unknown>>,
  envelope: BridgeEventEnvelope,
  requireSelection: boolean,
): BridgePayloadParseResult {
  const allowedFields = requireSelection
    ? ["selectionId", "element", "pointer", "inputModality"] as const
    : ["element", "pointer"] as const;
  const unknownField = rejectUnknownFields(record, allowedFields, "payload");
  if (unknownField) {
    return { ok: false, error: unknownField };
  }

  const element = readElementReferencePayload(record.element, envelope);
  if (!element.ok) return { ok: false, error: element.error };
  const pointer = readPointerSnapshot(record.pointer);
  const selectionId = requireSelection ? readString(record, "selectionId") : undefined;
  const inputModality = requireSelection ? readString(record, "inputModality") : undefined;
  const validInputModalities = new Set(["keyboard", "mouse", "pen", "touch"]);

  if (!pointer || (requireSelection && (!selectionId || !validInputModalities.has(inputModality ?? "")))) {
    return { ok: false, error: bridgeContractError("bridge_event_bad_payload", "payload") };
  }

  return {
    ok: true,
    payload: requireSelection
      ? { selectionId, element: element.value, pointer, inputModality }
      : { element: element.value, pointer },
  };
}

function readSelectionRevalidatedPayload(
  record: Readonly<Record<string, unknown>>,
  envelope: BridgeEventEnvelope,
): BridgePayloadParseResult {
  const unknownField = rejectUnknownFields(
    record,
    ["selectionId", "element", "valid", "reasons"],
    "payload",
  );
  if (unknownField) {
    return { ok: false, error: unknownField };
  }

  const selectionId = readString(record, "selectionId");
  const element = readElementReferencePayload(record.element, envelope);
  if (!element.ok) return { ok: false, error: element.error };
  const valid = typeof record.valid === "boolean" ? record.valid : undefined;
  const reasons = readStringArray(record, "reasons", MAX_REASONS);

  if (!selectionId || valid === undefined || !reasons) {
    return { ok: false, error: bridgeContractError("bridge_event_bad_payload", "payload") };
  }

  return { ok: true, payload: { selectionId, element: element.value, valid, reasons } };
}

function readElementReferencePayload(
  value: unknown,
  expectedIdentity: BridgeIdentitySnapshot,
): BridgeFieldResult<ElementReferencePayload> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, error: bridgeContractError("bridge_event_bad_payload", "payload.element") };
  }

  const unknownField = rejectUnknownFields(
    record,
    [
      ...BRIDGE_IDENTITY_FIELDS,
      "referenceKind",
      "elementReferenceId",
      "capturedAt",
      "stableSelector",
      "selectorReliability",
      "domPath",
      "roleHints",
      "boundingBox",
      "attributes",
      "redactions",
      "visibility",
      "frame",
    ],
    "payload.element",
  );
  if (unknownField) {
    return { ok: false, error: unknownField };
  }

  const requiredStrings = [
    "elementReferenceId",
    "capturedAt",
    "stableSelector",
    "projectId",
    "projectEpoch",
    "previewSessionId",
    "bridgeSessionId",
    "pageNavigationId",
    "routeFingerprint",
  ] as const;
  if (requiredStrings.some((field) => !readString(record, field))) {
    return { ok: false, error: bridgeContractError("bridge_event_missing_field", "payload.element") };
  }
  if (record.referenceKind !== "dom_element") {
    return { ok: false, error: bridgeContractError("bridge_event_bad_payload", "payload.element.referenceKind") };
  }
  const bridgeRevision = readNonNegativeInteger(record, "bridgeRevision");
  if (bridgeRevision === undefined) {
    return { ok: false, error: bridgeContractError("bridge_event_missing_field", "payload.element.bridgeRevision") };
  }
  if (!isBridgeIdentityMatch(record, expectedIdentity)) {
    return { ok: false, error: bridgeContractError("bridge_event_identity_mismatch", "payload.element") };
  }

  const selectorReliability = readSelectorReliability(record, "selectorReliability");
  if (!selectorReliability) {
    return { ok: false, error: bridgeContractError("bridge_event_bad_payload", "payload.element.selectorReliability") };
  }

  const domPath = readDomPath(record.domPath, "payload.element.domPath");
  if (!domPath.ok) return domPath;
  const roleHints = readRoleHints(record.roleHints, "payload.element.roleHints");
  if (!roleHints.ok) return roleHints;
  const boundingBox = readBoundingBox(record.boundingBox, "payload.element.boundingBox");
  if (!boundingBox.ok) return boundingBox;
  const attributes = readStringRecord(
    record.attributes,
    "payload.element.attributes",
    MAX_ELEMENT_ATTRIBUTE_COUNT,
    MAX_ELEMENT_ATTRIBUTE_NAME_LENGTH,
    MAX_ELEMENT_ATTRIBUTE_VALUE_LENGTH,
  );
  if (!attributes.ok) return attributes;
  const redactions = readRedactions(record.redactions, "payload.element.redactions");
  if (!redactions.ok) return redactions;
  const visibility = readVisibility(record.visibility, "payload.element.visibility");
  if (!visibility.ok) return visibility;
  const frame = readFrame(record.frame, "payload.element.frame");
  if (!frame.ok) return frame;

  return {
    ok: true,
    value: {
      referenceKind: "dom_element",
      elementReferenceId: readString(record, "elementReferenceId"),
      capturedAt: readString(record, "capturedAt"),
      stableSelector: readString(record, "stableSelector"),
      selectorReliability,
      projectId: readString(record, "projectId"),
      projectEpoch: readString(record, "projectEpoch"),
      previewSessionId: readString(record, "previewSessionId"),
      bridgeSessionId: readString(record, "bridgeSessionId"),
      pageNavigationId: readString(record, "pageNavigationId"),
      routeFingerprint: readString(record, "routeFingerprint"),
      bridgeRevision,
      domPath: domPath.value,
      roleHints: roleHints.value,
      boundingBox: boundingBox.value,
      attributes: attributes.value,
      redactions: redactions.value,
      visibility: visibility.value,
      frame: frame.value,
    },
  };
}

function isBridgeIdentityMatch(
  record: Readonly<Record<string, unknown>>,
  expected: BridgeIdentitySnapshot,
): boolean {
  return (
    record.projectId === expected.projectId &&
    record.projectEpoch === expected.projectEpoch &&
    record.previewSessionId === expected.previewSessionId &&
    record.bridgeSessionId === expected.bridgeSessionId &&
    record.pageNavigationId === expected.pageNavigationId &&
    record.routeFingerprint === expected.routeFingerprint &&
    record.bridgeRevision === expected.bridgeRevision
  );
}

function readSelectorReliability(
  record: Readonly<Record<string, unknown>>,
  field: string,
): SelectorReliability | undefined {
  const value = readString(record, field);
  if (value === "instrumented" || value === "semantic" || value === "structural") {
    return value;
  }
  return undefined;
}

function readDomPath(value: unknown, path: string): BridgeFieldResult<readonly ElementDomPathSegment[]> {
  const values = readArray(value, path, MAX_DOM_PATH_SEGMENTS);
  if (!values.ok) return values;
  if (values.value.length === 0) {
    return { ok: false, error: bridgeContractError("bridge_event_bad_payload", path) };
  }

  const segments: ElementDomPathSegment[] = [];
  for (let index = 0; index < values.value.length; index += 1) {
    const segmentPath = `${path}[${index}]`;
    const record = asRecord(values.value[index]);
    if (!record) {
      return { ok: false, error: bridgeContractError("bridge_event_bad_payload", segmentPath) };
    }
    const unknownField = rejectUnknownFields(
      record,
      ["tagName", "childIndex", "sameTagIndex", "selectorSegment", "role", "testId", "sourceFile"],
      segmentPath,
    );
    if (unknownField) return { ok: false, error: unknownField };

    const tagName = readString(record, "tagName", 80);
    const childIndex = readPositiveInteger(record, "childIndex");
    const sameTagIndex = readPositiveInteger(record, "sameTagIndex");
    const selectorSegment = readString(record, "selectorSegment", MAX_BRIDGE_STRING_LENGTH);
    if (!tagName || childIndex === undefined || sameTagIndex === undefined || !selectorSegment) {
      return { ok: false, error: bridgeContractError("bridge_event_bad_payload", segmentPath) };
    }

    const role = readOptionalString(record, "role", 80);
    if (!role.ok) return role;
    const testId = readOptionalString(record, "testId", 256);
    if (!testId.ok) return testId;
    const sourceFile = readOptionalString(record, "sourceFile", MAX_BRIDGE_STRING_LENGTH);
    if (!sourceFile.ok) return sourceFile;

    segments.push({
      tagName,
      childIndex,
      sameTagIndex,
      selectorSegment,
      ...(role.value === undefined ? {} : { role: role.value }),
      ...(testId.value === undefined ? {} : { testId: testId.value }),
      ...(sourceFile.value === undefined ? {} : { sourceFile: sourceFile.value }),
    });
  }

  return { ok: true, value: segments };
}

function readRoleHints(value: unknown, path: string): BridgeFieldResult<ElementRoleHints> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, error: bridgeContractError("bridge_event_bad_payload", path) };
  }
  const unknownField = rejectUnknownFields(
    record,
    ["role", "accessibleName", "text", "labelText"],
    path,
  );
  if (unknownField) return { ok: false, error: unknownField };

  if (
    typeof record.role !== "string" ||
    typeof record.accessibleName !== "string" ||
    typeof record.text !== "string" ||
    typeof record.labelText !== "string" ||
    record.role.length > MAX_ROLE_HINT_LENGTH ||
    record.accessibleName.length > MAX_ROLE_HINT_LENGTH ||
    record.text.length > MAX_ROLE_HINT_LENGTH ||
    record.labelText.length > MAX_ROLE_HINT_LENGTH
  ) {
    return { ok: false, error: bridgeContractError("bridge_event_unsafe_dom_size", path) };
  }

  return {
    ok: true,
    value: {
      role: record.role,
      accessibleName: record.accessibleName,
      text: record.text,
      labelText: record.labelText,
    },
  };
}

function readBoundingBox(value: unknown, path: string): BridgeFieldResult<ElementBoundingBox> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, error: bridgeContractError("bridge_event_bad_payload", path) };
  }
  const unknownField = rejectUnknownFields(
    record,
    [
      "x",
      "y",
      "width",
      "height",
      "top",
      "right",
      "bottom",
      "left",
      "scrollX",
      "scrollY",
      "viewportWidth",
      "viewportHeight",
    ],
    path,
  );
  if (unknownField) return { ok: false, error: unknownField };

  const box = {
    x: readFiniteNumber(record, "x"),
    y: readFiniteNumber(record, "y"),
    width: readFiniteNumber(record, "width"),
    height: readFiniteNumber(record, "height"),
    top: readFiniteNumber(record, "top"),
    right: readFiniteNumber(record, "right"),
    bottom: readFiniteNumber(record, "bottom"),
    left: readFiniteNumber(record, "left"),
    scrollX: readFiniteNumber(record, "scrollX"),
    scrollY: readFiniteNumber(record, "scrollY"),
    viewportWidth: readFiniteNumber(record, "viewportWidth"),
    viewportHeight: readFiniteNumber(record, "viewportHeight"),
  };

  if (Object.values(box).some((entry) => entry === undefined)) {
    return { ok: false, error: bridgeContractError("bridge_event_bad_payload", path) };
  }

  const boundingBox = box as ElementBoundingBox;
  if (
    boundingBox.width < 0 ||
    boundingBox.height < 0 ||
    boundingBox.right < boundingBox.left ||
    boundingBox.bottom < boundingBox.top ||
    boundingBox.viewportWidth <= 0 ||
    boundingBox.viewportHeight <= 0
  ) {
    return { ok: false, error: bridgeContractError("bridge_event_bad_payload", path) };
  }

  return { ok: true, value: boundingBox };
}

function readRedactions(value: unknown, path: string): BridgeFieldResult<readonly RedactedField[]> {
  const values = readArray(value, path, MAX_REDACTIONS);
  if (!values.ok) return values;

  const redactions: RedactedField[] = [];
  for (let index = 0; index < values.value.length; index += 1) {
    const redactionPath = `${path}[${index}]`;
    const record = asRecord(values.value[index]);
    if (!record) {
      return { ok: false, error: bridgeContractError("bridge_event_bad_payload", redactionPath) };
    }
    const unknownField = rejectUnknownFields(
      record,
      ["field", "originalLength", "reason"],
      redactionPath,
    );
    if (unknownField) return { ok: false, error: unknownField };

    const field = readString(record, "field", MAX_BRIDGE_STRING_LENGTH);
    const originalLength = readPositiveInteger(record, "originalLength");
    const reason = readRedactionReason(record, "reason");
    if (!field || originalLength === undefined || !reason) {
      return { ok: false, error: bridgeContractError("bridge_event_bad_payload", redactionPath) };
    }
    redactions.push({ field, originalLength, reason });
  }

  return { ok: true, value: redactions };
}

function readVisibility(value: unknown, path: string): BridgeFieldResult<ElementVisibilitySnapshot> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, error: bridgeContractError("bridge_event_bad_payload", path) };
  }
  const unknownField = rejectUnknownFields(record, ["visible", "reasons"], path);
  if (unknownField) return { ok: false, error: unknownField };

  const visible = readBoolean(record, "visible");
  const reasons = readStringArray(record, "reasons", MAX_REASONS);
  if (visible === undefined || !reasons) {
    return { ok: false, error: bridgeContractError("bridge_event_bad_payload", path) };
  }

  return { ok: true, value: { visible, reasons } };
}

function readFrame(
  value: unknown,
  path: string,
): BridgeFieldResult<ElementReferencePayload["frame"]> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, error: bridgeContractError("bridge_event_bad_payload", path) };
  }
  const unknownField = rejectUnknownFields(record, ["sameOrigin", "framePath"], path);
  if (unknownField) return { ok: false, error: unknownField };

  const sameOrigin = readBoolean(record, "sameOrigin");
  const framePath = readStringArray(record, "framePath", MAX_FRAME_PATH_SEGMENTS);
  if (sameOrigin === undefined || !framePath) {
    return { ok: false, error: bridgeContractError("bridge_event_bad_payload", path) };
  }

  return { ok: true, value: { sameOrigin, framePath } };
}

function readRedactionReason(
  record: Readonly<Record<string, unknown>>,
  field: string,
): RedactionReason | undefined {
  const value = readString(record, field);
  if (
    value === "email" ||
    value === "high_entropy" ||
    value === "long_numeric" ||
    value === "secret" ||
    value === "too_long" ||
    value === "url_query"
  ) {
    return value;
  }
  return undefined;
}

function readPointerSnapshot(value: unknown): BridgePointerSnapshot | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  if (
    rejectUnknownFields(
      record,
      ["clientX", "clientY", "button", "altKey", "ctrlKey", "metaKey", "shiftKey"],
      "payload.pointer",
    )
  ) {
    return undefined;
  }

  const clientX = readFiniteNumber(record, "clientX");
  const clientY = readFiniteNumber(record, "clientY");
  const button = readNonNegativeInteger(record, "button");
  if (clientX === undefined || clientY === undefined || button === undefined) {
    return undefined;
  }

  const altKey = readBoolean(record, "altKey");
  const ctrlKey = readBoolean(record, "ctrlKey");
  const metaKey = readBoolean(record, "metaKey");
  const shiftKey = readBoolean(record, "shiftKey");
  if (
    altKey === undefined ||
    ctrlKey === undefined ||
    metaKey === undefined ||
    shiftKey === undefined
  ) {
    return undefined;
  }

  return {
    clientX,
    clientY,
    button,
    altKey,
    ctrlKey,
    metaKey,
    shiftKey,
  };
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Readonly<Record<string, unknown>>;
}

function rejectUnknownFields(
  record: Readonly<Record<string, unknown>>,
  allowedFields: readonly string[],
  path: string,
): BridgeContractError | undefined {
  for (const key of Object.keys(record)) {
    if (!allowedFields.includes(key)) {
      return bridgeContractError("bridge_event_unknown_field", `${path}.${key}`);
    }
  }
  return undefined;
}

function readString(
  record: Readonly<Record<string, unknown>>,
  field: string,
  maxLength = MAX_BRIDGE_STRING_LENGTH,
): string {
  const value = record[field];
  return typeof value === "string" && value.length <= maxLength ? value : "";
}

function readOptionalString(
  record: Readonly<Record<string, unknown>>,
  field: string,
  maxLength = MAX_BRIDGE_STRING_LENGTH,
): BridgeFieldResult<string | undefined> {
  if (!(field in record)) {
    return { ok: true, value: undefined };
  }
  const value = record[field];
  if (typeof value !== "string" || value.length > maxLength) {
    return { ok: false, error: bridgeContractError("bridge_event_unsafe_dom_size", field) };
  }
  return { ok: true, value };
}

function readNonNegativeInteger(
  record: Readonly<Record<string, unknown>>,
  field: string,
): number | undefined {
  const value = record[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return undefined;
  }
  return value;
}

function readPositiveInteger(
  record: Readonly<Record<string, unknown>>,
  field: string,
): number | undefined {
  const value = record[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function readFiniteNumber(
  record: Readonly<Record<string, unknown>>,
  field: string,
): number | undefined {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function readBoolean(
  record: Readonly<Record<string, unknown>>,
  field: string,
): boolean | undefined {
  const value = record[field];
  return typeof value === "boolean" ? value : undefined;
}

function readStringArray(
  record: Readonly<Record<string, unknown>>,
  field: string,
  maxItems = MAX_BRIDGE_STRING_ARRAY_ITEMS,
): readonly string[] | undefined {
  const value = record[field];
  if (
    !Array.isArray(value) ||
    value.length > maxItems ||
    value.some((item) => typeof item !== "string" || item.length > MAX_BRIDGE_STRING_LENGTH)
  ) {
    return undefined;
  }
  return value;
}

function readArray(
  value: unknown,
  path: string,
  maxItems: number,
): BridgeFieldResult<readonly unknown[]> {
  if (!Array.isArray(value)) {
    return { ok: false, error: bridgeContractError("bridge_event_bad_payload", path) };
  }
  if (value.length > maxItems) {
    return { ok: false, error: bridgeContractError("bridge_event_unsafe_dom_size", path) };
  }
  return { ok: true, value };
}

function readStringRecord(
  value: unknown,
  path: string,
  maxEntries: number,
  maxKeyLength: number,
  maxValueLength: number,
): BridgeFieldResult<Readonly<Record<string, string>>> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, error: bridgeContractError("bridge_event_bad_payload", path) };
  }

  const entries = Object.entries(record);
  if (entries.length > maxEntries) {
    return { ok: false, error: bridgeContractError("bridge_event_unsafe_dom_size", path) };
  }

  const strings: Record<string, string> = {};
  for (const [key, entryValue] of entries) {
    if (
      key.length > maxKeyLength ||
      typeof entryValue !== "string" ||
      entryValue.length > maxValueLength
    ) {
      return { ok: false, error: bridgeContractError("bridge_event_unsafe_dom_size", `${path}.${key}`) };
    }
    strings[key] = entryValue;
  }

  return { ok: true, value: strings };
}

function bridgeContractError(
  code: BridgeContractError["code"],
  field: string,
): BridgeContractError {
  return {
    code,
    field,
    message: `Invalid DOM bridge event field: ${field}`,
    recoverable: true,
  };
}
