import type {
  IsoDateTimeString,
  JsonValue,
  NonEmptyString,
  VersionedContract,
} from "./common";
import type {
  AiModelId,
  ContextBundleId,
  LocalAiJobId,
  PatchSetId,
  ProjectId,
  PromptId,
  RevisionId,
  SelectionId,
  SessionId,
  UiSkillId,
} from "./ids";
import type { SourceCandidateResult, VisibleSelection } from "./preview";
import type { PromptContract } from "./prompt";

export type LocalAiProvider =
  | { readonly kind: "ollama"; readonly endpoint: NonEmptyString }
  | { readonly kind: "lm_studio"; readonly endpoint: NonEmptyString }
  | { readonly kind: "custom_local"; readonly endpoint: NonEmptyString };

export type GpuMemoryProfile = {
  readonly dedicatedVramGb: number;
  readonly ddr5RamGb?: number | null;
};

export type QwopusQuantizationTier = "q3_k_m" | "q4_k_m";
export type KvCachePlacement = "gpu" | "system_ram";

export type QwopusRuntimePlan = {
  readonly repo: "KyleHessling1/Qwopus-GLM-18B-Merged-GGUF";
  readonly modelFile: NonEmptyString;
  readonly quantization: QwopusQuantizationTier;
  readonly ggufSizeGb: number;
  readonly contextSizeTokens: number;
  readonly gpuLayers: number;
  readonly flashAttention: boolean;
  readonly kvCache: KvCachePlacement;
  readonly mmapModel: boolean;
  readonly mlockModel: boolean;
  readonly cpuSpillEnabled: boolean;
  readonly minimumRecommendedDdr5Gb: number;
  readonly llamaServerArgs: readonly NonEmptyString[];
  readonly notes: readonly NonEmptyString[];
};

export type LocalAiModel = {
  readonly id: AiModelId;
  readonly provider: LocalAiProvider;
  readonly displayName: NonEmptyString;
  readonly contextWindowTokens: number;
};

export type AiContextSourceFile = {
  readonly path: import("./common").RelativeFilePath;
  readonly selectedRanges: readonly import("./preview").SourceRange[];
  readonly contentHash: import("./common").FileHash;
  readonly excerpt: NonEmptyString;
};

export type AiContextBundle = VersionedContract & {
  readonly id: ContextBundleId;
  readonly projectId: ProjectId;
  readonly sessionId: SessionId;
  readonly revisionId: RevisionId;
  readonly selection: VisibleSelection | null;
  readonly sourceCandidates: readonly SourceCandidateResult[];
  readonly sourceFiles: readonly AiContextSourceFile[];
  readonly promptId: PromptId;
  readonly uiSkillIds: readonly UiSkillId[];
  readonly createdAt: IsoDateTimeString;
};

export type LocalAiJobRequest = VersionedContract & {
  readonly projectId: ProjectId;
  readonly sessionId: SessionId;
  readonly revisionId: RevisionId;
  readonly prompt: PromptContract;
  readonly context: AiContextBundle;
  readonly model: LocalAiModel;
  readonly requestedAt: IsoDateTimeString;
};

export type LocalAiJobState =
  | { readonly kind: "queued" }
  | {
      readonly kind: "running";
      readonly startedAt: IsoDateTimeString;
      readonly progress: number;
    }
  | {
      readonly kind: "completed";
      readonly completedAt: IsoDateTimeString;
      readonly patchSetId: PatchSetId;
      readonly summary: NonEmptyString;
    }
  | {
      readonly kind: "failed";
      readonly failedAt: IsoDateTimeString;
      readonly reason: NonEmptyString;
      readonly recoverable: boolean;
    }
  | {
      readonly kind: "cancelled";
      readonly cancelledAt: IsoDateTimeString;
      readonly reason: NonEmptyString;
    };

export type LocalAiJob = VersionedContract & {
  readonly id: LocalAiJobId;
  readonly projectId: ProjectId;
  readonly sessionId: SessionId;
  readonly request: LocalAiJobRequest;
  readonly state: LocalAiJobState;
  readonly createdAt: IsoDateTimeString;
  readonly updatedAt: IsoDateTimeString;
};

export type LocalAiToolCall =
  | {
      readonly kind: "inspect_source";
      readonly path: import("./common").RelativeFilePath;
      readonly reason: NonEmptyString;
    }
  | {
      readonly kind: "propose_patch";
      readonly patchSetId: PatchSetId;
      readonly metadata: JsonValue;
    };
