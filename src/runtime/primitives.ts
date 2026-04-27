import type {
  AbsoluteFilePath,
  FileHash,
  IsoDateTimeString,
  NonEmptyString,
  RelativeFilePath,
} from "../contracts";
import { fieldError, fieldOk, issue, type FieldResult } from "./validation";

const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/;
const POSIX_ABSOLUTE_PATH = /^\//;
const HASH_PATTERN = /^[A-Za-z0-9:_-]{6,256}$/;

export function isNonEmptyString(value: unknown): value is NonEmptyString {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseNonEmptyString(
  value: unknown,
  path: string,
): FieldResult<NonEmptyString> {
  if (!isNonEmptyString(value)) {
    return fieldError(issue(path, "non-empty string", value, "Expected a non-empty string."));
  }

  return fieldOk(value);
}

export function isIsoDateTimeString(value: unknown): value is IsoDateTimeString {
  return (
    typeof value === "string" &&
    value.includes("T") &&
    Number.isFinite(Date.parse(value))
  );
}

export function parseIsoDateTimeString(
  value: unknown,
  path: string,
): FieldResult<IsoDateTimeString> {
  if (!isIsoDateTimeString(value)) {
    return fieldError(issue(path, "ISO date-time string", value, "Expected an ISO date-time."));
  }

  return fieldOk(value);
}

export function isAbsoluteFilePath(value: unknown): value is AbsoluteFilePath {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes("\0") &&
    (WINDOWS_ABSOLUTE_PATH.test(value) || POSIX_ABSOLUTE_PATH.test(value))
  );
}

export function parseAbsoluteFilePath(
  value: unknown,
  path: string,
): FieldResult<AbsoluteFilePath> {
  if (!isAbsoluteFilePath(value)) {
    return fieldError(issue(path, "absolute file path", value, "Expected an absolute file path."));
  }

  return fieldOk(value);
}

export function isRelativeFilePath(value: unknown): value is RelativeFilePath {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    return false;
  }

  if (WINDOWS_ABSOLUTE_PATH.test(value) || POSIX_ABSOLUTE_PATH.test(value)) {
    return false;
  }

  return !value.split(/[\\/]/).some((segment) => segment === ".." || segment === "");
}

export function parseRelativeFilePath(
  value: unknown,
  path: string,
): FieldResult<RelativeFilePath> {
  if (!isRelativeFilePath(value)) {
    return fieldError(issue(path, "relative file path", value, "Expected a safe relative path."));
  }

  return fieldOk(value);
}

export function isFileHash(value: unknown): value is FileHash {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

export function parseFileHash(value: unknown, path: string): FieldResult<FileHash> {
  if (!isFileHash(value)) {
    return fieldError(issue(path, "file hash", value, "Expected a stable file hash."));
  }

  return fieldOk(value);
}

export function parseNonNegativeInteger(
  value: unknown,
  path: string,
): FieldResult<number> {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return fieldError(
      issue(path, "non-negative integer", value, "Expected a non-negative integer."),
    );
  }

  return fieldOk(value);
}

export function parseNonNegativeFiniteNumber(
  value: unknown,
  path: string,
): FieldResult<number> {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fieldError(
      issue(path, "non-negative finite number", value, "Expected a non-negative finite number."),
    );
  }

  return fieldOk(value);
}

export function parsePositiveInteger(value: unknown, path: string): FieldResult<number> {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return fieldError(issue(path, "positive integer", value, "Expected a positive integer."));
  }

  return fieldOk(value);
}

export function parsePositiveFiniteNumber(value: unknown, path: string): FieldResult<number> {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fieldError(issue(path, "positive finite number", value, "Expected a positive finite number."));
  }

  return fieldOk(value);
}

export function parseUnitInterval(value: unknown, path: string): FieldResult<number> {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    return fieldError(issue(path, "number from 0 to 1", value, "Expected a unit interval."));
  }

  return fieldOk(value);
}
