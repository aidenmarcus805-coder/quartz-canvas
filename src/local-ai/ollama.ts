import type { AppError } from "../shared/types";
import type { PromptRenderedMessage } from "../prompting";
import {
  getQuartzLocalModelDescriptor,
  OLLAMA_DEFAULT_ENDPOINT,
  OLLAMA_PROVIDER_ID,
  QUARTZ_LOCAL_MODEL_PRESETS
} from "./presets";
import type {
  LocalAiRequestId,
  LocalModelDescriptor,
  LocalModelProvider,
  LocalModelRequest,
  LocalModelResponse,
  LocalModelStreamEvent,
  LocalModelUsage
} from "./provider";

type FetchLike = typeof fetch;

export type OllamaProviderOptions = Readonly<{
  endpoint?: string;
  fetchImpl?: FetchLike;
  keepAlive?: string;
  includeRecommendedModels?: boolean;
  recommendedModels?: readonly LocalModelDescriptor[];
}>;

type OllamaMessage = Readonly<{
  role: "system" | "user" | "assistant";
  content: string;
}>;

type OllamaModelListResponse = Readonly<{
  models?: readonly OllamaListedModel[];
}>;

type OllamaListedModel = Readonly<{
  name?: unknown;
  model?: unknown;
  details?: Readonly<{
    parameter_size?: unknown;
    quantization_level?: unknown;
    family?: unknown;
  }>;
}>;

type OllamaChatChunk = Readonly<{
  model?: unknown;
  message?: Readonly<{
    content?: unknown;
  }>;
  done?: unknown;
  done_reason?: unknown;
  prompt_eval_count?: unknown;
  eval_count?: unknown;
}>;

const defaultOllamaKeepAlive = "30s";

export function createOllamaProvider(options: OllamaProviderOptions = {}): LocalModelProvider {
  const endpoint = normalizeOllamaEndpoint(options.endpoint ?? OLLAMA_DEFAULT_ENDPOINT);
  const fetchImpl = options.fetchImpl ?? fetch;
  const recommendedModels = options.recommendedModels ?? QUARTZ_LOCAL_MODEL_PRESETS;

  return {
    id: OLLAMA_PROVIDER_ID,
    displayName: "Ollama",
    async listModels(signal) {
      const response = await fetchJson<OllamaModelListResponse>(
        fetchImpl,
        endpoint,
        "/api/tags",
        {
          method: "GET",
          signal
        }
      );
      const installed = (response.models ?? []).flatMap(readOllamaModel);

      if (!options.includeRecommendedModels) {
        return installed;
      }

      const installedIds = new Set(installed.map((model) => model.modelId));
      return [
        ...installed,
        ...recommendedModels.filter((model) => !installedIds.has(model.modelId))
      ];
    },
    complete(request) {
      return completeOllamaChat(fetchImpl, endpoint, options.keepAlive, request);
    },
    stream(request) {
      return streamOllamaChat(fetchImpl, endpoint, options.keepAlive, request);
    }
  };
}

async function completeOllamaChat(
  fetchImpl: FetchLike,
  endpoint: string,
  defaultKeepAlive: string | undefined,
  request: LocalModelRequest
): Promise<LocalModelResponse> {
  const budgetError = promptBudgetError(request);
  if (budgetError) {
    throw budgetError;
  }

  const response = await fetchJson<OllamaChatChunk>(
    fetchImpl,
    endpoint,
    "/api/chat",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toOllamaChatBody(request, false, defaultKeepAlive)),
      signal: request.abortSignal
    }
  );

  return {
    requestId: request.requestId,
    model: request.model,
    content: readChunkText(response),
    usage: readUsage(response),
    finishReason: readFinishReason(response.done_reason)
  };
}

async function* streamOllamaChat(
  fetchImpl: FetchLike,
  endpoint: string,
  defaultKeepAlive: string | undefined,
  request: LocalModelRequest
): AsyncIterable<LocalModelStreamEvent> {
  const budgetError = promptBudgetError(request);
  if (budgetError) {
    yield { type: "error", requestId: request.requestId, error: budgetError };
    return;
  }

  yield { type: "state", state: { status: "connecting", requestId: request.requestId } };

  const response = await fetchImpl(`${endpoint}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toOllamaChatBody(request, true, defaultKeepAlive)),
    signal: request.abortSignal
  });

  if (!response.ok || !response.body) {
    yield {
      type: "error",
      requestId: request.requestId,
      error: await readHttpError(response)
    };
    return;
  }

  yield {
    type: "state",
    state: { status: "streaming", requestId: request.requestId, receivedCharacters: 0 }
  };

  let receivedCharacters = 0;
  let accumulated = "";
  for await (const chunk of readJsonLines(response.body)) {
    const text = readChunkText(chunk);
    if (text) {
      accumulated += text;
      receivedCharacters += text.length;
      yield { type: "text_delta", requestId: request.requestId, text };
      yield {
        type: "state",
        state: { status: "streaming", requestId: request.requestId, receivedCharacters }
      };
    }

    if (chunk.done === true) {
      const usage = readUsage(chunk);
      if (usage) {
        yield { type: "usage", requestId: request.requestId, usage };
      }

      const finalResponse: LocalModelResponse = {
        requestId: request.requestId,
        model: request.model,
        content: accumulated,
        usage,
        finishReason: readFinishReason(chunk.done_reason)
      };
      yield { type: "done", response: finalResponse };
      yield {
        type: "state",
        state: { status: "completed", requestId: request.requestId, response: finalResponse }
      };
      return;
    }
  }

  yield {
    type: "error",
    requestId: request.requestId,
    error: appError("ollama_stream_interrupted", "Ollama stream ended without a final done chunk.", true)
  };
}

function toOllamaChatBody(
  request: LocalModelRequest,
  stream: boolean,
  defaultKeepAlive: string | undefined
) {
  const runtime = request.runtimeOptions;
  const contextWindowTokens = resolvedContextWindowTokens(request);
  const maxOutputTokens = resolvedMaxOutputTokens(request);
  const options: Record<string, string | number | boolean | readonly string[]> = {
    temperature: request.temperature,
    num_predict: maxOutputTokens,
    num_ctx: contextWindowTokens,
    ...(runtime?.gpuLayers === undefined ? {} : { num_gpu: runtime.gpuLayers }),
    ...(runtime?.cpuThreads === undefined ? {} : { num_thread: runtime.cpuThreads }),
    ...(runtime?.stop === undefined ? {} : { stop: runtime.stop }),
    ...(runtime?.rawOllamaOptions ?? {})
  };

  return {
    model: request.model.modelId,
    messages: toOllamaMessages(request.messages),
    stream,
    ...(request.responseFormat.type === "json" ? { format: "json" } : {}),
    options,
    keep_alive: runtime?.keepAlive ?? defaultKeepAlive ?? defaultOllamaKeepAlive
  };
}

function toOllamaMessages(messages: readonly PromptRenderedMessage[]): readonly OllamaMessage[] {
  return messages.map((message) => ({
    role: message.role === "user" ? "user" : "system",
    content: message.role === "developer" ? `Developer instructions:\n${message.content}` : message.content
  }));
}

function promptBudgetError(request: LocalModelRequest): AppError | null {
  const contextWindow = resolvedContextWindowTokens(request);
  const reservedOutput = resolvedMaxOutputTokens(request);
  const inputBudget = request.inputBudgetTokens ?? Math.max(512, contextWindow - reservedOutput);
  const estimatedInputTokens = estimatePromptTokens(request.messages);

  if (estimatedInputTokens <= inputBudget) {
    return null;
  }

  return appError(
    "local_prompt_context_too_large",
    `Local prompt is too large for the selected model budget (${estimatedInputTokens} estimated input tokens > ${inputBudget}).`,
    false,
    {
      estimatedInputTokens,
      inputBudgetTokens: inputBudget,
      contextWindowTokens: contextWindow,
      reservedOutputTokens: reservedOutput
    }
  );
}

function resolvedContextWindowTokens(request: LocalModelRequest): number {
  return Math.max(1, Math.floor(request.runtimeOptions?.contextWindowTokens ?? request.model.contextWindowTokens));
}

function resolvedMaxOutputTokens(request: LocalModelRequest): number {
  const contextWindow = resolvedContextWindowTokens(request);
  return Math.max(1, Math.floor(Math.min(request.maxOutputTokens, request.model.maxOutputTokens, contextWindow)));
}

function estimatePromptTokens(messages: readonly PromptRenderedMessage[]): number {
  const characters = messages.reduce((total, message) => total + message.content.length, 0);
  return Math.ceil(characters / 4);
}

function readOllamaModel(model: OllamaListedModel): readonly LocalModelDescriptor[] {
  const modelId = typeof model.model === "string" ? model.model : typeof model.name === "string" ? model.name : "";
  if (!modelId) {
    return [];
  }

  const catalogModel = getQuartzLocalModelDescriptor(modelId);
  if (catalogModel) {
    return [catalogModel];
  }

  const details = model.details ?? {};
  const parameterSize = typeof details.parameter_size === "string" ? details.parameter_size : undefined;
  const quantization = typeof details.quantization_level === "string" ? details.quantization_level : undefined;
  const family = typeof details.family === "string" ? details.family : undefined;

  return [
    {
      providerId: OLLAMA_PROVIDER_ID,
      modelId,
      displayName: modelId,
      contextWindowTokens: 8_192,
      maxOutputTokens: 2_048,
      capabilities: ["chat", "streaming", "json_output"],
      runtime: {
        architecture: family,
        parameterSize,
        ggufQuantization: quantization,
        recommendedProviderModelId: modelId
      }
    }
  ];
}

async function fetchJson<T>(
  fetchImpl: FetchLike,
  endpoint: string,
  path: string,
  init: RequestInit
): Promise<T> {
  const response = await fetchImpl(`${endpoint}${path}`, init);
  if (!response.ok) {
    throw await readHttpError(response);
  }
  return response.json() as Promise<T>;
}

async function readHttpError(response: Response): Promise<AppError> {
  const body = await response.text().catch(() => "");
  return appError(
    "ollama_http_error",
    `Ollama request failed with HTTP ${response.status}.`,
    response.status >= 500 || response.status === 404,
    body ? { body } : undefined
  );
}

async function* readJsonLines(body: ReadableStream<Uint8Array>): AsyncIterable<OllamaChatChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffered += decoder.decode(value, { stream: true });
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      yield JSON.parse(trimmed) as OllamaChatChunk;
    }
  }

  const finalLine = buffered.trim();
  if (finalLine) {
    yield JSON.parse(finalLine) as OllamaChatChunk;
  }
}

function readChunkText(chunk: OllamaChatChunk): string {
  return typeof chunk.message?.content === "string" ? chunk.message.content : "";
}

function readUsage(chunk: OllamaChatChunk): LocalModelUsage | undefined {
  const inputTokens = positiveNumber(chunk.prompt_eval_count);
  const outputTokens = positiveNumber(chunk.eval_count);
  const totalTokens = inputTokens === undefined || outputTokens === undefined ? undefined : inputTokens + outputTokens;

  return inputTokens === undefined && outputTokens === undefined && totalTokens === undefined
    ? undefined
    : { inputTokens, outputTokens, totalTokens };
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function readFinishReason(reason: unknown): LocalModelResponse["finishReason"] {
  return reason === "length" ? "length" : "stop";
}

function normalizeOllamaEndpoint(endpoint: string): string {
  const parsed = new URL(endpoint);
  if (!isLoopbackHost(parsed.hostname)) {
    throw appError(
      "ollama_endpoint_not_local",
      "Ollama endpoints must resolve to localhost, 127.0.0.0/8, or ::1.",
      false,
      { endpoint }
    );
  }

  const pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = pathname.endsWith("/api") ? pathname.slice(0, -4) || "/" : pathname || "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("127.")
  );
}

function appError(code: string, message: string, recoverable: boolean, details?: unknown): AppError {
  return { code, message, recoverable, details };
}
