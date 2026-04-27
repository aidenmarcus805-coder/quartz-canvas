import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode, type UIEvent } from "react";
import {
  ArrowClockwise,
  ArrowSquareOut,
  DownloadSimple,
  MagnifyingGlass,
  SpinnerGap,
  WarningCircle,
  X
} from "@phosphor-icons/react";

type MarketplaceLoadStatus = "loading" | "ready" | "error";
type MarketplaceTaskFilter = "all" | "text" | "code" | "vision" | "ready";
type MarketplaceCompatibilityFilter = "all" | "compatible" | "review";
type MarketplaceQuantFilter = "any" | "q2" | "q3" | "q4" | "q5" | "q6plus" | "fp";
type MarketplaceSizeFilter = "any" | "lt4b" | "4to8b" | "9to14b" | "15to32b" | "33bplus" | "unknown";
type MarketplaceSort = "downloads" | "updated" | "name";
type MarketplaceHardwareTier = "8gb" | "12gb" | "16gb";
type MarketplaceCompatibility = Readonly<{
  reason: string;
  severity: "compatible" | "review" | "blocked";
  shortLabel: string;
}>;

type HuggingFaceApiSibling = {
  readonly rfilename?: unknown;
  readonly size?: unknown;
  readonly lfs?: {
    readonly size?: unknown;
  } | null;
};

type HuggingFaceApiModel = {
  readonly authorData?: {
    readonly avatarUrl?: unknown;
    readonly avatar_url?: unknown;
  } | null;
  readonly id?: unknown;
  readonly modelId?: unknown;
  readonly author?: unknown;
  readonly downloads?: unknown;
  readonly gated?: unknown;
  readonly lastModified?: unknown;
  readonly likes?: unknown;
  readonly pipeline_tag?: unknown;
  readonly private?: unknown;
  readonly owner?: {
    readonly avatarUrl?: unknown;
    readonly avatar_url?: unknown;
  } | null;
  readonly siblings?: unknown;
  readonly tags?: unknown;
};

export type MarketplaceGgufFile = Readonly<{
  name: string;
  quantization: string | null;
  sizeBytes: number | null;
}>;

export type MarketplaceModel = Readonly<{
  author: string | null;
  avatarUrl: string | null;
  downloads: number | null;
  gated: boolean;
  ggufFiles: readonly MarketplaceGgufFile[];
  lastModified: string | null;
  license: string | null;
  modelId: string;
  parameterSize: string | null;
  preferredFile: MarketplaceGgufFile | null;
  sourceUrl: string;
  task: string | null;
}>;

export type MarketplaceModelSelection = Readonly<{
  ggufFileName: string | null;
  ggufUrl: string | null;
  modelId: string;
  sourceRepo: string;
  sourceUrl: string;
}>;

export type MarketplacePaneProps = {
  readonly actionLabel?: string;
  readonly className?: string;
  readonly initialQuery?: string;
  readonly onSelectModel?: (model: MarketplaceModelSelection) => void;
};

const fetchPageSize = 50;
const marketplacePrefsStorageKey = "quartz-canvas-marketplace-preferences-v1";
const aiModelSettingsStorageKey = "quartz-canvas-ai-model-settings-v1";
const searchDebounceMs = 240;

const quietButtonClass =
  "inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-md)] px-2 text-[12px] font-medium text-[var(--text-secondary)] transition-[background-color,color,opacity] duration-100 ease-out hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-45";

const toolbarFilterClass =
  "inline-flex h-7 items-center rounded-[var(--radius-md)] px-2 text-[12px] font-medium transition-[background-color,color] duration-100 ease-out focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]";

const marketplaceFilters = [
  { id: "all", label: "All" },
  { id: "text", label: "Text" },
  { id: "code", label: "Code" },
  { id: "vision", label: "Vision" },
  { id: "ready", label: "Ready" }
] as const satisfies readonly {
  readonly id: MarketplaceTaskFilter;
  readonly label: string;
}[];

const marketplaceSortOptions = [
  { id: "downloads", label: "Most downloaded" },
  { id: "updated", label: "Recent" },
  { id: "name", label: "Name" }
] as const satisfies readonly {
  readonly id: MarketplaceSort;
  readonly label: string;
}[];

const marketplaceQuantOptions = [
  { id: "any", label: "Any quant" },
  { id: "q2", label: "Q2 / IQ2" },
  { id: "q3", label: "Q3 / IQ3" },
  { id: "q4", label: "Q4 / IQ4" },
  { id: "q5", label: "Q5 / IQ5" },
  { id: "q6plus", label: "Q6+" },
  { id: "fp", label: "F16 / BF16" }
] as const satisfies readonly {
  readonly id: MarketplaceQuantFilter;
  readonly label: string;
}[];

const marketplaceSizeOptions = [
  { id: "any", label: "Any size" },
  { id: "lt4b", label: "<4B" },
  { id: "4to8b", label: "4-8B" },
  { id: "9to14b", label: "9-14B" },
  { id: "15to32b", label: "15-32B" },
  { id: "33bplus", label: "33B+" },
  { id: "unknown", label: "Unknown" }
] as const satisfies readonly {
  readonly id: MarketplaceSizeFilter;
  readonly label: string;
}[];

const marketplaceCompatibilityOptions = [
  { id: "all", label: "Show all" },
  { id: "compatible", label: "Compatible" },
  { id: "review", label: "Needs review" }
] as const satisfies readonly {
  readonly id: MarketplaceCompatibilityFilter;
  readonly label: string;
}[];

const marketplaceHardwareOptions = [
  { comfortableFileGiB: 6, id: "8gb", label: "8GB GPU", reviewFileGiB: 8, reviewParamB: 13, strongParamB: 20 },
  { comfortableFileGiB: 9.5, id: "12gb", label: "12GB GPU", reviewFileGiB: 12, reviewParamB: 20, strongParamB: 26 },
  { comfortableFileGiB: 13, id: "16gb", label: "16GB GPU", reviewFileGiB: 16, reviewParamB: 26, strongParamB: 33 }
] as const satisfies readonly {
  readonly comfortableFileGiB: number;
  readonly id: MarketplaceHardwareTier;
  readonly label: string;
  readonly reviewFileGiB: number;
  readonly reviewParamB: number;
  readonly strongParamB: number;
}[];

const preferredQuantizations = [
  "Q4_K_M",
  "Q5_K_M",
  "Q4_K_S",
  "Q3_K_M",
  "Q5_K_S",
  "Q2_K",
  "Q8_0",
  "Q6_K",
  "F16",
  "BF16"
] as const;

const allowedTasks = new Set([
  "text-generation",
  "text-to-text",
  "text2text-generation",
  "image-text-to-text",
  "conversational",
  "question-answering",
  "summarization",
  "translation"
]);

const rejectedTerms = [
  "siglip",
  "feature-extraction",
  "fill-mask",
  "openclip",
  "clip-",
  "-clip",
  "blip",
  "dinov2",
  "vit-",
  "vision-encoder",
  "image-classification",
  "text-to-image",
  "image-to-image",
  "stable-diffusion",
  "diffusion",
  "controlnet",
  "sdxl",
  "flux",
  "whisper",
  "wav2vec",
  "musicgen",
  "bark",
  "tts",
  "asr",
  "embedding",
  "embeddings",
  "embed-",
  "reranker",
  "sentence-transformers",
  "colbert",
  "yolo",
  "segment-anything",
  "sam-",
  "depth-estimation",
  "object-detection"
];

const textModelHints = [
  "llama",
  "qwen",
  "mistral",
  "gemma",
  "glm",
  "phi",
  "deepseek",
  "yi-",
  "coder",
  "code",
  "chat",
  "instruct",
  "reason",
  "language",
  "llm",
  "moe",
  "hermes",
  "smollm",
  "tinyllama",
  "bonsai",
  "qwopus"
];

function joinClasses(...classes: readonly (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cleanBoolean(value: unknown) {
  return value === true;
}

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isMarketplaceSort(value: unknown): value is MarketplaceSort {
  return marketplaceSortOptions.some((option) => option.id === value);
}

function isMarketplaceQuantFilter(value: unknown): value is MarketplaceQuantFilter {
  return marketplaceQuantOptions.some((option) => option.id === value);
}

function isMarketplaceSizeFilter(value: unknown): value is MarketplaceSizeFilter {
  return marketplaceSizeOptions.some((option) => option.id === value);
}

function isMarketplaceCompatibilityFilter(value: unknown): value is MarketplaceCompatibilityFilter {
  return marketplaceCompatibilityOptions.some((option) => option.id === value);
}

function isMarketplaceHardwareTier(value: unknown): value is MarketplaceHardwareTier {
  return marketplaceHardwareOptions.some((option) => option.id === value);
}

function hardwareTierForProfileId(value: unknown): MarketplaceHardwareTier {
  const profileId = cleanString(value).toLowerCase();
  if (profileId.startsWith("8gb")) {
    return "8gb";
  }

  if (profileId.startsWith("16gb")) {
    return "16gb";
  }

  return "12gb";
}

function readSavedHardwareTier(): MarketplaceHardwareTier {
  if (typeof window === "undefined") {
    return "12gb";
  }

  try {
    const settings = readRecord(JSON.parse(window.localStorage.getItem(aiModelSettingsStorageKey) ?? "null"));
    return hardwareTierForProfileId(settings?.hardwareProfileId);
  } catch {
    return "12gb";
  }
}

function readMarketplacePreferences() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return readRecord(JSON.parse(window.localStorage.getItem(marketplacePrefsStorageKey) ?? "null"));
  } catch {
    return null;
  }
}

function repoUrl(modelId: string) {
  return `https://huggingface.co/${modelId.split("/").map(encodeURIComponent).join("/")}`;
}

function ggufResolveUrl(modelId: string, fileName: string) {
  return `${repoUrl(modelId)}/resolve/main/${fileName.split("/").map(encodeURIComponent).join("/")}`;
}

function socialThumbnailUrl(author: string) {
  return `https://cdn-thumbnails.huggingface.co/social-thumbnails/${encodeURIComponent(author)}.png`;
}

const ownerAvatarCache = new Map<string, string | null>();
const ownerAvatarRequests = new Map<string, Promise<string | null>>();

async function fetchAvatarEndpoint(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    return null;
  }

  const payload = readRecord((await response.json()) as unknown);
  return normalizeImageUrl(payload?.avatarUrl);
}

function requestOwnerAvatar(owner: string) {
  const key = owner.trim();
  const cached = ownerAvatarCache.get(key);
  if (cached !== undefined) {
    return Promise.resolve(cached);
  }

  const pending = ownerAvatarRequests.get(key);
  if (pending) {
    return pending;
  }

  const encodedOwner = encodeURIComponent(key);
  const request = fetchAvatarEndpoint(`https://huggingface.co/api/organizations/${encodedOwner}/avatar`)
    .then((organizationAvatar) => {
      if (organizationAvatar) {
        return organizationAvatar;
      }

      return fetchAvatarEndpoint(`https://huggingface.co/api/users/${encodedOwner}/avatar`);
    })
    .catch(() => null)
    .then((avatarUrl) => {
      ownerAvatarCache.set(key, avatarUrl);
      ownerAvatarRequests.delete(key);
      return avatarUrl;
    });

  ownerAvatarRequests.set(key, request);
  return request;
}

function apiSortFor(sortBy: MarketplaceSort) {
  if (sortBy === "updated") {
    return "lastModified";
  }

  return "downloads";
}

function modelSearchUrl(query: string, sortBy: MarketplaceSort) {
  const url = new URL("https://huggingface.co/api/models");
  url.searchParams.set("filter", "gguf");
  url.searchParams.set("full", "true");
  url.searchParams.set("sort", apiSortFor(sortBy));
  url.searchParams.set("direction", "-1");
  url.searchParams.set("limit", fetchPageSize.toString());

  if (query) {
    url.searchParams.set("search", query);
  }

  return url.toString();
}

function normalizeImageUrl(value: unknown) {
  const rawUrl = cleanString(value);
  if (!rawUrl) {
    return null;
  }

  try {
    return new URL(rawUrl, "https://huggingface.co").toString();
  } catch {
    return null;
  }
}

function readApiAvatarUrl(item: HuggingFaceApiModel) {
  return (
    normalizeImageUrl(item.authorData?.avatarUrl) ??
    normalizeImageUrl(item.authorData?.avatar_url) ??
    normalizeImageUrl(item.owner?.avatarUrl) ??
    normalizeImageUrl(item.owner?.avatar_url)
  );
}

function readTags(value: unknown) {
  return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === "string") : [];
}

function readSiblings(value: unknown) {
  return Array.isArray(value) ? (value as readonly HuggingFaceApiSibling[]) : [];
}

function extractQuantization(fileName: string) {
  const normalized = fileName.toUpperCase();
  const match = normalized.match(
    /(?:^|[-_.\/])((?:UD-)?(?:IQ[1-4]_[A-Z0-9]+|Q[2-8]_K_[A-Z]+|Q[2-8]_K|Q[2-8]_[01]|Q[2-8]|F16|BF16|MXFP4_MOE))(?:[-_.\/]|$)/
  );

  return match?.[1]?.replace(/^UD-/, "") ?? null;
}

function extractParameterSize(modelId: string, tags: readonly string[]) {
  const candidates = [modelId, ...tags];
  for (const candidate of candidates) {
    const match = candidate.match(/(?:^|[^a-z0-9])(\d+(?:\.\d+)?\s*[bm])(?:[^a-z0-9]|$)/i);
    if (match?.[1]) {
      return match[1].replace(/\s+/g, "").toUpperCase();
    }
  }

  return null;
}

function licenseFromTags(tags: readonly string[]) {
  const licenseTag = tags.find((tag) => tag.startsWith("license:"));
  return licenseTag ? licenseTag.replace("license:", "") : null;
}

function isProjectionFile(fileName: string) {
  const lowerName = fileName.toLowerCase();
  return lowerName.includes("mmproj") || lowerName.includes("projection");
}

function quantizationRank(file: MarketplaceGgufFile) {
  if (!file.quantization) {
    return 99;
  }

  const rank = preferredQuantizations.indexOf(file.quantization as (typeof preferredQuantizations)[number]);
  return rank === -1 ? 60 : rank;
}

function compareGgufFiles(left: MarketplaceGgufFile, right: MarketplaceGgufFile) {
  return quantizationRank(left) - quantizationRank(right) || left.name.localeCompare(right.name);
}

function normalizeSibling(sibling: HuggingFaceApiSibling): MarketplaceGgufFile | null {
  const name = cleanString(sibling.rfilename);
  if (!name.toLowerCase().endsWith(".gguf")) {
    return null;
  }

  return {
    name,
    quantization: extractQuantization(name),
    sizeBytes: cleanNumber(sibling.size) ?? cleanNumber(sibling.lfs?.size)
  };
}

function hasRejectedModelTerms(modelId: string, tags: readonly string[], task: string | null) {
  const searchable = [modelId, task, ...tags].filter(Boolean).join(" ").toLowerCase();
  return rejectedTerms.some((term) => searchable.includes(term));
}

function normalizeTaskTag(value: string | null) {
  return (value ?? "").trim().toLowerCase().replace(/_/g, "-");
}

function isUsableTextModel(
  modelId: string,
  tags: readonly string[],
  task: string | null,
  parameterSize: string | null
) {
  if (hasRejectedModelTerms(modelId, tags, task)) {
    return false;
  }

  if (task && allowedTasks.has(normalizeTaskTag(task))) {
    return true;
  }

  const searchable = [modelId, ...tags].join(" ").toLowerCase();
  return textModelHints.some((hint) => searchable.includes(hint)) || Boolean(parameterSize);
}

function normalizeModel(item: HuggingFaceApiModel): MarketplaceModel | null {
  const modelId = cleanString(item.modelId) || cleanString(item.id);
  if (!modelId) {
    return null;
  }

  const author = cleanString(item.author) || modelId.split("/")[0] || null;
  const tags = readTags(item.tags);
  const task = cleanString(item.pipeline_tag) || null;
  const ggufFiles = readSiblings(item.siblings).map(normalizeSibling).filter((file): file is MarketplaceGgufFile => file !== null);
  const looksLikeGguf = tags.includes("gguf") || modelId.toLowerCase().includes("gguf") || ggufFiles.length > 0;
  const parameterSize = extractParameterSize(modelId, tags);

  if (!looksLikeGguf || !isUsableTextModel(modelId, tags, task, parameterSize)) {
    return null;
  }

  const mainFiles = ggufFiles.filter((file) => !isProjectionFile(file.name));
  const preferredFile = [...(mainFiles.length > 0 ? mainFiles : ggufFiles)].sort(compareGgufFiles)[0] ?? null;

  return {
    author,
    avatarUrl: readApiAvatarUrl(item),
    downloads: cleanNumber(item.downloads),
    gated: cleanBoolean(item.gated) || cleanBoolean(item.private),
    ggufFiles,
    lastModified: cleanString(item.lastModified) || null,
    license: licenseFromTags(tags),
    modelId,
    parameterSize,
    preferredFile,
    sourceUrl: repoUrl(modelId),
    task
  };
}

function nextPageFromLinkHeader(linkHeader: string | null) {
  if (!linkHeader) {
    return null;
  }

  for (const segment of linkHeader.split(",")) {
    const match = segment.match(/<([^>]+)>;\s*rel="next"/i);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

async function fetchMarketplaceModelPage(url: string, signal: AbortSignal) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    },
    signal
  });

  if (!response.ok) {
    throw new Error(`Hugging Face returned ${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    return {
      models: [],
      nextPageUrl: nextPageFromLinkHeader(response.headers.get("Link"))
    };
  }

  return {
    models: payload
      .map((item) => normalizeModel(item as HuggingFaceApiModel))
      .filter((model): model is MarketplaceModel => model !== null),
    nextPageUrl: nextPageFromLinkHeader(response.headers.get("Link"))
  };
}

async function fetchMarketplaceModels(query: string, sortBy: MarketplaceSort, signal: AbortSignal) {
  return fetchMarketplaceModelPage(modelSearchUrl(query, sortBy), signal);
}

function mergeModels(
  existingModels: readonly MarketplaceModel[],
  nextModels: readonly MarketplaceModel[]
) {
  const seen = new Set(existingModels.map((model) => model.modelId));
  return [
    ...existingModels,
    ...nextModels.filter((model) => {
      if (seen.has(model.modelId)) {
        return false;
      }

      seen.add(model.modelId);
      return true;
    })
  ];
}

function formatCompactNumber(value: number | null) {
  if (value === null) {
    return "-";
  }

  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value >= 1000 ? 1 : 0,
    notation: "compact"
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short"
  }).format(date);
}

function formatBytes(value: number | null) {
  if (value === null) {
    return null;
  }

  const gib = value / 1024 ** 3;
  if (gib >= 1) {
    return `${gib.toFixed(gib >= 10 ? 0 : 1)} GB`;
  }

  const mib = value / 1024 ** 2;
  return `${Math.max(1, Math.round(mib))} MB`;
}

function fileSummary(model: MarketplaceModel) {
  if (!model.preferredFile) {
    return model.ggufFiles.length > 0 ? `${model.ggufFiles.length} GGUF files` : "GGUF repository";
  }

  const size = formatBytes(model.preferredFile.sizeBytes);
  return size ? `${model.preferredFile.quantization ?? "GGUF"} / ${size}` : model.preferredFile.quantization ?? "GGUF";
}

function typeLabel(model: MarketplaceModel) {
  const task = normalizeTaskTag(model.task);
  if (task === "image-text-to-text") {
    return "Image-text";
  }
  if (task === "text-to-text" || task === "text2text-generation") {
    return "Text-to-text";
  }
  if ([model.modelId, model.preferredFile?.name ?? ""].join(" ").toLowerCase().includes("code")) {
    return "Coding";
  }
  return "Text";
}

function isVisionTextModel(model: MarketplaceModel) {
  const searchable = [model.modelId, model.task, model.preferredFile?.name ?? ""].join(" ").toLowerCase();
  return normalizeTaskTag(model.task) === "image-text-to-text" || /(?:llava|minicpm-v|moondream|vision|vlm)/.test(searchable);
}

function isCodeModel(model: MarketplaceModel) {
  const searchable = [model.modelId, model.preferredFile?.name ?? ""].join(" ").toLowerCase();
  return /(?:code|coder|codestral|starcoder|sql)/.test(searchable);
}

function quantizationCategory(quantization: string | null): MarketplaceQuantFilter | null {
  const quant = (quantization ?? "").toUpperCase();
  if (!quant) {
    return null;
  }

  if (quant.includes("Q2") || quant.includes("IQ2")) {
    return "q2";
  }

  if (quant.includes("Q3") || quant.includes("IQ3")) {
    return "q3";
  }

  if (quant.includes("Q4") || quant.includes("IQ4")) {
    return "q4";
  }

  if (quant.includes("Q5") || quant.includes("IQ5")) {
    return "q5";
  }

  if (quant.includes("Q6") || quant.includes("Q8")) {
    return "q6plus";
  }

  if (quant.includes("F16") || quant.includes("BF16")) {
    return "fp";
  }

  return null;
}

function parameterBillions(model: MarketplaceModel) {
  const rawSize = model.parameterSize;
  if (!rawSize) {
    return null;
  }

  const match = rawSize.match(/(\d+(?:\.\d+)?)([BM])/i);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) {
    return null;
  }

  return match[2].toUpperCase() === "M" ? value / 1000 : value;
}

function preferredFileGiB(model: MarketplaceModel) {
  return model.preferredFile?.sizeBytes ? model.preferredFile.sizeBytes / 1024 ** 3 : null;
}

function hardwareProfileFor(tier: MarketplaceHardwareTier) {
  return marketplaceHardwareOptions.find((profile) => profile.id === tier) ?? marketplaceHardwareOptions[1];
}

function isHighPrecisionQuant(model: MarketplaceModel) {
  const quant = quantizationCategory(model.preferredFile?.quantization ?? null);
  return quant === "q5" || quant === "q6plus" || quant === "fp";
}

function modelCompatibility(model: MarketplaceModel, hardwareTier: MarketplaceHardwareTier): MarketplaceCompatibility {
  if (model.gated) {
    return {
      reason: "Gated repository. Open it on Hugging Face before importing.",
      severity: "blocked",
      shortLabel: "Gated"
    };
  }

  if (!model.preferredFile) {
    return {
      reason: "No usable GGUF file was found in this repository.",
      severity: "blocked",
      shortLabel: "No GGUF"
    };
  }

  const hardware = hardwareProfileFor(hardwareTier);
  const fileGiB = preferredFileGiB(model);
  const paramsB = parameterBillions(model);

  if (fileGiB !== null) {
    const estimatedGpuGiB = fileGiB * 1.2;
    if (estimatedGpuGiB > hardware.reviewFileGiB) {
      return {
        reason: `Likely exceeds ${hardware.label} memory before context and cache overhead.`,
        severity: "review",
        shortLabel: "Too large"
      };
    }

    if (estimatedGpuGiB > hardware.comfortableFileGiB) {
      return {
        reason: `May exceed comfortable ${hardware.label} memory with long context or GPU layers.`,
        severity: "review",
        shortLabel: "Check GPU"
      };
    }
  }

  if (paramsB !== null) {
    if (paramsB >= hardware.strongParamB) {
      return {
        reason: `${model.parameterSize} is likely too large for ${hardware.label} without heavy DDR5 spillover.`,
        severity: "review",
        shortLabel: "Too large"
      };
    }

    if (paramsB >= hardware.reviewParamB && isHighPrecisionQuant(model)) {
      return {
        reason: `${model.parameterSize} with ${model.preferredFile.quantization ?? "this quant"} needs GPU review.`,
        severity: "review",
        shortLabel: "Check GPU"
      };
    }
  }

  if (quantizationCategory(model.preferredFile.quantization) === "fp") {
    return {
      reason: "F16/BF16 files are usually impractical for local GPU memory.",
      severity: "review",
      shortLabel: "Heavy quant"
    };
  }

  if (isVisionTextModel(model) && model.ggufFiles.some((file) => isProjectionFile(file.name))) {
    return {
      reason: "Vision models may require importing the projector file alongside the main GGUF.",
      severity: "review",
      shortLabel: "Projector"
    };
  }

  if (paramsB === null && fileGiB === null) {
    return {
      reason: "Model size was not available from Hugging Face metadata.",
      severity: "review",
      shortLabel: "Unknown fit"
    };
  }

  return {
    reason: `Looks reasonable for ${hardware.label}.`,
    severity: "compatible",
    shortLabel: "Compatible"
  };
}

function modelMatchesFilter(model: MarketplaceModel, filter: MarketplaceTaskFilter) {
  if (filter === "all") {
    return true;
  }

  if (filter === "ready") {
    return Boolean(model.preferredFile && !model.gated);
  }

  if (filter === "vision") {
    return isVisionTextModel(model);
  }

  if (filter === "code") {
    return isCodeModel(model) && !isVisionTextModel(model);
  }

  return !isCodeModel(model) && !isVisionTextModel(model);
}

function modelMatchesQuantFilter(model: MarketplaceModel, filter: MarketplaceQuantFilter) {
  return filter === "any" || quantizationCategory(model.preferredFile?.quantization ?? null) === filter;
}

function modelMatchesSizeFilter(model: MarketplaceModel, filter: MarketplaceSizeFilter) {
  if (filter === "any") {
    return true;
  }

  const paramsB = parameterBillions(model);
  if (paramsB === null) {
    return filter === "unknown";
  }

  if (filter === "lt4b") {
    return paramsB < 4;
  }

  if (filter === "4to8b") {
    return paramsB >= 4 && paramsB <= 8;
  }

  if (filter === "9to14b") {
    return paramsB >= 9 && paramsB <= 14;
  }

  if (filter === "15to32b") {
    return paramsB >= 15 && paramsB <= 32;
  }

  return paramsB >= 33;
}

function modelMatchesCompatibilityFilter(
  model: MarketplaceModel,
  filter: MarketplaceCompatibilityFilter,
  hardwareTier: MarketplaceHardwareTier
) {
  if (filter === "all") {
    return true;
  }

  const compatibility = modelCompatibility(model, hardwareTier);
  if (filter === "compatible") {
    return compatibility.severity === "compatible";
  }

  return compatibility.severity !== "compatible";
}

function sortModels(models: readonly MarketplaceModel[], sortBy: MarketplaceSort) {
  return [...models].sort((left, right) => {
    if (sortBy === "updated") {
      const leftTime = left.lastModified ? new Date(left.lastModified).getTime() : 0;
      const rightTime = right.lastModified ? new Date(right.lastModified).getTime() : 0;
      return rightTime - leftTime || left.modelId.localeCompare(right.modelId);
    }

    if (sortBy === "name") {
      return modelDisplayName(left.modelId).localeCompare(modelDisplayName(right.modelId));
    }

    return (right.downloads ?? 0) - (left.downloads ?? 0) || left.modelId.localeCompare(right.modelId);
  });
}

function filterCounts(models: readonly MarketplaceModel[]) {
  return marketplaceFilters.reduce(
    (counts, filter) => ({
      ...counts,
      [filter.id]: models.filter((model) => modelMatchesFilter(model, filter.id)).length
    }),
    {} as Record<MarketplaceTaskFilter, number>
  );
}

function secondarySummary(model: MarketplaceModel) {
  return [typeLabel(model), model.parameterSize, model.license, formatCompactNumber(model.downloads) + " downloads"]
    .filter(Boolean)
    .join(" / ");
}

function makerName(model: MarketplaceModel) {
  return model.author ?? model.modelId.split("/")[0] ?? "HF";
}

function makerInitials(name: string) {
  return name
    .split(/[-_\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "HF";
}

function modelDisplayName(modelId: string) {
  return modelId.split("/").pop() ?? modelId;
}

function MakerAvatar({ model }: { readonly model: MarketplaceModel }) {
  const owner = makerName(model);
  const [resolvedAvatarUrl, setResolvedAvatarUrl] = useState(model.avatarUrl);
  const imageUrls = [resolvedAvatarUrl, socialThumbnailUrl(owner)].filter((url): url is string => Boolean(url));
  const [imageIndex, setImageIndex] = useState(0);
  const currentImageUrl = imageUrls[imageIndex] ?? null;

  useEffect(() => {
    let isCurrent = true;
    setImageIndex(0);
    setResolvedAvatarUrl(model.avatarUrl);

    void requestOwnerAvatar(owner).then((avatarUrl) => {
      if (isCurrent && avatarUrl) {
        setResolvedAvatarUrl(avatarUrl);
        setImageIndex(0);
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [model.avatarUrl, owner]);

  return (
    <span className="relative grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--control-bg)] text-[10px] font-medium text-[var(--text-muted)]">
      <span>{makerInitials(owner)}</span>
      {currentImageUrl ? (
        <img
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          onError={() => setImageIndex((index) => index + 1)}
          src={currentImageUrl}
        />
      ) : null}
    </span>
  );
}

function LoadingRows() {
  return (
    <div>
      {Array.from({ length: 8 }, (_, index) => (
        <div
          className="grid min-h-[64px] grid-cols-[28px_minmax(0,1fr)_48px] items-center gap-3 border-b border-[var(--border-subtle)] py-2.5"
          key={index}
        >
          <div className="h-7 w-7 animate-pulse rounded-[var(--radius-sm)] bg-[var(--control-bg)]" />
          <div className="min-w-0 animate-pulse">
            <div className="h-3 w-3/5 rounded-[var(--radius-sm)] bg-[var(--control-bg-hover)]" />
            <div className="mt-2 h-2.5 w-4/5 rounded-[var(--radius-sm)] bg-[var(--control-bg)]" />
          </div>
          <div className="h-7 w-12 animate-pulse justify-self-end rounded-[var(--radius-md)] bg-[var(--control-bg)]" />
        </div>
      ))}
    </div>
  );
}

function StateBlock({
  children,
  icon,
  title
}: {
  readonly children?: ReactNode;
  readonly icon?: ReactNode;
  readonly title: string;
}) {
  return (
    <div className="grid min-h-[240px] place-items-center px-6 text-center">
      <div className="min-w-0">
        {icon ? <div className="mb-2 flex justify-center text-[var(--text-muted)]">{icon}</div> : null}
        <div className="text-[13px] font-medium text-[var(--text-primary)]">{title}</div>
        {children ? <div className="mt-2 text-[12px] text-[var(--text-muted)]">{children}</div> : null}
      </div>
    </div>
  );
}

function MarketplaceResultRow({
  actionLabel,
  hardwareTier,
  model,
  onSelect
}: {
  readonly actionLabel?: string;
  readonly hardwareTier: MarketplaceHardwareTier;
  readonly model: MarketplaceModel;
  readonly onSelect: (model: MarketplaceModel) => void;
}) {
  const compatibility = modelCompatibility(model, hardwareTier);
  const canUse = Boolean(model.preferredFile && !model.gated && compatibility.severity !== "blocked");
  const label = canUse ? actionLabel ?? "Use" : "Open";
  const isReview = compatibility.severity === "review";

  return (
    <div className="grid min-h-[72px] grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--border-subtle)] py-2.5 transition-colors duration-100 ease-out hover:bg-[var(--sidebar-hover-bg)]">
      <MakerAvatar model={model} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-baseline gap-2">
          <div className="truncate text-[13px] font-medium text-[var(--text-primary)]">{modelDisplayName(model.modelId)}</div>
          <div className="truncate text-[11px] text-[var(--text-muted)]">{makerName(model)}</div>
        </div>
        <div className="mt-0.5 truncate text-[12px] leading-4 text-[var(--text-secondary)]">
          {fileSummary(model)}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-[var(--text-muted)]">
          <span className="truncate">{secondarySummary(model)} / updated {formatDate(model.lastModified)}</span>
          {compatibility.severity !== "compatible" ? (
            <span
              className={joinClasses(
                "inline-flex shrink-0 items-center gap-1",
                isReview ? "text-[var(--warning)]" : "text-[var(--text-secondary)]"
              )}
              title={compatibility.reason}
            >
              <WarningCircle size={12} weight="regular" />
              <span>{compatibility.shortLabel}</span>
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex items-center justify-end gap-1">
        {isReview ? (
          <WarningCircle className="text-[var(--warning)]" size={14} weight="regular" />
        ) : null}
        <button
          aria-label={`${label} ${model.modelId}`}
          className="inline-flex h-7 items-center justify-center gap-1 rounded-[var(--radius-md)] px-2 text-[12px] font-medium text-[var(--text-secondary)] transition-[background-color,color] duration-100 ease-out hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
          onClick={() => onSelect(model)}
          title={label === "Open" ? "Open on Hugging Face" : compatibility.reason}
          type="button"
        >
          {label === "Open" ? <ArrowSquareOut size={13} weight="regular" /> : <DownloadSimple size={13} weight="regular" />}
          <span>{label}</span>
        </button>
      </div>
    </div>
  );
}

function MarketplaceResultsList({
  actionLabel,
  hardwareTier,
  models,
  onSelect
}: {
  readonly actionLabel?: string;
  readonly hardwareTier: MarketplaceHardwareTier;
  readonly models: readonly MarketplaceModel[];
  readonly onSelect: (model: MarketplaceModel) => void;
}) {
  return (
    <section>
      <div className="grid grid-cols-1 gap-x-5 border-t border-[var(--border-subtle)] min-[900px]:grid-cols-2">
        {models.map((model) => (
          <MarketplaceResultRow
            actionLabel={actionLabel}
            hardwareTier={hardwareTier}
            key={model.modelId}
            model={model}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}

function MarketplaceFilterButton({
  active,
  count,
  filter,
  onSelect
}: {
  readonly active: boolean;
  readonly count: number;
  readonly filter: (typeof marketplaceFilters)[number];
  readonly onSelect: (filter: MarketplaceTaskFilter) => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={joinClasses(
        toolbarFilterClass,
        active
          ? "bg-[var(--text-primary)] text-[var(--bg-workspace-main)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
      )}
      onClick={() => onSelect(filter.id)}
      type="button"
    >
      <span>{filter.label}</span>
      <span className={joinClasses("ml-1 text-[11px] tabular-nums", active ? "opacity-70" : "text-[var(--text-muted)]")}>
        {count}
      </span>
    </button>
  );
}

export function MarketplacePane({
  actionLabel,
  className,
  initialQuery = "",
  onSelectModel
}: MarketplacePaneProps) {
  const savedPreferences = useMemo(() => readMarketplacePreferences(), []);
  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery.trim());
  const [models, setModels] = useState<readonly MarketplaceModel[]>([]);
  const [nextPageUrl, setNextPageUrl] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<MarketplaceSort>(() =>
    isMarketplaceSort(savedPreferences?.sortBy) ? savedPreferences.sortBy : "downloads"
  );
  const [quantFilter, setQuantFilter] = useState<MarketplaceQuantFilter>(() =>
    isMarketplaceQuantFilter(savedPreferences?.quantFilter) ? savedPreferences.quantFilter : "any"
  );
  const [sizeFilter, setSizeFilter] = useState<MarketplaceSizeFilter>(() =>
    isMarketplaceSizeFilter(savedPreferences?.sizeFilter) ? savedPreferences.sizeFilter : "any"
  );
  const [compatibilityFilter, setCompatibilityFilter] = useState<MarketplaceCompatibilityFilter>(() =>
    isMarketplaceCompatibilityFilter(savedPreferences?.compatibilityFilter) ? savedPreferences.compatibilityFilter : "all"
  );
  const [hardwareTier, setHardwareTier] = useState<MarketplaceHardwareTier>(() =>
    isMarketplaceHardwareTier(savedPreferences?.hardwareTier) ? savedPreferences.hardwareTier : readSavedHardwareTier()
  );
  const [selectedFilter, setSelectedFilter] = useState<MarketplaceTaskFilter>("all");
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState<MarketplaceLoadStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const counts = useMemo(() => filterCounts(models), [models]);
  const visibleModels = useMemo(
    () =>
      sortModels(
        models.filter(
          (model) =>
            modelMatchesFilter(model, selectedFilter) &&
            modelMatchesQuantFilter(model, quantFilter) &&
            modelMatchesSizeFilter(model, sizeFilter) &&
            modelMatchesCompatibilityFilter(model, compatibilityFilter, hardwareTier)
        ),
        sortBy
      ),
    [compatibilityFilter, hardwareTier, models, quantFilter, selectedFilter, sizeFilter, sortBy]
  );
  const hardwareLabel = hardwareProfileFor(hardwareTier).label;
  const statusLabel = useMemo(() => {
    if (status === "loading") {
      return "Searching";
    }

    if (status === "error") {
      return "Search failed";
    }

    return `${visibleModels.length} shown`;
  }, [status, visibleModels.length]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query.trim()), searchDebounceMs);
    return () => window.clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    window.localStorage.setItem(
      marketplacePrefsStorageKey,
      JSON.stringify({
        compatibilityFilter,
        hardwareTier,
        quantFilter,
        sizeFilter,
        sortBy
      })
    );
  }, [compatibilityFilter, hardwareTier, quantFilter, sizeFilter, sortBy]);

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setErrorMessage(null);

    void fetchMarketplaceModels(debouncedQuery, sortBy, controller.signal)
      .then((page) => {
        setModels(page.models);
        setNextPageUrl(page.nextPageUrl);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        setStatus("error");
        setErrorMessage(error instanceof Error ? error.message : "Hugging Face search failed");
      });

    return () => controller.abort();
  }, [debouncedQuery, reloadKey, sortBy]);

  function loadMoreModels() {
    if (!nextPageUrl || loadingMore) {
      return;
    }

    const controller = new AbortController();
    setLoadingMore(true);
    setErrorMessage(null);

    void fetchMarketplaceModelPage(nextPageUrl, controller.signal)
      .then((page) => {
        setModels((currentModels) => mergeModels(currentModels, page.models));
        setNextPageUrl(page.nextPageUrl);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        setStatus("error");
        setErrorMessage(error instanceof Error ? error.message : "Hugging Face search failed");
      })
      .finally(() => setLoadingMore(false));
  }

  function maybeLoadMoreModels(event: UIEvent<HTMLElement>) {
    const target = event.currentTarget;
    const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;

    if (distanceFromBottom < 420) {
      loadMoreModels();
    }
  }

  function updateQuery(event: ChangeEvent<HTMLInputElement>) {
    setQuery(event.target.value);
  }

  function selectModel(model: MarketplaceModel) {
    const ggufFileName = model.preferredFile?.name ?? null;
    const selection: MarketplaceModelSelection = {
      ggufFileName,
      ggufUrl: ggufFileName ? ggufResolveUrl(model.modelId, ggufFileName) : null,
      modelId: model.modelId,
      sourceRepo: model.modelId,
      sourceUrl: model.sourceUrl
    };

    if (onSelectModel && ggufFileName && !model.gated) {
      onSelectModel(selection);
      return;
    }

    window.open(model.sourceUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <section
      aria-label="Model marketplace"
      className={joinClasses(
        "min-h-0 min-w-0 overflow-auto bg-[var(--bg-workspace-main)] text-[13px] text-[var(--text-primary)]",
        className
      )}
      onScroll={maybeLoadMoreModels}
    >
      <div className="mx-auto flex min-h-full w-full max-w-[1000px] flex-col px-6 py-4">
        <div className="mb-3 flex min-h-8 items-center justify-between gap-3">
          <div className="flex min-w-0 items-baseline gap-2">
            <h1 className="truncate text-[14px] font-medium text-[var(--text-primary)]">Models</h1>
            <span className="shrink-0 text-[11px] text-[var(--text-muted)]">{loadingMore ? "Loading more" : statusLabel}</span>
            <span className="hidden shrink-0 text-[11px] text-[var(--text-muted)] min-[760px]:inline">
              {hardwareLabel}
            </span>
          </div>
          <div
            aria-live="polite"
            className="flex shrink-0 items-center justify-end gap-1 text-[11px] text-[var(--text-muted)]"
          >
            {status === "loading" || loadingMore ? <SpinnerGap className="animate-spin" size={13} weight="regular" /> : null}
            <button
              aria-label="Refresh marketplace"
              className="ml-1 grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-md)] text-[var(--text-muted)] transition-[background-color,color] duration-100 hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
              onClick={() => setReloadKey((key) => key + 1)}
              type="button"
            >
              <ArrowClockwise size={14} weight="regular" />
            </button>
          </div>
        </div>

        <div className="mb-4 space-y-2">
          <div className="grid grid-cols-1 gap-2 min-[900px]:grid-cols-[minmax(280px,1fr)_auto]">
            <div className="flex h-8 min-w-0 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--control-bg)] px-2.5 text-[12px] text-[var(--text-muted)] transition-colors duration-100 focus-within:border-[var(--accent)] focus-within:bg-[var(--bg-elevated)]">
              <MagnifyingGlass className="shrink-0" size={14} weight="regular" />
              <input
                aria-label="Search Hugging Face GGUF LLMs"
                className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                onChange={updateQuery}
                placeholder="Filter by name"
                spellCheck={false}
                value={query}
              />
              {query ? (
                <button
                  aria-label="Clear search"
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
                  onClick={() => setQuery("")}
                  type="button"
                >
                  <X size={12} weight="regular" />
                </button>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <select
                aria-label="GPU profile for compatibility warnings"
                className="h-8 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--control-bg)] px-2 text-[12px] text-[var(--text-secondary)] outline-none transition-colors duration-100 hover:bg-[var(--control-bg-hover)] focus:border-[var(--accent)] focus:bg-[var(--bg-elevated)]"
                onChange={(event) => setHardwareTier(event.target.value as MarketplaceHardwareTier)}
                value={hardwareTier}
              >
                {marketplaceHardwareOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Sort marketplace models"
                className="h-8 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--control-bg)] px-2 text-[12px] text-[var(--text-secondary)] outline-none transition-colors duration-100 hover:bg-[var(--control-bg-hover)] focus:border-[var(--accent)] focus:bg-[var(--bg-elevated)]"
                onChange={(event) => setSortBy(event.target.value as MarketplaceSort)}
                value={sortBy}
              >
                {marketplaceSortOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <select
              aria-label="Filter marketplace models"
              className="h-7 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--control-bg)] px-2 text-[12px] text-[var(--text-secondary)] outline-none transition-colors duration-100 hover:bg-[var(--control-bg-hover)] focus:border-[var(--accent)] focus:bg-[var(--bg-elevated)] min-[760px]:hidden"
              onChange={(event) => setSelectedFilter(event.target.value as MarketplaceTaskFilter)}
              value={selectedFilter}
            >
              {marketplaceFilters.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label} ({counts[item.id]})
                </option>
              ))}
            </select>
            <div className="hidden flex-wrap items-center justify-center gap-1 min-[760px]:flex">
              {marketplaceFilters.map((item) => (
                <MarketplaceFilterButton
                  active={selectedFilter === item.id}
                  count={counts[item.id]}
                  filter={item}
                  key={item.id}
                  onSelect={setSelectedFilter}
                />
              ))}
            </div>
            <select
              aria-label="Filter quantization"
              className="h-7 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--control-bg)] px-2 text-[12px] text-[var(--text-secondary)] outline-none transition-colors duration-100 hover:bg-[var(--control-bg-hover)] focus:border-[var(--accent)] focus:bg-[var(--bg-elevated)]"
              onChange={(event) => setQuantFilter(event.target.value as MarketplaceQuantFilter)}
              value={quantFilter}
            >
              {marketplaceQuantOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter model parameter size"
              className="h-7 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--control-bg)] px-2 text-[12px] text-[var(--text-secondary)] outline-none transition-colors duration-100 hover:bg-[var(--control-bg-hover)] focus:border-[var(--accent)] focus:bg-[var(--bg-elevated)]"
              onChange={(event) => setSizeFilter(event.target.value as MarketplaceSizeFilter)}
              value={sizeFilter}
            >
              {marketplaceSizeOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter compatibility warnings"
              className="h-7 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--control-bg)] px-2 text-[12px] text-[var(--text-secondary)] outline-none transition-colors duration-100 hover:bg-[var(--control-bg-hover)] focus:border-[var(--accent)] focus:bg-[var(--bg-elevated)]"
              onChange={(event) => setCompatibilityFilter(event.target.value as MarketplaceCompatibilityFilter)}
              value={compatibilityFilter}
            >
              {marketplaceCompatibilityOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="min-h-0 min-w-0 flex-1">
          {status === "loading" && models.length === 0 ? (
            <LoadingRows />
          ) : status === "error" && models.length === 0 ? (
            <StateBlock icon={<WarningCircle size={18} weight="regular" />} title="Search failed">
              <div className="truncate">{errorMessage ?? "Hugging Face search failed"}</div>
              <button className={quietButtonClass} onClick={() => setReloadKey((key) => key + 1)} type="button">
                Retry
              </button>
            </StateBlock>
          ) : visibleModels.length === 0 ? (
            <StateBlock title={models.length === 0 ? "No compatible models found" : "No models match this filter"}>
              <div className="flex justify-center gap-1.5">
                {selectedFilter !== "all" ? (
                  <button className={quietButtonClass} onClick={() => setSelectedFilter("all")} type="button">
                    Show all
                  </button>
                ) : null}
                {query ? (
                  <button className={quietButtonClass} onClick={() => setQuery("")} type="button">
                    Clear search
                  </button>
                ) : null}
              </div>
            </StateBlock>
          ) : (
            <>
              <MarketplaceResultsList
                actionLabel={actionLabel}
                hardwareTier={hardwareTier}
                models={visibleModels}
                onSelect={selectModel}
              />
              <div className="flex min-h-12 items-center justify-center gap-2 text-[11px] text-[var(--text-muted)]">
                {nextPageUrl ? (
                  <button
                    className={quietButtonClass}
                    disabled={loadingMore}
                    onClick={loadMoreModels}
                    type="button"
                  >
                    {loadingMore ? "Loading" : "Load more"}
                  </button>
                ) : (
                  <span>{models.length} fetched</span>
                )}
              </div>
              {status === "error" ? (
                <div className="flex min-h-9 items-center justify-center gap-2 border-t border-[var(--border-subtle)] text-[11px] text-[var(--text-muted)]">
                  <span className="truncate">{errorMessage ?? "Search failed"}</span>
                  <button className={quietButtonClass} onClick={() => setReloadKey((key) => key + 1)} type="button">
                    Retry
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
