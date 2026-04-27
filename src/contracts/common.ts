declare const brandSymbol: unique symbol;

export type Brand<Base, BrandName extends string> = Base & {
  readonly [brandSymbol]: BrandName;
};

export type NonEmptyString = Brand<string, "NonEmptyString">;
export type IsoDateTimeString = Brand<string, "IsoDateTimeString">;
export type AbsoluteFilePath = Brand<string, "AbsoluteFilePath">;
export type RelativeFilePath = Brand<string, "RelativeFilePath">;
export type FileHash = Brand<string, "FileHash">;

export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

export type Result<Ok, Err> =
  | { readonly ok: true; readonly value: Ok }
  | { readonly ok: false; readonly error: Err };

export const BOUNDARY_SOURCE = {
  Ipc: "ipc",
  PreviewBridge: "preview_bridge",
  SourceMapBridge: "source_map_bridge",
  LocalAi: "local_ai",
  FileSystem: "filesystem",
} as const;

export type BoundarySource =
  (typeof BOUNDARY_SOURCE)[keyof typeof BOUNDARY_SOURCE];

export const APP_ERROR_CODE = {
  InvalidPayload: "invalid_payload",
  NotFound: "not_found",
  Conflict: "conflict",
  Blocked: "blocked",
  DependencyUnavailable: "dependency_unavailable",
  InvariantViolation: "invariant_violation",
} as const;

export type AppErrorCode =
  (typeof APP_ERROR_CODE)[keyof typeof APP_ERROR_CODE];

export type AppError = {
  readonly code: AppErrorCode;
  readonly message: string;
  readonly recoverable: boolean;
  readonly details?: unknown;
};

export type EventEnvelope<EventName extends string, Payload> = {
  readonly eventId: import("./ids").EventId;
  readonly name: EventName;
  readonly payload: Payload;
  readonly occurredAt: IsoDateTimeString;
  readonly correlationId?: import("./ids").CorrelationId;
};

export type ContractVersion = 1;

export type VersionedContract = {
  readonly contractVersion: ContractVersion;
};
