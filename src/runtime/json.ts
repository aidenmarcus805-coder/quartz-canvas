import type { JsonObject, JsonValue } from "../contracts";
import { fieldError, fieldOk, isUnknownRecord, issue, type FieldResult } from "./validation";

const MAX_JSON_DEPTH = 8;

export function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (value === null) {
    return true;
  }

  const valueType = typeof value;
  if (valueType === "string" || valueType === "boolean") {
    return true;
  }

  if (valueType === "number") {
    return Number.isFinite(value);
  }

  if (depth >= MAX_JSON_DEPTH) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item, depth + 1));
  }

  if (isUnknownRecord(value)) {
    return Object.values(value).every((item) => isJsonValue(item, depth + 1));
  }

  return false;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return isUnknownRecord(value) && Object.values(value).every((item) => isJsonValue(item));
}

export function parseJsonObject(value: unknown, path: string): FieldResult<JsonObject> {
  if (!isJsonObject(value)) {
    return fieldError(issue(path, "JSON object", value, "Expected a JSON-compatible object."));
  }

  return fieldOk(value);
}
