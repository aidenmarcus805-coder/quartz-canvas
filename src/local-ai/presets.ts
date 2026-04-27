import type {
  LocalModelCapability,
  LocalModelDescriptor,
  LocalModelRuntimeOptions
} from "./provider";

export const OLLAMA_PROVIDER_ID = "ollama" as const;
export const OLLAMA_DEFAULT_ENDPOINT = "http://127.0.0.1:11434" as const;

export const QWOPUS_GLM_18B_GGUF_REPO = "KyleHessling1/Qwopus-GLM-18B-Merged-GGUF" as const;
export const TERNARY_BONSAI_8B_GGUF_REPO = "lilyanatia/Ternary-Bonsai-8B-GGUF" as const;

export type QuartzLocalModelCatalogId = "qwopus-glm-18b" | "ternary-bonsai-8b";
export type QuartzLocalModelQuantizationId = "q2_k" | "q3_k_m" | "q4_k_m";
export type QuartzLocalModelHardwareClass = "8gb_vram" | "12gb_vram" | "16gb_plus_vram";
export type QuartzLocalModelRuntimeFit = "preferred" | "supported_with_ddr5_spillover" | "below_recommended";

export type LocalModelHardwareProfile = Readonly<{
  dedicatedVramGb: number;
  ddr5RamGb?: number | null;
  cpuThreads?: number;
}>;

export type LocalModelOllamaImportMetadata = Readonly<{
  providerId: typeof OLLAMA_PROVIDER_ID;
  source: "huggingface_gguf";
  sourceRepo: string;
  sourceUrl: string;
  ggufFileName: string;
  providerModelId: string;
  modelfile: string;
}>;

export type LocalModelQuantizationProfile = Readonly<{
  id: QuartzLocalModelQuantizationId;
  displayName: string;
  ggufQuantization: string;
  quantizationBits: number;
  ggufSizeGb: number;
  providerModelId: string;
  ggufFileName: string;
  contextWindowTokens: number;
  maxOutputTokens: number;
  importMetadata: LocalModelOllamaImportMetadata;
}>;

export type LocalModelRuntimeRecommendation = Readonly<{
  id: string;
  displayName: string;
  hardwareClass: QuartzLocalModelHardwareClass;
  minimumDedicatedVramGb: number;
  maximumDedicatedVramGb?: number;
  minimumRecommendedDdr5Gb: number;
  quantizationId: QuartzLocalModelQuantizationId;
  runtimeOptions: LocalModelRuntimeOptions;
  kvCachePlacement: "gpu" | "system_ram";
  cpuSpilloverEnabled: boolean;
  flashAttentionRecommended: boolean;
  notes: readonly string[];
  llamaServerArgs: readonly string[];
}>;

export type LocalModelCatalogEntry = Readonly<{
  id: QuartzLocalModelCatalogId;
  providerId: typeof OLLAMA_PROVIDER_ID;
  displayName: string;
  shortName: string;
  description: string;
  architecture: string;
  parameterSize: string;
  sourceRepo: string;
  capabilities: readonly LocalModelCapability[];
  defaultQuantizationId: QuartzLocalModelQuantizationId;
  quantizations: readonly LocalModelQuantizationProfile[];
  runtimeRecommendations: readonly LocalModelRuntimeRecommendation[];
}>;

export type LocalModelHardwareAssessment = Readonly<{
  fit: QuartzLocalModelRuntimeFit;
  missingDdr5Gb: number;
  notes: readonly string[];
}>;

const QWOPUS_CAPABILITIES = [
  "chat",
  "streaming",
  "json_output",
  "evidence_citations"
] as const satisfies readonly LocalModelCapability[];

const BONSAI_CAPABILITIES = [
  "chat",
  "streaming",
  "json_output"
] as const satisfies readonly LocalModelCapability[];

export const QUARTZ_LOCAL_MODEL_CATALOG = [
  {
    id: "qwopus-glm-18b",
    providerId: OLLAMA_PROVIDER_ID,
    displayName: "Qwopus GLM 18B",
    shortName: "Qwopus",
    description: "Current Quartz local model for agentic editing, structured output, and code-aware workflows.",
    architecture: "glm/qwen3.5 hybrid",
    parameterSize: "18B",
    sourceRepo: QWOPUS_GLM_18B_GGUF_REPO,
    capabilities: QWOPUS_CAPABILITIES,
    defaultQuantizationId: "q4_k_m",
    quantizations: [
      quantizationProfile({
        sourceRepo: QWOPUS_GLM_18B_GGUF_REPO,
        id: "q3_k_m",
        displayName: "Q3_K_M - 8 GB VRAM with DDR5 spillover",
        ggufQuantization: "Q3_K_M",
        quantizationBits: 3,
        ggufSizeGb: 7.95,
        providerModelId: "qwopus-glm-18b:q3_k_m",
        ggufFileName: "Qwopus-GLM-18B-Healed-Q3_K_M.gguf",
        contextWindowTokens: 32_768,
        maxOutputTokens: 4_096
      }),
      quantizationProfile({
        sourceRepo: QWOPUS_GLM_18B_GGUF_REPO,
        id: "q4_k_m",
        displayName: "Q4_K_M - 12/16 GB VRAM",
        ggufQuantization: "Q4_K_M",
        quantizationBits: 4,
        ggufSizeGb: 9.84,
        providerModelId: "qwopus-glm-18b:q4_k_m",
        ggufFileName: "Qwopus-GLM-18B-Healed-Q4_K_M.gguf",
        contextWindowTokens: 49_152,
        maxOutputTokens: 4_096
      })
    ],
    runtimeRecommendations: [
      {
        id: "qwopus-8gb-vram-ddr5-spillover",
        displayName: "8 GB VRAM + DDR5 spillover",
        hardwareClass: "8gb_vram",
        minimumDedicatedVramGb: 8,
        maximumDedicatedVramGb: 12,
        minimumRecommendedDdr5Gb: 32,
        quantizationId: "q3_k_m",
        runtimeOptions: {
          contextWindowTokens: 32_768,
          gpuLayers: 48,
          keepAlive: "20m",
          rawOllamaOptions: {
            num_batch: 512,
            use_mmap: true,
            use_mlock: false
          }
        },
        kvCachePlacement: "system_ram",
        cpuSpilloverEnabled: true,
        flashAttentionRecommended: true,
        notes: [
          "Use Q3_K_M on 8 GB cards; keep part of the model/KV pressure in DDR5 instead of forcing a full VRAM fit.",
          "32 GB DDR5 is the practical floor for this profile, with 64 GB preferred for larger canvases or parallel desktop work."
        ],
        llamaServerArgs: [
          "-m Qwopus-GLM-18B-Healed-Q3_K_M.gguf",
          "-ngl 48",
          "-c 32768",
          "--flash-attn",
          "--mmap"
        ]
      },
      {
        id: "qwopus-12gb-vram",
        displayName: "12 GB VRAM",
        hardwareClass: "12gb_vram",
        minimumDedicatedVramGb: 12,
        maximumDedicatedVramGb: 16,
        minimumRecommendedDdr5Gb: 32,
        quantizationId: "q4_k_m",
        runtimeOptions: {
          contextWindowTokens: 49_152,
          gpuLayers: 64,
          keepAlive: "30m",
          rawOllamaOptions: {
            num_batch: 512,
            use_mmap: true,
            use_mlock: false
          }
        },
        kvCachePlacement: "gpu",
        cpuSpilloverEnabled: true,
        flashAttentionRecommended: true,
        notes: [
          "Use Q4_K_M on 12 GB cards; it is the baseline Quartz quality profile.",
          "DDR5 spillover remains allowed for long context, OS pressure, and editor-side multitasking."
        ],
        llamaServerArgs: [
          "-m Qwopus-GLM-18B-Healed-Q4_K_M.gguf",
          "-ngl 64",
          "-c 49152",
          "--flash-attn",
          "--mmap"
        ]
      },
      {
        id: "qwopus-16gb-plus-vram",
        displayName: "16+ GB VRAM",
        hardwareClass: "16gb_plus_vram",
        minimumDedicatedVramGb: 16,
        minimumRecommendedDdr5Gb: 32,
        quantizationId: "q4_k_m",
        runtimeOptions: {
          contextWindowTokens: 65_536,
          gpuLayers: 64,
          keepAlive: "45m",
          rawOllamaOptions: {
            num_batch: 768,
            use_mmap: true,
            use_mlock: false
          }
        },
        kvCachePlacement: "gpu",
        cpuSpilloverEnabled: true,
        flashAttentionRecommended: true,
        notes: [
          "Stay on Q4_K_M for Quartz quality; spend the extra VRAM on context and responsiveness instead of a larger quant.",
          "DDR5 spillover is still supported when expanded context or other GPU workloads push memory over budget."
        ],
        llamaServerArgs: [
          "-m Qwopus-GLM-18B-Healed-Q4_K_M.gguf",
          "-ngl 64",
          "-c 65536",
          "--flash-attn",
          "--mmap"
        ]
      }
    ]
  },
  {
    id: "ternary-bonsai-8b",
    providerId: OLLAMA_PROVIDER_ID,
    displayName: "Ternary Bonsai 8B",
    shortName: "Bonsai",
    description: "Compact GGUF fallback model for fast local drafting and lower-memory systems.",
    architecture: "qwen3",
    parameterSize: "8B",
    sourceRepo: TERNARY_BONSAI_8B_GGUF_REPO,
    capabilities: BONSAI_CAPABILITIES,
    defaultQuantizationId: "q2_k",
    quantizations: [
      quantizationProfile({
        sourceRepo: TERNARY_BONSAI_8B_GGUF_REPO,
        id: "q2_k",
        displayName: "Q2_K - compact ternary GGUF",
        ggufQuantization: "Q2_K",
        quantizationBits: 2,
        ggufSizeGb: 3.28,
        providerModelId: "ternary-bonsai-8b:q2_k",
        ggufFileName: "Ternary-Bonsai-8B-Q2_K.gguf",
        contextWindowTokens: 32_768,
        maxOutputTokens: 4_096
      })
    ],
    runtimeRecommendations: [
      {
        id: "bonsai-8gb-vram",
        displayName: "8+ GB VRAM",
        hardwareClass: "8gb_vram",
        minimumDedicatedVramGb: 8,
        minimumRecommendedDdr5Gb: 16,
        quantizationId: "q2_k",
        runtimeOptions: {
          contextWindowTokens: 32_768,
          keepAlive: "20m",
          rawOllamaOptions: {
            num_batch: 512,
            use_mmap: true,
            use_mlock: false
          }
        },
        kvCachePlacement: "gpu",
        cpuSpilloverEnabled: true,
        flashAttentionRecommended: true,
        notes: [
          "The Q2_K GGUF is small enough for broad 8 GB GPU coverage.",
          "DDR5 spillover is mainly a safety valve for long context and concurrent creative apps."
        ],
        llamaServerArgs: [
          "-m Ternary-Bonsai-8B-Q2_K.gguf",
          "-c 32768",
          "--flash-attn",
          "--mmap"
        ]
      }
    ]
  }
] as const satisfies readonly LocalModelCatalogEntry[];

export const QUARTZ_LOCAL_MODEL_PRESETS: readonly LocalModelDescriptor[] =
  QUARTZ_LOCAL_MODEL_CATALOG.flatMap((entry) =>
    entry.quantizations.map((quantization) => toLocalModelDescriptor(entry, quantization))
  );

export function listQuartzLocalModelCatalog(): readonly LocalModelCatalogEntry[] {
  return QUARTZ_LOCAL_MODEL_CATALOG;
}

export function listQuartzLocalModelDescriptors(): readonly LocalModelDescriptor[] {
  return QUARTZ_LOCAL_MODEL_PRESETS;
}

export function getQuartzLocalModelCatalogEntry(
  id: string
): LocalModelCatalogEntry | undefined {
  return QUARTZ_LOCAL_MODEL_CATALOG.find((entry) =>
    entry.id === id || entry.quantizations.some((quantization) => quantization.providerModelId === id)
  );
}

export function getQuartzLocalModelDescriptor(
  providerModelId: string
): LocalModelDescriptor | undefined {
  return QUARTZ_LOCAL_MODEL_PRESETS.find((model) => model.modelId === providerModelId);
}

export function getQuartzLocalModelQuantization(
  modelOrProviderId: string,
  quantizationId?: QuartzLocalModelQuantizationId
): LocalModelQuantizationProfile | undefined {
  return resolveQuantization(modelOrProviderId, quantizationId)?.quantization;
}

export function getQuartzOllamaImportMetadata(
  modelOrProviderId: string,
  quantizationId?: QuartzLocalModelQuantizationId
): LocalModelOllamaImportMetadata | undefined {
  return resolveQuantization(modelOrProviderId, quantizationId)?.quantization.importMetadata;
}

export function recommendQuartzLocalModelRuntime(
  modelOrProviderId: string,
  hardware: LocalModelHardwareProfile
): LocalModelRuntimeRecommendation | undefined {
  const entry = getQuartzLocalModelCatalogEntry(modelOrProviderId);
  if (!entry) {
    return undefined;
  }

  return entry.runtimeRecommendations.find((recommendation) =>
    hardware.dedicatedVramGb >= recommendation.minimumDedicatedVramGb &&
    (recommendation.maximumDedicatedVramGb === undefined ||
      hardware.dedicatedVramGb < recommendation.maximumDedicatedVramGb)
  ) ?? entry.runtimeRecommendations[entry.runtimeRecommendations.length - 1];
}

export function assessQuartzLocalModelHardware(
  recommendation: LocalModelRuntimeRecommendation,
  hardware: LocalModelHardwareProfile
): LocalModelHardwareAssessment {
  const missingDdr5Gb = Math.max(0, recommendation.minimumRecommendedDdr5Gb - (hardware.ddr5RamGb ?? 0));
  if (hardware.dedicatedVramGb < recommendation.minimumDedicatedVramGb) {
    return {
      fit: "below_recommended",
      missingDdr5Gb,
      notes: ["Dedicated VRAM is below the selected runtime profile.", ...recommendation.notes]
    };
  }

  if (recommendation.cpuSpilloverEnabled && missingDdr5Gb > 0) {
    return {
      fit: "supported_with_ddr5_spillover",
      missingDdr5Gb,
      notes: [
        `Add about ${missingDdr5Gb} GB DDR5 RAM to reach this profile's recommended spillover headroom.`,
        ...recommendation.notes
      ]
    };
  }

  return {
    fit: "preferred",
    missingDdr5Gb: 0,
    notes: recommendation.notes
  };
}

function quantizationProfile(
  profile: Omit<LocalModelQuantizationProfile, "importMetadata"> & { readonly sourceRepo: string }
): LocalModelQuantizationProfile {
  return {
    id: profile.id,
    displayName: profile.displayName,
    ggufQuantization: profile.ggufQuantization,
    quantizationBits: profile.quantizationBits,
    ggufSizeGb: profile.ggufSizeGb,
    providerModelId: profile.providerModelId,
    ggufFileName: profile.ggufFileName,
    contextWindowTokens: profile.contextWindowTokens,
    maxOutputTokens: profile.maxOutputTokens,
    importMetadata: {
      providerId: OLLAMA_PROVIDER_ID,
      source: "huggingface_gguf",
      sourceRepo: profile.sourceRepo,
      sourceUrl: huggingFaceResolveUrl(profile.sourceRepo, profile.ggufFileName),
      ggufFileName: profile.ggufFileName,
      providerModelId: profile.providerModelId,
      modelfile: createOllamaModelfile(profile.ggufFileName, profile.contextWindowTokens)
    }
  };
}

function toLocalModelDescriptor(
  entry: LocalModelCatalogEntry,
  quantization: LocalModelQuantizationProfile
): LocalModelDescriptor {
  return {
    providerId: entry.providerId,
    modelId: quantization.providerModelId,
    displayName: `${entry.displayName} ${quantization.ggufQuantization}`,
    contextWindowTokens: quantization.contextWindowTokens,
    maxOutputTokens: quantization.maxOutputTokens,
    capabilities: entry.capabilities,
    runtime: {
      sourceRepo: entry.sourceRepo,
      sourceUrl: quantization.importMetadata.sourceUrl,
      architecture: entry.architecture,
      parameterSize: entry.parameterSize,
      ggufQuantization: quantization.ggufQuantization,
      ggufFileName: quantization.ggufFileName,
      ggufSizeGb: quantization.ggufSizeGb,
      quantizationBits: quantization.quantizationBits,
      recommendedProviderModelId: quantization.providerModelId,
      installHint: `Create an Ollama Modelfile from ${quantization.ggufFileName}, then create ${quantization.providerModelId}.`
    }
  };
}

function resolveQuantization(
  modelOrProviderId: string,
  quantizationId?: QuartzLocalModelQuantizationId
): Readonly<{
  entry: LocalModelCatalogEntry;
  quantization: LocalModelQuantizationProfile;
}> | undefined {
  const entry = getQuartzLocalModelCatalogEntry(modelOrProviderId);
  if (!entry) {
    return undefined;
  }

  const quantization = entry.quantizations.find((profile) =>
    profile.id === quantizationId || profile.providerModelId === modelOrProviderId
  ) ?? entry.quantizations.find((profile) => profile.id === entry.defaultQuantizationId);

  return quantization ? { entry, quantization } : undefined;
}

function createOllamaModelfile(ggufFileName: string, contextWindowTokens: number): string {
  return [
    `FROM ./${ggufFileName}`,
    `PARAMETER num_ctx ${contextWindowTokens}`,
    "PARAMETER num_batch 512",
    "PARAMETER use_mmap true",
    "PARAMETER use_mlock false"
  ].join("\n");
}

function huggingFaceResolveUrl(repo: string, fileName: string): string {
  return `https://huggingface.co/${repo}/resolve/main/${encodeURIComponent(fileName)}`;
}
