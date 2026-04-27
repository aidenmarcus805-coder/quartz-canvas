import type { AppError } from "../shared/types";
import type { PromptRenderedMessage } from "../prompting";

export type LocalModelProviderId = string;
export type LocalModelId = string;
export type LocalAiRequestId = string;

export type LocalModelCapability =
  | "chat"
  | "streaming"
  | "json_output"
  | "evidence_citations";

export type LocalModelRuntimeHints = Readonly<{
  sourceRepo?: string;
  sourceUrl?: string;
  architecture?: string;
  parameterSize?: string;
  ggufQuantization?: string;
  ggufFileName?: string;
  ggufSizeGb?: number;
  quantizationBits?: number;
  recommendedProviderModelId?: string;
  installHint?: string;
}>;

export type LocalModelDescriptor = Readonly<{
  providerId: LocalModelProviderId;
  modelId: LocalModelId;
  displayName: string;
  contextWindowTokens: number;
  maxOutputTokens: number;
  capabilities: readonly LocalModelCapability[];
  runtime?: LocalModelRuntimeHints;
}>;

export type LocalModelResponseFormat =
  | { readonly type: "text" }
  | { readonly type: "json"; readonly schemaName: string };

export type LocalModelRuntimeOptions = Readonly<{
  contextWindowTokens?: number;
  gpuLayers?: number;
  cpuThreads?: number;
  keepAlive?: string;
  stop?: readonly string[];
  rawOllamaOptions?: Readonly<Record<string, string | number | boolean | readonly string[]>>;
}>;

export type LocalModelRequest = Readonly<{
  requestId: LocalAiRequestId;
  model: LocalModelDescriptor;
  messages: readonly PromptRenderedMessage[];
  temperature: number;
  inputBudgetTokens?: number;
  maxOutputTokens: number;
  responseFormat: LocalModelResponseFormat;
  runtimeOptions?: LocalModelRuntimeOptions;
  abortSignal?: AbortSignal;
}>;

export type LocalModelUsage = Readonly<{
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}>;

export type LocalModelResponse = Readonly<{
  requestId: LocalAiRequestId;
  model: LocalModelDescriptor;
  content: string;
  usage?: LocalModelUsage;
  finishReason: "stop" | "length" | "cancelled" | "error";
}>;

export type LocalAiRunState =
  | { readonly status: "idle" }
  | { readonly status: "queued"; readonly requestId: LocalAiRequestId }
  | { readonly status: "connecting"; readonly requestId: LocalAiRequestId }
  | { readonly status: "streaming"; readonly requestId: LocalAiRequestId; readonly receivedCharacters: number }
  | { readonly status: "completed"; readonly requestId: LocalAiRequestId; readonly response: LocalModelResponse }
  | { readonly status: "cancelled"; readonly requestId: LocalAiRequestId; readonly reason?: string }
  | { readonly status: "failed"; readonly requestId: LocalAiRequestId; readonly error: AppError };

export type LocalModelStreamEvent =
  | { readonly type: "state"; readonly state: LocalAiRunState }
  | { readonly type: "text_delta"; readonly requestId: LocalAiRequestId; readonly text: string }
  | { readonly type: "usage"; readonly requestId: LocalAiRequestId; readonly usage: LocalModelUsage }
  | { readonly type: "done"; readonly response: LocalModelResponse }
  | { readonly type: "error"; readonly requestId: LocalAiRequestId; readonly error: AppError };

export type LocalAiCancellation = Readonly<{
  requestId: LocalAiRequestId;
  signal: AbortSignal;
  cancel(reason?: string): void;
}>;

export type LocalModelProvider = Readonly<{
  id: LocalModelProviderId;
  displayName: string;
  listModels(signal?: AbortSignal): Promise<readonly LocalModelDescriptor[]> | readonly LocalModelDescriptor[];
  complete(request: LocalModelRequest): Promise<LocalModelResponse>;
  stream(request: LocalModelRequest): AsyncIterable<LocalModelStreamEvent>;
  cancel?(requestId: LocalAiRequestId, reason?: string): Promise<void> | void;
}>;

export type LocalModelProviderRegistry = Readonly<{
  providers: readonly LocalModelProvider[];
  get(providerId: LocalModelProviderId): LocalModelProvider | undefined;
}>;

export function createLocalModelProviderRegistry(
  providers: readonly LocalModelProvider[],
): LocalModelProviderRegistry {
  return {
    providers,
    get(providerId) {
      return providers.find((provider) => provider.id === providerId);
    },
  };
}
