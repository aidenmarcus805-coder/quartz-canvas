export const REDACTED_VALUE = "[redacted]" as const;

export const ELEMENT_ATTRIBUTE_ALLOWLIST = [
  "alt",
  "aria-describedby",
  "aria-label",
  "aria-labelledby",
  "data-component",
  "data-component-name",
  "data-qa",
  "data-quartz-id",
  "data-route",
  "data-source-column",
  "data-source-file",
  "data-source-id",
  "data-source-line",
  "data-test",
  "data-testid",
  "href",
  "name",
  "placeholder",
  "role",
  "src",
  "title",
  "type",
] as const;

export type ElementAttributeName = (typeof ELEMENT_ATTRIBUTE_ALLOWLIST)[number];

export type RedactionReason =
  | "email"
  | "high_entropy"
  | "long_numeric"
  | "secret"
  | "too_long"
  | "url_query";

export type RedactedField = Readonly<{
  field: string;
  originalLength: number;
  reason: RedactionReason;
}>;

export type SanitizedValue = Readonly<{
  value: string;
  redactions: readonly RedactedField[];
}>;

export type ElementAttributeLike = Readonly<{
  name: string;
  value: string;
}>;

export type SanitizedAttributeMap = Readonly<{
  attributes: Readonly<Record<string, string>>;
  redactions: readonly RedactedField[];
}>;

const ALLOWED_ATTRIBUTE_SET = new Set<string>(ELEMENT_ATTRIBUTE_ALLOWLIST);

const URL_LIKE_ATTRIBUTES = new Set<string>(["href", "src"]);

export function isAllowedElementAttribute(name: string): name is ElementAttributeName {
  return ALLOWED_ATTRIBUTE_SET.has(name.toLowerCase());
}

export function sanitizeTextHint(
  value: string | null | undefined,
  field: string,
  maxLength = 160,
): SanitizedValue {
  if (value === null || value === undefined) {
    return { value: "", redactions: [] };
  }

  const normalized = normalizeWhitespace(value);
  const redacted = redactSensitiveText(normalized, field);
  if (redacted.value.length <= maxLength) {
    return redacted;
  }

  return {
    value: redacted.value.slice(0, maxLength).trimEnd(),
    redactions: [
      ...redacted.redactions,
      { field, originalLength: redacted.value.length, reason: "too_long" },
    ],
  };
}

export function sanitizeAttributeList(
  attributes: readonly ElementAttributeLike[],
  maxValueLength = 220,
): SanitizedAttributeMap {
  const sanitizedAttributes: Record<string, string> = {};
  const redactions: RedactedField[] = [];

  for (const attribute of attributes) {
    const name = attribute.name.toLowerCase();
    if (!isAllowedElementAttribute(name)) {
      continue;
    }

    const sanitized = sanitizeAttributeValue(name, attribute.value, maxValueLength);
    if (sanitized.value.length > 0) {
      sanitizedAttributes[name] = sanitized.value;
    }
    redactions.push(...sanitized.redactions);
  }

  return { attributes: sanitizedAttributes, redactions };
}

export function sanitizeAttributeValue(
  name: string,
  value: string,
  maxValueLength = 220,
): SanitizedValue {
  const field = `attributes.${name.toLowerCase()}`;
  const urlSanitized = URL_LIKE_ATTRIBUTES.has(name.toLowerCase())
    ? stripUrlQueryAndFragment(value, field)
    : { value, redactions: [] };
  const textSanitized = sanitizeTextHint(urlSanitized.value, field, maxValueLength);

  return {
    value: textSanitized.value,
    redactions: [...urlSanitized.redactions, ...textSanitized.redactions],
  };
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function redactSensitiveText(value: string, field: string): SanitizedValue {
  const redactions: RedactedField[] = [];
  let redacted = replaceAndTrack(value, field, redactions, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "email");
  redacted = replaceAndTrack(redacted, field, redactions, /\b(?:api[_-]?key|bearer|password|secret|token)\s*[:=]\s*["']?[^"'\s]{8,}/gi, "secret");
  redacted = replaceAndTrack(redacted, field, redactions, /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "secret");
  redacted = replaceAndTrack(redacted, field, redactions, /\b\d{10,}\b/g, "long_numeric");
  redacted = replaceAndTrack(redacted, field, redactions, /\b[A-Za-z0-9_-]{36,}\b/g, "high_entropy");

  return { value: redacted, redactions };
}

function replaceAndTrack(
  value: string,
  field: string,
  redactions: RedactedField[],
  pattern: RegExp,
  reason: RedactionReason,
): string {
  return value.replace(pattern, (match) => {
    redactions.push({ field, originalLength: match.length, reason });
    return REDACTED_VALUE;
  });
}

function stripUrlQueryAndFragment(value: string, field: string): SanitizedValue {
  const trimmed = value.trim();
  const queryIndex = trimmed.search(/[?#]/);

  if (queryIndex === -1) {
    return { value: trimmed, redactions: [] };
  }

  return {
    value: trimmed.slice(0, queryIndex),
    redactions: [{ field, originalLength: trimmed.length - queryIndex, reason: "url_query" }],
  };
}
