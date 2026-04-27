import type { BoundarySource, Result } from "../contracts";

export type UnknownRecord = Readonly<Record<string, unknown>>;

export type ValidationIssue = {
  readonly path: string;
  readonly expected: string;
  readonly received: string;
  readonly message: string;
};

export type ValidationError = {
  readonly kind: "validation_failed";
  readonly source: BoundarySource;
  readonly issues: readonly ValidationIssue[];
};

export type ValidationResult<Value> = Result<Value, ValidationError>;
export type FieldResult<Value> = Result<Value, ValidationIssue>;

export function fieldOk<Value>(value: Value): FieldResult<Value> {
  return { ok: true, value };
}

export function fieldError<Value>(issue: ValidationIssue): FieldResult<Value> {
  return { ok: false, error: issue };
}

export function validationOk<Value>(value: Value): ValidationResult<Value> {
  return { ok: true, value };
}

export function validationError<Value>(
  source: BoundarySource,
  issue: ValidationIssue,
): ValidationResult<Value> {
  return {
    ok: false,
    error: { kind: "validation_failed", source, issues: [issue] },
  };
}

export function fromFieldResult<Value>(
  source: BoundarySource,
  result: FieldResult<Value>,
): ValidationResult<Value> {
  return result.ok ? validationOk(result.value) : validationError(source, result.error);
}

export function describeReceived(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  return typeof value;
}

export function issue(
  path: string,
  expected: string,
  receivedValue: unknown,
  message: string,
): ValidationIssue {
  return {
    path,
    expected,
    received: describeReceived(receivedValue),
    message,
  };
}

export function isUnknownRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readRecord(value: unknown, path: string): FieldResult<UnknownRecord> {
  if (!isUnknownRecord(value)) {
    return fieldError(issue(path, "object", value, "Expected an object payload."));
  }

  return fieldOk(value);
}

export function rejectUnknownFields(
  record: UnknownRecord,
  allowedFields: readonly string[],
  path: string,
): FieldResult<void> {
  for (const key of Object.keys(record)) {
    if (!allowedFields.includes(key)) {
      return fieldError(
        issue(`${path}.${key}`, "known field", record[key], "Unknown field is not allowed."),
      );
    }
  }

  return fieldOk(undefined);
}

export function readRequiredField(
  record: UnknownRecord,
  key: string,
  path: string,
): FieldResult<unknown> {
  if (!(key in record)) {
    return fieldError(issue(path, "present field", undefined, "Required field is missing."));
  }

  return fieldOk(record[key]);
}

export function readStringField(
  record: UnknownRecord,
  key: string,
  path: string,
): FieldResult<string> {
  const valueResult = readRequiredField(record, key, path);
  if (!valueResult.ok) {
    return valueResult;
  }

  if (typeof valueResult.value !== "string") {
    return fieldError(issue(path, "string", valueResult.value, "Expected a string."));
  }

  return fieldOk(valueResult.value);
}

export function readNumberField(
  record: UnknownRecord,
  key: string,
  path: string,
): FieldResult<number> {
  const valueResult = readRequiredField(record, key, path);
  if (!valueResult.ok) {
    return valueResult;
  }

  if (typeof valueResult.value !== "number" || !Number.isFinite(valueResult.value)) {
    return fieldError(issue(path, "finite number", valueResult.value, "Expected a finite number."));
  }

  return fieldOk(valueResult.value);
}

export function readBooleanField(
  record: UnknownRecord,
  key: string,
  path: string,
): FieldResult<boolean> {
  const valueResult = readRequiredField(record, key, path);
  if (!valueResult.ok) {
    return valueResult;
  }

  if (typeof valueResult.value !== "boolean") {
    return fieldError(issue(path, "boolean", valueResult.value, "Expected a boolean."));
  }

  return fieldOk(valueResult.value);
}

export function readArrayField(
  record: UnknownRecord,
  key: string,
  path: string,
): FieldResult<readonly unknown[]> {
  const valueResult = readRequiredField(record, key, path);
  if (!valueResult.ok) {
    return valueResult;
  }

  if (!Array.isArray(valueResult.value)) {
    return fieldError(issue(path, "array", valueResult.value, "Expected an array."));
  }

  return fieldOk(valueResult.value);
}

export function readRecordField(
  record: UnknownRecord,
  key: string,
  path: string,
): FieldResult<UnknownRecord> {
  const valueResult = readRequiredField(record, key, path);
  if (!valueResult.ok) {
    return valueResult;
  }

  return readRecord(valueResult.value, path);
}

export function readLiteralField<const Values extends readonly string[]>(
  record: UnknownRecord,
  key: string,
  values: Values,
  path: string,
): FieldResult<Values[number]> {
  const valueResult = readStringField(record, key, path);
  if (!valueResult.ok) {
    return valueResult;
  }

  if (!isOneOf(valueResult.value, values)) {
    return fieldError(
      issue(path, values.join(" | "), valueResult.value, "Unexpected string literal."),
    );
  }

  return fieldOk(valueResult.value);
}

export function isOneOf<const Values extends readonly string[]>(
  value: string,
  values: Values,
): value is Values[number] {
  return values.some((candidate) => candidate === value);
}

export function readParsedField<Value>(
  record: UnknownRecord,
  key: string,
  path: string,
  parse: (value: unknown, path: string) => FieldResult<Value>,
): FieldResult<Value> {
  const valueResult = readRequiredField(record, key, path);
  if (!valueResult.ok) {
    return valueResult;
  }

  return parse(valueResult.value, path);
}

export function readNullableParsedField<Value>(
  record: UnknownRecord,
  key: string,
  path: string,
  parse: (value: unknown, path: string) => FieldResult<Value>,
): FieldResult<Value | null> {
  const valueResult = readRequiredField(record, key, path);
  if (!valueResult.ok) {
    return valueResult;
  }

  if (valueResult.value === null) {
    return fieldOk(null);
  }

  return parse(valueResult.value, path);
}

export function parseArrayItems<Value>(
  values: readonly unknown[],
  path: string,
  parse: (value: unknown, path: string) => FieldResult<Value>,
): FieldResult<readonly Value[]> {
  const parsed: Value[] = [];

  for (let index = 0; index < values.length; index += 1) {
    const itemResult = parse(values[index], `${path}[${index}]`);
    if (!itemResult.ok) {
      return itemResult;
    }
    parsed.push(itemResult.value);
  }

  return fieldOk(parsed);
}

export function readParsedArrayField<Value>(
  record: UnknownRecord,
  key: string,
  path: string,
  parse: (value: unknown, path: string) => FieldResult<Value>,
): FieldResult<readonly Value[]> {
  const arrayResult = readArrayField(record, key, path);
  if (!arrayResult.ok) {
    return arrayResult;
  }

  return parseArrayItems(arrayResult.value, path, parse);
}

export function parseContractVersion(value: unknown, path: string): FieldResult<1> {
  if (value !== 1) {
    return fieldError(issue(path, "contract version 1", value, "Unsupported contract version."));
  }

  return fieldOk(1);
}
