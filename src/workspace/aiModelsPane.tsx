import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowSquareOut,
  CaretDown,
  Check,
  DownloadSimple,
  FolderOpen,
  Lightning
} from "@phosphor-icons/react";
import { Switch } from "./switch";
import {
  OLLAMA_DEFAULT_ENDPOINT,
  PRISM_LLAMA_CPP_DEFAULT_ENDPOINT,
  PRISM_LLAMA_CPP_RELEASE_URL,
  QUARTZ_NANO_UI_MODEL_ID,
  QUARTZ_LOCAL_MODEL_PRESETS,
  QWOPUS_GLM_18B_GGUF_REPO,
  TERNARY_BONSAI_8B_GGUF_REPO
} from "../local-ai";

export type LocalModelKey = "qwopus-glm-18b" | "quartz-nano-ui" | "ternary-bonsai-8b";
type QuantizationId = "q2_0" | "q2_k" | "q3_k_m" | "q4_k_m";
type HardwareProfileId = "8gb-q2" | "8gb-q3" | "12gb-q4" | "12gb-nano-q2" | "16gb-q4";
type EndpointStatus = "idle" | "checking" | "reachable" | "unreachable";

export type AiModelRuntimeSettings = {
  readonly modelKey: LocalModelKey;
  readonly providerModelId: string;
  readonly endpoint: string;
  readonly modelDirectory: string;
  readonly quantization: QuantizationId;
  readonly hardwareProfileId: HardwareProfileId;
  readonly ggufPath: string;
  readonly loraAdapterPath: string;
  readonly contextWindowTokens: number;
  readonly cpuThreads: number;
  readonly gpuLayers: number;
  readonly maxOutputTokens: number;
  readonly temperature: number;
  readonly keepAlive: string;
  readonly flashAttention: boolean;
  readonly mmapModel: boolean;
  readonly mlockModel: boolean;
};

export type AiModelImportRequest = {
  readonly settings: AiModelRuntimeSettings;
  readonly modelfile: string;
  readonly command: string;
};

export type AiMarketplaceModelSettings = {
  readonly ggufFileName: string | null;
  readonly modelId: string;
  readonly ollamaModelName: string;
  readonly sourceRepo: string;
  readonly sourceUrl: string;
};

export type AiModelsPaneProps = {
  readonly className?: string;
  readonly embedded?: boolean;
  readonly initialSettings?: Partial<AiModelRuntimeSettings>;
  readonly marketplaceModel?: AiMarketplaceModelSettings | null;
  readonly onClearMarketplaceModel?: () => void;
  readonly onImportRequest?: (request: AiModelImportRequest) => void;
  readonly onOpenMarketplace?: () => void;
  readonly onSettingsChange?: (settings: AiModelRuntimeSettings) => void;
};

type ModelDefinition = {
  readonly key: LocalModelKey;
  readonly name: string;
  readonly shortName: string;
  readonly family: string;
  readonly parameters: string;
  readonly sourceRepo: string;
  readonly preferredRuntime: "ollama" | "prism_llama_cpp";
  readonly runtimeSourceUrl?: string;
  readonly ollamaCompatible: boolean;
  readonly defaultProfileId: HardwareProfileId;
  readonly maxContext: number;
  readonly maxGpuLayers: number;
  readonly recommendedModelId: Partial<Record<QuantizationId, string>>;
  readonly ggufFile: Partial<Record<QuantizationId, string>>;
};

type HardwareProfile = {
  readonly id: HardwareProfileId;
  readonly modelKey: LocalModelKey;
  readonly label: string;
  readonly quantization: QuantizationId;
  readonly vram: string;
  readonly dedicatedVramGb: number;
  readonly ddr5RamGb: number;
  readonly context: number;
  readonly gpuLayers: number;
  readonly kvCache: "GPU" | "DDR5";
};

type ImportedGguf = {
  readonly id: string;
  readonly path: string;
  readonly modelKey: LocalModelKey;
  readonly quantization: QuantizationId;
  readonly importedAt: string;
};

type RuntimeControlPlan = Readonly<{
  supported: boolean;
  suggestedTag?: string | null;
  modelfile?: string | null;
  createArgs: readonly string[];
  runArgs: readonly string[];
  serverArgs: readonly string[];
  notes: readonly string[];
}>;

type NativeRuntimePlan = Readonly<{
  modelId: string;
  displayName: string;
  repo: string;
  modelFile: string;
  quantization: QuantizationId;
  ggufSizeGb: number;
  contextSizeTokens: number;
  gpuLayers: number;
  flashAttention: boolean;
  kvCache: "gpu" | "system_ram";
  mmapModel: boolean;
  mlockModel: boolean;
  cpuSpillEnabled: boolean;
  minimumRecommendedDdr5Gb: number;
  llamaCpp: RuntimeControlPlan;
  ollama: RuntimeControlPlan;
  notes: readonly string[];
}>;

type NativeImportPlan = Readonly<{
  sourceType: string;
  modelId?: string | null;
  repo?: string | null;
  file: string;
  validatedLocalPath?: string | null;
  quantization?: QuantizationId | null;
  ollamaTag: string;
  modelfile: string;
  ollamaCreateArgs: readonly string[];
  llamaServerArgs: readonly string[];
  downloadRequired: boolean;
  instructions: readonly string[];
  warnings: readonly string[];
}>;

export const aiModelSettingsStorageKey = "quartz-canvas-ai-model-settings-v1";
const importsStorageKey = "quartz-canvas-ai-model-imports-v1";
const fallbackModelDirectory = "%USERPROFILE%\\.ollama\\models";
const contextMarks = [4096, 8192, 16384, 32768, 49152, 65536] as const;
const defaultMaxOutputTokens = 2048;
const maxOutputTokenLimit = 4096;
const legacyLongKeepAliveDefaults = new Set(["10m", "20m", "30m", "45m"]);

const modelDefinitions: readonly ModelDefinition[] = [
  {
    key: "qwopus-glm-18b",
    name: "Qwopus GLM 18B",
    shortName: "Qwopus",
    family: "GLM",
    parameters: "18B",
    sourceRepo: QWOPUS_GLM_18B_GGUF_REPO,
    preferredRuntime: "ollama",
    ollamaCompatible: true,
    defaultProfileId: "12gb-q4",
    maxContext: 65536,
    maxGpuLayers: 99,
    recommendedModelId: {
      q3_k_m: "qwopus-glm-18b:q3_k_m",
      q4_k_m: "qwopus-glm-18b:q4_k_m"
    },
    ggufFile: {
      q3_k_m: "Qwopus-GLM-18B-Healed-Q3_K_M.gguf",
      q4_k_m: "Qwopus-GLM-18B-Healed-Q4_K_M.gguf"
    }
  },
  {
    key: QUARTZ_NANO_UI_MODEL_ID,
    name: "Quartz Nano UI",
    shortName: "Nano",
    family: "Bonsai UI",
    parameters: "8B",
    sourceRepo: TERNARY_BONSAI_8B_GGUF_REPO,
    preferredRuntime: "prism_llama_cpp",
    runtimeSourceUrl: PRISM_LLAMA_CPP_RELEASE_URL,
    ollamaCompatible: false,
    defaultProfileId: "12gb-nano-q2",
    maxContext: 65536,
    maxGpuLayers: 99,
    recommendedModelId: {
      q2_0: "quartz-nano:q2_0"
    },
    ggufFile: {
      q2_0: "Ternary-Bonsai-8B-Q2_0.gguf"
    }
  },
  {
    key: "ternary-bonsai-8b",
    name: "Ternary Bonsai 8B",
    shortName: "Bonsai",
    family: "Qwen3",
    parameters: "8B",
    sourceRepo: TERNARY_BONSAI_8B_GGUF_REPO,
    preferredRuntime: "prism_llama_cpp",
    runtimeSourceUrl: PRISM_LLAMA_CPP_RELEASE_URL,
    ollamaCompatible: false,
    defaultProfileId: "8gb-q2",
    maxContext: 65536,
    maxGpuLayers: 99,
    recommendedModelId: {
      q2_0: "ternary-bonsai-8b:q2_0"
    },
    ggufFile: {
      q2_0: "Ternary-Bonsai-8B-Q2_0.gguf"
    }
  }
];

const hardwareProfiles: readonly HardwareProfile[] = [
  {
    id: "8gb-q3",
    modelKey: "qwopus-glm-18b",
    label: "8GB VRAM",
    quantization: "q3_k_m",
    vram: "8GB",
    dedicatedVramGb: 8,
    ddr5RamGb: 32,
    context: 32768,
    gpuLayers: 36,
    kvCache: "DDR5"
  },
  {
    id: "12gb-q4",
    modelKey: "qwopus-glm-18b",
    label: "12GB VRAM",
    quantization: "q4_k_m",
    vram: "12GB",
    dedicatedVramGb: 12,
    ddr5RamGb: 48,
    context: 49152,
    gpuLayers: 52,
    kvCache: "DDR5"
  },
  {
    id: "16gb-q4",
    modelKey: "qwopus-glm-18b",
    label: "16GB+ VRAM",
    quantization: "q4_k_m",
    vram: "16GB+",
    dedicatedVramGb: 16,
    ddr5RamGb: 32,
    context: 65536,
    gpuLayers: 99,
    kvCache: "GPU"
  },
  {
    id: "12gb-nano-q2",
    modelKey: QUARTZ_NANO_UI_MODEL_ID,
    label: "12GB VRAM",
    quantization: "q2_0",
    vram: "12GB",
    dedicatedVramGb: 12,
    ddr5RamGb: 48,
    context: 65536,
    gpuLayers: 99,
    kvCache: "GPU"
  },
  {
    id: "8gb-q2",
    modelKey: "ternary-bonsai-8b",
    label: "8GB VRAM",
    quantization: "q2_0",
    vram: "8GB",
    dedicatedVramGb: 8,
    ddr5RamGb: 16,
    context: 65536,
    gpuLayers: 99,
    kvCache: "GPU"
  }
];

const defaultSettings: AiModelRuntimeSettings = {
  modelKey: "qwopus-glm-18b",
  providerModelId: "qwopus-glm-18b:q4_k_m",
  endpoint: OLLAMA_DEFAULT_ENDPOINT,
  modelDirectory: fallbackModelDirectory,
  quantization: "q4_k_m",
  hardwareProfileId: "12gb-q4",
  ggufPath: "",
  loraAdapterPath: "",
  contextWindowTokens: 49152,
  cpuThreads: 8,
  gpuLayers: 52,
  maxOutputTokens: defaultMaxOutputTokens,
  temperature: 0.2,
  keepAlive: "30s",
  flashAttention: true,
  mmapModel: true,
  mlockModel: false
};

const controlClass =
  "h-8 rounded-[var(--radius-md)] px-2.5 text-[12px] font-medium text-[var(--text-secondary)] outline-none transition-[background-color,color,opacity] duration-100 ease-out hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)] focus-visible:ring-1 focus-visible:ring-[var(--accent)] disabled:cursor-default disabled:opacity-45 disabled:transition-none disabled:hover:bg-transparent disabled:hover:text-[var(--text-secondary)]";

const inputClass =
  "h-8 min-w-0 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--control-bg)] px-2 text-[12px] text-[var(--text-primary)] outline-none transition-colors duration-100 placeholder:text-[var(--text-muted)] hover:bg-[var(--control-bg-hover)] focus:border-[var(--accent)] focus:bg-[var(--bg-elevated)] focus-visible:ring-1 focus-visible:ring-[var(--accent)]";

const numberInputClass =
  "h-8 w-20 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--control-bg)] px-2 text-right text-[12px] tabular-nums text-[var(--text-primary)] outline-none transition-colors duration-100 hover:bg-[var(--control-bg-hover)] focus:border-[var(--accent)] focus:bg-[var(--bg-elevated)] focus-visible:ring-1 focus-visible:ring-[var(--accent)]";

function readStoredSettings(): Partial<AiModelRuntimeSettings> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const saved = window.localStorage.getItem(aiModelSettingsStorageKey);
    return saved ? (JSON.parse(saved) as Partial<AiModelRuntimeSettings>) : {};
  } catch {
    return {};
  }
}

function readStoredImports(): readonly ImportedGguf[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const saved = window.localStorage.getItem(importsStorageKey);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? (parsed as readonly ImportedGguf[]) : [];
  } catch {
    return [];
  }
}

function joinClasses(...classes: readonly (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function cleanString(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function cleanBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function cleanNumber(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

function cleanKeepAlive(value: unknown) {
  const keepAlive = cleanString(value, defaultSettings.keepAlive).trim();
  return keepAlive && !legacyLongKeepAliveDefaults.has(keepAlive) ? keepAlive : defaultSettings.keepAlive;
}

function knownProviderModelIds() {
  return new Set(
    modelDefinitions.flatMap((model) =>
      Object.values(model.recommendedModelId).filter((providerModelId): providerModelId is string =>
        Boolean(providerModelId)
      )
    )
  );
}

function defaultProviderModelId(model: ModelDefinition, quantization: QuantizationId) {
  return model.recommendedModelId[quantization] || defaultSettings.providerModelId;
}

function sanitizedProviderModelId(
  requestedProviderModelId: unknown,
  model: ModelDefinition,
  quantization: QuantizationId
) {
  const requested = cleanString(requestedProviderModelId, "").trim();
  const expected = defaultProviderModelId(model, quantization);

  if (!requested) {
    return expected;
  }

  const referencedBuiltInModel = modelDefinitions.find((item) => requested.includes(item.key));
  if (referencedBuiltInModel && referencedBuiltInModel.key !== model.key) {
    return expected;
  }

  if (knownProviderModelIds().has(requested) && requested !== expected) {
    return expected;
  }

  return requested;
}

function isLocalModelKey(value: unknown): value is LocalModelKey {
  return value === "qwopus-glm-18b" || value === QUARTZ_NANO_UI_MODEL_ID || value === "ternary-bonsai-8b";
}

function isHardwareProfileId(value: unknown): value is HardwareProfileId {
  return (
    value === "8gb-q2" ||
    value === "8gb-q3" ||
    value === "12gb-q4" ||
    value === "12gb-nano-q2" ||
    value === "16gb-q4"
  );
}

function isQuantizationId(value: unknown): value is QuantizationId {
  return value === "q2_0" || value === "q2_k" || value === "q3_k_m" || value === "q4_k_m";
}

function isLegacyPrismLlamaCppEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return (url.hostname === "127.0.0.1" || url.hostname === "localhost") && url.port === String(8000 + 33);
  } catch {
    return false;
  }
}

function modelFor(key: LocalModelKey) {
  return modelDefinitions.find((model) => model.key === key) ?? modelDefinitions[0];
}

function profileFor(id: HardwareProfileId) {
  return hardwareProfiles.find((profile) => profile.id === id) ?? hardwareProfiles[1];
}

function defaultProfileFor(model: ModelDefinition) {
  return profileFor(model.defaultProfileId);
}

function sanitizeSettings(settings: Partial<AiModelRuntimeSettings>): AiModelRuntimeSettings {
  const modelKey = isLocalModelKey(settings.modelKey) ? settings.modelKey : defaultSettings.modelKey;
  const model = modelFor(modelKey);
  const requestedProfile = isHardwareProfileId(settings.hardwareProfileId)
    ? profileFor(settings.hardwareProfileId)
    : defaultProfileFor(model);
  const profile = requestedProfile.modelKey === model.key ? requestedProfile : defaultProfileFor(model);
  const requestedQuantization = isQuantizationId(settings.quantization) ? settings.quantization : profile.quantization;
  const quantization = model.recommendedModelId[requestedQuantization] ? requestedQuantization : profile.quantization;
  const runtimeDefaultEndpoint = modelUsesPrismLlamaCpp(model) ? PRISM_LLAMA_CPP_DEFAULT_ENDPOINT : OLLAMA_DEFAULT_ENDPOINT;
  const oppositeRuntimeDefaultEndpoint = modelUsesPrismLlamaCpp(model)
    ? OLLAMA_DEFAULT_ENDPOINT
    : PRISM_LLAMA_CPP_DEFAULT_ENDPOINT;
  const requestedEndpoint = cleanString(settings.endpoint, runtimeDefaultEndpoint).trim();
  const endpoint =
    requestedEndpoint &&
    requestedEndpoint !== oppositeRuntimeDefaultEndpoint &&
    !isLegacyPrismLlamaCppEndpoint(requestedEndpoint)
      ? requestedEndpoint
      : runtimeDefaultEndpoint;
  const requestedContextWindowTokens = cleanNumber(settings.contextWindowTokens, profile.context, 4096, model.maxContext);
  const contextWindowTokens =
    model.key === QUARTZ_NANO_UI_MODEL_ID && requestedContextWindowTokens === 8192
      ? profile.context
      : requestedContextWindowTokens;
  const requestedMaxOutputTokens = cleanNumber(
    settings.maxOutputTokens,
    defaultSettings.maxOutputTokens,
    256,
    maxOutputTokenLimit
  );
  const maxOutputTokens =
    model.key === QUARTZ_NANO_UI_MODEL_ID && requestedMaxOutputTokens === defaultSettings.maxOutputTokens
      ? 640
      : requestedMaxOutputTokens;

  return {
    ...defaultSettings,
    modelKey: model.key,
    hardwareProfileId: profile.id,
    quantization,
    providerModelId: sanitizedProviderModelId(settings.providerModelId, model, quantization),
    endpoint,
    modelDirectory:
      cleanString(settings.modelDirectory, defaultSettings.modelDirectory).trim() || defaultSettings.modelDirectory,
    ggufPath: cleanString(settings.ggufPath, "").trim(),
    loraAdapterPath:
      model.key === QUARTZ_NANO_UI_MODEL_ID ? cleanString(settings.loraAdapterPath, "").trim() : "",
    contextWindowTokens: Math.round(contextWindowTokens),
    cpuThreads: Math.round(cleanNumber(settings.cpuThreads, defaultSettings.cpuThreads, 1, 32)),
    gpuLayers: Math.round(cleanNumber(settings.gpuLayers, profile.gpuLayers, 0, model.maxGpuLayers)),
    maxOutputTokens: Math.round(maxOutputTokens),
    temperature: cleanNumber(settings.temperature, defaultSettings.temperature, 0, 1.5),
    keepAlive: cleanKeepAlive(settings.keepAlive),
    flashAttention: cleanBoolean(settings.flashAttention, defaultSettings.flashAttention),
    mmapModel: cleanBoolean(settings.mmapModel, defaultSettings.mmapModel),
    mlockModel: cleanBoolean(settings.mlockModel, defaultSettings.mlockModel)
  };
}

export function sanitizeAiModelRuntimeSettings(
  settings: Partial<AiModelRuntimeSettings>
): AiModelRuntimeSettings {
  return sanitizeSettings(settings);
}

export function readStoredAiModelRuntimeSettings(): Partial<AiModelRuntimeSettings> {
  return readStoredSettings();
}

export function writeStoredAiModelRuntimeSettings(settings: AiModelRuntimeSettings) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(aiModelSettingsStorageKey, JSON.stringify(settings));
}

export function aiModelSettingsForModelKey(
  modelKey: LocalModelKey,
  current?: Partial<AiModelRuntimeSettings> | null
) {
  const nextModel = modelFor(modelKey);
  const nextProfile = defaultProfileFor(nextModel);

  return sanitizeSettings({
    ...current,
    modelKey,
    hardwareProfileId: nextProfile.id,
    quantization: nextProfile.quantization,
    contextWindowTokens: nextProfile.context,
    gpuLayers: nextProfile.gpuLayers,
    maxOutputTokens: nextModel.key === QUARTZ_NANO_UI_MODEL_ID ? 640 : defaultMaxOutputTokens,
    temperature: nextModel.key === QUARTZ_NANO_UI_MODEL_ID ? 0.15 : defaultSettings.temperature,
    endpoint: modelUsesPrismLlamaCpp(nextModel) ? PRISM_LLAMA_CPP_DEFAULT_ENDPOINT : OLLAMA_DEFAULT_ENDPOINT,
    providerModelId: defaultProviderModelId(nextModel, nextProfile.quantization)
  });
}

export function chatModeForAiModelSettings(settings: Partial<AiModelRuntimeSettings> | null | undefined) {
  if (settings?.modelKey === QUARTZ_NANO_UI_MODEL_ID) {
    return "Nano";
  }
  return settings?.modelKey === "ternary-bonsai-8b" ? "Bonsai" : "Qwopus";
}

function modelUsesPrismLlamaCpp(model: ModelDefinition) {
  return model.preferredRuntime === "prism_llama_cpp";
}

function modelfileFor(settings: AiModelRuntimeSettings) {
  const model = modelFor(settings.modelKey);
  const fromPath =
    settings.ggufPath.trim() ||
    model.ggufFile[settings.quantization] ||
    model.ggufFile.q4_k_m ||
    model.ggufFile.q2_0 ||
    model.ggufFile.q2_k ||
    "";
  const lines = [
    `FROM "${fromPath}"`,
    `PARAMETER num_ctx ${settings.contextWindowTokens}`,
    `PARAMETER num_predict ${settings.maxOutputTokens}`,
    `PARAMETER temperature ${settings.temperature.toFixed(2)}`,
    "PARAMETER top_p 0.86",
    "PARAMETER top_k 40",
    "PARAMETER repeat_penalty 1.18",
    "PARAMETER repeat_last_n 512",
    'PARAMETER stop "\\nUser:"',
    'PARAMETER stop "\\nAssistant:"',
    'PARAMETER stop "<|im_start|>"',
    'PARAMETER stop "<|im_end|>"'
  ];

  return lines.filter(Boolean).join("\n");
}

function commandFor(settings: AiModelRuntimeSettings) {
  const model = modelFor(settings.modelKey);
  if (modelUsesPrismLlamaCpp(model)) {
    const modelPath = settings.ggufPath.trim() || model.ggufFile[settings.quantization] || "Ternary-Bonsai-8B-Q2_0.gguf";
    const loraArg = settings.loraAdapterPath.trim() ? ` --lora "${settings.loraAdapterPath.trim()}"` : "";
    return [
      `# ${model.sourceRepo}`,
      `# Runtime: ${model.runtimeSourceUrl ?? PRISM_LLAMA_CPP_RELEASE_URL}`,
      `llama-server -m "${modelPath}"${loraArg} --ctx-size ${settings.contextWindowTokens} --n-gpu-layers ${settings.gpuLayers} --host 127.0.0.1 --port 11435 --flash-attn on`
    ].join("\n");
  }

  const modelfileName = `Modelfile.${model.shortName.toLowerCase()}.${settings.quantization}`;
  return [
    `# ${model.sourceRepo}`,
    "@'",
    modelfileFor(settings),
    `'@ | Set-Content -Path .\\${modelfileName} -NoNewline`,
    `ollama create ${settings.providerModelId} -f .\\${modelfileName}`,
    `ollama run ${settings.providerModelId}`
  ].join("\n");
}

function formatTokens(tokens: number) {
  return tokens >= 1024 ? `${Math.round(tokens / 1024)}k` : tokens.toString();
}

function modelPresetHint(modelKey: LocalModelKey) {
  const selected = modelFor(modelKey);
  const recommendedProviderModelId =
    selected.recommendedModelId.q4_k_m ??
    selected.recommendedModelId.q3_k_m ??
    selected.recommendedModelId.q2_0 ??
    selected.recommendedModelId.q2_k ??
    "";
  const preset = QUARTZ_LOCAL_MODEL_PRESETS.find((item) => item.modelId === recommendedProviderModelId);
  return (
    preset?.runtime?.recommendedProviderModelId ??
    recommendedProviderModelId
  );
}

function isLoopbackEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}

function nativeErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  return message.toLowerCase().includes("invoke") ? fallback : message || fallback;
}

function installedModelName(item: { readonly id?: unknown; readonly model?: unknown; readonly name?: unknown }) {
  if (typeof item.id === "string") {
    return item.id;
  }
  if (typeof item.model === "string") {
    return item.model;
  }
  return typeof item.name === "string" ? item.name : "";
}

function Section({
  children,
  title
}: {
  readonly children: ReactNode;
  readonly title: string;
}) {
  return (
    <section className="border-b border-[var(--border-subtle)] py-4 last:border-b-0">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-normal text-[var(--text-muted)]">{title}</div>
      <div className="divide-y divide-[var(--border-subtle)]">{children}</div>
    </section>
  );
}

function Row({
  children,
  detail,
  label
}: {
  readonly children: ReactNode;
  readonly detail?: string;
  readonly label: string;
}) {
  return (
    <div className="grid min-h-10 grid-cols-[180px_minmax(0,1fr)] items-center gap-4 py-1.5 max-[820px]:grid-cols-1 max-[820px]:gap-1.5">
      <div className="min-w-0">
        <div className="truncate text-[12px] font-medium leading-4 text-[var(--text-primary)]">{label}</div>
        {detail ? <div className="truncate text-[11px] leading-4 text-[var(--text-muted)]">{detail}</div> : null}
      </div>
      <div className="flex min-w-0 justify-end max-[820px]:justify-start">{children}</div>
    </div>
  );
}

function RuntimeNumber({
  label,
  max,
  min,
  onChange,
  step = 1,
  value
}: {
  readonly label: string;
  readonly max: number;
  readonly min: number;
  readonly onChange: (value: number) => void;
  readonly step?: number;
  readonly value: number;
}) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onChange(clamp(Number(event.target.value), min, max));
  }

  return (
    <Row label={label}>
      <input
        className={numberInputClass}
        max={max}
        min={min}
        onChange={handleChange}
        step={step}
        type="number"
        value={step < 1 ? value.toFixed(2) : value}
      />
    </Row>
  );
}

function SettingSelect<T extends string>({
  ariaLabel,
  options,
  onChange,
  value,
  widthClass = "w-40"
}: {
  readonly ariaLabel: string;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
  readonly value: T;
  readonly widthClass?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className={joinClasses("relative inline-flex max-w-full", widthClass)} ref={menuRef}>
      <button
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        className="flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--control-bg)] px-2 text-left text-[12px] text-[var(--text-primary)] outline-none transition-[background-color,border-color] duration-100 hover:bg-[var(--control-bg-hover)] focus:border-[var(--accent)] focus:bg-[var(--bg-elevated)] focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span className="min-w-0 truncate">{selectedOption.label}</span>
        <CaretDown
          aria-hidden="true"
          className={joinClasses(
            "shrink-0 text-[var(--text-muted)] transition-transform duration-100",
            isOpen && "rotate-180"
          )}
          size={12}
          weight="regular"
        />
      </button>
      {isOpen ? (
        <div
          aria-label={ariaLabel}
          className="absolute right-0 top-[calc(100%+4px)] z-50 w-full min-w-32 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-menu)]"
          role="listbox"
        >
          {options.map((option) => (
            <button
              aria-selected={option.value === value}
              className={joinClasses(
                "flex h-7 w-full items-center px-2 text-left text-[12px] outline-none transition-colors duration-100 focus-visible:bg-[var(--control-bg-hover)]",
                option.value === value
                  ? "bg-[var(--control-bg-hover)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
              )}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              role="option"
              type="button"
            >
              <span className="truncate">{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ContextScale({
  max,
  onChange,
  value
}: {
  readonly max: number;
  readonly onChange: (value: number) => void;
  readonly value: number;
}) {
  return (
    <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_80px] items-center gap-2">
              <div className="grid min-w-0 grid-cols-6 gap-1" role="radiogroup" aria-label="Context length presets">
        {contextMarks.map((mark) => {
          const disabled = mark > max;
          const selected = value === mark;
          return (
            <button
              aria-checked={selected}
              className={joinClasses(
                "h-8 rounded-[var(--radius-md)] border px-2 text-[12px] tabular-nums transition-[background-color,border-color,color,opacity] duration-100 ease-out",
                selected
                  ? "border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--bg-workspace-main)]"
                  : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]",
                "outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]",
                disabled && "cursor-default opacity-35 hover:bg-transparent hover:text-[var(--text-secondary)]"
              )}
              disabled={disabled}
              key={mark}
              onClick={() => onChange(mark)}
              role="radio"
              type="button"
            >
              {formatTokens(mark)}
            </button>
          );
        })}
      </div>
      <input
        aria-label="Context length override"
        className={numberInputClass}
        max={max}
        min={4096}
        onChange={(event) => onChange(Number(event.target.value))}
        step={1024}
        type="number"
        value={value}
      />
    </div>
  );
}

function endpointStatusLabel(status: EndpointStatus) {
  if (status === "checking") {
    return "Checking";
  }
  if (status === "reachable") {
    return "Online";
  }
  if (status === "unreachable") {
    return "Offline";
  }
  return "Not checked";
}

function StatusLine({
  status,
  text
}: {
  readonly status: EndpointStatus;
  readonly text: string;
}) {
  return (
    <span
      className={joinClasses(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] px-2 text-[11px] font-medium",
        status === "reachable" && "text-[var(--success)]",
        status === "unreachable" && "text-[var(--danger)]",
        status !== "reachable" && status !== "unreachable" && "text-[var(--text-muted)]"
      )}
    >
      <span
        className={joinClasses(
          "h-1.5 w-1.5 rounded-full",
          status === "reachable"
            ? "bg-[var(--success)]"
            : status === "unreachable"
              ? "bg-[var(--danger)]"
              : "bg-[var(--text-muted)]"
        )}
      />
      {text}
    </span>
  );
}

function RuntimeSummary({
  error,
  plan,
  profile
}: {
  readonly error: string | null;
  readonly plan: NativeRuntimePlan | null;
  readonly profile: HardwareProfile;
}) {
  const text = error
    ? error
    : plan
      ? `${plan.modelFile} / ${plan.gpuLayers} layers / ${plan.kvCache === "gpu" ? "GPU KV" : "DDR5 KV"}`
      : `${profile.quantization.toUpperCase()} / ${formatTokens(profile.context)} / ${profile.gpuLayers} layers`;

  return <div className="min-w-0 truncate text-[11px] leading-4 text-[var(--text-muted)]">{text}</div>;
}

export function AiModelsPane({
  className,
  embedded = false,
  initialSettings,
  marketplaceModel,
  onClearMarketplaceModel,
  onImportRequest,
  onOpenMarketplace,
  onSettingsChange
}: AiModelsPaneProps) {
  const [settings, setSettings] = useState(() => sanitizeSettings({ ...readStoredSettings(), ...initialSettings }));
  const [imports, setImports] = useState(readStoredImports);
  const [installedModels, setInstalledModels] = useState<readonly string[]>([]);
  const [nativeImportPlan, setNativeImportPlan] = useState<NativeImportPlan | null>(null);
  const [nativeRuntimePlan, setNativeRuntimePlan] = useState<NativeRuntimePlan | null>(null);
  const [nativePlanError, setNativePlanError] = useState<string | null>(null);
  const [endpointStatus, setEndpointStatus] = useState<EndpointStatus>("idle");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const model = modelFor(settings.modelKey);
  const profile = profileFor(settings.hardwareProfileId);
  const modelfile = useMemo(() => modelfileFor(settings), [settings]);
  const command = useMemo(() => commandFor(settings), [settings]);
  const availableProfiles = hardwareProfiles.filter((item) => item.modelKey === settings.modelKey);
  const matchingImports = imports.filter((item) => item.modelKey === settings.modelKey);
  const expectedFile = model.ggufFile[settings.quantization] ?? "";
  const quantizationOptions = useMemo(
    () =>
      [
        model.recommendedModelId.q2_0 ? { label: "Q2_0", value: "q2_0" as const } : null,
        model.recommendedModelId.q2_k ? { label: "Q2_K", value: "q2_k" as const } : null,
        model.recommendedModelId.q3_k_m ? { label: "Q3_K_M", value: "q3_k_m" as const } : null,
        model.recommendedModelId.q4_k_m ? { label: "Q4_K_M", value: "q4_k_m" as const } : null
      ].filter((option): option is { readonly label: string; readonly value: QuantizationId } => option !== null),
    [model]
  );

  function updateSettings(next: Partial<AiModelRuntimeSettings>) {
    setSettings((current) => sanitizeSettings({ ...current, ...next }));
  }

  function updateProviderModelId(providerModelId: string) {
    onClearMarketplaceModel?.();
    updateSettings({ providerModelId });
  }

  function resetModelSettings() {
    onClearMarketplaceModel?.();
    const reset = sanitizeSettings({
      ...defaultSettings,
      modelDirectory: settings.modelDirectory || defaultSettings.modelDirectory
    });
    setSettings(reset);
    setLastAction("Defaults restored");
  }

  function selectModel(modelKey: LocalModelKey) {
    onClearMarketplaceModel?.();
    const nextModel = modelFor(modelKey);
    const nextProfile = defaultProfileFor(nextModel);
    updateSettings({
      modelKey,
      hardwareProfileId: nextProfile.id,
      quantization: nextProfile.quantization,
      contextWindowTokens: nextProfile.context,
      gpuLayers: nextProfile.gpuLayers,
      endpoint:
        nextModel.preferredRuntime === "prism_llama_cpp"
          ? PRISM_LLAMA_CPP_DEFAULT_ENDPOINT
          : OLLAMA_DEFAULT_ENDPOINT,
      providerModelId: nextModel.recommendedModelId[nextProfile.quantization] ?? ""
    });
  }

  function selectProfile(profileId: HardwareProfileId) {
    onClearMarketplaceModel?.();
    const nextProfile = profileFor(profileId);
    updateSettings({
      hardwareProfileId: profileId,
      quantization: nextProfile.quantization,
      contextWindowTokens: nextProfile.context,
      gpuLayers: nextProfile.gpuLayers,
      providerModelId: model.recommendedModelId[nextProfile.quantization] ?? settings.providerModelId
    });
  }

  function selectQuantization(quantization: QuantizationId) {
    onClearMarketplaceModel?.();
    updateSettings({
      quantization,
      providerModelId: model.recommendedModelId[quantization] ?? settings.providerModelId
    });
  }

  async function checkEndpoint() {
    setEndpointStatus("checking");
    setLastAction(null);
    if (!isLoopbackEndpoint(settings.endpoint)) {
      setEndpointStatus("unreachable");
      setInstalledModels([]);
      setLastAction("Endpoint must be localhost");
      return;
    }

    try {
      const endpoint = settings.endpoint.replace(/\/+$/, "");
      const prismRuntime = modelUsesPrismLlamaCpp(model);
      const response = await fetch(`${endpoint}${prismRuntime ? "/v1/models" : "/api/tags"}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = (await response.json()) as {
        data?: readonly { id?: unknown }[];
        models?: readonly { name?: unknown; model?: unknown }[];
      };
      setInstalledModels(
        (prismRuntime ? (payload.data ?? []) : (payload.models ?? []))
          .map(installedModelName)
          .filter(Boolean)
      );
      setEndpointStatus("reachable");
      setLastAction(prismRuntime ? "Prism llama.cpp connected" : "Ollama connected");
    } catch {
      setEndpointStatus("unreachable");
      setInstalledModels([]);
      setLastAction(modelUsesPrismLlamaCpp(model) ? "Prism llama.cpp unreachable" : "Ollama unreachable");
    }
  }

  async function openModelDirectory() {
    try {
      await invoke("open_model_directory", { request: { modelDirectory: settings.modelDirectory } });
      setLastAction("Model folder opened");
    } catch (error) {
      setLastAction(nativeErrorMessage(error, "Model folder opens in the desktop app"));
    }
  }

  async function copyText(text: string, label: string) {
    await navigator.clipboard?.writeText(text);
    setLastAction(`${label} copied`);
  }

  function registerImport() {
    const path = settings.ggufPath.trim();
    if (!path) {
      return;
    }

    setLastAction("Validating GGUF");
    void invoke<NativeImportPlan>("plan_ai_model_import", {
      request: {
        source: {
          sourceType: "localGgufPath",
          path
        },
        modelId: settings.modelKey,
        quantization: settings.quantization,
        ollamaModelName: settings.providerModelId,
        contextSizeTokens: settings.contextWindowTokens
      }
    })
      .then((plan) => {
        const validatedPath = plan.validatedLocalPath ?? path;
        const item: ImportedGguf = {
          id: `gguf_${Date.now().toString(36)}`,
          path: validatedPath,
          modelKey: settings.modelKey,
          quantization: plan.quantization ?? settings.quantization,
          importedAt: new Date().toISOString()
        };
        const nextImports = [item, ...imports.filter((current) => current.path !== validatedPath)].slice(0, 8);
        setImports(nextImports);
        setNativeImportPlan(plan);
        setLastAction("GGUF validated");
        updateSettings({ ggufPath: validatedPath });
        onImportRequest?.({ settings: { ...settings, ggufPath: validatedPath }, modelfile, command });
      })
      .catch((error) => {
        setNativeImportPlan(null);
        setLastAction(nativeErrorMessage(error, "GGUF validation runs in the desktop app"));
      });
  }

  useEffect(() => {
    void invoke<string>("get_default_model_directory")
      .then((modelDirectory) => {
        setSettings((current) => {
          if (current.modelDirectory && current.modelDirectory !== fallbackModelDirectory) {
            return current;
          }
          return sanitizeSettings({ ...current, modelDirectory });
        });
      })
      .catch(() => {
        // Browser/dev fallback keeps the editable default path.
      });
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      writeStoredAiModelRuntimeSettings(settings);
    }
    onSettingsChange?.(settings);
  }, [onSettingsChange, settings]);

  useEffect(() => {
    let cancelled = false;

    void invoke<NativeRuntimePlan>("plan_ai_model_runtime", {
      request: {
        modelId: settings.modelKey,
        gpu: {
          dedicatedVramGb: profile.dedicatedVramGb,
          ddr5RamGb: profile.ddr5RamGb
        },
        quantization: settings.quantization,
        contextSizeTokens: settings.contextWindowTokens
      }
    })
      .then((plan) => {
        if (!cancelled) {
          setNativeRuntimePlan(plan);
          setNativePlanError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setNativeRuntimePlan(null);
          setNativePlanError(nativeErrorMessage(error, "Native planner runs in the desktop app"));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [profile.ddr5RamGb, profile.dedicatedVramGb, settings.contextWindowTokens, settings.modelKey, settings.quantization]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(importsStorageKey, JSON.stringify(imports));
    }
  }, [imports]);

  return (
    <section
      aria-label="AI models"
      className={joinClasses(
        embedded ? "grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)]" : "grid min-h-0 min-w-0 grid-rows-[40px_minmax(0,1fr)]",
        "bg-[var(--bg-workspace-main)] text-[13px] text-[var(--text-primary)]",
        className
      )}
    >
      {embedded ? null : (
        <div className="flex min-w-0 items-center justify-between border-b border-[var(--border)] px-4">
          <div className="flex min-w-0 items-center gap-2">
            <Lightning className="shrink-0 text-[var(--text-muted)]" size={15} weight="regular" />
            <div className="truncate text-[12px] font-medium">AI Models</div>
            <div className="hidden truncate text-[11px] text-[var(--text-muted)] min-[760px]:block">
              {model.shortName} / {settings.quantization.toUpperCase()} / {formatTokens(settings.contextWindowTokens)}
            </div>
          </div>
          <button className={controlClass} onClick={resetModelSettings} type="button">
            Reset
          </button>
        </div>
      )}

      <div className="min-h-0 overflow-auto">
        <div className="mx-auto grid w-full max-w-[1160px] grid-cols-[minmax(0,1fr)_minmax(360px,430px)] px-6 py-3 max-[980px]:block">
          <div className="min-w-0 pr-6 max-[980px]:pr-0">
          <Section title="Built-in presets">
            <Row label="Preset">
              <div
                aria-label="Built-in model preset"
                className="grid min-w-0 flex-1 grid-cols-2 gap-0.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--control-bg)] p-0.5 max-[760px]:grid-cols-1"
                role="radiogroup"
              >
                {modelDefinitions.map((item) => (
                  <button
                    aria-checked={item.key === settings.modelKey}
                    className={joinClasses(
                      "grid min-h-10 grid-cols-[minmax(0,1fr)_16px] items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left outline-none transition-[background-color,color] duration-100 focus-visible:ring-1 focus-visible:ring-[var(--accent)]",
                      item.key === settings.modelKey
                        ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
                    )}
                    key={item.key}
                    onClick={() => selectModel(item.key)}
                    role="radio"
                    type="button"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-medium">{item.name}</span>
                      <span className="block truncate text-[11px] text-[var(--text-muted)]">
                        Built-in / {item.family} / {item.parameters}
                      </span>
                    </span>
                    {item.key === settings.modelKey ? <Check size={14} weight="bold" /> : null}
                  </button>
                ))}
              </div>
            </Row>
          </Section>

          <Section title="Marketplace and installed">
            {marketplaceModel ? (
              <Row label="Active marketplace model" detail={marketplaceModel.sourceRepo}>
                <div className="flex min-w-0 flex-1 items-center justify-end gap-2 max-[820px]:justify-start">
                  <span className="min-w-0 truncate text-[11px] text-[var(--text-muted)]">
                    {marketplaceModel.ggufFileName ?? marketplaceModel.modelId} / {marketplaceModel.ollamaModelName}
                  </span>
                  <button
                    className={controlClass}
                    onClick={() => window.open(marketplaceModel.sourceUrl, "_blank", "noopener,noreferrer")}
                    type="button"
                  >
                    Source
                  </button>
                  {onClearMarketplaceModel ? (
                    <button className={controlClass} onClick={onClearMarketplaceModel} type="button">
                      Clear
                    </button>
                  ) : null}
                </div>
              </Row>
            ) : null}
            <Row
              label={modelUsesPrismLlamaCpp(model) ? "Server model" : "Provider tag"}
              detail={modelUsesPrismLlamaCpp(model) ? "Prism llama-server model name" : "Ollama tag used by chat"}
            >
              <input
                aria-label={modelUsesPrismLlamaCpp(model) ? "llama-server model name" : "Ollama provider tag"}
                className={`${inputClass} w-[320px] max-w-full`}
                onChange={(event) => updateProviderModelId(event.target.value)}
                spellCheck={false}
                value={settings.providerModelId}
              />
            </Row>
            <Row label="Downloaded models">
              <div className="flex min-w-0 flex-1 items-center justify-end gap-2 max-[820px]:justify-start">
                <span className="min-w-0 truncate text-[11px] text-[var(--text-muted)]">
                  {modelUsesPrismLlamaCpp(model)
                    ? "Download the official GGUF, serve it with Prism llama.cpp, then point chat at that server."
                    : "Download GGUF models from Hugging Face, then use their Ollama tag here."}
                </span>
                {onOpenMarketplace ? (
                  <button className={controlClass} onClick={onOpenMarketplace} type="button">
                    <span className="inline-flex items-center gap-1.5">
                      Open Marketplace
                      <ArrowSquareOut size={13} weight="regular" />
                    </span>
                  </button>
                ) : null}
              </div>
            </Row>
            {installedModels.length > 0 ? (
              <Row label={modelUsesPrismLlamaCpp(model) ? "Server models" : "Installed Ollama tags"}>
                <div className="flex min-w-0 flex-1 flex-wrap justify-end gap-1.5 max-[820px]:justify-start">
                  {installedModels.slice(0, 6).map((installed) => (
                    <button
                      className="h-7 max-w-52 truncate rounded-[var(--radius-md)] px-2 text-[12px] text-[var(--text-secondary)] transition-colors duration-100 hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
                      key={installed}
                      onClick={() => updateProviderModelId(installed)}
                      type="button"
                    >
                      {installed}
                    </button>
                  ))}
                </div>
              </Row>
            ) : null}
          </Section>

          <Section title="Local runtime">
            <Row label={modelUsesPrismLlamaCpp(model) ? "Prism endpoint" : "Ollama endpoint"}>
              <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 max-[640px]:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  aria-label={modelUsesPrismLlamaCpp(model) ? "Prism llama.cpp endpoint" : "Ollama endpoint"}
                  className={`${inputClass} w-full`}
                  onChange={(event) => updateSettings({ endpoint: event.target.value })}
                  spellCheck={false}
                  value={settings.endpoint}
                />
                <StatusLine status={endpointStatus} text={endpointStatusLabel(endpointStatus)} />
                <button
                  className={controlClass}
                  disabled={endpointStatus === "checking"}
                  onClick={checkEndpoint}
                  type="button"
                >
                  Check
                </button>
              </div>
            </Row>
          </Section>

          <Section title="Files">
            <Row label="Model folder">
              <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-2">
                <input
                  aria-label="Model location"
                  className={`${inputClass} w-full`}
                  onChange={(event) => updateSettings({ modelDirectory: event.target.value })}
                  spellCheck={false}
                  value={settings.modelDirectory}
                />
                <button className={controlClass} onClick={openModelDirectory} type="button">
                  <span className="inline-flex items-center gap-1.5">
                    <FolderOpen size={14} weight="regular" />
                    Open
                  </span>
                </button>
              </div>
            </Row>
            <Row label="GGUF file">
              <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-2">
                <input
                  aria-label="GGUF file path"
                  className={`${inputClass} w-full`}
                  onChange={(event) => updateSettings({ ggufPath: event.target.value })}
                  placeholder={`${settings.modelDirectory}\\${expectedFile}`}
                  spellCheck={false}
                  value={settings.ggufPath}
                />
                <button
                  className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--text-primary)] px-2.5 text-[12px] font-medium text-[var(--bg-workspace-main)] transition-opacity duration-100 hover:opacity-90 disabled:cursor-default disabled:opacity-40"
                  disabled={!settings.ggufPath.trim()}
                  onClick={registerImport}
                  type="button"
                >
                  <DownloadSimple size={14} weight="bold" />
                  Import
                </button>
              </div>
            </Row>
            {settings.modelKey === QUARTZ_NANO_UI_MODEL_ID ? (
              <Row label="LoRA adapter">
                <input
                  aria-label="Quartz Nano LoRA adapter GGUF path"
                  className={`${inputClass} min-w-0 flex-1`}
                  onChange={(event) => updateSettings({ loraAdapterPath: event.target.value })}
                  placeholder="Optional override; Quartz Nano uses the default adapter when present"
                  spellCheck={false}
                  value={settings.loraAdapterPath}
                />
              </Row>
            ) : null}
            {matchingImports.length > 0 ? (
              <Row label="Recent imports">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  {matchingImports.slice(0, 3).map((item) => (
                    <button
                      className="grid h-8 w-full grid-cols-[minmax(0,1fr)_64px] items-center gap-2 rounded-[var(--radius-md)] px-2 text-left text-[12px] text-[var(--text-secondary)] transition-colors duration-100 hover:bg-[var(--control-bg)] hover:text-[var(--text-primary)]"
                      key={item.id}
                      onClick={() => updateSettings({ ggufPath: item.path, quantization: item.quantization })}
                      type="button"
                    >
                      <span className="truncate">{item.path}</span>
                      <span className="text-right text-[11px] text-[var(--text-muted)]">
                        {item.quantization.toUpperCase()}
                      </span>
                    </button>
                  ))}
                </div>
              </Row>
            ) : null}
          </Section>
          </div>

          <div className="min-w-0 border-l border-[var(--border-subtle)] pl-6 max-[980px]:border-l-0 max-[980px]:pl-0">
          <Section title="Memory">
            <Row label="Runtime status">
              <div className="min-w-0 flex-1 text-right max-[820px]:text-left">
                <RuntimeSummary error={nativePlanError} plan={nativeRuntimePlan} profile={profile} />
              </div>
            </Row>
            <Row label="Profile">
              <div
                aria-label="Memory profile"
                className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--control-bg)] p-0.5"
                role="radiogroup"
              >
                {availableProfiles.map((item) => (
                  <button
                    aria-checked={item.id === settings.hardwareProfileId}
                    className={joinClasses(
                      "grid h-9 w-full grid-cols-[minmax(0,1fr)_16px] items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left text-[12px] outline-none transition-colors duration-100 focus-visible:ring-1 focus-visible:ring-[var(--accent)]",
                      item.id === settings.hardwareProfileId
                        ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
                    )}
                    key={item.id}
                    onClick={() => selectProfile(item.id)}
                    role="radio"
                    type="button"
                  >
                    <span className="truncate">
                      <span className="font-medium">{item.label}</span>
                      <span className="text-[var(--text-muted)]">
                        {" / "}
                        {item.quantization.toUpperCase()} / {formatTokens(item.context)} / {item.gpuLayers} layers /{" "}
                        {item.kvCache === "DDR5" ? "DDR5 spillover" : "GPU KV"}
                      </span>
                    </span>
                    {item.id === settings.hardwareProfileId ? <Check size={14} weight="bold" /> : null}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Context">
              <ContextScale
                max={model.maxContext}
                onChange={(contextWindowTokens) => updateSettings({ contextWindowTokens })}
                value={settings.contextWindowTokens}
              />
            </Row>
            <Row label="Quantization">
              <SettingSelect
                ariaLabel="Quantization"
                onChange={selectQuantization}
                options={quantizationOptions}
                value={settings.quantization}
              />
            </Row>
          </Section>

          <Section title="Advanced runtime">
            <button
              aria-expanded={advancedOpen}
              className="grid min-h-10 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-[var(--radius-md)] px-2 text-left outline-none transition-colors duration-100 hover:bg-[var(--control-bg)] focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
              onClick={() => setAdvancedOpen((open) => !open)}
              type="button"
            >
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-medium text-[var(--text-primary)]">
                  {advancedOpen ? "Hide runtime controls" : "Show runtime controls"}
                </span>
                <span className="block truncate text-[11px] leading-4 text-[var(--text-muted)]">
                  {settings.gpuLayers} GPU layers / {settings.cpuThreads} CPU threads / {settings.maxOutputTokens} output
                </span>
              </span>
              <CaretDown
                className={joinClasses("text-[var(--text-muted)] transition-transform duration-100", advancedOpen && "rotate-180")}
                size={12}
              />
            </button>
            {advancedOpen ? (
              <>
                <Row label="Runtime plan">
                  <div className="min-w-0 flex-1 text-right text-[11px] leading-4 text-[var(--text-muted)] max-[820px]:text-left">
                    {nativePlanError
                      ? nativePlanError
                      : nativeRuntimePlan
                        ? `${nativeRuntimePlan.modelFile} / ${nativeRuntimePlan.gpuLayers} GPU layers / ${nativeRuntimePlan.kvCache === "gpu" ? "GPU KV" : "DDR5 KV"}`
                        : "Planning runtime"}
                  </div>
                </Row>
                <RuntimeNumber
                  label="GPU layers"
                  max={model.maxGpuLayers}
                  min={0}
                  onChange={(gpuLayers) => updateSettings({ gpuLayers })}
                  value={settings.gpuLayers}
                />
                <RuntimeNumber
                  label="CPU threads"
                  max={32}
                  min={1}
                  onChange={(cpuThreads) => updateSettings({ cpuThreads })}
                  value={settings.cpuThreads}
                />
                <RuntimeNumber
                  label="Max output"
                  max={maxOutputTokenLimit}
                  min={256}
                  onChange={(maxOutputTokens) => updateSettings({ maxOutputTokens })}
                  step={256}
                  value={settings.maxOutputTokens}
                />
                <RuntimeNumber
                  label="Temperature"
                  max={1.5}
                  min={0}
                  onChange={(temperature) => updateSettings({ temperature })}
                  step={0.05}
                  value={settings.temperature}
                />
                <Row label="Flash attention">
                  <Switch
                    checked={settings.flashAttention}
                    label="Flash attention"
                    onChange={(flashAttention) => updateSettings({ flashAttention })}
                  />
                </Row>
                <Row label="Memory map">
                  <Switch
                    checked={settings.mmapModel}
                    label="Memory map"
                    onChange={(mmapModel) => updateSettings({ mmapModel })}
                  />
                </Row>
                <Row label="Lock in RAM">
                  <Switch
                    checked={settings.mlockModel}
                    label="Lock in RAM"
                    onChange={(mlockModel) => updateSettings({ mlockModel })}
                  />
                </Row>
                <Row label="Import plan">
                  <div className="min-w-0 flex-1 text-right text-[11px] leading-4 text-[var(--text-muted)] max-[820px]:text-left">
                    {nativeImportPlan
                      ? `${nativeImportPlan.ollamaTag} / ${nativeImportPlan.downloadRequired ? "download required" : "local GGUF"}`
                      : settings.ggufPath.trim()
                        ? "Validate GGUF to create an import plan."
                        : "No local GGUF imported"}
                  </div>
                </Row>
                <Row label={modelUsesPrismLlamaCpp(model) ? "Server command" : "Ollama output"}>
                  <div className="flex min-w-0 flex-1 justify-end gap-1.5 max-[820px]:justify-start">
                    {!modelUsesPrismLlamaCpp(model) ? (
                    <button className={controlClass} onClick={() => void copyText(modelfile, "Modelfile")} type="button">
                      Copy Modelfile
                    </button>
                    ) : null}
                    <button className={controlClass} onClick={() => void copyText(command, "Command")} type="button">
                      Copy command
                    </button>
                  </div>
                </Row>
                <Row label="Defaults">
                  <button className={controlClass} onClick={resetModelSettings} type="button">
                    Reset
                  </button>
                </Row>
              </>
            ) : null}
          </Section>
          </div>

          {lastAction ? (
            <div className="col-span-2 pb-4 pt-1 text-right text-[11px] text-[var(--text-muted)]">{lastAction}</div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
