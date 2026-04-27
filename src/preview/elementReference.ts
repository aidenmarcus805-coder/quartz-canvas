import type { ProjectEpoch, ProjectId } from "../shared/types";
import {
  sanitizeAttributeList,
  sanitizeTextHint,
  type RedactedField,
} from "./sanitization";

export type PreviewSessionId = string;
export type BridgeSessionId = string;
export type PageNavigationId = string;
export type RouteFingerprint = string;

export type BridgeIdentitySnapshot = Readonly<{
  projectId: ProjectId;
  projectEpoch: ProjectEpoch;
  previewSessionId: PreviewSessionId;
  bridgeSessionId: BridgeSessionId;
  pageNavigationId: PageNavigationId;
  routeFingerprint: RouteFingerprint;
  bridgeRevision: number;
}>;

export type ElementBoundingBox = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
  scrollX: number;
  scrollY: number;
  viewportWidth: number;
  viewportHeight: number;
}>;

export type ElementDomPathSegment = Readonly<{
  tagName: string;
  childIndex: number;
  sameTagIndex: number;
  selectorSegment: string;
  role?: string;
  testId?: string;
  sourceFile?: string;
}>;

export type ElementRoleHints = Readonly<{
  role: string;
  accessibleName: string;
  text: string;
  labelText: string;
}>;

export type ElementVisibilitySnapshot = Readonly<{
  visible: boolean;
  reasons: readonly string[];
}>;

export type SelectorReliability = "instrumented" | "semantic" | "structural";

export type ElementReferencePayload = BridgeIdentitySnapshot &
  Readonly<{
    referenceKind: "dom_element";
    elementReferenceId: string;
    capturedAt: string;
    stableSelector: string;
    selectorReliability: SelectorReliability;
    domPath: readonly ElementDomPathSegment[];
    roleHints: ElementRoleHints;
    boundingBox: ElementBoundingBox;
    attributes: Readonly<Record<string, string>>;
    redactions: readonly RedactedField[];
    visibility: ElementVisibilitySnapshot;
    frame: Readonly<{
      sameOrigin: boolean;
      framePath: readonly string[];
    }>;
  }>;

export type ElementReferenceBuildInput = Readonly<{
  element: Element;
  identity: BridgeIdentitySnapshot;
  capturedAt?: string;
  maxDomDepth?: number;
  maxTextHintLength?: number;
  framePath?: readonly string[];
  sameOriginFrame?: boolean;
}>;

export type StableSelectorResult = Readonly<{
  selector: string;
  reliability: SelectorReliability;
}>;

const INSTRUMENTATION_ATTRIBUTES = [
  "data-source-id",
  "data-testid",
  "data-test",
  "data-qa",
  "data-quartz-id",
  "data-component",
  "data-component-name",
] as const;

export function buildElementReferencePayload(
  input: ElementReferenceBuildInput,
): ElementReferencePayload {
  const maxDomDepth = input.maxDomDepth ?? 12;
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const attributes = sanitizeAttributeList(Array.from(input.element.attributes));
  const selector = buildStableSelector(input.element, maxDomDepth);
  const roleHints = readRoleHints(input.element, input.maxTextHintLength ?? 160);
  const redactions = [...attributes.redactions, ...roleHints.redactions];
  const domPath = buildDomPath(input.element, maxDomDepth);

  return {
    ...input.identity,
    referenceKind: "dom_element",
    elementReferenceId: createElementReferenceId(input.identity, selector.selector, domPath),
    capturedAt,
    stableSelector: selector.selector,
    selectorReliability: selector.reliability,
    domPath,
    roleHints: roleHints.hints,
    boundingBox: readBoundingBox(input.element),
    attributes: attributes.attributes,
    redactions,
    visibility: readVisibility(input.element),
    frame: {
      sameOrigin: input.sameOriginFrame ?? true,
      framePath: input.framePath ?? [],
    },
  };
}

export function buildStableSelector(element: Element, maxDepth = 12): StableSelectorResult {
  const documentRef = element.ownerDocument;
  const selectorSegments: string[] = [];
  let current: Element | null = element;
  let strongestReliability: SelectorReliability = "structural";

  for (let depth = 0; current && depth < maxDepth; depth += 1) {
    const segment = buildSelectorSegment(current);
    selectorSegments.unshift(segment.selector);
    strongestReliability = strongestSelectorReliability(strongestReliability, segment.reliability);

    const selector = selectorSegments.join(" > ");
    if (isUniqueSelector(documentRef, selector)) {
      return { selector, reliability: strongestReliability };
    }

    current = current.parentElement;
  }

  return { selector: selectorSegments.join(" > "), reliability: strongestReliability };
}

export function createElementReferenceId(
  identity: BridgeIdentitySnapshot,
  selector: string,
  domPath: readonly ElementDomPathSegment[],
): string {
  const pathFingerprint = domPath.map((segment) => segment.selectorSegment).join("/");
  return `el_${stableHash([
    identity.bridgeSessionId,
    identity.pageNavigationId,
    identity.routeFingerprint,
    selector,
    pathFingerprint,
  ].join("|"))}`;
}

function buildDomPath(element: Element, maxDepth: number): readonly ElementDomPathSegment[] {
  const segments: ElementDomPathSegment[] = [];
  let current: Element | null = element;

  for (let depth = 0; current && depth < maxDepth; depth += 1) {
    segments.unshift(readDomPathSegment(current));
    current = current.parentElement;
  }

  return segments;
}

function readDomPathSegment(element: Element): ElementDomPathSegment {
  const attributes = sanitizeAttributeList(Array.from(element.attributes)).attributes;
  const role = readRole(element);

  return {
    tagName: element.tagName.toLowerCase(),
    childIndex: readChildIndex(element),
    sameTagIndex: readSameTagIndex(element),
    selectorSegment: buildSelectorSegment(element).selector,
    role: role.length > 0 ? role : undefined,
    testId: attributes["data-testid"] ?? attributes["data-test"] ?? attributes["data-qa"],
    sourceFile: attributes["data-source-file"],
  };
}

function buildSelectorSegment(element: Element): StableSelectorResult {
  const tagName = element.tagName.toLowerCase();
  const attributes = sanitizeAttributeList(Array.from(element.attributes)).attributes;

  for (const attributeName of INSTRUMENTATION_ATTRIBUTES) {
    const attributeValue = attributes[attributeName];
    if (attributeValue) {
      return {
        selector: `${tagName}[${attributeName}="${escapeCssAttribute(attributeValue)}"]`,
        reliability: "instrumented",
      };
    }
  }

  const role = readRole(element);
  if (role.length > 0) {
    return {
      selector: `${tagName}[role="${escapeCssAttribute(role)}"]:nth-of-type(${readSameTagIndex(element)})`,
      reliability: "semantic",
    };
  }

  return {
    selector: `${tagName}:nth-of-type(${readSameTagIndex(element)})`,
    reliability: "structural",
  };
}

function readRoleHints(
  element: Element,
  maxTextHintLength: number,
): Readonly<{ hints: ElementRoleHints; redactions: readonly RedactedField[] }> {
  const role = sanitizeTextHint(readRole(element), "role", 80);
  const accessibleName = sanitizeTextHint(readAccessibleName(element), "accessibleName", maxTextHintLength);
  const text = sanitizeTextHint(element.textContent ?? "", "text", maxTextHintLength);
  const labelText = sanitizeTextHint(readLabelText(element), "labelText", maxTextHintLength);

  return {
    hints: {
      role: role.value,
      accessibleName: accessibleName.value,
      text: text.value,
      labelText: labelText.value,
    },
    redactions: [
      ...role.redactions,
      ...accessibleName.redactions,
      ...text.redactions,
      ...labelText.redactions,
    ],
  };
}

function readRole(element: Element): string {
  const explicitRole = element.getAttribute("role");
  if (explicitRole) {
    return explicitRole;
  }

  const tagName = element.tagName.toLowerCase();
  if (tagName === "button") return "button";
  if (tagName === "a" && element.hasAttribute("href")) return "link";
  if (tagName === "img") return "img";
  if (tagName === "nav") return "navigation";
  if (tagName === "main") return "main";
  if (tagName === "form") return "form";
  if (tagName === "header") return "banner";
  if (tagName === "footer") return "contentinfo";
  if (tagName === "textarea") return "textbox";
  if (tagName === "select") return "combobox";
  if (tagName === "input") return readInputRole(element);

  return "";
}

function readInputRole(element: Element): string {
  const inputType = (element.getAttribute("type") ?? "text").toLowerCase();
  if (inputType === "checkbox") return "checkbox";
  if (inputType === "radio") return "radio";
  if (inputType === "range") return "slider";
  if (inputType === "submit" || inputType === "button" || inputType === "reset") return "button";
  return "textbox";
}

function readAccessibleName(element: Element): string {
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel;

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    return labelledBy
      .split(/\s+/)
      .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? "")
      .join(" ");
  }

  return (
    element.getAttribute("alt") ??
    element.getAttribute("title") ??
    element.getAttribute("placeholder") ??
    element.textContent ??
    ""
  );
}

function readLabelText(element: Element): string {
  const id = element.getAttribute("id");
  if (id) {
    const label = element.ownerDocument.querySelector(`label[for="${escapeCssAttribute(id)}"]`);
    if (label?.textContent) {
      return label.textContent;
    }
  }

  return element.closest("label")?.textContent ?? "";
}

function readBoundingBox(element: Element): ElementBoundingBox {
  const rect = element.getBoundingClientRect();
  const view = element.ownerDocument.defaultView;

  return {
    x: finiteNumber(rect.x),
    y: finiteNumber(rect.y),
    width: finiteNumber(rect.width),
    height: finiteNumber(rect.height),
    top: finiteNumber(rect.top),
    right: finiteNumber(rect.right),
    bottom: finiteNumber(rect.bottom),
    left: finiteNumber(rect.left),
    scrollX: finiteNumber(view?.scrollX ?? 0),
    scrollY: finiteNumber(view?.scrollY ?? 0),
    viewportWidth: finiteNumber(view?.innerWidth ?? 0),
    viewportHeight: finiteNumber(view?.innerHeight ?? 0),
  };
}

function readVisibility(element: Element): ElementVisibilitySnapshot {
  const reasons: string[] = [];
  const rect = element.getBoundingClientRect();
  const computed = element.ownerDocument.defaultView?.getComputedStyle(element);

  if (rect.width <= 0 || rect.height <= 0) reasons.push("empty_bounds");
  if (computed?.display === "none") reasons.push("display_none");
  if (computed?.visibility === "hidden") reasons.push("visibility_hidden");
  if (computed?.opacity === "0") reasons.push("opacity_zero");

  return { visible: reasons.length === 0, reasons };
}

function readChildIndex(element: Element): number {
  const parent = element.parentElement;
  if (!parent) return 1;
  return Array.from(parent.children).indexOf(element) + 1;
}

function readSameTagIndex(element: Element): number {
  const parent = element.parentElement;
  if (!parent) return 1;
  const tagName = element.tagName;
  return Array.from(parent.children).filter((child) => child.tagName === tagName).indexOf(element) + 1;
}

function isUniqueSelector(documentRef: Document, selector: string): boolean {
  try {
    return documentRef.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function strongestSelectorReliability(
  current: SelectorReliability,
  next: SelectorReliability,
): SelectorReliability {
  if (current === "instrumented" || next === "instrumented") return "instrumented";
  if (current === "semantic" || next === "semantic") return "semantic";
  return "structural";
}

function escapeCssAttribute(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function finiteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
