import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Minus, SidebarSimple, Square, X } from "@phosphor-icons/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAuth } from "../auth/AuthContext";
import {
  getQuartzLocalModelQuantization,
  getQuartzOllamaImportMetadata,
  type QuartzLocalModelQuantizationId
} from "../local-ai";
import { readStoredThemeMode, setDocumentThemeMode, type AppThemeMode } from "../styles/theme";
import topbarLogoUrl from "../styles/logo1Black.png";
import type { AiModelRuntimeSettings } from "./aiModelsPane";
import { MarketplacePane, type MarketplaceModelSelection } from "./marketplacePane";
import {
  BrowserPreviewPane,
  ChatPane,
  ProjectThreadRail,
  SkillsPane,
  type BrowserMode,
  type ChatMode,
  type ChatMessage,
  type ComposerContext,
  type ContextBudgetInfo,
  type ApplicationSurfaceKind,
  type LoadState,
  type LocalhostProjectPreview,
  type Project,
  type ProjectCreateInput,
  type SelectedElement,
  type SkillCreationSource,
  type Thread,
  type WorkspaceView
} from "./panes";
import { SettingsPane, type SettingsSectionId, type SettingsState } from "./settingsPane";
import {
  DEFAULT_CHARS_PER_TOKEN,
  DEFAULT_TURN_TOKEN_BUDGET,
  buildCompactRecentHistory,
  estimateTokenCountFromChars,
  type ContextBudgetChatTurn
} from "./contextBudget";

type OpenProjectResponse = {
  readonly projectId: string;
  readonly rootLabel: string;
  readonly framework: string;
  readonly surfaceKind?: ApplicationSurfaceKind | null;
  readonly surfaceSignals?: readonly string[];
  readonly packageManager?: string | null;
  readonly availableScripts: readonly string[];
  readonly projectEpoch: number;
};

type EnsureOllamaModelRequest = {
  readonly ollamaModelName: string;
  readonly huggingFaceUrl: string;
  readonly modelDirectory?: string;
  readonly contextSizeTokens?: number;
  readonly operationId: string;
};

type EnsureOllamaModelResponse = {
  readonly ollamaModelName: string;
  readonly modelAlreadyPresent: boolean;
  readonly downloaded: boolean;
  readonly created: boolean;
  readonly ggufPath: string;
  readonly modelfilePath: string;
};

type GenerateChatRole = "assistant" | "system" | "user";

type GenerateChatMessage = {
  readonly role: GenerateChatRole;
  readonly content: string;
};

type GenerateChatResponse = {
  readonly ollamaModelName: string;
  readonly content: string;
  readonly thinking?: string | null;
  readonly promptEvalCount?: number | null;
  readonly evalCount?: number | null;
  readonly totalDurationNs?: number | null;
};

type LoadedOllamaModel = {
  readonly name: string;
  readonly endpoint?: string;
};

type UnloadOllamaModelRequest = {
  readonly ollamaModelName: string;
  readonly endpoint?: string;
  readonly timeoutMs?: number;
};

type ChatPromptBuild = {
  readonly systemPrompt: string;
  readonly messages: readonly GenerateChatMessage[];
  readonly contextBudget: ContextBudgetInfo;
  readonly droppedTurnCount: number;
  readonly trimmedTurnCount: number;
};

type PatchRollbackStackResponse = {
  readonly patchIds: readonly string[];
};

type ModelInstallProgressEvent = {
  readonly operationId?: string | null;
  readonly ollamaModelName: string;
  readonly phase: "checking_ollama" | "downloading" | "writing_modelfile" | "creating_ollama_model" | "ready";
  readonly downloadedBytes?: number | null;
  readonly totalBytes?: number | null;
  readonly message?: string | null;
};

type ActivityStatus = NonNullable<ChatMessage["status"]>;

type ModelInstallActivityTarget = {
  readonly baseLines: readonly string[];
  readonly messageId: string;
  readonly threadId: string;
};

type ChatMessageWithThinking = ChatMessage & {
  readonly thinking?: string;
};

type AssistantMessageOptions = Pick<ChatMessage, "createdAt" | "status"> & {
  readonly thinking?: string | null;
};

function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `http://${trimmed}`;
}

async function minimizeWindow() {
  try {
    await getCurrentWindow().minimize();
  } catch {
    // Window controls are inert outside Tauri.
  }
}

async function toggleMaximizeWindow() {
  try {
    await getCurrentWindow().toggleMaximize();
  } catch {
    // Window controls are inert outside Tauri.
  }
}

async function closeWindow() {
  try {
    await getCurrentWindow().close();
  } catch {
    // Window controls are inert outside Tauri.
  }
}

function startWindowDrag(event: MouseEvent<HTMLElement>) {
  if (event.button !== 0 || event.detail > 1) {
    return;
  }

  event.preventDefault();
  void getCurrentWindow().startDragging().catch(() => {
    // Drag regions are inert outside Tauri.
  });
}

const defaultPaneSizes = {
  left: 272,
  chat: 640
} as const;

const paneLimits = {
  leftMin: 220,
  leftMax: 380,
  chatMin: 380,
  chatMax: 860,
  browserMin: 520,
  handleWidth: 8
} as const;

const localChatDefaults = {
  contextWindowTokens: 32_768,
  maxOutputTokens: 512,
  maxInteractiveOutputTokens: 1_024,
  minHistoryTokens: 512,
  promptSafetyMarginTokens: 128
} as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function resolvedChatContextTokens(settings: AiModelRuntimeSettings | null) {
  const configured = settings?.contextWindowTokens;
  if (!Number.isFinite(configured) || configured === undefined || configured <= 0) {
    return localChatDefaults.contextWindowTokens;
  }

  return clamp(Math.round(configured), 512, 65_536);
}

function resolvedChatOutputTokens(settings: AiModelRuntimeSettings | null) {
  const configured = settings?.maxOutputTokens;
  const target =
    Number.isFinite(configured) && configured !== undefined && configured > 0
      ? configured
      : localChatDefaults.maxOutputTokens;

  return clamp(Math.round(target), 256, localChatDefaults.maxInteractiveOutputTokens);
}

function chatInputBudgetTokens(contextWindowTokens: number, reservedOutputTokens: number) {
  return Math.max(
    localChatDefaults.minHistoryTokens,
    contextWindowTokens - reservedOutputTokens - localChatDefaults.promptSafetyMarginTokens
  );
}

function readSavedPaneSizes() {
  if (typeof window === "undefined") {
    return defaultPaneSizes;
  }

  try {
    const saved = window.localStorage.getItem("quartz-canvas-pane-sizes");
    if (!saved) {
      return defaultPaneSizes;
    }

    const parsed = JSON.parse(saved) as Partial<typeof defaultPaneSizes>;
    return {
      left: clamp(Number(parsed.left) || defaultPaneSizes.left, paneLimits.leftMin, paneLimits.leftMax),
      chat: clamp(Number(parsed.chat) || defaultPaneSizes.chat, paneLimits.chatMin, paneLimits.chatMax)
    };
  } catch {
    return defaultPaneSizes;
  }
}

function readSavedList<T>(key: string): readonly T[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const saved = window.localStorage.getItem(key);
    if (!saved) {
      return [];
    }

    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? (parsed as readonly T[]) : [];
  } catch {
    return [];
  }
}

function readSavedId(key: string) {
  if (typeof window === "undefined") {
    return null;
  }

  const saved = window.localStorage.getItem(key);
  return saved && saved.trim() ? saved : null;
}

function readSavedBoolean(key: string, fallback = false) {
  if (typeof window === "undefined") {
    return fallback;
  }

  const saved = window.localStorage.getItem(key);
  if (saved === "true") {
    return true;
  }
  if (saved === "false") {
    return false;
  }

  return fallback;
}

function projectPathKey(path: string) {
  return path.trim().replace(/[\\/]+$/, "").toLowerCase();
}

function sameProjectPath(left: string, right: string) {
  return projectPathKey(left) === projectPathKey(right);
}

function isAbsoluteLocalPath(path: string) {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("/");
}

function safeOllamaTagPart(value: string, fallback: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);

  return normalized || fallback;
}

function quantizationFromFileName(fileName: string | null) {
  const match = fileName?.toLowerCase().match(/(?:^|[-_.])((?:q[2-8](?:_k(?:_[a-z]+)?|_[01])?)|f16|bf16)(?:[-_.]|$)/);
  return match?.[1]?.replace(/[^a-z0-9_]+/g, "_") ?? "gguf";
}

function readableErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    const message = "message" in error && typeof error.message === "string" ? error.message : error.code;
    return message;
  }
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function normalizeAssistantThinking(thinking: string | null | undefined) {
  const trimmed = thinking?.trim();
  return trimmed ? trimmed : undefined;
}

function chatPromptContentForMessage(message: ChatMessage) {
  return message.content;
}

function marketplaceOllamaModelName(selection: MarketplaceModelSelection) {
  const repoName = selection.modelId.split("/").pop() ?? selection.modelId;
  return `${safeOllamaTagPart(repoName, "hf-model")}:${quantizationFromFileName(selection.ggufFileName)}`;
}

function localhostProjectName(project: LocalhostProjectPreview, rootLabel?: string) {
  const label = rootLabel?.trim() || project.title.trim() || `localhost:${project.port}`;
  return label.length > 64 ? label.slice(0, 61).trimEnd() + "..." : label;
}

function formatBytes(bytes: number | null | undefined) {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) {
    return "";
  }

  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function modelDownloadPercent(event: ModelInstallProgressEvent) {
  return event.totalBytes && event.downloadedBytes
    ? Math.max(0, Math.min(100, Math.round((event.downloadedBytes / event.totalBytes) * 100)))
    : null;
}

function activityMessageContent(
  status: ActivityStatus,
  title: string,
  lines: readonly string[],
  progress?: number | null
) {
  return [
    `activity:${status}`,
    title,
    ...lines,
    progress === null || progress === undefined ? "" : `progress:${progress}`
  ].filter(Boolean).join("\n");
}

function patchIdsFromMessage(message: ChatMessage) {
  const metadataIds = message.appliedPatchIds ?? [];
  const contentIds = Array.from(
    message.content.matchAll(/\bpatch(?:Id|_id)\s*:\s*([0-9a-f]{8}-[0-9a-f-]{27,})\b/gi),
    (match) => match[1]
  );

  return [...metadataIds, ...contentIds].filter((patchId): patchId is string => Boolean(patchId));
}

function patchIdsAfterMessage(messages: readonly ChatMessage[], messageIndex: number) {
  const seen = new Set<string>();
  const patchIds: string[] = [];

  for (let index = messages.length - 1; index > messageIndex; index -= 1) {
    for (const patchId of patchIdsFromMessage(messages[index])) {
      if (!seen.has(patchId)) {
        seen.add(patchId);
        patchIds.push(patchId);
      }
    }
  }

  return patchIds;
}

function patchCountLabel(count: number) {
  return count === 1 ? "1 patch" : `${count} patches`;
}

function sendActivityBaseLines({
  context,
  currentUrl,
  hasModelRequest,
  selectedElement
}: {
  context: ComposerContext;
  currentUrl: string;
  hasModelRequest: boolean;
  selectedElement: SelectedElement | null;
}) {
  const lines = ["Building context"];

  if (context.includeSelection && selectedElement) {
    lines.push(`Checking selected ${selectedElement.tag}`);
  }

  if (context.attachmentsCount > 0) {
    lines.push(
      context.attachmentsCount === 1
        ? "Reading 1 attachment"
        : `Reading ${context.attachmentsCount} attachments`
    );
  }

  if (currentUrl) {
    lines.push("Checking preview state");
  }

  if (context.planMode) {
    lines.push("Plan mode enabled");
  }

  lines.push(hasModelRequest ? `Preparing ${context.localModelLabel ?? context.mode} local model` : "Checking model settings");

  if (hasModelRequest) {
    lines.push("Waiting for local model");
  }

  return lines;
}

function modelInstallActivityLines(target: ModelInstallActivityTarget, event: ModelInstallProgressEvent) {
  const lines = target.baseLines.filter((line) => line !== "Waiting for local model");
  const percent = modelDownloadPercent(event);
  const downloaded = formatBytes(event.downloadedBytes);
  const total = formatBytes(event.totalBytes);
  const byteLabel = downloaded && total ? `${downloaded} / ${total}` : downloaded || total || "";

  switch (event.phase) {
    case "checking_ollama":
      return [...lines, "Checking local model", event.ollamaModelName];
    case "downloading":
      return [
        ...lines,
        "Downloading local model",
        [byteLabel, percent === null ? "" : `${percent}%`].filter(Boolean).join(" "),
        event.ollamaModelName
      ].filter(Boolean);
    case "writing_modelfile":
      return [...lines, "Writing Modelfile", event.ollamaModelName];
    case "creating_ollama_model":
      return [...lines, "Creating Ollama model", event.ollamaModelName];
    case "ready":
      return [...lines, "Local model ready", event.ollamaModelName];
  }
}

function constrainPaneSizes(left: number, chat: number, sidebarCollapsed = false) {
  const availableWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
  const effectiveLeft = sidebarCollapsed ? 0 : clamp(left, paneLimits.leftMin, paneLimits.leftMax);
  const leftHandleWidth = sidebarCollapsed ? 0 : paneLimits.handleWidth;
  const maxChatForWindow = Math.max(
    paneLimits.chatMin,
    availableWidth - effectiveLeft - paneLimits.browserMin - leftHandleWidth - paneLimits.handleWidth
  );

  return {
    left: effectiveLeft,
    chat: clamp(chat, paneLimits.chatMin, Math.min(paneLimits.chatMax, maxChatForWindow))
  };
}

function PaneResizeHandle({
  active,
  label,
  onResizeStart
}: {
  active: boolean;
  label: string;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const lineClassName = active
    ? "bg-[var(--text-muted)]"
    : "bg-transparent group-hover:bg-[var(--text-muted)] group-focus-visible:bg-[var(--text-muted)]";

  return (
    <div
      aria-label={label}
      aria-orientation="vertical"
      className="group relative z-10 cursor-col-resize bg-transparent outline-none"
      onPointerDown={onResizeStart}
      role="separator"
      tabIndex={0}
    >
      <div className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors duration-100 ease-out ${lineClassName}`} />
    </div>
  );
}

export function WorkspaceLayout() {
  const { signOut, user } = useAuth();
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() =>
    readSavedId("quartz-canvas-active-project")
  );
  const [activeThreadId, setActiveThreadId] = useState<string | null>(() =>
    readSavedId("quartz-canvas-active-thread")
  );
  const [browserMode, setBrowserMode] = useState<BrowserMode>("interact");
  const [chatMode, setChatMode] = useState<ChatMode>("Qwopus");
  const [aiModelSettings, setAiModelSettings] = useState<AiModelRuntimeSettings | null>(null);
  const [marketplaceModel, setMarketplaceModel] = useState<MarketplaceModelSelection | null>(null);
  const [contextBudgetByThreadId, setContextBudgetByThreadId] = useState<Record<string, ContextBudgetInfo>>({});
  const [, setLoadState] = useState<LoadState>("idle");
  const [projects, setProjects] = useState<readonly Project[]>(() => readSavedList<Project>("quartz-canvas-projects"));
  const [search, setSearch] = useState("");
  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null);
  const [selectionBlockedReason, setSelectionBlockedReason] = useState<string | null>(null);
  const [threads, setThreads] = useState<readonly Thread[]>(() => readSavedList<Thread>("quartz-canvas-threads"));
  const [urlHistory, setUrlHistory] = useState<readonly string[]>([""]);
  const [urlIndex, setUrlIndex] = useState(0);
  const [view, setView] = useState<WorkspaceView>("threads");
  const [lastWorkspaceView, setLastWorkspaceView] = useState<WorkspaceView>("threads");
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>("general");
  const [themeMode, setThemeMode] = useState<AppThemeMode>(() => readStoredThemeMode());
  const [zoom, setZoom] = useState(100);
  const [paneSizes, setPaneSizes] = useState(readSavedPaneSizes);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    readSavedBoolean("quartz-canvas-sidebar-collapsed")
  );
  const [activePaneResize, setActivePaneResize] = useState<"left" | "chat" | null>(null);
  const cancelledMessageIdsRef = useRef(new Set<string>());
  const loadedOllamaModelRef = useRef<LoadedOllamaModel | null>(null);
  const modelUnloadPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const modelInstallThreadsRef = useRef(new Map<string, ModelInstallActivityTarget>());

  const activeThread = threads.find((thread) => thread.id === activeThreadId) ?? null;
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const currentUrl = urlHistory[urlIndex] ?? "";
  const activeContextBudget = activeThread
    ? contextBudgetForThread(activeThread)
    : null;
  const hasPreviewUrl = currentUrl.trim().length > 0;
  const constrainedPaneSizes = constrainPaneSizes(paneSizes.left, paneSizes.chat, sidebarCollapsed);
  const leftHandleWidth = sidebarCollapsed ? 0 : paneLimits.handleWidth;
  const profileName = user?.name?.trim() || user?.email?.trim() || "Quartz User";
  const profilePlan = user?.plan?.trim() || "Pro Plan";

  const upsertToolMessage = useCallback((
    threadId: string,
    messageId: string,
    content: string,
    options?: Pick<ChatMessage, "createdAt" | "kind" | "status">
  ) => {
    if (cancelledMessageIdsRef.current.has(messageId)) {
      return;
    }

    setThreads((current) =>
      current.map((thread) => {
        if (thread.id !== threadId) {
          return thread;
        }

        const existing = thread.messages.find((message) => message.id === messageId);
        const nextMessage: ChatMessage = {
          ...existing,
          id: messageId,
          role: "tool",
          content,
          createdAt: options?.createdAt ?? existing?.createdAt,
          kind: options?.kind ?? existing?.kind,
          status: options?.status ?? existing?.status
        };
        const existingMessage = Boolean(existing);

        return {
          ...thread,
          messages: existingMessage
            ? thread.messages.map((message) => (message.id === messageId ? nextMessage : message))
            : [...thread.messages, nextMessage]
        };
      })
    );
  }, []);

  const upsertAssistantMessage = useCallback((
    threadId: string,
    messageId: string,
    content: string,
    options?: AssistantMessageOptions
  ) => {
    if (cancelledMessageIdsRef.current.has(messageId)) {
      return;
    }

    setThreads((current) =>
      current.map((thread) => {
        if (thread.id !== threadId) {
          return thread;
        }

        const existing = thread.messages.find((message) => message.id === messageId);
        const existingAssistantMessage = existing as ChatMessageWithThinking | undefined;
        const nextThinking =
          options && "thinking" in options
            ? normalizeAssistantThinking(options.thinking)
            : existingAssistantMessage?.thinking;
        const nextMessage: ChatMessageWithThinking = {
          ...existing,
          id: messageId,
          role: "assistant",
          content,
          createdAt: options?.createdAt ?? existing?.createdAt ?? Date.now(),
          status: options?.status ?? existing?.status,
          thinking: nextThinking
        };
        const hasExistingMessage = Boolean(existing);

        return {
          ...thread,
          messages: hasExistingMessage
            ? thread.messages.map((message) => (message.id === messageId ? nextMessage : message))
            : [...thread.messages, nextMessage]
        };
      })
    );
  }, []);

  const removeMessage = useCallback((threadId: string, messageId: string) => {
    cancelledMessageIdsRef.current.add(messageId);
    setThreads((current) =>
      current.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              messages: thread.messages.filter((message) => message.id !== messageId)
            }
          : thread
      )
    );
  }, []);

  useEffect(() => {
    if (view !== "settings") {
      setLastWorkspaceView(view);
    }
  }, [view]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    void listen<ModelInstallProgressEvent>("ai_model_install_progress", (event) => {
      if (cancelled || !event.payload.operationId) {
        return;
      }
      const target = modelInstallThreadsRef.current.get(event.payload.operationId);
      if (!target) {
        return;
      }
      upsertToolMessage(
        target.threadId,
        target.messageId,
        activityMessageContent(
          "working",
          "Working",
          modelInstallActivityLines(target, event.payload),
          modelDownloadPercent(event.payload)
        ),
        {
          kind: "activity",
          status: "working"
        }
      );
    })
      .then((cleanup) => {
        if (cancelled) {
          cleanup();
          return;
        }
        unlisten = cleanup;
      })
      .catch((error) => {
        console.warn("failed to listen for model download progress", error);
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [upsertToolMessage]);

  useEffect(() => {
    setDocumentThemeMode(themeMode);
  }, [themeMode]);

  const handleSettingsChange = useCallback((settings: SettingsState) => {
    setThemeMode(settings.appearanceMode);
  }, []);

  useEffect(() => {
    return () => {
      unloadLoadedOllamaModel();
    };
  }, []);

  function changeWorkspaceView(nextView: WorkspaceView) {
    if (nextView !== "threads" && nextView !== view) {
      unloadLoadedOllamaModel();
    }
    setView(nextView);
  }

  function closeSettings() {
    setView(lastWorkspaceView === "settings" ? "threads" : lastWorkspaceView);
  }

  function modelDirectoryRequestPart() {
    const modelDirectory = aiModelSettings?.modelDirectory?.trim();
    return modelDirectory && isAbsoluteLocalPath(modelDirectory) ? { modelDirectory } : {};
  }

  function modelEnsureRequest(operationId: string): EnsureOllamaModelRequest | null {
    if (marketplaceModel?.ggufUrl) {
      return {
        operationId,
        ollamaModelName: marketplaceOllamaModelName(marketplaceModel),
        huggingFaceUrl: marketplaceModel.ggufUrl,
        ...modelDirectoryRequestPart(),
        contextSizeTokens: aiModelSettings?.contextWindowTokens ?? 32_768
      };
    }

    const modelKey = aiModelSettings?.modelKey ?? (chatMode === "Bonsai" ? "ternary-bonsai-8b" : "qwopus-glm-18b");
    const quantization = (aiModelSettings?.quantization ??
      (modelKey === "ternary-bonsai-8b" ? "q2_k" : "q4_k_m")) as QuartzLocalModelQuantizationId;
    const configuredModelName = aiModelSettings?.providerModelId?.trim() ?? "";
    const configuredMetadata = configuredModelName
      ? getQuartzOllamaImportMetadata(configuredModelName, quantization)
      : undefined;
    if (configuredModelName && !configuredMetadata) {
      return null;
    }
    const metadata = configuredMetadata ?? getQuartzOllamaImportMetadata(modelKey, quantization);
    const quantizationProfile = getQuartzLocalModelQuantization(modelKey, quantization);

    if (!metadata) {
      return null;
    }

    const providerModelId = configuredModelName || metadata.providerModelId;

    return {
      operationId,
      ollamaModelName: providerModelId,
      huggingFaceUrl: metadata.sourceUrl,
      ...modelDirectoryRequestPart(),
      contextSizeTokens: aiModelSettings?.contextWindowTokens ?? quantizationProfile?.contextWindowTokens
    };
  }

  function selectedOllamaModelName(request: EnsureOllamaModelRequest | null) {
    const configuredModelName = aiModelSettings?.providerModelId?.trim();
    return request?.ollamaModelName ?? (configuredModelName || null);
  }

  function currentOllamaEndpoint() {
    return aiModelSettings?.endpoint?.trim() || undefined;
  }

  async function unloadOllamaModel(model: LoadedOllamaModel) {
    const request: UnloadOllamaModelRequest = {
      ollamaModelName: model.name,
      endpoint: model.endpoint,
      timeoutMs: 15_000
    };

    try {
      await invoke("unload_ollama_model", { request });
    } catch (error) {
      console.warn("failed to unload Ollama model", model.name, error);
    }
  }

  function queueOllamaModelUnload(model: LoadedOllamaModel) {
    modelUnloadPromiseRef.current = modelUnloadPromiseRef.current.then(() => unloadOllamaModel(model));
    return modelUnloadPromiseRef.current;
  }

  function unloadLoadedOllamaModel() {
    const loadedModel = loadedOllamaModelRef.current;
    if (!loadedModel) {
      return;
    }

    loadedOllamaModelRef.current = null;
    void queueOllamaModelUnload(loadedModel);
  }

  async function prepareOllamaModelForRequest(model: LoadedOllamaModel) {
    await modelUnloadPromiseRef.current;
    const loadedModel = loadedOllamaModelRef.current;
    if (
      loadedModel &&
      (loadedModel.name !== model.name || loadedModel.endpoint !== model.endpoint)
    ) {
      loadedOllamaModelRef.current = null;
      await queueOllamaModelUnload(loadedModel);
    }

    loadedOllamaModelRef.current = model;
  }

  function chatSystemPrompt(context: ComposerContext, targetProject: Project) {
    return [
      "You are Quartz Canvas, a local UI editing assistant.",
      "Be concise. Do not repeat the user's prompt or your prior response.",
      "If the user is only chatting, answer in one or two short sentences.",
      "Never continue by repeating words or phrases to fill the response.",
      "Answer with the next useful action, diagnosis, or exact change. Use short paragraphs or bullets only when they improve scanability.",
      "Do not claim code changes were applied unless Quartz Canvas produced and applied a patch.",
      targetProject.name ? `Project: ${targetProject.name}` : "",
      targetProject.path ? `Project path: ${targetProject.path}` : "",
      currentUrl ? `Preview URL: ${currentUrl}` : "",
      context.localModelLabel ? `Local model: ${context.localModelLabel}` : "",
      context.includeSelection && selectedElement
        ? `Selected element: ${selectedElement.tag} ${selectedElement.label} (${selectedElement.source})`
        : "",
      context.planMode ? "Mode: plan first before implementation." : "Mode: normal chat."
    ].filter(Boolean).join("\n");
  }

  function chatHistoryTurnsForThread(threadId: string): readonly ContextBudgetChatTurn[] {
    const history = threads.find((thread) => thread.id === threadId)?.messages ?? [];
    return history
      .filter((message) => message.role === "user" || (message.role === "assistant" && message.status !== "working"))
      .map((message): ContextBudgetChatTurn => ({
        id: message.id,
        role: message.role === "assistant" ? "assistant" : "user",
        content: chatPromptContentForMessage(message)
      }))
      .filter((message) => message.content.trim().length > 0);
  }

  function chatPromptTurnsForThread(threadId: string, instruction: string): readonly ContextBudgetChatTurn[] {
    const turns = [...chatHistoryTurnsForThread(threadId)];
    const trimmedInstruction = instruction.trim();
    const lastTurn = turns[turns.length - 1];

    if (
      trimmedInstruction &&
      !(lastTurn?.role === "user" && lastTurn.content.trim() === trimmedInstruction)
    ) {
      turns.push({
        id: "current-user-instruction",
        role: "user",
        content: trimmedInstruction
      });
    }

    return turns;
  }

  function generateRoleForContextTurn(role: ContextBudgetChatTurn["role"]): GenerateChatRole | null {
    if (role === "assistant" || role === "system" || role === "user") {
      return role;
    }

    return null;
  }

  function buildChatPromptForThread(
    threadId: string,
    instruction: string,
    context: ComposerContext,
    targetProject: Project,
    messageCount: number
  ): ChatPromptBuild {
    const systemPrompt = chatSystemPrompt(context, targetProject);
    const contextWindowTokens = resolvedChatContextTokens(aiModelSettings);
    const reservedOutputTokens = resolvedChatOutputTokens(aiModelSettings);
    const systemPromptTokens = estimateTokenCountFromChars(systemPrompt.length, DEFAULT_CHARS_PER_TOKEN);
    const historyTokenBudget = Math.max(
      localChatDefaults.minHistoryTokens,
      chatInputBudgetTokens(contextWindowTokens, reservedOutputTokens) - systemPromptTokens
    );
    const maxTokensPerTurn = Math.min(
      DEFAULT_TURN_TOKEN_BUDGET,
      Math.max(384, Math.floor(historyTokenBudget / 3))
    );
    const compactedHistory = buildCompactRecentHistory(chatPromptTurnsForThread(threadId, instruction), {
      charsPerToken: DEFAULT_CHARS_PER_TOKEN,
      includeCompactionNotice: true,
      maxTokensPerTurn,
      tokenBudget: historyTokenBudget
    });
    const messages = compactedHistory.turns
      .map((turn): GenerateChatMessage | null => {
        const role = generateRoleForContextTurn(turn.role);
        const content = turn.content.trim();
        return role && content ? { role, content } : null;
      })
      .filter((message): message is GenerateChatMessage => Boolean(message));

    return {
      systemPrompt,
      messages,
      contextBudget: {
        contextWindowTokens,
        estimatedInputTokens: systemPromptTokens + compactedHistory.estimatedTokens,
        historyCompacted: compactedHistory.compacted,
        messageCount,
        reservedOutputTokens,
        source: "estimate"
      },
      droppedTurnCount: compactedHistory.droppedTurnCount,
      trimmedTurnCount: compactedHistory.trimmedTurnCount
    };
  }

  function estimateContextBudgetForThread(thread: Thread): ContextBudgetInfo {
    const targetProject =
      projects.find((project) => project.name === thread.project) ??
      activeProject ??
      projects[0] ?? {
        id: "project_fallback",
        name: "quartz-canvas",
        path: ".",
        pinned: false,
        status: "open"
      };
    const contextWindowTokens = resolvedChatContextTokens(aiModelSettings);
    const reservedOutputTokens = resolvedChatOutputTokens(aiModelSettings);
    const systemPromptTokens = estimateTokenCountFromChars(
      chatSystemPrompt(
        {
          attachmentsCount: 0,
          includeSelection: Boolean(selectedElement && !selectedElement.stale),
          includeTerminal: false,
          localModelLabel: marketplaceModel ? marketplaceOllamaModelName(marketplaceModel) : chatMode,
          mode: chatMode,
          permissionMode: "full-access",
          planMode: false
        },
        targetProject
      ).length,
      DEFAULT_CHARS_PER_TOKEN
    );
    const historyTokenBudget = Math.max(
      localChatDefaults.minHistoryTokens,
      chatInputBudgetTokens(contextWindowTokens, reservedOutputTokens) - systemPromptTokens
    );
    const compactedHistory = buildCompactRecentHistory(chatHistoryTurnsForThread(thread.id), {
      charsPerToken: DEFAULT_CHARS_PER_TOKEN,
      includeCompactionNotice: false,
      maxTokensPerTurn: DEFAULT_TURN_TOKEN_BUDGET,
      tokenBudget: historyTokenBudget
    });

    return {
      contextWindowTokens,
      estimatedInputTokens: systemPromptTokens + compactedHistory.estimatedTokens,
      historyCompacted: compactedHistory.compacted,
      messageCount: thread.messages.length,
      reservedOutputTokens,
      source: "estimate"
    };
  }

  function contextBudgetForThread(thread: Thread): ContextBudgetInfo {
    const cachedBudget = contextBudgetByThreadId[thread.id];

    if (
      cachedBudget?.source === "last_request" &&
      cachedBudget.messageCount === thread.messages.length
    ) {
      return cachedBudget;
    }

    return estimateContextBudgetForThread(thread);
  }

  async function ensureModelForSend(
    threadId: string,
    operationId: string,
    activityMessageId: string,
    assistantMessageId: string,
    instruction: string,
    baseLines: readonly string[],
    context: ComposerContext,
    targetProject: Project,
    targetMessageCount: number,
    request: EnsureOllamaModelRequest | null
  ) {
    const ollamaModelName = selectedOllamaModelName(request);
    if (!request) {
      upsertToolMessage(
        threadId,
        activityMessageId,
        activityMessageContent("working", "Working", [...baseLines, "Sending request"]),
        {
          kind: "activity",
          status: "working"
        }
      );
      await requestAiResponse(
        threadId,
        activityMessageId,
        assistantMessageId,
        ollamaModelName,
        instruction,
        baseLines,
        context,
        targetProject,
        targetMessageCount
      );
      return;
    }

    try {
      modelInstallThreadsRef.current.set(operationId, {
        baseLines,
        messageId: activityMessageId,
        threadId
      });
      upsertToolMessage(
        threadId,
        activityMessageId,
        activityMessageContent("working", "Working", baseLines),
        {
          kind: "activity",
          status: "working"
        }
      );
      const result = await invoke<EnsureOllamaModelResponse>("ensure_ollama_gguf_model", { request });
      upsertToolMessage(
        threadId,
        activityMessageId,
        activityMessageContent("working", "Working", [
          ...baseLines.filter((line) => line !== "Waiting for local model"),
          "Local model ready",
          result.ollamaModelName,
          "Sending request"
        ]),
        {
          kind: "activity",
          status: "working"
        }
      );
      await requestAiResponse(
        threadId,
        activityMessageId,
        assistantMessageId,
        result.ollamaModelName,
        instruction,
        baseLines,
        context,
        targetProject,
        targetMessageCount
      );
    } catch (error) {
      const message = readableErrorMessage(error);
      removeMessage(threadId, assistantMessageId);
      upsertToolMessage(
        threadId,
        activityMessageId,
        activityMessageContent("failed", "Model preparation failed", [
          ...baseLines.filter((line) => line !== "Waiting for local model"),
          message
        ]),
        {
          kind: "activity",
          status: "failed"
        }
      );
    } finally {
      window.setTimeout(() => {
        modelInstallThreadsRef.current.delete(operationId);
      }, 10_000);
    }
  }

  async function requestAiResponse(
    threadId: string,
    activityMessageId: string,
    assistantMessageId: string,
    ollamaModelName: string | null,
    instruction: string,
    baseLines: readonly string[],
    context: ComposerContext,
    targetProject: Project,
    targetMessageCount: number
  ) {
    if (!ollamaModelName) {
      removeMessage(threadId, assistantMessageId);
      upsertToolMessage(
        threadId,
        activityMessageId,
        activityMessageContent("failed", "AI request failed", [
          ...baseLines.filter((line) => line !== "Waiting for local model"),
          "No local model is configured."
        ]),
        {
          kind: "activity",
          status: "failed"
        }
      );
      return;
    }

    try {
      const prompt = buildChatPromptForThread(threadId, instruction, context, targetProject, targetMessageCount);
      await prepareOllamaModelForRequest({
        name: ollamaModelName,
        endpoint: currentOllamaEndpoint()
      });
      setContextBudgetByThreadId((current) => ({
        ...current,
        [threadId]: prompt.contextBudget
      }));
      const response = await invoke<GenerateChatResponse>("generate_ollama_chat", {
        request: {
          ollamaModelName,
          endpoint: currentOllamaEndpoint(),
          keepAlive: aiModelSettings?.keepAlive ?? "30s",
          think: true,
          systemPrompt: prompt.systemPrompt,
          messages: prompt.messages,
          options: {
            temperature: aiModelSettings?.temperature ?? 0.2,
            maxOutputTokens: prompt.contextBudget.reservedOutputTokens,
            contextWindowTokens: prompt.contextBudget.contextWindowTokens
          },
          timeoutMs: 180000
        }
      });
      const actualPromptTokens = response.promptEvalCount ?? prompt.contextBudget.estimatedInputTokens;
      const actualResponseTokens = response.evalCount ?? 0;
      setContextBudgetByThreadId((current) => ({
        ...current,
        [threadId]: {
          ...prompt.contextBudget,
          actualPromptTokens,
          actualOutputTokens: actualResponseTokens,
          source: "last_request"
        }
      }));

      upsertToolMessage(
        threadId,
        activityMessageId,
        activityMessageContent("ready", "Ready", [
          ...baseLines.filter((line) => line !== "Waiting for local model"),
          ...(prompt.contextBudget.historyCompacted
            ? [`Compacted history (${prompt.droppedTurnCount} dropped, ${prompt.trimmedTurnCount} trimmed)`]
            : []),
          "Response generated",
          response.ollamaModelName
        ]),
        {
          kind: "activity",
          status: "ready"
        }
      );
      upsertAssistantMessage(threadId, assistantMessageId, response.content, {
        status: "ready",
        thinking: response.thinking
      });
    } catch (error) {
      removeMessage(threadId, assistantMessageId);
      upsertToolMessage(
        threadId,
        activityMessageId,
        activityMessageContent("failed", "AI request failed", [
          ...baseLines.filter((line) => line !== "Waiting for local model"),
          readableErrorMessage(error)
        ]),
        {
          kind: "activity",
          status: "failed"
        }
      );
    }
  }

  function findFallbackThread(excludedThreadId: string) {
    const activeProjectName = activeProject?.name;
    const projectFallback = activeProjectName
      ? threads.find((thread) => thread.id !== excludedThreadId && !thread.archived && thread.project === activeProjectName)
      : null;

    return projectFallback ?? threads.find((thread) => thread.id !== excludedThreadId && !thread.archived) ?? null;
  }

  function selectProject(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    setActiveProjectId(projectId);
    setView("threads");

    const projectThread = project
      ? threads.find((thread) => thread.project === project.name && !thread.archived)
      : null;
    if (projectThread) {
      if (projectThread.id !== activeThreadId) {
        unloadLoadedOllamaModel();
      }
      setActiveThreadId(projectThread.id);
    }
  }

  function selectThread(threadId: string) {
    const thread = threads.find((item) => item.id === threadId);
    if (threadId !== activeThreadId) {
      unloadLoadedOllamaModel();
    }

    if (thread?.project) {
      const project = projects.find((item) => item.name === thread.project);
      if (project) {
        setActiveProjectId(project.id);
      }
    }

    setActiveThreadId(threadId);
    setView("threads");
  }

  function createThread(projectId?: string) {
    unloadLoadedOllamaModel();

    const fallbackProject: Project = {
      id: createId("project"),
      name: "quartz-canvas",
      path: ".",
      pinned: false,
      status: "open"
    };
    const requestedProject = projectId ? projects.find((project) => project.id === projectId) : null;
    const targetProject = requestedProject ?? activeProject ?? projects[0] ?? fallbackProject;

    if (!requestedProject && !activeProject && projects.length === 0) {
      setProjects([fallbackProject]);
    }
    if (activeProjectId !== targetProject.id) {
      setActiveProjectId(targetProject.id);
    }

    const thread: Thread = {
      id: createId("thread"),
      title: "Untitled",
      project: targetProject.name,
      meta: "now",
      archived: false,
      messages: [],
      pinned: false
    };

    setThreads((current) => [thread, ...current]);
    setActiveThreadId(thread.id);
    setView("threads");
  }

  function createSkillThread(creationSource: SkillCreationSource) {
    unloadLoadedOllamaModel();

    const fallbackProject: Project = {
      id: createId("project"),
      name: "quartz-canvas",
      path: ".",
      pinned: false,
      status: "open"
    };
    const targetProject = activeProject ?? projects[0] ?? fallbackProject;
    const sourceLabel =
      creationSource === "frontier_generated"
        ? "Generated by frontier model"
        : "Input by frontier model";
    const thread: Thread = {
      id: createId("thread"),
      title: "Create a skill",
      project: targetProject.name,
      meta: "now",
      archived: false,
      messages: [
        {
          id: createId("tool"),
          createdAt: Date.now(),
          role: "tool",
          content: `${sourceLabel}. Skills should be generated or input by frontier models before enabling. Define the trigger, workflow, guardrails, and validation checks.`
        }
      ],
      pinned: false
    };

    if (!activeProject && projects.length === 0) {
      setProjects([fallbackProject]);
    }
    if (!activeProject) {
      setActiveProjectId(targetProject.id);
    }
    setThreads((current) => [thread, ...current]);
    setActiveThreadId(thread.id);
    setView("threads");
  }

  function selectMarketplaceModel(selection: MarketplaceModelSelection) {
    unloadLoadedOllamaModel();
    setMarketplaceModel(selection);

    const fallbackProject: Project = {
      id: createId("project"),
      name: "quartz-canvas",
      path: ".",
      pinned: false,
      status: "open"
    };
    const targetProject = activeProject ?? projects[0] ?? fallbackProject;
    const modelName = marketplaceOllamaModelName(selection);
    const displayName = selection.ggufFileName ?? selection.modelId;
    const thread: Thread = {
      id: createId("thread"),
      title: `Use ${displayName}`.slice(0, 64),
      project: targetProject.name,
      meta: "now",
      archived: false,
      messages: [
        {
          id: createId("tool"),
          createdAt: Date.now(),
          role: "tool",
          content: `Selected marketplace model\n${selection.sourceRepo} / ${displayName}\nOllama tag: ${modelName}`
        }
      ],
      pinned: false
    };

    if (!activeProject && projects.length === 0) {
      setProjects([fallbackProject]);
    }
    if (!activeProject) {
      setActiveProjectId(targetProject.id);
    }
    setThreads((current) => [thread, ...current]);
    setActiveThreadId(thread.id);
    setView("threads");
  }

  function createProject(input: ProjectCreateInput) {
    const trimmedPath = input.path.trim();
    const trimmedName = input.name.trim();
    if (input.mode === "existing" && !trimmedPath) {
      return;
    }

    const normalizedPath = trimmedPath.replace(/[\\/]+$/, "");
    const fallbackName = normalizedPath ? normalizedPath.split(/[\\/]/).pop() || normalizedPath : "Untitled project";
    const name = trimmedName || fallbackName;
    const project: Project = {
      id: createId("project"),
      name,
      path: trimmedPath || `./${name.toLowerCase().replace(/\s+/g, "-")}`,
      pinned: false,
      status: input.mode === "scratch" ? "new" : "open"
    };

    setProjects((current) => [project, ...current]);
    setActiveProjectId(project.id);
    setView("threads");
  }

  function commitLocalhostProject(
    project: Project,
    starterThreadId: string,
    previousProjectName?: string
  ) {
    setProjects((current) => {
      const existing = current.find((item) => sameProjectPath(item.path, project.path));
      if (!existing) {
        return [project, ...current];
      }

      return current.map((item) =>
        sameProjectPath(item.path, project.path)
          ? {
              ...item,
              id: project.id,
              name: project.name,
              path: project.path,
              projectEpoch: project.projectEpoch ?? item.projectEpoch,
              status: project.status,
              surfaceKind: project.surfaceKind ?? item.surfaceKind,
              surfaceSignals: project.surfaceSignals ?? item.surfaceSignals
            }
          : item
      );
    });

    setThreads((current) => {
      const renamedThreads = previousProjectName && previousProjectName !== project.name
        ? current.map((thread) =>
            thread.project === previousProjectName
              ? {
                  ...thread,
                  project: project.name
                }
              : thread
          )
        : current;

      const hasStarterThread = renamedThreads.some((thread) => thread.id === starterThreadId);
      if (hasStarterThread) {
        return renamedThreads;
      }

      return [
        {
          id: starterThreadId,
          title: "Untitled",
          project: project.name,
          meta: "now",
          archived: false,
          messages: [],
          pinned: false
        },
        ...renamedThreads
      ];
    });

    if (starterThreadId !== activeThreadId) {
      unloadLoadedOllamaModel();
    }
    setActiveProjectId(project.id);
    setActiveThreadId(starterThreadId);
    setView("threads");
  }

  function selectLocalhostProject(project: LocalhostProjectPreview) {
    navigate(project.url);

    const rootPath = project.rootPath?.trim() || "";
    const projectPath = rootPath || project.url;
    const projectName = localhostProjectName(project);
    const existingProject = projects.find((item) => sameProjectPath(item.path, projectPath));
    const existingThread = threads.find(
      (thread) =>
        !thread.archived &&
        (thread.project === projectName || (existingProject ? thread.project === existingProject.name : false))
    );
    const starterThreadId = existingThread?.id ?? createId("thread");
    const optimisticProject: Project = {
      id: existingProject?.id ?? createId("project"),
      name: existingProject?.name ?? projectName,
      path: projectPath,
      projectEpoch: existingProject?.projectEpoch,
      pinned: existingProject?.pinned ?? false,
      status: rootPath ? "opening" : "linked",
      surfaceKind: project.surfaceKind ?? existingProject?.surfaceKind ?? null,
      surfaceSignals: project.surfaceSignals ?? existingProject?.surfaceSignals ?? []
    };

    commitLocalhostProject(optimisticProject, starterThreadId, existingProject?.name);

    if (!rootPath) {
      return;
    }

    void openDetectedLocalhostProject(project, rootPath, starterThreadId, optimisticProject.name).catch((error) => {
      console.warn("failed to open detected localhost project", error);
      commitLocalhostProject(
        {
          ...optimisticProject,
          status: "open-failed"
        },
        starterThreadId,
        optimisticProject.name
      );
    });
  }

  async function openDetectedLocalhostProject(
    project: LocalhostProjectPreview,
    rootPath: string,
    starterThreadId: string,
    previousProjectName: string
  ) {
    const response = await invoke<OpenProjectResponse>("open_project", {
      request: {
        rootPath,
        preferredScript: null
      }
    });
    const name = localhostProjectName(project, response.rootLabel);

    commitLocalhostProject(
      {
        id: response.projectId,
        name,
        path: rootPath,
        projectEpoch: response.projectEpoch,
        pinned: false,
        status: "open",
        surfaceKind: response.surfaceKind ?? project.surfaceKind ?? null,
        surfaceSignals: response.surfaceSignals ?? project.surfaceSignals ?? []
      },
      starterThreadId,
      previousProjectName
    );
  }

  function toggleProjectPinned(projectId: string) {
    setProjects((current) =>
      current.map((project) =>
        project.id === projectId
          ? {
              ...project,
              pinned: !project.pinned
            }
          : project
      )
    );
  }

  function renameProject(projectId: string, name: string) {
    const nextName = name.trim();
    const project = projects.find((item) => item.id === projectId);
    if (!project || !nextName) {
      return;
    }

    setProjects((current) =>
      current.map((item) =>
        item.id === projectId
          ? {
              ...item,
              name: nextName
            }
          : item
      )
    );
    setThreads((current) =>
      current.map((thread) =>
        thread.project === project.name
          ? {
              ...thread,
              project: nextName
            }
          : thread
      )
    );
  }

  function archiveProjectChats(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      return;
    }

    const fallbackThread = threads.find((thread) => thread.project !== project.name && !thread.archived) ?? null;
    setThreads((current) =>
      current.map((thread) =>
        thread.project === project.name && !thread.archived
          ? {
              ...thread,
              archived: true,
              archivedAt: new Date().toISOString()
            }
          : thread
      )
    );

    if (activeThread?.project === project.name) {
      unloadLoadedOllamaModel();
      setActiveThreadId(fallbackThread?.id ?? null);
    }
  }

  function removeProject(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      return;
    }

    const nextProjects = projects.filter((item) => item.id !== projectId);
    const nextThreads = threads.filter((thread) => thread.project !== project.name);
    setProjects(nextProjects);
    setThreads(nextThreads);

    if (activeProjectId === projectId) {
      setActiveProjectId(nextProjects[0]?.id ?? null);
    }
    if (activeThread?.project === project.name) {
      unloadLoadedOllamaModel();
      setActiveThreadId(nextThreads.find((thread) => !thread.archived)?.id ?? null);
    }
  }

  function openProjectInExplorer(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      return;
    }

    void invoke("open_project_in_explorer", { request: { rootPath: project.path } }).catch((error) => {
      console.warn("failed to open project in Explorer", error);
    });
  }

  function sendMessage(message: string, context: ComposerContext) {
    const targetThreadId = activeThreadId ?? createId("thread");
    const modelOperationId = createId("model");
    const activityMessageId = createId("activity");
    const assistantMessageId = createId("assistant");
    const modelRequest = modelEnsureRequest(modelOperationId);
    const targetThread = threads.find((thread) => thread.id === targetThreadId);
    const targetMessageCount = (targetThread?.messages.length ?? 0) + 3;
    const fallbackProject: Project = {
      id: createId("project"),
      name: "quartz-canvas",
      path: ".",
      pinned: false,
      status: "open"
    };
    const targetProject = activeProject ?? projects[0] ?? fallbackProject;
    const userMessage: ChatMessage = {
      id: createId("user"),
      createdAt: Date.now(),
      role: "user",
      content: message.trim()
    };
    const baseActivityLines = sendActivityBaseLines({
      context,
      currentUrl,
      hasModelRequest: Boolean(modelRequest),
      selectedElement
    });
    const activityMessage: ChatMessage = {
      id: activityMessageId,
      createdAt: Date.now(),
      kind: "activity",
      role: "tool",
      status: "working",
      content: activityMessageContent("working", "Working", baseActivityLines)
    };
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      createdAt: Date.now(),
      role: "assistant",
      status: "working",
      content: "Waiting for local response..."
    };

    setThreads((current) =>
      current.some((thread) => thread.id === targetThreadId)
        ? current.map((thread) =>
            thread.id === targetThreadId
              ? {
                  ...thread,
                  archived: false,
                  archivedAt: undefined,
                  title: thread.messages.length === 0 ? message.trim().slice(0, 48) || "Untitled" : thread.title,
                  meta: "now",
                  messages: [...thread.messages, userMessage, activityMessage, assistantMessage]
                }
              : thread
          )
        : [
            {
              id: targetThreadId,
              title: message.trim().slice(0, 48) || "Untitled",
              project: targetProject.name,
              meta: "now",
              archived: false,
              messages: [userMessage, activityMessage, assistantMessage]
            },
            ...current
          ]
    );
    if (!activeProject && projects.length === 0) {
      setProjects([fallbackProject]);
    }
    if (!activeProject) {
      setActiveProjectId(targetProject.id);
    }
    setActiveThreadId(targetThreadId);
    void ensureModelForSend(
      targetThreadId,
      modelOperationId,
      activityMessageId,
      assistantMessageId,
      message.trim(),
      baseActivityLines,
      context,
      targetProject,
      targetMessageCount,
      modelRequest
    );
  }

  function renameThread(threadId: string, title: string) {
    const nextTitle = title.trim();
    if (!nextTitle) {
      return;
    }

    setThreads((current) =>
      current.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              title: nextTitle
            }
          : thread
      )
    );
  }

  function toggleThreadPinned(threadId: string) {
    setThreads((current) =>
      current.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              pinned: !thread.pinned
            }
          : thread
      )
    );
  }

  function archiveThread(threadId: string) {
    const fallbackThread = findFallbackThread(threadId);

    setThreads((current) =>
      current.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              archived: true,
              archivedAt: new Date().toISOString()
            }
          : thread
      )
    );

    if (activeThreadId === threadId) {
      unloadLoadedOllamaModel();
      setActiveThreadId(fallbackThread?.id ?? null);
    }
  }

  function restoreThread(threadId: string) {
    setThreads((current) =>
      current.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              archived: false,
              archivedAt: undefined
            }
          : thread
      )
    );
    if (threadId !== activeThreadId) {
      unloadLoadedOllamaModel();
    }
    setActiveThreadId(threadId);
    setView("threads");
  }

  function clearThread(threadId: string) {
    if (threadId === activeThreadId) {
      unloadLoadedOllamaModel();
    }
    setThreads((current) =>
      current.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              messages: []
            }
          : thread
      )
    );
  }

  async function restoreThreadToMessage(threadId: string, messageId: string) {
    const thread = threads.find((item) => item.id === threadId);
    const messageIndex = thread?.messages.findIndex((message) => message.id === messageId) ?? -1;
    if (!thread || messageIndex < 0) {
      return;
    }

    const removedMessages = thread.messages.slice(messageIndex + 1);
    const patchIds = patchIdsAfterMessage(thread.messages, messageIndex);
    const restoreMessageId = createId("restore");

    if (patchIds.length > 0) {
      upsertToolMessage(
        threadId,
        restoreMessageId,
        activityMessageContent("working", "Reverting workspace", [
          `Rolling back ${patchCountLabel(patchIds.length)}`,
          "Checking rollback snapshots"
        ]),
        {
          createdAt: Date.now(),
          kind: "activity",
          status: "working"
        }
      );

      try {
        await invoke<PatchRollbackStackResponse>("rollback_patch_stack", {
          request: {
            patchIds,
            allowConflicts: false
          }
        });
      } catch (error) {
        upsertToolMessage(
          threadId,
          restoreMessageId,
          activityMessageContent("failed", "Workspace revert blocked", [
            readableErrorMessage(error),
            "Transcript was left unchanged"
          ]),
          {
            kind: "activity",
            status: "failed"
          }
        );
        return;
      }
    }

    for (const message of removedMessages) {
      cancelledMessageIdsRef.current.add(message.id);
    }
    modelInstallThreadsRef.current.forEach((target, operationId) => {
      if (target.threadId === threadId) {
        modelInstallThreadsRef.current.delete(operationId);
      }
    });

    setThreads((current) =>
      current.map((currentThread) => {
        if (currentThread.id !== threadId) {
          return currentThread;
        }

        const currentMessageIndex = currentThread.messages.findIndex((message) => message.id === messageId);
        if (currentMessageIndex < 0) {
          return currentThread;
        }

        const keptMessages = currentThread.messages.slice(0, currentMessageIndex + 1);
        const restoreMessage: ChatMessage | null =
          patchIds.length > 0
            ? {
                id: restoreMessageId,
                createdAt: Date.now(),
                kind: "activity",
                role: "tool",
                status: "ready",
                content: activityMessageContent("ready", "Workspace restored", [
                  `Rolled back ${patchCountLabel(patchIds.length)}`
                ]),
                appliedPatchIds: []
              }
            : null;

        return {
          ...currentThread,
          archived: false,
          archivedAt: undefined,
          meta: "now",
          messages: restoreMessage ? [...keptMessages, restoreMessage] : keptMessages
        };
      })
    );
    unloadLoadedOllamaModel();
    setActiveThreadId(threadId);
    setView("threads");
  }

  function navigate(nextUrlValue: string) {
    const nextUrl = normalizeUrl(nextUrlValue);
    setLoadState(nextUrl ? "loading" : "idle");
    setBrowserMode("interact");
    setSelectedElement(null);
    setSelectionBlockedReason(null);
    setUrlHistory((current) => {
      const nextHistory = [...current.slice(0, urlIndex + 1), nextUrl];
      setUrlIndex(nextHistory.length - 1);
      return nextHistory;
    });
  }

  function reloadPreview() {
    if (!currentUrl) {
      return;
    }

    setLoadState("loading");
    setSelectedElement((element) => (element ? { ...element, stale: true } : element));
    setSelectionBlockedReason(null);
  }

  function goBack() {
    setUrlIndex((current) => Math.max(0, current - 1));
    setSelectedElement(null);
    setSelectionBlockedReason(null);
  }

  function goForward() {
    setUrlIndex((current) => Math.min(urlHistory.length - 1, current + 1));
    setSelectedElement(null);
    setSelectionBlockedReason(null);
  }

  function changeBrowserMode(nextMode: BrowserMode) {
    if (nextMode === "select" && !hasPreviewUrl) {
      setBrowserMode("interact");
      setSelectedElement(null);
      setSelectionBlockedReason(null);
      return;
    }

    setBrowserMode(nextMode);
    setSelectedElement(null);
    setSelectionBlockedReason(null);
  }

  useEffect(() => {
    if (hasPreviewUrl) {
      return;
    }

    setBrowserMode("interact");
    setSelectedElement(null);
    setSelectionBlockedReason(null);
  }, [hasPreviewUrl]);

  function startPaneResize(target: "left" | "chat", event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (target === "left" && sidebarCollapsed)) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setActivePaneResize(target);

    const startX = event.clientX;
    const startSizes = constrainedPaneSizes;
    const startStoredSizes = paneSizes;

    function resize(moveEvent: PointerEvent) {
      const delta = moveEvent.clientX - startX;
      const nextSizes =
        target === "left"
          ? constrainPaneSizes(startSizes.left + delta, startSizes.chat, sidebarCollapsed)
          : constrainPaneSizes(startSizes.left, startSizes.chat + delta, sidebarCollapsed);

      setPaneSizes(
        target === "chat" && sidebarCollapsed ? { left: startStoredSizes.left, chat: nextSizes.chat } : nextSizes
      );
    }

    function stopResize() {
      document.removeEventListener("pointermove", resize);
      document.removeEventListener("pointerup", stopResize);
      document.removeEventListener("pointercancel", stopResize);
      setActivePaneResize(null);
    }

    document.addEventListener("pointermove", resize);
    document.addEventListener("pointerup", stopResize, { once: true });
    document.addEventListener("pointercancel", stopResize, { once: true });
  }

  useEffect(() => {
    if (!sidebarCollapsed) {
      setPaneSizes((current) => constrainPaneSizes(current.left, current.chat));
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!sidebarCollapsed) {
      window.localStorage.setItem("quartz-canvas-pane-sizes", JSON.stringify(constrainedPaneSizes));
    }
  }, [constrainedPaneSizes, sidebarCollapsed]);

  useEffect(() => {
    window.localStorage.setItem("quartz-canvas-projects", JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    window.localStorage.setItem("quartz-canvas-threads", JSON.stringify(threads));
  }, [threads]);

  useEffect(() => {
    if (activeProjectId) {
      window.localStorage.setItem("quartz-canvas-active-project", activeProjectId);
    } else {
      window.localStorage.removeItem("quartz-canvas-active-project");
    }
  }, [activeProjectId]);

  useEffect(() => {
    if (activeThreadId) {
      window.localStorage.setItem("quartz-canvas-active-thread", activeThreadId);
    } else {
      window.localStorage.removeItem("quartz-canvas-active-thread");
    }
  }, [activeThreadId]);

  useEffect(() => {
    window.localStorage.setItem("quartz-canvas-sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  return (
    <div className="grid h-dvh w-screen min-w-0 grid-rows-[40px_minmax(0,1fr)] overflow-hidden bg-[var(--bg-workspace-main)] font-[var(--font-sans)] text-[13px] text-[var(--text-primary)] antialiased">
      <header
        className="relative z-20 flex min-w-0 select-none items-center justify-between bg-[var(--bg-topbar)]"
        data-tauri-drag-region
        onDoubleClick={toggleMaximizeWindow}
        onMouseDown={startWindowDrag}
      >
        <div className="flex h-full min-w-0 items-center pl-1.5 pr-3" data-tauri-drag-region>
          <button
            aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            aria-pressed={sidebarCollapsed}
            className="group relative grid h-8 w-8 place-items-center rounded-[6px] text-[var(--text-primary)] transition-[background-color,opacity] duration-100 ease-out hover:bg-[var(--control-bg-hover)] focus-visible:bg-[var(--control-bg-hover)] focus-visible:outline-none"
            onClick={() => setSidebarCollapsed((current) => !current)}
            onDoubleClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            type="button"
          >
            <img
              alt=""
              className="absolute h-[18px] w-[18px] object-contain opacity-100 transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0"
              draggable={false}
              src={topbarLogoUrl}
            />
            <SidebarSimple
              aria-hidden="true"
              className="absolute opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              size={18}
              weight="regular"
            />
          </button>
        </div>
        <div className="h-full min-w-0 flex-1" data-tauri-drag-region />
        <div
          className="flex h-full items-center"
          onDoubleClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            aria-label="Minimize"
            className="grid h-full w-[46px] place-items-center text-[var(--text-muted)] transition-[background-color,color] duration-100 ease-out hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
            onClick={minimizeWindow}
            type="button"
          >
            <Minus size={15} weight="regular" />
          </button>
          <button
            aria-label="Maximize"
            className="grid h-full w-[46px] place-items-center text-[var(--text-muted)] transition-[background-color,color] duration-100 ease-out hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
            onClick={toggleMaximizeWindow}
            type="button"
          >
            <Square size={13} weight="regular" />
          </button>
          <button
            aria-label="Close"
            className="grid h-full w-[46px] place-items-center text-[var(--text-muted)] transition-[background-color,color] duration-100 ease-out hover:bg-[var(--danger)] hover:text-white"
            onClick={closeWindow}
            type="button"
          >
            <X size={15} weight="regular" />
          </button>
        </div>
      </header>

      <main
        className="grid min-h-0 min-w-0 overflow-hidden transition-[grid-template-columns] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{
          gridTemplateColumns: `${constrainedPaneSizes.left}px ${leftHandleWidth}px ${constrainedPaneSizes.chat}px ${paneLimits.handleWidth}px minmax(${paneLimits.browserMin}px, 1fr)`
        }}
      >
        <ProjectThreadRail
          activeProjectId={activeProjectId}
          activeThreadId={activeThreadId}
          className={sidebarCollapsed ? "pointer-events-none opacity-0 -translate-x-1" : "opacity-100 translate-x-0"}
          onArchiveProjectChats={archiveProjectChats}
          onArchiveThread={archiveThread}
          onCreateProject={createProject}
          onNewThread={createThread}
          onOpenSettings={() => {
            unloadLoadedOllamaModel();
            setSettingsSection("general");
            setView("settings");
          }}
          onOpenProjectInExplorer={openProjectInExplorer}
          onRemoveProject={removeProject}
          onRenameProject={renameProject}
          onRestoreThread={restoreThread}
          onSearchChange={setSearch}
          onSelectProject={selectProject}
          onSelectThread={selectThread}
          onSignOut={() => {
            void signOut();
          }}
          onToggleProjectPinned={toggleProjectPinned}
          onToggleThreadPinned={toggleThreadPinned}
          onViewChange={changeWorkspaceView}
          profileImage={user?.image ?? null}
          profileName={profileName}
          profilePlan={profilePlan}
          projects={projects}
          search={search}
          settingsSection={settingsSection}
          onSettingsSectionChange={setSettingsSection}
          threads={threads}
          view={view}
        />
        <PaneResizeHandle
          active={activePaneResize === "left"}
          label="Resize project panel"
          onResizeStart={(event) => startPaneResize("left", event)}
        />
        {view === "settings" || view === "marketplace" ? (
          <div
            className="min-h-0 min-w-0 overflow-hidden"
            style={{
              gridColumn: "3 / -1"
            }}
          >
            {view === "settings" ? (
              <SettingsPane
                aiModelSettings={aiModelSettings ?? undefined}
                className="h-full"
                marketplaceModel={
                  marketplaceModel
                    ? {
                        ggufFileName: marketplaceModel.ggufFileName,
                        modelId: marketplaceModel.modelId,
                        ollamaModelName: marketplaceOllamaModelName(marketplaceModel),
                        sourceRepo: marketplaceModel.sourceRepo,
                        sourceUrl: marketplaceModel.sourceUrl
                      }
                    : null
                }
                onAiModelSettingsChange={(settings) => {
                  unloadLoadedOllamaModel();
                  setAiModelSettings(settings);
                  setChatMode(settings.modelKey === "ternary-bonsai-8b" ? "Bonsai" : "Qwopus");
                }}
                onBack={closeSettings}
                onClearMarketplaceModel={() => {
                  unloadLoadedOllamaModel();
                  setMarketplaceModel(null);
                }}
                onOpenMarketplace={() => {
                  unloadLoadedOllamaModel();
                  setView("marketplace");
                }}
                onSettingsChange={handleSettingsChange}
                section={settingsSection}
              />
            ) : (
              <MarketplacePane actionLabel="Use" className="h-full" onSelectModel={selectMarketplaceModel} />
            )}
          </div>
        ) : (
          <>
            {view === "skills" ? (
              <SkillsPane onCreateSkillChat={createSkillThread} />
            ) : (
              <ChatPane
                chatMode={chatMode}
                contextBudget={activeContextBudget}
                marketplaceModelLabel={marketplaceModel ? marketplaceOllamaModelName(marketplaceModel) : null}
                onArchiveThread={archiveThread}
                onClearThread={clearThread}
                onChatModeChange={(mode) => {
                  unloadLoadedOllamaModel();
                  setMarketplaceModel(null);
                  setChatMode(mode);
                }}
                onOpenMarketplace={() => {
                  unloadLoadedOllamaModel();
                  setView("marketplace");
                }}
                onNewThread={createThread}
                onOpenModels={() => {
                  unloadLoadedOllamaModel();
                  setSettingsSection("ai-models");
                  setView("settings");
                }}
                onRenameThread={renameThread}
                onRestoreThread={restoreThread}
                onRestoreToMessage={restoreThreadToMessage}
                onSendMessage={sendMessage}
                onToggleThreadPinned={toggleThreadPinned}
                selectedElement={selectedElement}
                sidebarCollapsed={sidebarCollapsed}
                thread={activeThread}
              />
            )}
            <PaneResizeHandle
              active={activePaneResize === "chat"}
              label="Resize chat panel"
              onResizeStart={(event) => startPaneResize("chat", event)}
            />
            <BrowserPreviewPane
              canGoBack={urlIndex > 0}
              canGoForward={urlIndex < urlHistory.length - 1}
              mode={browserMode}
              onBack={goBack}
              onForward={goForward}
              onModeChange={changeBrowserMode}
              onNavigate={navigate}
              onSelectLocalhostProject={selectLocalhostProject}
              onReload={reloadPreview}
              onLoadStateChange={setLoadState}
              onSelectionBlocked={(reason) => {
                setSelectionBlockedReason(reason);
                setSelectedElement(null);
              }}
              onSelectionReady={() => setSelectionBlockedReason(null)}
              onSelectElement={(element) => {
                setSelectionBlockedReason(null);
                setSelectedElement(element);
              }}
              onZoomChange={setZoom}
              selectionBlockedReason={selectionBlockedReason}
              selectedElement={selectedElement}
              url={currentUrl}
              zoom={zoom}
            />
          </>
        )}
      </main>
    </div>
  );
}
