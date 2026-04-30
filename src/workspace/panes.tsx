import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type Ref,
  type RefObject,
  type ReactNode,
  type WheelEvent
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { settingsSections, type SettingsSectionId } from "./settingsPane";
import logoBlackUrl from "../styles/logoBlack1.png";
import {
  ArrowClockwise,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CaretDown,
  ChatCircleText,
  Check,
  ClockCounterClockwise,
  Copy,
  CursorClick,
  Cpu,
  DotsThree,
  Folder,
  FolderPlus,
  FunnelSimple,
  Gear,
  GlobeSimple,
  MagnifyingGlass,
  MagnifyingGlassPlus,
  Monitor,
  NotePencil,
  Paperclip,
  PencilSimple,
  Plus,
  PushPinSimple,
  SlidersHorizontal,
  Sparkle,
  SignOut,
  Storefront,
  TerminalWindow,
  Tray,
  TrayArrowUp,
  Question,
  X
} from "@phosphor-icons/react";
import { sanitizeBridgeEventEnvelope } from "../preview/bridgeContracts";
import type { ElementReferencePayload } from "../preview/elementReference";

export type WorkspaceView = "threads" | "projects" | "search" | "marketplace" | "skills" | "settings";
export type BrowserMode = "interact" | "select";
export type LoadState = "idle" | "loaded" | "loading";
export type ChatMode = "Qwopus" | "Nano" | "Bonsai";
export type PermissionMode = "default" | "auto-review" | "full-access";
export type SkillCreationSource = "frontier_generated" | "frontier_input";
export type ComposerModelOption = {
  readonly id: ChatMode;
  readonly label: string;
  readonly buttonLabel: string;
  readonly detail: string;
  readonly providerModelId: string;
  readonly runtime: "ollama" | "prism_llama_cpp";
};

export type ChatMessage = {
  id: string;
  appliedPatchIds?: readonly string[];
  createdAt?: number;
  kind?: "activity";
  role: "assistant" | "user" | "tool";
  status?: "working" | "ready" | "failed";
  content: string;
  thinking?: string;
};

export type Thread = {
  id: string;
  title: string;
  project?: string;
  meta: string;
  archived?: boolean;
  archivedAt?: string;
  messages: ChatMessage[];
  pinned?: boolean;
};

export type Project = {
  id: string;
  name: string;
  path: string;
  projectEpoch?: number;
  pinned?: boolean;
  status: string;
  surfaceKind?: ApplicationSurfaceKind | null;
  surfaceSignals?: readonly string[];
};

export type ProjectCreateInput = {
  mode: "scratch" | "existing";
  name: string;
  path: string;
};

type SkillGroup = "Recommended" | "System" | "Personal";

type SkillItem = {
  id: string;
  name: string;
  group: SkillGroup;
  scope: string;
  enabled: boolean;
  source?: string;
  creationSource?: SkillCreationSource;
};

export type SelectedElement = {
  id: string;
  label: string;
  previewUrl?: string;
  tag: string;
  source: string;
  selector?: string;
  reliability?: string;
  rect?: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  stale?: boolean;
};

export type ComposerContext = {
  includeSelection: boolean;
  includeTerminal: boolean;
  attachmentsCount: number;
  localModelLabel?: string;
  mode: ChatMode;
  permissionMode: PermissionMode;
  planMode: boolean;
};

export type ContextBudgetInfo = {
  contextWindowTokens: number;
  estimatedInputTokens: number;
  actualPromptTokens?: number | null;
  actualOutputTokens?: number | null;
  historyCompacted: boolean;
  messageCount?: number;
  reservedOutputTokens: number;
  source: "estimate" | "last_request";
};

export type ApplicationSurfaceKind = "desktop" | "web" | "unknown";

const controlClass =
  "h-7 rounded-[var(--radius-md)] px-2 text-[12px] font-medium text-[var(--text-secondary)] transition-[background-color,color,opacity] duration-100 ease-out hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-45 disabled:transition-none disabled:hover:bg-transparent disabled:hover:text-[var(--text-secondary)]";

const iconButtonClass =
  "grid h-7 w-7 place-items-center rounded-[var(--radius-md)] text-[var(--text-secondary)] transition-[background-color,color,opacity] duration-100 ease-out hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-45 disabled:transition-none disabled:hover:bg-transparent disabled:hover:text-[var(--text-secondary)]";

const sidebarIconButtonClass =
  "grid h-7 w-7 place-items-center rounded-[var(--radius-md)] text-[var(--text-muted)] transition-[background-color,color,opacity] duration-100 ease-out hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-45 disabled:transition-none disabled:hover:bg-transparent disabled:hover:text-[var(--text-muted)]";

const menuPanelClass =
  "overflow-hidden rounded-[var(--radius-lg)] border border-[var(--chrome-glass-border)] bg-[var(--bg-elevated)] p-1 text-[12px] shadow-[var(--shadow-menu)] transition-[opacity,transform] duration-75 ease-out";

const menuItemClass =
  "flex h-8 w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left text-[var(--text-primary)] transition-[background-color,color] duration-75 ease-out active:bg-[var(--control-bg)] hover:bg-[var(--control-bg-hover)]";

const menuItemMutedClass =
  "flex h-8 w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left text-[var(--text-secondary)] transition-[background-color,color] duration-75 ease-out active:bg-[var(--control-bg)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]";

function useDismissableLayer(
  open: boolean,
  refs: readonly RefObject<HTMLElement | null>[],
  onDismiss: () => void
) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function closeOnOutsidePointer(event: globalThis.PointerEvent) {
      const target = event.target;
      if (target instanceof Node && refs.some((ref) => ref.current?.contains(target))) {
        return;
      }

      onDismiss();
    }

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        onDismiss();
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, refs, onDismiss]);
}

function useMenuTransition(open: boolean, duration = 75, placement: "below" | "above" = "below") {
  const [shouldRender, setShouldRender] = useState(open);
  const [shown, setShown] = useState(open);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      const frame = window.requestAnimationFrame(() => setShown(true));
      return () => window.cancelAnimationFrame(frame);
    }

    setShown(false);
    if (!shouldRender) {
      return;
    }

    const timeout = window.setTimeout(() => setShouldRender(false), duration);
    return () => window.clearTimeout(timeout);
  }, [duration, open, shouldRender]);

  return {
    className: shown
      ? "translate-y-0 opacity-100"
      : placement === "above"
        ? "pointer-events-none translate-y-0.5 opacity-0"
        : "pointer-events-none -translate-y-0.5 opacity-0",
    shouldRender
  };
}

const defaultSkillItems: readonly SkillItem[] = [
  {
    id: "desktop-product-ui",
    name: "Desktop Product UI",
    group: "Recommended",
    scope: "Compact app shells, panes, inspectors, dense desktop flows",
    enabled: true,
    source: "System"
  },
  {
    id: "web-creative-ui",
    name: "Web Creative UI",
    group: "Recommended",
    scope: "Expressive but consistent web pages and browser-first apps",
    enabled: true,
    source: "System"
  },
  {
    id: "minimalist-ui",
    name: "Minimalist UI",
    group: "System",
    scope: "Quiet shells, restrained controls, no card soup",
    enabled: true,
    source: "System"
  },
  {
    id: "selection-system",
    name: "Selection System",
    group: "System",
    scope: "Element picking, source references, stale states",
    enabled: true,
    source: "System"
  },
  {
    id: "editorial-ui",
    name: "Editorial UI",
    group: "System",
    scope: "High-contrast reading surfaces and strong type",
    enabled: false,
    source: "System"
  },
  {
    id: "apple-ui",
    name: "Apple UI",
    group: "Personal",
    scope: "Native-feeling spacing, controls, and motion",
    enabled: false,
    source: "Personal"
  }
];

function readSavedSkills() {
  if (typeof window === "undefined") {
    return defaultSkillItems;
  }

  try {
    const saved = window.localStorage.getItem("quartz-canvas-skills");
    if (!saved) {
      return defaultSkillItems;
    }

    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) {
      return defaultSkillItems;
    }

    return parsed.map((item: Partial<SkillItem>) => ({
      id: item.id ?? `skill_${Math.random().toString(36).slice(2, 8)}`,
      name: item.name ?? "Untitled skill",
      group: item.group ?? "Personal",
      scope: item.scope ?? "User skill",
      enabled: Boolean(item.enabled),
      source: item.source ?? (item.group === "Personal" ? "Personal" : "System"),
      creationSource: item.creationSource
    }));
  } catch {
    return defaultSkillItems;
  }
}

const skillGroupOrder: readonly SkillGroup[] = ["Recommended", "System", "Personal"];

const skillFilterOptions = [
  { id: "all", label: "All" },
  { id: "enabled", label: "Enabled" },
  { id: "disabled", label: "Disabled" },
  { id: "recommended", label: "Recommended" },
  { id: "system", label: "System" },
  { id: "personal", label: "Personal" }
] as const;

type SkillFilter = (typeof skillFilterOptions)[number]["id"];

function ThreadRow({
  active,
  onArchive,
  onRestore,
  onSelect,
  onTogglePinned,
  thread
}: {
  active: boolean;
  onArchive: () => void;
  onRestore: () => void;
  onSelect: () => void;
  onTogglePinned: () => void;
  thread: Thread;
}) {
  const archived = Boolean(thread.archived);
  const pinned = Boolean(thread.pinned);

  return (
    <div
      className={[
        "group grid h-8 w-full cursor-pointer grid-cols-[18px_minmax(0,1fr)_18px] items-center gap-2 rounded-[var(--radius-md)] px-2 text-left transition-[background-color,color] duration-100 ease-out",
        active
          ? "bg-[var(--sidebar-selected-bg)] text-[var(--text-primary)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--text-primary)]"
      ].join(" ")}
      onClick={onSelect}
    >
      <button
        aria-label={pinned ? "Unpin chat" : "Pin chat"}
        className={[
          "grid h-6 w-6 -ml-1 place-items-center rounded-[var(--radius-sm)] transition-[background-color,color,opacity] duration-100 ease-out hover:bg-[var(--control-bg-hover)]",
          pinned || active
            ? "text-[var(--text-secondary)]"
            : "text-[var(--text-muted)] opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        ].join(" ")}
        onClick={(event) => {
          event.stopPropagation();
          onTogglePinned();
        }}
        title={pinned ? "Unpin chat" : "Pin chat"}
        type="button"
      >
        <PushPinSimple size={14} weight={pinned ? "fill" : "regular"} />
      </button>
      <button
        className="h-full w-full min-w-0 text-left"
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        type="button"
      >
        <span className="block truncate text-[13px] font-medium">{thread.title}</span>
      </button>
      <button
        aria-label={archived ? "Restore chat" : "Archive chat"}
        className={[
          "grid h-6 w-6 -mr-1 place-items-center rounded-[var(--radius-sm)] transition-[background-color,color,opacity] duration-100 ease-out hover:bg-[var(--control-bg-hover)]",
          active || archived
            ? "text-[var(--text-secondary)]"
            : "text-[var(--text-muted)] opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        ].join(" ")}
        onClick={(event) => {
          event.stopPropagation();
          if (archived) {
            onRestore();
          } else {
            onArchive();
          }
        }}
        title={archived ? "Restore chat" : "Archive chat"}
        type="button"
      >
        {archived ? <TrayArrowUp size={15} weight="regular" /> : <Tray size={15} weight="regular" />}
      </button>
    </div>
  );
}

function SidebarAction({
  active,
  children,
  label,
  onClick,
  shortcut
}: {
  active?: boolean;
  children: ReactNode;
  label: string;
  onClick: () => void;
  shortcut?: string;
}) {
  return (
    <button
      className={[
        "grid h-8 w-full grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-3 rounded-[var(--radius-md)] px-2 text-left text-[12px] transition-[background-color,color] duration-100 ease-out active:bg-[var(--sidebar-selected-bg)]",
        active
          ? "bg-[var(--sidebar-selected-bg)] text-[var(--text-primary)]"
          : "text-[var(--text-muted)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--text-primary)]"
      ].join(" ")}
      onClick={onClick}
      type="button"
    >
      <span className="grid w-4 place-items-center">{children}</span>
      <span className="truncate">{label}</span>
      {shortcut ? (
        <span className="rounded-[var(--radius-sm)] bg-[var(--control-bg)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
          {shortcut}
        </span>
      ) : null}
    </button>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <div className="px-7 py-1 text-[12px] text-[var(--text-muted)]">{children}</div>;
}

function SectionHeader({
  children,
  actions,
  containerRef
}: {
  children: ReactNode;
  actions?: ReactNode;
  containerRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div
      className="relative mt-7 flex h-7 items-center justify-between px-2 text-[12px] text-[var(--text-muted)]"
      ref={containerRef}
    >
      <span className="flex min-w-0 items-center gap-1 truncate">{children}</span>
      {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
    </div>
  );
}

export function ProjectThreadRail({
  activeProjectId,
  activeThreadId,
  onArchiveProjectChats,
  onArchiveThread,
  onCreateProject,
  onNewThread,
  onOpenSettings,
  onOpenProjectInExplorer,
  onRemoveProject,
  onRenameProject,
  onRestoreThread,
  onSearchChange,
  onSelectProject,
  onSelectThread,
  onSignOut,
  onToggleProjectPinned,
  onToggleThreadPinned,
  onViewChange,
  onSettingsSectionChange,
  profileImage = null,
  profileName = "Aiden Marcus",
  profilePlan = "Pro Plan",
  projects,
  search,
  settingsSection = "general",
  threads,
  view,
  className
}: {
  activeProjectId: string | null;
  activeThreadId: string | null;
  onArchiveProjectChats: (projectId: string) => void;
  onArchiveThread: (id: string) => void;
  onCreateProject: (input: ProjectCreateInput) => void;
  onNewThread: (projectId?: string) => void;
  onOpenSettings?: () => void;
  onOpenProjectInExplorer: (projectId: string) => void;
  onRemoveProject: (projectId: string) => void;
  onRenameProject: (projectId: string, name: string) => void;
  onRestoreThread: (id: string) => void;
  onSearchChange: (value: string) => void;
  onSelectProject: (id: string) => void;
  onSelectThread: (id: string) => void;
  onSignOut?: () => void;
  onToggleProjectPinned: (projectId: string) => void;
  onToggleThreadPinned: (id: string) => void;
  onViewChange: (view: WorkspaceView) => void;
  onSettingsSectionChange?: (section: SettingsSectionId) => void;
  profileImage?: string | null;
  profileName?: string;
  profilePlan?: string;
  projects: readonly Project[];
  search: string;
  settingsSection?: SettingsSectionId;
  threads: readonly Thread[];
  view: WorkspaceView;
  className?: string;
}) {
  const projectHeaderActionsRef = useRef<HTMLDivElement | null>(null);
  const projectsHeaderRef = useRef<HTMLDivElement | null>(null);
  const projectRowMenuRef = useRef<HTMLDivElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchPopupRef = useRef<HTMLDivElement | null>(null);
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<readonly string[]>([]);
  const [projectOrganization, setProjectOrganization] = useState<"project" | "chronological" | "chats-first">(
    "project"
  );
  const [projectDraftMode, setProjectDraftMode] = useState<ProjectCreateInput["mode"] | null>(null);
  const [projectDraftName, setProjectDraftName] = useState("");
  const [projectDraftPath, setProjectDraftPath] = useState("");
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [projectHeaderMenuBounds, setProjectHeaderMenuBounds] = useState<{
    left: number;
    maxHeight: number;
    top: number;
    width: number;
  } | null>(null);
  const [projectOptionsOpen, setProjectOptionsOpen] = useState(false);
  const [projectRowMenuOpen, setProjectRowMenuOpen] = useState<string | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [projectRemoveConfirmId, setProjectRemoveConfirmId] = useState<string | null>(null);
  const [projectRenameDraft, setProjectRenameDraft] = useState("");
  const [projectRenamingId, setProjectRenamingId] = useState<string | null>(null);
  const [projectShow, setProjectShow] = useState<"active" | "archived" | "all">("active");
  const [projectSortBy, setProjectSortBy] = useState<"created" | "updated">("updated");
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
  const [searchPopupOpen, setSearchPopupOpen] = useState(false);
  const projectCreateMenuTransition = useMenuTransition(projectMenuOpen);
  const projectOptionsMenuTransition = useMenuTransition(projectOptionsOpen);
  const projectRowMenuTransition = useMenuTransition(Boolean(projectRowMenuOpen));
  const profileMenuTransition = useMenuTransition(profileMenuOpen, 75, "above");
  const searchPopupTransition = useMenuTransition(searchPopupOpen, 160);
  const visibleProjectRowMenuIdRef = useRef<string | null>(projectRowMenuOpen);

  if (projectRowMenuOpen) {
    visibleProjectRowMenuIdRef.current = projectRowMenuOpen;
  }

  const visibleProjectRowMenuId = projectRowMenuOpen ?? (projectRowMenuTransition.shouldRender ? visibleProjectRowMenuIdRef.current : null);

  useDismissableLayer(projectMenuOpen, [projectHeaderActionsRef], () => setProjectMenuOpen(false));
  useDismissableLayer(projectOptionsOpen, [projectHeaderActionsRef], () => setProjectOptionsOpen(false));
  useDismissableLayer(Boolean(projectRowMenuOpen), [projectRowMenuRef], closeProjectMenu);
  useDismissableLayer(profileMenuOpen, [profileMenuRef], () => setProfileMenuOpen(false));

  useEffect(() => {
    const open = projectMenuOpen || projectOptionsOpen;
    if (!open) {
      setProjectHeaderMenuBounds(null);
      return;
    }

    function updateBounds() {
      const rect = projectsHeaderRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      const viewportMargin = 8;
      const gap = 4;
      const left = Math.max(viewportMargin, rect.left);
      const top = rect.bottom + gap;
      const width = Math.max(160, Math.min(rect.width, window.innerWidth - left - viewportMargin));

      setProjectHeaderMenuBounds({
        left,
        maxHeight: Math.max(128, window.innerHeight - top - viewportMargin),
        top,
        width
      });
    }

    updateBounds();
    window.addEventListener("resize", updateBounds);
    window.addEventListener("scroll", updateBounds, true);
    return () => {
      window.removeEventListener("resize", updateBounds);
      window.removeEventListener("scroll", updateBounds, true);
    };
  }, [projectMenuOpen, projectOptionsOpen]);

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        onNewThread();
      }

      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearchPopup();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onNewThread, onSearchChange]);

  const searchQuery = search.trim().toLowerCase();

  const searchMatchesThread = (thread: Thread) =>
    `${thread.title} ${thread.project ?? ""} ${thread.messages.map((message) => message.content).join(" ")}`
      .toLowerCase()
      .includes(searchQuery);

  const threadMatchesVisibility = (thread: Thread) => {
    if (projectShow === "archived") {
      return Boolean(thread.archived);
    }

    if (projectShow === "all") {
      return true;
    }

    return !thread.archived;
  };

  const orderThreads = (rows: readonly Thread[]) =>
    [...rows].sort((left, right) => {
      if (Boolean(left.pinned) !== Boolean(right.pinned)) {
        return left.pinned ? -1 : 1;
      }

      return threads.indexOf(left) - threads.indexOf(right);
    });

  const filteredThreads = orderThreads(threads.filter(threadMatchesVisibility));

  const projectHasThreads = (project: Project) => filteredThreads.some((thread) => thread.project === project.name);

  const visibleProjects = projects;

  function projectActivityIndex(project: Project) {
    const index = filteredThreads.findIndex((thread) => thread.project === project.name);
    return index === -1 ? Number.POSITIVE_INFINITY : index;
  }

  const orderedProjects = [...visibleProjects].sort((left, right) => {
    if (Boolean(left.pinned) !== Boolean(right.pinned)) {
      return left.pinned ? -1 : 1;
    }

    if (projectOrganization === "chats-first") {
      const leftHasThreads = projectHasThreads(left);
      const rightHasThreads = projectHasThreads(right);
      if (leftHasThreads !== rightHasThreads) {
        return leftHasThreads ? -1 : 1;
      }
    }

    if (projectSortBy === "updated") {
      return projectActivityIndex(left) - projectActivityIndex(right);
    }

    return projects.indexOf(left) - projects.indexOf(right);
  });

  const activeThreadProjectName = activeThreadId
    ? threads.find((thread) => thread.id === activeThreadId)?.project ?? null
    : null;

  const projectThreads = orderedProjects.map((project) => ({
    project,
    threads: filteredThreads.filter((thread) => thread.project === project.name)
  }));

  const allProjectsCollapsed =
    orderedProjects.length > 0 && orderedProjects.every((project) => collapsedProjectIds.includes(project.id));

  function toggleAllProjects() {
    setCollapsedProjectIds(allProjectsCollapsed ? [] : orderedProjects.map((project) => project.id));
  }

  function toggleProject(projectId: string) {
    setCollapsedProjectIds((current) =>
      current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId]
    );
  }

  function openProjectRow(projectId: string, collapsed: boolean) {
    onSelectProject(projectId);

    if (collapsed) {
      setCollapsedProjectIds((current) => current.filter((id) => id !== projectId));
    }
  }

  function openProjectDraft(mode: ProjectCreateInput["mode"]) {
    setProjectDraftMode(mode);
    setProjectDraftName("");
    setProjectDraftPath("");
    setProjectMenuOpen(false);
  }

  function cancelProjectDraft() {
    setProjectDraftMode(null);
    setProjectDraftName("");
    setProjectDraftPath("");
  }

  function submitProjectDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!projectDraftMode) {
      return;
    }

    const path = projectDraftPath.trim();
    const name = projectDraftName.trim();
    const canSubmit = projectDraftMode === "scratch" ? Boolean(name || path) : Boolean(path);
    if (!canSubmit) {
      return;
    }

    onCreateProject({
      mode: projectDraftMode,
      name,
      path
    });
    cancelProjectDraft();
  }

  const threadSearchResults = orderThreads((searchQuery ? threads.filter(searchMatchesThread) : threads).filter(threadMatchesVisibility));
  const searchDialogThreads = threadSearchResults.slice(0, 9);
  const clampedSearchActiveIndex = Math.min(searchActiveIndex, Math.max(searchDialogThreads.length - 1, 0));

  useEffect(() => {
    if (!searchPopupOpen) {
      return;
    }

    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [searchPopupOpen]);

  useEffect(() => {
    setSearchActiveIndex(0);
  }, [searchQuery]);

  useEffect(() => {
    if (!activeProjectId) {
      return;
    }

    setCollapsedProjectIds((current) =>
      current.includes(activeProjectId) ? current.filter((id) => id !== activeProjectId) : current
    );
  }, [activeProjectId]);

  function startProjectRename(project: Project) {
    setProjectRenameDraft(project.name);
    setProjectRenamingId(project.id);
    setProjectRemoveConfirmId(null);
  }

  function submitProjectRename(event: FormEvent<HTMLFormElement>, project: Project) {
    event.preventDefault();

    const nextName = projectRenameDraft.trim();
    if (!nextName) {
      return;
    }

    onRenameProject(project.id, nextName);
    setProjectRenamingId(null);
    setProjectRowMenuOpen(null);
  }

  function closeProjectMenu() {
    setProjectRowMenuOpen(null);
    setProjectRenamingId(null);
    setProjectRemoveConfirmId(null);
  }

  function openSearchPopup() {
    onSearchChange("");
    setSearchActiveIndex(0);
    setSearchPopupOpen(true);
    setProjectMenuOpen(false);
    setProjectOptionsOpen(false);
    setProfileMenuOpen(false);
    closeProjectMenu();
  }

  function closeSearchPopup() {
    setSearchPopupOpen(false);
  }

  function openSettingsFromProfile() {
    if (onOpenSettings) {
      onOpenSettings();
    } else {
      onViewChange("settings");
    }
    setProjectMenuOpen(false);
    setProjectOptionsOpen(false);
    setProfileMenuOpen(false);
    closeProjectMenu();
  }

  function selectSearchThread(thread: Thread) {
    onSelectThread(thread.id);
    closeSearchPopup();
  }

  function handleSearchPopupKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearchPopup();
      return;
    }

    if (searchDialogThreads.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSearchActiveIndex((current) => Math.min(current + 1, searchDialogThreads.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSearchActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      selectSearchThread(searchDialogThreads[clampedSearchActiveIndex]);
      return;
    }

    if ((event.ctrlKey || event.metaKey) && /^[1-9]$/.test(event.key)) {
      const shortcutIndex = Number(event.key) - 1;
      const thread = searchDialogThreads[shortcutIndex];
      if (thread) {
        event.preventDefault();
        selectSearchThread(thread);
      }
    }
  }

  function ProjectMenuOption({
    active,
    children,
    onClick
  }: {
    active: boolean;
    children: ReactNode;
    onClick: () => void;
  }) {
    return (
      <button
        aria-checked={active}
        className={[
          "grid h-7 w-full grid-cols-[minmax(0,1fr)_14px] items-center gap-2 rounded-[var(--radius-sm)] px-2.5 text-left text-[12px] transition-[background-color,color] duration-75 ease-out active:bg-[var(--control-bg)]",
          active
            ? "bg-[var(--sidebar-selected-bg)] text-[var(--text-primary)]"
            : "text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
        ].join(" ")}
        onClick={onClick}
        role="menuitemradio"
        type="button"
      >
        <span className="truncate">{children}</span>
        <span className="grid place-items-center text-[var(--text-muted)]">
          {active ? <Check size={13} weight="regular" /> : null}
        </span>
      </button>
    );
  }

  function ProjectActionMenu({ className, project }: { className: string; project: Project }) {
    const renaming = projectRenamingId === project.id;
    const confirmingRemove = projectRemoveConfirmId === project.id;

    return (
      <div className={`absolute right-0 top-full z-30 mt-1 w-52 ${menuPanelClass} ${className}`}>
        {renaming ? (
          <form className="space-y-1" onSubmit={(event) => submitProjectRename(event, project)}>
            <input
              aria-label="Project name"
              className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--control-bg)] px-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              onChange={(event) => setProjectRenameDraft(event.target.value)}
              value={projectRenameDraft}
            />
            <div className="flex justify-end gap-1">
              <button className={controlClass} onClick={() => setProjectRenamingId(null)} type="button">
                Cancel
              </button>
              <button className={controlClass} disabled={!projectRenameDraft.trim()} type="submit">
                Save
              </button>
            </div>
          </form>
        ) : confirmingRemove ? (
          <div className="space-y-2 px-1 py-1">
            <div className="text-[12px] leading-4 text-[var(--text-secondary)]">
              Remove this project and its local chat history?
            </div>
            <div className="flex justify-end gap-1">
              <button className={controlClass} onClick={() => setProjectRemoveConfirmId(null)} type="button">
                Cancel
              </button>
              <button
                className="h-7 rounded-[var(--radius-md)] px-2 text-[12px] font-medium text-[var(--danger)] transition-[background-color,color] duration-100 ease-out hover:bg-[var(--control-bg-hover)]"
                onClick={() => {
                  onRemoveProject(project.id);
                  closeProjectMenu();
                }}
                type="button"
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              className={menuItemMutedClass}
              onClick={() => {
                onToggleProjectPinned(project.id);
                closeProjectMenu();
              }}
              type="button"
            >
              <PushPinSimple size={15} weight={project.pinned ? "fill" : "regular"} />
              {project.pinned ? "Unpin project" : "Pin project"}
            </button>
            <button
              className={menuItemMutedClass}
              onClick={() => {
                onOpenProjectInExplorer(project.id);
                closeProjectMenu();
              }}
              type="button"
            >
              <Folder size={15} weight="regular" />
              Open in Explorer
            </button>
            <button
              className={menuItemMutedClass}
              onClick={() => startProjectRename(project)}
              type="button"
            >
              <NotePencil size={15} weight="regular" />
              Rename project
            </button>
            <button
              className={menuItemMutedClass}
              onClick={() => {
                onArchiveProjectChats(project.id);
                closeProjectMenu();
              }}
              type="button"
            >
              <Tray size={15} weight="regular" />
              Archive chats
            </button>
            <button
              className="flex h-8 w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left text-[var(--text-secondary)] transition-[background-color,color] duration-75 ease-out active:bg-[var(--control-bg)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--danger)]"
              onClick={() => setProjectRemoveConfirmId(project.id)}
              type="button"
            >
              <X size={15} weight="regular" />
              Remove
            </button>
          </>
        )}
      </div>
    );
  }

  const projectsHeaderActions = (
    <div className="flex items-center gap-1" ref={projectHeaderActionsRef}>
      <button
        className={sidebarIconButtonClass}
        disabled={orderedProjects.length === 0}
        onClick={toggleAllProjects}
        title={allProjectsCollapsed ? "Expand projects" : "Collapse projects"}
        type="button"
      >
        <CaretDown
          className={allProjectsCollapsed ? "-rotate-90 transition-transform" : "transition-transform"}
          size={14}
          weight="regular"
        />
      </button>
      <button
        aria-expanded={projectOptionsOpen}
        aria-haspopup="menu"
        className={sidebarIconButtonClass}
        onClick={() => {
          setProjectOptionsOpen((current) => !current);
          setProjectMenuOpen(false);
          closeProjectMenu();
        }}
        title="Organize projects"
        type="button"
      >
        <FunnelSimple size={14} weight="regular" />
      </button>
      <button
        aria-expanded={projectMenuOpen}
        aria-haspopup="menu"
        className={sidebarIconButtonClass}
        onClick={() => {
          setProjectMenuOpen((current) => !current);
          setProjectOptionsOpen(false);
          closeProjectMenu();
        }}
        title="Add project"
        type="button"
      >
        <FolderPlus size={14} weight="regular" />
      </button>
      {projectOptionsMenuTransition.shouldRender ? (
        <div
          aria-label="Organize projects"
          className={`fixed z-50 origin-top ${menuPanelClass} ${projectOptionsMenuTransition.className}`}
          role="menu"
          style={
            projectHeaderMenuBounds
              ? {
                  left: projectHeaderMenuBounds.left,
                  maxHeight: projectHeaderMenuBounds.maxHeight,
                  overflowY: "auto",
                  top: projectHeaderMenuBounds.top,
                  width: projectHeaderMenuBounds.width
                }
              : undefined
          }
        >
          <div className="px-2.5 pb-1 pt-1 text-[11px] font-medium text-[var(--text-muted)]">Organize</div>
          <div className="space-y-0.5">
            <ProjectMenuOption
              active={projectOrganization === "project"}
              onClick={() => {
                setProjectOrganization("project");
                setProjectOptionsOpen(false);
              }}
            >
              By project
            </ProjectMenuOption>
            <ProjectMenuOption
              active={projectOrganization === "chronological"}
              onClick={() => {
                setProjectOrganization("chronological");
                setProjectOptionsOpen(false);
              }}
            >
              Chronological list
            </ProjectMenuOption>
            <ProjectMenuOption
              active={projectOrganization === "chats-first"}
              onClick={() => {
                setProjectOrganization("chats-first");
                setProjectOptionsOpen(false);
              }}
            >
              Chats first
            </ProjectMenuOption>
          </div>
          <div className="my-1 h-px bg-[var(--border-subtle)]" />
          <div className="px-2.5 pb-1 pt-1 text-[11px] font-medium text-[var(--text-muted)]">Sort by</div>
          <div className="space-y-0.5">
            <ProjectMenuOption
              active={projectSortBy === "created"}
              onClick={() => {
                setProjectSortBy("created");
                setProjectOptionsOpen(false);
              }}
            >
              Created
            </ProjectMenuOption>
            <ProjectMenuOption
              active={projectSortBy === "updated"}
              onClick={() => {
                setProjectSortBy("updated");
                setProjectOptionsOpen(false);
              }}
            >
              Updated
            </ProjectMenuOption>
          </div>
          <div className="my-1 h-px bg-[var(--border-subtle)]" />
          <div className="px-2.5 pb-1 pt-1 text-[11px] font-medium text-[var(--text-muted)]">Show</div>
          <div className="space-y-0.5">
            <ProjectMenuOption
              active={projectShow === "active"}
              onClick={() => {
                setProjectShow("active");
                setProjectOptionsOpen(false);
              }}
            >
              Active chats
            </ProjectMenuOption>
            <ProjectMenuOption
              active={projectShow === "archived"}
              onClick={() => {
                setProjectShow("archived");
                setProjectOptionsOpen(false);
              }}
            >
              Archived
            </ProjectMenuOption>
            <ProjectMenuOption
              active={projectShow === "all"}
              onClick={() => {
                setProjectShow("all");
                setProjectOptionsOpen(false);
              }}
            >
              All chats
            </ProjectMenuOption>
          </div>
        </div>
      ) : null}
      {projectCreateMenuTransition.shouldRender ? (
        <div
          aria-label="Add project"
          className={`fixed z-50 origin-top ${menuPanelClass} ${projectCreateMenuTransition.className}`}
          role="menu"
          style={
            projectHeaderMenuBounds
              ? {
                  left: projectHeaderMenuBounds.left,
                  maxHeight: projectHeaderMenuBounds.maxHeight,
                  overflowY: "auto",
                  top: projectHeaderMenuBounds.top,
                  width: projectHeaderMenuBounds.width
                }
              : undefined
          }
        >
          <button
            className={menuItemClass}
            onClick={() => openProjectDraft("scratch")}
            role="menuitem"
            type="button"
          >
            <Plus size={15} weight="regular" />
            Start from scratch
          </button>
          <button
            className={menuItemClass}
            onClick={() => openProjectDraft("existing")}
            role="menuitem"
            type="button"
          >
            <Folder size={15} weight="regular" />
            Use an existing folder
          </button>
        </div>
      ) : null}
    </div>
  );

  const projectDraft = projectDraftMode ? (
    <form className="mx-2 mb-3 space-y-2 border-b border-[var(--border-subtle)] pb-3" onSubmit={submitProjectDraft}>
      <div className="text-[12px] font-medium text-[var(--text-primary)]">
        {projectDraftMode === "scratch" ? "New project" : "Existing folder"}
      </div>
      <input
        aria-label="Project name"
        className="h-8 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--control-bg)] px-2 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
        onChange={(event) => setProjectDraftName(event.target.value)}
        placeholder={projectDraftMode === "scratch" ? "Project name" : "Name, optional"}
        value={projectDraftName}
      />
      <input
        aria-label="Project path"
        className="h-8 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--control-bg)] px-2 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
        onChange={(event) => setProjectDraftPath(event.target.value)}
        placeholder={projectDraftMode === "scratch" ? "Folder path, optional" : "Folder path"}
        value={projectDraftPath}
      />
      <div className="flex justify-end gap-1">
        <button className={controlClass} onClick={cancelProjectDraft} type="button">
          Cancel
        </button>
        <button className={controlClass} type="submit">
          {projectDraftMode === "scratch" ? "Create" : "Open"}
        </button>
      </div>
    </form>
  ) : null;

  const emptyChatLabel = projectShow === "archived" ? "No archived chats" : "No chats";

  function renderThreadRow(thread: Thread) {
    return (
      <ThreadRow
        active={thread.id === activeThreadId}
        key={thread.id}
        onArchive={() => onArchiveThread(thread.id)}
        onRestore={() => onRestoreThread(thread.id)}
        onSelect={() => onSelectThread(thread.id)}
        onTogglePinned={() => onToggleThreadPinned(thread.id)}
        thread={thread}
      />
    );
  }

  function renderProjectsView() {
    if (projectOrganization === "chronological") {
      return (
        <>
          <SectionHeader actions={projectsHeaderActions} containerRef={projectsHeaderRef}>
            Projects
          </SectionHeader>
          {projectDraft}
          {filteredThreads.length === 0 ? (
            <EmptyLine>{projects.length === 0 ? "No projects" : emptyChatLabel}</EmptyLine>
          ) : (
            <div className="space-y-1 px-1">
              {filteredThreads.map((thread) => renderThreadRow(thread))}
            </div>
          )}
        </>
      );
    }

    return (
      <>
        <SectionHeader actions={projectsHeaderActions} containerRef={projectsHeaderRef}>
          Projects
        </SectionHeader>
        {projectDraft}
        {projectThreads.length === 0 ? (
          <EmptyLine>No projects</EmptyLine>
        ) : (
          <div className="space-y-3">
            {projectThreads.map(({ project, threads: projectThreadRows }) => {
              const collapsed = collapsedProjectIds.includes(project.id);
              const projectHasActiveThread = activeThreadProjectName === project.name;
              const projectIsPrimarySelection = project.id === activeProjectId && !projectHasActiveThread;

              return (
                <div key={project.id}>
                  <div
                    className={[
                      "group/project relative mb-1 grid h-8 cursor-pointer grid-cols-[32px_minmax(0,1fr)_auto] items-center rounded-[var(--radius-md)] pr-1 transition-[background-color,color] duration-100 ease-out",
                      projectIsPrimarySelection
                        ? "bg-[var(--sidebar-selected-bg)] text-[var(--text-primary)]"
                        : "text-[var(--text-muted)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--text-primary)]"
                    ].join(" ")}
                    onClick={() => openProjectRow(project.id, collapsed)}
                  >
                    <button
                      aria-label={collapsed ? "Expand project" : "Collapse project"}
                      className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] text-[var(--text-muted)] transition-[background-color,color] duration-100 ease-out hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleProject(project.id);
                      }}
                      title={collapsed ? "Expand project" : "Collapse project"}
                      type="button"
                    >
                      <CaretDown
                        className={collapsed ? "-rotate-90 transition-transform" : "transition-transform"}
                        size={12}
                        weight="regular"
                      />
                    </button>
                    <button
                      aria-expanded={!collapsed}
                      className="flex h-8 w-full min-w-0 items-center gap-2 text-left text-[12px]"
                      onClick={(event) => {
                        event.stopPropagation();
                        openProjectRow(project.id, collapsed);
                      }}
                      title={collapsed ? `Open ${project.name}` : project.name}
                      type="button"
                    >
                      <Folder size={16} weight={project.pinned ? "fill" : "regular"} />
                      <span className="truncate">{project.name}</span>
                    </button>
                    <div
                      className={[
                        "relative flex items-center gap-0.5 transition-opacity duration-100 ease-out",
                        projectIsPrimarySelection || visibleProjectRowMenuId === project.id
                          ? "opacity-100"
                          : "opacity-0 group-hover/project:opacity-100 focus-within:opacity-100"
                      ].join(" ")}
                      onClick={(event) => event.stopPropagation()}
                      ref={visibleProjectRowMenuId === project.id ? projectRowMenuRef : undefined}
                    >
                      <button
                        aria-expanded={projectRowMenuOpen === project.id}
                        aria-haspopup="menu"
                        aria-label={`Project actions for ${project.name}`}
                        className={sidebarIconButtonClass}
                        onClick={(event) => {
                          event.stopPropagation();
                          setProjectMenuOpen(false);
                          setProjectOptionsOpen(false);
                          setProjectRemoveConfirmId(null);
                          setProjectRenamingId(null);
                          setProjectRowMenuOpen((current) => (current === project.id ? null : project.id));
                        }}
                        title="Project actions"
                        type="button"
                      >
                        <DotsThree size={15} weight="bold" />
                      </button>
                      <button
                        aria-label={`New agent in ${project.name}`}
                        className={sidebarIconButtonClass}
                        onClick={(event) => {
                          event.stopPropagation();
                          onNewThread(project.id);
                        }}
                        title="New agent"
                        type="button"
                      >
                        <NotePencil size={15} weight="regular" />
                      </button>
                      {visibleProjectRowMenuId === project.id && projectRowMenuTransition.shouldRender ? (
                        <ProjectActionMenu className={projectRowMenuTransition.className} project={project} />
                      ) : null}
                    </div>
                  </div>
                  {collapsed ? null : projectThreadRows.length === 0 ? (
                    <EmptyLine>{emptyChatLabel}</EmptyLine>
                  ) : (
                    <div className="space-y-1 pl-6">
                      {projectThreadRows.map((thread) => renderThreadRow(thread))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </>
    );
  }

  function renderSearchPopup() {
    if (!searchPopupTransition.shouldRender) {
      return null;
    }

    const overlayStateClass = searchPopupOpen ? "opacity-100" : "pointer-events-none opacity-0";
    const panelStateClass = searchPopupOpen
      ? "translate-y-0 scale-100 opacity-100"
      : "translate-y-1 scale-[0.985] opacity-0";
    const resultLabel = searchQuery ? "Matching chats" : "Recent chats";

    return (
      <div
        className={`fixed inset-0 z-50 flex items-start justify-center bg-[var(--overlay-bg)] px-4 pt-[92px] backdrop-blur-[1.5px] transition-opacity duration-150 ease-out ${overlayStateClass}`}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            closeSearchPopup();
          }
        }}
      >
        <div
          aria-label="Search chats"
          aria-modal="true"
          className={`w-[min(572px,calc(100vw-32px))] origin-top overflow-hidden rounded-[20px] border border-[var(--chrome-glass-border)] bg-[var(--bg-elevated)] text-[13px] text-[var(--text-primary)] shadow-[var(--shadow-menu)] transition-[opacity,transform] duration-150 ease-out ${panelStateClass}`}
          onKeyDown={handleSearchPopupKeyDown}
          ref={searchPopupRef}
          role="dialog"
        >
          <label className="flex h-12 items-center gap-2 border-b border-[var(--border-subtle)] px-4 text-[var(--text-muted)]">
            <MagnifyingGlass size={16} weight="regular" />
            <input
              aria-label="Search chats"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search chats"
              ref={searchInputRef}
              value={search}
            />
            {search ? (
              <button
                aria-label="Clear search"
                className="grid h-7 w-7 place-items-center rounded-[var(--radius-md)] text-[var(--text-muted)] transition-[background-color,color] duration-100 ease-out hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
                onClick={() => onSearchChange("")}
                type="button"
              >
                <X size={14} weight="regular" />
              </button>
            ) : null}
          </label>
          <div className="px-2 pb-3 pt-2">
            <div className="px-2 pb-1 pt-1 text-[12px] text-[var(--text-muted)]">{resultLabel}</div>
            {searchDialogThreads.length === 0 ? (
              <div className="px-2 py-2 text-[13px] text-[var(--text-muted)]">
                {searchQuery ? "No matching chats" : "No recent chats"}
              </div>
            ) : (
              <div className="space-y-0.5">
                {searchDialogThreads.map((thread, index) => {
                  const active = index === clampedSearchActiveIndex;

                  return (
                    <button
                      aria-selected={active}
                      className={[
                        "grid h-8 w-full grid-cols-[18px_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-[var(--radius-md)] px-2 text-left transition-[background-color,color] duration-100 ease-out",
                        active
                          ? "bg-[var(--sidebar-selected-bg)] text-[var(--text-primary)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--text-primary)]"
                      ].join(" ")}
                      key={thread.id}
                      onClick={() => selectSearchThread(thread)}
                      onMouseEnter={() => setSearchActiveIndex(index)}
                      role="option"
                      type="button"
                    >
                      <Monitor size={15} weight="regular" />
                      <span className="min-w-0 truncate text-[13px] font-medium">{thread.title}</span>
                      <span className="max-w-32 truncate text-[12px] text-[var(--text-muted)]">{thread.project ?? "No project"}</span>
                      <span className="rounded-[var(--radius-sm)] bg-[var(--control-bg)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                        Ctrl+{index + 1}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderSettingsView() {
    return (
      <>
        <SectionHeader>Settings</SectionHeader>
        <nav aria-label="Settings sections" className="space-y-0.5">
          {settingsSections.map((section) => (
              <button
                aria-current={settingsSection === section.id ? "page" : undefined}
                className={[
                "grid h-8 w-full grid-cols-[18px_minmax(0,1fr)_14px] items-center gap-2 rounded-[var(--radius-md)] px-2 text-left text-[12px] transition-[background-color,color] duration-100 ease-out",
                settingsSection === section.id
                  ? "bg-[var(--sidebar-selected-bg)] text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--text-primary)]"
              ].join(" ")}
              key={section.id}
              onClick={() => {
                onSettingsSectionChange?.(section.id);
                onViewChange("settings");
              }}
              type="button"
            >
              <span className="grid w-[18px] place-items-center text-[var(--text-muted)]">{section.icon}</span>
              <span className="min-w-0 truncate">{section.label}</span>
              {settingsSection === section.id ? <Check size={13} weight="regular" /> : null}
            </button>
          ))}
        </nav>
      </>
    );
  }

  const content = view === "settings" ? renderSettingsView() : renderProjectsView();

  return (
    <aside
      aria-label="Projects and threads"
      className={[
        "flex min-h-0 min-w-0 flex-col bg-[var(--bg-sidebar)] px-2 py-3 transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] transform-gpu",
        className ?? ""
      ].join(" ")}
    >
      <nav aria-label="Workspace navigation" className="shrink-0 space-y-1">
        <SidebarAction label="New Agent" onClick={onNewThread} shortcut="Ctrl+N">
          <NotePencil size={16} weight="regular" />
        </SidebarAction>
        <SidebarAction active={searchPopupOpen} label="Search" onClick={openSearchPopup} shortcut="Ctrl+K">
          <MagnifyingGlass size={16} weight="regular" />
        </SidebarAction>
        <SidebarAction active={view === "marketplace"} label="Marketplace" onClick={() => onViewChange("marketplace")}>
          <Storefront size={16} weight="regular" />
        </SidebarAction>
        <SidebarAction active={view === "skills"} label="Skills" onClick={() => onViewChange("skills")}>
          <Sparkle size={16} weight="regular" />
        </SidebarAction>
      </nav>
      <div className="min-h-0 flex-1 overflow-auto">{content}</div>
      {renderSearchPopup()}
      <div
        className="relative w-full shrink-0 pt-2"
        onDoubleClick={(event) => event.stopPropagation()}
        ref={profileMenuRef}
      >
        {profileMenuTransition.shouldRender ? (
          <div
            aria-label="Profile menu"
            className={`absolute bottom-full left-0 z-[200] mb-2 flex w-[180px] max-w-[calc(100vw-32px)] origin-bottom-left transform-gpu flex-col isolate rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-lg transition-[opacity,transform] duration-150 ease-out ${profileMenuTransition.className}`}
            onPointerDown={(event) => event.stopPropagation()}
            role="menu"
          >
            <div className="flex flex-col p-1">
              <button
                className="group flex w-full items-center gap-2 rounded-[4px] px-2 py-1 text-left text-[12px] text-[var(--text-primary)] transition-colors duration-100 hover:bg-[var(--control-bg-hover)]"
                onClick={openSettingsFromProfile}
                role="menuitem"
                type="button"
              >
                <Gear
                  className="text-[var(--text-muted)] transition-colors group-hover:text-[var(--text-primary)]"
                  size={14}
                />
                <span>Settings</span>
              </button>

              <a
                className="group flex w-full items-center gap-2 rounded-[4px] px-2 py-1 text-left text-[12px] text-[var(--text-primary)] no-underline transition-colors duration-100 hover:bg-[var(--control-bg-hover)]"
                href="https://quartzeditor.com/guide"
                onClick={() => setProfileMenuOpen(false)}
                rel="noopener noreferrer"
                role="menuitem"
                target="_blank"
              >
                <Question
                  className="text-[var(--text-muted)] transition-colors group-hover:text-[var(--text-primary)]"
                  size={14}
                />
                <span>Guide</span>
              </a>

              <a
                className="group flex w-full items-center gap-2 rounded-[4px] px-2 py-1 text-left text-[12px] text-[var(--text-primary)] no-underline transition-colors duration-100 hover:bg-[var(--control-bg-hover)]"
                href="https://discord.gg/quartz"
                onClick={() => setProfileMenuOpen(false)}
                rel="noopener noreferrer"
                role="menuitem"
                target="_blank"
              >
                <ChatCircleText
                  className="text-[var(--text-muted)] transition-colors group-hover:text-[var(--text-primary)]"
                  size={14}
                />
                <span>Support</span>
              </a>

              <div className="mx-1.5 my-1 h-px bg-[var(--border-subtle)]" />

              <button
                className="group flex w-full items-center gap-2 rounded-[4px] px-2 py-1 text-left text-[12px] text-[var(--text-primary)] transition-colors duration-100 hover:bg-[var(--danger)]/10 hover:text-[var(--danger)]"
                onClick={() => {
                  setProfileMenuOpen(false);
                  onSignOut?.();
                }}
                role="menuitem"
                type="button"
              >
                <SignOut
                  className="text-[var(--text-muted)] transition-colors group-hover:text-[var(--danger)]"
                  size={14}
                />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        ) : null}
        <div className="group flex w-full select-none flex-row items-center gap-2 rounded-[6px] px-1.5 py-1.5 outline-none transition-colors duration-150 hover:bg-[var(--sidebar-hover-bg)]">
          <button
            aria-expanded={profileMenuOpen}
            aria-haspopup="menu"
            className="h-6 w-6 flex-shrink-0 cursor-pointer overflow-hidden rounded-full bg-[var(--control-bg)] ring-1 ring-[var(--border)]"
            onClick={() => setProfileMenuOpen((current) => !current)}
            type="button"
          >
            {profileImage ? (
              <img alt="" className="h-full w-full object-cover" draggable={false} src={profileImage} />
            ) : (
              <span className="flex h-full w-full items-center justify-center bg-[var(--control-bg-pressed)] text-[10px] font-bold text-[var(--text-primary)]">
                {profileName
                  .split(/\s+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((part) => part[0]?.toUpperCase())
                  .join("") || "QC"}
              </span>
            )}
          </button>
          <button
            aria-expanded={profileMenuOpen}
            aria-haspopup="menu"
            className="flex min-w-0 flex-1 cursor-pointer flex-col justify-center text-left opacity-100 transition-opacity duration-300"
            onClick={() => setProfileMenuOpen((current) => !current)}
            type="button"
          >
            <span className="truncate text-[12px] leading-tight text-[var(--text-primary)]">{profileName}</span>
            <span className="mt-[1px] truncate text-[10px] leading-tight text-[var(--text-muted)]">{profilePlan}</span>
          </button>
          <div className="flex shrink-0 items-center opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <button
              aria-label="Settings"
              className="flex h-5 w-5 items-center justify-center rounded-[4px] text-[var(--text-muted)] transition-colors hover:bg-[var(--sidebar-hover-bg-strong)] hover:text-[var(--text-primary)]"
              onClick={(event) => {
                event.stopPropagation();
                openSettingsFromProfile();
              }}
              type="button"
            >
              <Gear size={13} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

export function SkillsPane({
  onCreateSkillChat
}: {
  onCreateSkillChat: (creationSource: SkillCreationSource) => void;
}) {
  const createMenuRef = useRef<HTMLDivElement | null>(null);
  const filterMenuRef = useRef<HTMLDivElement | null>(null);
  const manageMenuRef = useRef<HTMLDivElement | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [creationSource, setCreationSource] = useState<SkillCreationSource | "">("");
  const [draftName, setDraftName] = useState("");
  const [draftScope, setDraftScope] = useState("");
  const [filter, setFilter] = useState<SkillFilter>("all");
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [manageMenuOpen, setManageMenuOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [skills, setSkills] = useState<readonly SkillItem[]>(readSavedSkills);
  const createMenuTransition = useMenuTransition(createMenuOpen);
  const filterMenuTransition = useMenuTransition(filterMenuOpen);
  const manageMenuTransition = useMenuTransition(manageMenuOpen);

  useDismissableLayer(createMenuOpen, [createMenuRef], () => setCreateMenuOpen(false));
  useDismissableLayer(filterMenuOpen, [filterMenuRef], () => setFilterMenuOpen(false));
  useDismissableLayer(manageMenuOpen, [manageMenuRef], () => setManageMenuOpen(false));

  useEffect(() => {
    window.localStorage.setItem("quartz-canvas-skills", JSON.stringify(skills));
  }, [skills]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleSkills = skills.filter((skill) => {
    const matchesQuery =
      !normalizedQuery ||
      `${skill.name} ${skill.scope} ${skill.source ?? ""}`.toLowerCase().includes(normalizedQuery);
    const matchesFilter =
      filter === "all" ||
      (filter === "enabled" && skill.enabled) ||
      (filter === "disabled" && !skill.enabled) ||
      (filter === "recommended" && skill.group === "Recommended") ||
      (filter === "system" && skill.group === "System") ||
      (filter === "personal" && skill.group === "Personal");

    return matchesQuery && matchesFilter;
  });
  const selectedFilter = skillFilterOptions.find((option) => option.id === filter) ?? skillFilterOptions[0];
  const enabledCount = skills.filter((skill) => skill.enabled).length;
  const canSaveDraft = Boolean(draftName.trim() && draftScope.trim() && creationSource);

  function toggleSkill(skillId: string) {
    setSkills((current) =>
      current.map((skill) =>
        skill.id === skillId
          ? {
              ...skill,
              enabled: !skill.enabled
            }
          : skill
      )
    );
  }

  function createReviewedSkill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSaveDraft || !creationSource) {
      return;
    }

    setSkills((current) => [
      {
        id: `skill_${Date.now().toString(36)}`,
        name: draftName.trim(),
        group: "Personal",
        scope: draftScope.trim(),
        enabled: true,
        source:
          creationSource === "frontier_generated"
            ? "Generated by frontier model"
            : "Input by frontier model",
        creationSource
      },
      ...current
    ]);
    setDraftName("");
    setDraftScope("");
    setCreationSource("");
    setPasteOpen(false);
    setCreateMenuOpen(false);
  }

  function startSkillChat(source: SkillCreationSource) {
    setCreateMenuOpen(false);
    onCreateSkillChat(source);
  }

  function enableAllSkills() {
    setSkills((current) => current.map((skill) => ({ ...skill, enabled: true })));
    setManageMenuOpen(false);
  }

  function disablePersonalSkills() {
    setSkills((current) =>
      current.map((skill) => (skill.group === "Personal" ? { ...skill, enabled: false } : skill))
    );
    setManageMenuOpen(false);
  }

  function resetSkills() {
    setSkills(defaultSkillItems);
    setManageMenuOpen(false);
  }

  return (
    <section
      aria-label="Skills"
      className="min-h-0 min-w-0 overflow-auto bg-[var(--bg-workspace-main)]"
    >
      <div className="mx-auto flex min-h-full w-full max-w-[820px] flex-col px-6 py-5">
        <div className="flex h-8 items-center justify-between">
          <div className="rounded-[var(--radius-md)] bg-[var(--control-bg)] px-2 py-1 text-[12px] text-[var(--text-primary)]">
            Skills
          </div>
          <div className="flex items-center gap-2">
            <div className="relative" ref={manageMenuRef}>
              <button
                aria-expanded={manageMenuOpen}
                aria-haspopup="menu"
                className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--control-bg)] px-2.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--control-bg-hover)]"
                onClick={() => {
                  setManageMenuOpen((current) => !current);
                  setCreateMenuOpen(false);
                  setFilterMenuOpen(false);
                }}
                type="button"
              >
                <SlidersHorizontal size={14} weight="regular" />
                Manage
              </button>
              {manageMenuTransition.shouldRender ? (
                <div className={`absolute right-0 top-full z-30 mt-1 w-44 ${menuPanelClass} ${manageMenuTransition.className}`}>
                  <button
                    className={menuItemClass}
                    onClick={enableAllSkills}
                    type="button"
                  >
                    Enable all
                  </button>
                  <button
                    className={menuItemClass}
                    onClick={disablePersonalSkills}
                    type="button"
                  >
                    Disable personal
                  </button>
                  <button
                    className="flex h-8 w-full items-center rounded-[var(--radius-sm)] px-2 text-left text-[var(--danger)] transition-[background-color,color] duration-75 ease-out active:bg-[var(--control-bg)] hover:bg-[var(--control-bg-hover)]"
                    onClick={resetSkills}
                    type="button"
                  >
                    Reset skills
                  </button>
                </div>
              ) : null}
            </div>
            <div className="relative" ref={createMenuRef}>
              <button
                aria-expanded={createMenuOpen}
                aria-haspopup="menu"
                className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--control-bg)] px-2.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--control-bg-hover)]"
                onClick={() => {
                  setCreateMenuOpen((current) => !current);
                  setManageMenuOpen(false);
                  setFilterMenuOpen(false);
                }}
                type="button"
              >
                Create
                <CaretDown
                  className={createMenuOpen ? "rotate-180 transition-transform duration-100 ease-out" : "rotate-0 transition-transform duration-100 ease-out"}
                  size={12}
                  weight="regular"
                />
              </button>
              {createMenuTransition.shouldRender ? (
                <div className={`absolute right-0 top-full z-30 mt-1 w-56 ${menuPanelClass} ${createMenuTransition.className}`}>
                  <button
                    className={menuItemClass}
                    onClick={() => startSkillChat("frontier_generated")}
                    type="button"
                  >
                    <NotePencil size={14} weight="regular" />
                    Create in chat
                  </button>
                  <button
                    className={menuItemClass}
                    onClick={() => {
                      setPasteOpen(true);
                      setCreateMenuOpen(false);
                    }}
                    type="button"
                  >
                    <Paperclip size={14} weight="regular" />
                    Paste reviewed skill
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="pb-7 pt-9 text-center">
          <h1 className="text-[26px] font-medium tracking-normal text-[var(--text-primary)]">
            Make Quartz Canvas work your way
          </h1>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_92px] items-center gap-2">
          <label className="flex h-8 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] px-2 text-[12px] text-[var(--text-muted)]">
            <MagnifyingGlass size={14} weight="regular" />
            <input
              aria-label="Search skills"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search skills"
              value={query}
            />
          </label>
          <div className="relative" ref={filterMenuRef}>
            <button
              aria-expanded={filterMenuOpen}
              aria-haspopup="menu"
              className="inline-flex h-8 w-full items-center justify-between rounded-[var(--radius-md)] bg-[var(--control-bg)] px-2 text-[12px] text-[var(--text-primary)] hover:bg-[var(--control-bg-hover)]"
              onClick={() => {
                setFilterMenuOpen((current) => !current);
                setCreateMenuOpen(false);
                setManageMenuOpen(false);
              }}
              type="button"
            >
              {selectedFilter.label}
              <CaretDown
                className={filterMenuOpen ? "rotate-180 transition-transform duration-100 ease-out" : "rotate-0 transition-transform duration-100 ease-out"}
                size={12}
                weight="regular"
              />
            </button>
            {filterMenuTransition.shouldRender ? (
              <div className={`absolute right-0 top-full z-30 mt-1 w-36 ${menuPanelClass} ${filterMenuTransition.className}`}>
                {skillFilterOptions.map((option) => (
                  <button
                    className="grid h-8 w-full grid-cols-[minmax(0,1fr)_14px] items-center rounded-[var(--radius-sm)] px-2 text-left text-[var(--text-primary)] transition-[background-color,color] duration-75 ease-out active:bg-[var(--control-bg)] hover:bg-[var(--control-bg-hover)]"
                    key={option.id}
                    onClick={() => {
                      setFilter(option.id);
                      setFilterMenuOpen(false);
                    }}
                    type="button"
                  >
                    <span className="truncate">{option.label}</span>
                    {option.id === filter ? <Check size={13} weight="regular" /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between text-[12px] text-[var(--text-muted)]">
          <span>
            {enabledCount} enabled of {skills.length}
          </span>
          <span>Frontier model required for user-created skills</span>
        </div>

        {pasteOpen ? (
          <form
            className="mt-5 border-y border-[var(--border)] py-3"
            onSubmit={createReviewedSkill}
          >
            <div className="mb-2 text-[12px] font-medium text-[var(--text-primary)]">
              Add reviewed skill
            </div>
            <div className="grid gap-2">
              <input
                aria-label="Skill name"
                className="h-8 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] px-2 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
                onChange={(event) => setDraftName(event.target.value)}
                placeholder="Skill name"
                value={draftName}
              />
              <input
                aria-label="Skill purpose"
                className="h-8 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] px-2 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
                onChange={(event) => setDraftScope(event.target.value)}
                placeholder="One-line purpose"
                value={draftScope}
              />
              <select
                aria-label="Creation source"
                className="h-8 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] px-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                onChange={(event) => setCreationSource(event.target.value as SkillCreationSource | "")}
                value={creationSource}
              >
                <option value="">Creation source required</option>
                <option value="frontier_generated">Generated by frontier model</option>
                <option value="frontier_input">Input by frontier model</option>
              </select>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="min-w-0 text-[11px] text-[var(--text-muted)]">
                User skills should be generated or input by frontier models before enabling.
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button className={controlClass} onClick={() => setPasteOpen(false)} type="button">
                  Cancel
                </button>
                <button className={controlClass} disabled={!canSaveDraft} type="submit">
                  Save
                </button>
              </div>
            </div>
          </form>
        ) : null}

        <div className="mt-7 min-h-0 flex-1">
          {skillGroupOrder.map((group) => {
            const groupSkills = visibleSkills.filter((skill) => skill.group === group);
            if (groupSkills.length === 0) {
              return null;
            }

            return (
              <section className="mb-8" key={group}>
                <div className="mb-2 flex h-7 items-center justify-between border-b border-[var(--border-subtle)] text-[13px] text-[var(--text-primary)]">
                  <span>{group}</span>
                </div>
                <div>
                  {groupSkills.map((skill) => (
                    <div
                      className="grid min-h-12 grid-cols-[20px_minmax(0,1fr)_28px] items-center gap-3 border-b border-[var(--border-subtle)] py-2"
                      key={skill.id}
                    >
                      <Sparkle className="text-[var(--text-muted)]" size={16} weight="regular" />
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                          {skill.name}
                        </div>
                        <div className="truncate text-[12px] text-[var(--text-muted)]">
                          {skill.scope}
                          {skill.source ? ` - ${skill.source}` : ""}
                        </div>
                      </div>
                      <button
                        aria-label={skill.enabled ? `Disable ${skill.name}` : `Enable ${skill.name}`}
                        aria-pressed={skill.enabled}
                        className="grid h-7 w-7 place-items-center rounded-[var(--radius-md)] text-[var(--text-muted)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
                        onClick={() => toggleSkill(skill.id)}
                        title={skill.enabled ? "Enabled" : "Disabled"}
                        type="button"
                      >
                        {skill.enabled ? <Check size={15} weight="regular" /> : <Plus size={15} weight="regular" />}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
          {visibleSkills.length === 0 ? (
            <div className="mt-10 text-center text-[13px] text-[var(--text-muted)]">
              <div>No skills match this search</div>
              {query || filter !== "all" ? (
                <button
                  className="mt-2 h-8 rounded-[var(--radius-md)] px-2 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
                  onClick={() => {
                    setQuery("");
                    setFilter("all");
                  }}
                  type="button"
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function formatElapsedTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function formatMessageTimestamp(timestamp: number | undefined) {
  if (!timestamp) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function readableMessageContent(message: ChatMessage) {
  return message.content
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("activity:") && !trimmed.startsWith("progress:");
    })
    .join("\n")
    .trim();
}

function useElapsedSeconds(startedAt: number | undefined, active: boolean) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) {
      return;
    }

    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [active]);

  if (!startedAt) {
    return 0;
  }

  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

function activityStatusFromMessage(message: ChatMessage) {
  if (message.status) {
    return message.status;
  }

  const marker = message.content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("activity:"));

  if (marker === "activity:ready" || marker === "activity:failed" || marker === "activity:working") {
    return marker.replace("activity:", "") as NonNullable<ChatMessage["status"]>;
  }

  return "working";
}

function MessageActions({
  canEdit,
  message,
  onEditPrompt,
  onRestoreToMessage
}: {
  canEdit: boolean;
  message: ChatMessage;
  onEditPrompt?: (message: ChatMessage) => void;
  onRestoreToMessage: (messageId: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const timestamp = formatMessageTimestamp(message.createdAt);
  const actionButtonClass =
    "grid h-6 w-6 place-items-center rounded-[var(--radius-sm)] text-[var(--text-muted)] transition-[background-color,color,opacity] duration-100 ease-out hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]";

  async function copyMessage() {
    const text = readableMessageContent(message);
    if (!text) {
      return;
    }

    await navigator.clipboard?.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="flex h-6 shrink-0 items-center gap-0.5 text-[11px] text-[var(--text-muted)]">
      {timestamp ? <span className="mr-1 tabular-nums">{timestamp}</span> : null}
      <button
        aria-label="Go back to this message"
        className={`${actionButtonClass} opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`}
        onClick={() => onRestoreToMessage(message.id)}
        title="Go back to this message"
        type="button"
      >
        <ClockCounterClockwise size={14} weight="regular" />
      </button>
      {canEdit ? (
        <button
          aria-label="Edit prompt"
          className={`${actionButtonClass} opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`}
          onClick={() => onEditPrompt?.(message)}
          title="Edit prompt"
          type="button"
        >
          <PencilSimple size={14} weight="regular" />
        </button>
      ) : null}
      <button
        aria-label="Copy text"
        className={`${actionButtonClass} opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`}
        onClick={() => void copyMessage()}
        title={copied ? "Copied" : "Copy text"}
        type="button"
      >
        {copied ? <Check size={14} weight="regular" /> : <Copy size={14} weight="regular" />}
      </button>
    </div>
  );
}

function ActivityMessageRow({
  message,
  onRestoreToMessage
}: {
  message: ChatMessage;
  onRestoreToMessage: (messageId: string) => void;
}) {
  const detailsId = useId();
  const lines = message.content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const status = activityStatusFromMessage(message);
  const progressLine = lines.find((line) => line.startsWith("progress:"));
  const progress = progressLine ? Number(progressLine.replace("progress:", "")) : null;
  const hasProgress = typeof progress === "number" && Number.isFinite(progress);
  const visibleLines = lines.filter((line) => !line.startsWith("activity:") && !line.startsWith("progress:"));
  const title =
    visibleLines[0] ??
    (status === "failed" ? "Stopped" : status === "ready" ? "Ready" : "Working");
  const detailLines = visibleLines.slice(1);
  const elapsed = useElapsedSeconds(message.createdAt, status === "working");
  const hasDetails = detailLines.length > 0 || hasProgress;
  const [detailsOpen, setDetailsOpen] = useState(() => status !== "ready" && hasDetails);

  useEffect(() => {
    setDetailsOpen(status !== "ready" && hasDetails);
  }, [hasDetails, message.id, status]);

  return (
    <div className="group px-6 pt-3">
      <div className="max-w-[430px] text-[12px] leading-5 text-[var(--text-muted)]">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <button
            aria-controls={hasDetails ? detailsId : undefined}
            aria-expanded={hasDetails ? detailsOpen : undefined}
            className={[
              "flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-sm)] text-left transition-[background-color,color] duration-100 ease-out",
              hasDetails
                ? "-ml-1 px-1 hover:bg-[var(--control-bg-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring-outer)]"
                : "cursor-default"
            ].join(" ")}
            disabled={!hasDetails}
            onClick={() => setDetailsOpen((current) => !current)}
            title={hasDetails ? (detailsOpen ? "Hide details" : "Show details") : undefined}
            type="button"
          >
            {status === "working" ? (
              <Cpu className="shrink-0 animate-pulse text-[var(--text-secondary)]" size={14} weight="regular" />
            ) : status === "failed" ? (
              <X className="shrink-0 text-[var(--danger)]" size={14} weight="regular" />
            ) : (
              <Check className="shrink-0 text-[var(--text-secondary)]" size={14} weight="regular" />
            )}
            <span className="min-w-0 truncate text-[13px] text-[var(--text-primary)]">{title}</span>
            <span className="shrink-0 tabular-nums text-[11px] text-[var(--text-muted)]">
              {status === "working" ? formatElapsedTime(elapsed) : status}
            </span>
            {hasDetails ? (
              <CaretDown
                className={[
                  "shrink-0 text-[var(--text-muted)] transition-transform duration-100 ease-out",
                  detailsOpen ? "rotate-0" : "-rotate-90"
                ].join(" ")}
                size={12}
                weight="regular"
              />
            ) : null}
          </button>
          <MessageActions canEdit={false} message={message} onRestoreToMessage={onRestoreToMessage} />
        </div>
        {hasDetails && detailsOpen ? (
          <div id={detailsId}>
            {detailLines.length > 0 ? (
              <div className="mt-1 space-y-0.5 pl-5">
                {detailLines.map((line, index) => (
                  <div className="grid min-w-0 grid-cols-[10px_minmax(0,1fr)] items-start gap-1.5" key={`${line}-${index}`}>
                    <span className="mt-[9px] h-1 w-1 rounded-full bg-[var(--text-muted)] opacity-70" />
                    <span className="min-w-0 truncate">{line}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {hasProgress ? (
              <div className="mt-2 ml-5 h-1 overflow-hidden rounded-full bg-[var(--control-bg-hover)]">
                <div
                  className="h-full rounded-full bg-[var(--text-primary)] transition-[width] duration-150 ease-out"
                  style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MessageThinkingDisclosure({ message }: { message: ChatMessage }) {
  const thinkingId = useId();
  const thinking = message.thinking?.trim();
  const [open, setOpen] = useState(() => message.status === "working");

  useEffect(() => {
    setOpen(message.status === "working");
  }, [message.id, message.status]);

  if (!thinking) {
    return null;
  }

  return (
    <div className="mb-2 text-[12px] leading-5 text-[var(--text-muted)]">
      <button
        aria-controls={thinkingId}
        aria-expanded={open}
        className="-ml-1 flex h-6 max-w-full items-center gap-1.5 rounded-[var(--radius-sm)] px-1 text-left transition-[background-color,color] duration-100 ease-out hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring-outer)]"
        onClick={() => setOpen((current) => !current)}
        title={open ? "Hide thinking" : "Show thinking"}
        type="button"
      >
        <CaretDown
          className={[
            "shrink-0 text-[var(--text-muted)] transition-transform duration-100 ease-out",
            open ? "rotate-0" : "-rotate-90"
          ].join(" ")}
          size={12}
          weight="regular"
        />
        <span className="min-w-0 truncate font-medium text-[var(--text-secondary)]">
          Thought for a moment
        </span>
      </button>
      {open ? (
        <div
          className="mt-1 max-h-[220px] overflow-auto whitespace-pre-wrap border-l border-[var(--border)] pl-3 pr-2 text-[12px] leading-5 text-[var(--text-muted)]"
          id={thinkingId}
        >
          {thinking}
        </div>
      ) : null}
    </div>
  );
}

function MessageRow({
  message,
  onEditPrompt,
  onRestoreToMessage
}: {
  message: ChatMessage;
  onEditPrompt: (message: ChatMessage) => void;
  onRestoreToMessage: (messageId: string) => void;
}) {
  const isActivityMessage =
    message.role === "tool" &&
    (message.kind === "activity" ||
      message.content
        .split("\n")
        .some((line) => line.trim().startsWith("activity:")));

  if (isActivityMessage) {
    return <ActivityMessageRow message={message} onRestoreToMessage={onRestoreToMessage} />;
  }

  if (message.role === "assistant") {
    const waiting = message.status === "working";

    return (
      <div className="group px-6 pt-4">
        <div className="max-w-[560px] text-[13px] leading-5 text-[var(--text-primary)]">
          <div className="mb-1 flex justify-end">
            <MessageActions canEdit={false} message={message} onRestoreToMessage={onRestoreToMessage} />
          </div>
          <MessageThinkingDisclosure message={message} />
          <div className={waiting ? "whitespace-pre-wrap text-[var(--text-muted)]" : "whitespace-pre-wrap"}>
            {message.content}
          </div>
        </div>
      </div>
    );
  }

  if (message.role === "tool") {
    const lines = message.content.split("\n").map((line) => line.trim()).filter(Boolean);
    const progressLine = lines.find((line) => line.startsWith("progress:"));
    const progress = progressLine ? Number(progressLine.replace("progress:", "")) : null;
    const hasProgress = typeof progress === "number" && Number.isFinite(progress);
    const title = lines[0] ?? message.content;
    const detail = lines.find((line) => !line.startsWith("progress:") && line !== title);

    return (
      <div className="group px-6 pt-4">
        <div className="max-w-[360px] text-[12px] text-[var(--text-muted)]">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {title === "Downloading model" ? (
                <TrayArrowUp size={14} weight="regular" />
              ) : (
                <TerminalWindow size={14} weight="regular" />
              )}
              <span className="truncate text-[13px] text-[var(--text-primary)]">{title}</span>
            </div>
            <MessageActions canEdit={false} message={message} onRestoreToMessage={onRestoreToMessage} />
          </div>
          {detail ? <div className="mt-1 pl-6 tabular-nums">{detail}</div> : null}
          {hasProgress ? (
            <div className="mt-2 ml-6 h-1.5 overflow-hidden rounded-full bg-[var(--control-bg-hover)]">
              <div
                className="h-full rounded-full bg-[var(--text-primary)] transition-[width] duration-150 ease-out"
                style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
              />
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="group px-4 pt-3">
      <div className="mb-1 flex justify-end">
        <MessageActions
          canEdit={message.role === "user"}
          message={message}
          onEditPrompt={onEditPrompt}
          onRestoreToMessage={onRestoreToMessage}
        />
      </div>
      <div className="rounded-[14px] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[13px] leading-5 text-[var(--text-primary)]">
        {message.content}
      </div>
    </div>
  );
}

const fallbackModelButtonLabels: Record<ChatMode, string> = {
  Qwopus: "Qwopus",
  Nano: "Nano",
  Bonsai: "Bonsai 8B"
};

function ComposerSwitch({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={[
        "relative h-[18px] w-8 rounded-full transition-colors",
        active ? "bg-[var(--text-primary)]" : "bg-[var(--control-bg-hover)]"
      ].join(" ")}
    >
      <span
        className={[
          "absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-transform",
          active ? "translate-x-[14px]" : "translate-x-0.5"
        ].join(" ")}
      />
    </span>
  );
}

function tokenCount(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.round(value));
}

function formatCompactTokens(value: number) {
  const tokens = tokenCount(value);

  if (tokens >= 1_000_000) {
    return `${formatCompactTokenValue(tokens / 1_000_000)}M`;
  }

  if (tokens >= 1_000) {
    return `${formatCompactTokenValue(tokens / 1_000)}K`;
  }

  return tokens.toLocaleString("en-US");
}

function formatCompactTokenValue(value: number) {
  return value.toFixed(value >= 10 ? 0 : 1).replace(/\.0$/, "");
}

function contextRatio(value: number, total: number) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(1, value / total));
}

function ContextWindowIndicator({ contextBudget }: { contextBudget?: ContextBudgetInfo | null }) {
  const tooltipId = useId();

  if (!contextBudget || !Number.isFinite(contextBudget.contextWindowTokens) || contextBudget.contextWindowTokens <= 0) {
    return null;
  }

  const contextWindowTokens = tokenCount(contextBudget.contextWindowTokens);
  if (contextWindowTokens <= 0) {
    return null;
  }

  const estimatedInputTokens = tokenCount(contextBudget.estimatedInputTokens);
  const actualPromptTokens =
    contextBudget.actualPromptTokens === null || contextBudget.actualPromptTokens === undefined
      ? null
      : tokenCount(contextBudget.actualPromptTokens);
  const actualOutputTokens =
    contextBudget.actualOutputTokens === null || contextBudget.actualOutputTokens === undefined
      ? null
      : tokenCount(contextBudget.actualOutputTokens);
  const promptTokens = actualPromptTokens ?? estimatedInputTokens;
  const generatedTokens = actualOutputTokens ?? 0;
  const usedTokens = promptTokens + generatedTokens;
  const reservedOutputTokens = tokenCount(contextBudget.reservedOutputTokens);
  const usedRatio = contextRatio(usedTokens, contextWindowTokens);
  const pressureRatio = contextRatio(promptTokens + reservedOutputTokens, contextWindowTokens);
  const usedPercent = Math.round(usedRatio * 100);
  const ringColor =
    pressureRatio >= 0.9
      ? "var(--danger)"
      : pressureRatio >= 0.75
        ? "var(--warning)"
        : "var(--text-secondary)";
  const ringBackground = `conic-gradient(${ringColor} ${Math.round(
    pressureRatio * 360
  )}deg, var(--border-subtle) 0deg)`;
  const historyLabel = contextBudget.historyCompacted ? "Compacted" : "Not compacted";
  const sourceLabel = contextBudget.source === "last_request" ? "Last request" : "Estimate";
  const summary = `${sourceLabel}: ${formatCompactTokens(usedTokens)} of ${formatCompactTokens(
    contextWindowTokens
  )} used, ${formatCompactTokens(reservedOutputTokens)} reserved output, history ${historyLabel.toLowerCase()}.`;

  return (
    <div className="group relative grid h-8 w-7 shrink-0 place-items-center">
      <span
        aria-describedby={tooltipId}
        aria-label={summary}
        className="grid h-6 w-6 place-items-center rounded-[var(--radius-md)] outline-none transition-[background-color] duration-100 hover:bg-[var(--control-bg-hover)] focus-visible:bg-[var(--control-bg-hover)] focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
        role="img"
        tabIndex={0}
      >
        <span
          aria-hidden="true"
          className="relative h-4 w-4 rounded-full border border-[var(--border-subtle)]"
          style={{ background: ringBackground }}
        >
          <span className="absolute inset-[3px] rounded-full bg-white" />
        </span>
      </span>
      <div
        className="pointer-events-none absolute bottom-full right-0 z-[130] mb-1 w-56 -translate-y-0.5 rounded-[var(--radius-lg)] border border-[var(--chrome-glass-border)] bg-[var(--bg-elevated)] p-2 text-[11px] text-[var(--text-secondary)] opacity-0 shadow-[var(--shadow-menu)] transition-[opacity,transform] duration-75 ease-out group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100"
        id={tooltipId}
        role="tooltip"
      >
        <span className="flex items-center justify-between gap-3">
          <span>Used</span>
          <span className="tabular-nums text-[var(--text-primary)]">
            {formatCompactTokens(usedTokens)} / {formatCompactTokens(contextWindowTokens)}
          </span>
        </span>
        <span className="mt-1 flex items-center justify-between gap-3">
          <span>Source</span>
          <span className="text-[var(--text-primary)]">{sourceLabel}</span>
        </span>
        {actualOutputTokens !== null ? (
          <span className="mt-1 flex items-center justify-between gap-3">
            <span>Generated</span>
            <span className="tabular-nums text-[var(--text-primary)]">
              {formatCompactTokens(actualOutputTokens)}
            </span>
          </span>
        ) : null}
        <span className="mt-1 flex items-center justify-between gap-3">
          <span>Reserved output</span>
          <span className="tabular-nums text-[var(--text-primary)]">
            {formatCompactTokens(reservedOutputTokens)}
          </span>
        </span>
        <span className="mt-1 flex items-center justify-between gap-3">
          <span>History</span>
          <span className="text-[var(--text-primary)]">{historyLabel}</span>
        </span>
        <span className="mt-1.5 block text-right text-[10px] tabular-nums text-[var(--text-muted)]">
          {usedPercent}% of window
        </span>
      </div>
    </div>
  );
}

export function PromptComposer({
  chatMode,
  composerModels,
  contextBudget,
  draftRequest,
  marketplaceModelLabel,
  onChatModeChange,
  onOpenMarketplace,
  onOpenModels,
  onSubmit,
  selectedElement
}: {
  chatMode: ChatMode;
  composerModels: readonly ComposerModelOption[];
  contextBudget?: ContextBudgetInfo | null;
  draftRequest?: { id: string; value: string } | null;
  marketplaceModelLabel?: string | null;
  onChatModeChange: (mode: ChatMode) => void;
  onOpenMarketplace: () => void;
  onOpenModels: () => void;
  onSubmit: (message: string, context: ComposerContext) => void;
  selectedElement: SelectedElement | null;
}) {
  const composerRef = useRef<HTMLFormElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const plusMenuRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [attachmentLabels, setAttachmentLabels] = useState<readonly string[]>([]);
  const [includeSelection, setIncludeSelection] = useState(true);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [planMode, setPlanMode] = useState(false);
  const [value, setValue] = useState("");
  const modelMenuTransition = useMenuTransition(modelMenuOpen, 75, "above");
  const plusMenuTransition = useMenuTransition(plusMenuOpen, 75, "above");

  const canAttachSelection = Boolean(selectedElement && !selectedElement.stale);
  const selectionAttached = includeSelection && canAttachSelection;
  const canSend = value.trim().length > 0;
  const activeComposerModel = composerModels.find((model) => model.id === chatMode) ?? null;
  const activeModelLabel =
    marketplaceModelLabel?.trim() ||
    activeComposerModel?.buttonLabel ||
    fallbackModelButtonLabels[chatMode];
  const attachmentsCount = attachmentLabels.length;
  const attachmentSummary =
    attachmentsCount === 0
      ? ""
      : attachmentsCount === 1
        ? attachmentLabels[0] ?? "1 file"
        : `${attachmentLabels[0] ?? "Files"} +${attachmentsCount - 1}`;
  const selectionSummary = selectedElement
    ? `${selectedElement.tag} ${selectedElement.label} - ${selectedElement.source}`
    : "";

  useDismissableLayer(plusMenuOpen, [plusMenuRef], () => setPlusMenuOpen(false));
  useDismissableLayer(modelMenuOpen, [modelMenuRef], () => setModelMenuOpen(false));

  useEffect(() => {
    if (!draftRequest) {
      return;
    }

    setValue(draftRequest.value);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(draftRequest.value.length, draftRequest.value.length);
    });
  }, [draftRequest]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`;
  }, [value]);

  function submitMessage() {
    if (!canSend) {
      return;
    }

    onSubmit(value, {
      attachmentsCount,
      includeSelection: selectionAttached,
      includeTerminal: false,
      localModelLabel: activeModelLabel,
      mode: chatMode,
      permissionMode: "full-access",
      planMode
    });
    setValue("");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    submitMessage();
  }

  function chooseModel(model: ComposerModelOption) {
    onChatModeChange(model.id);
    setModelMenuOpen(false);
  }

  return (
    <form
      aria-label="Message composer"
      className="relative z-30 min-w-0 shrink-0 overflow-visible bg-[var(--bg-workspace-main)] px-4 pb-3 pt-2"
      onSubmit={submit}
      ref={composerRef}
    >
      <input
        className="hidden"
        multiple
        onChange={(event) =>
          setAttachmentLabels(Array.from(event.target.files ?? []).map((file) => file.name))
        }
        ref={fileInputRef}
        type="file"
      />
      {canAttachSelection || attachmentSummary ? (
        <div className="mb-2 flex min-w-0 max-w-full flex-wrap items-center gap-1.5 overflow-hidden">
          {attachmentSummary ? (
            <span
              className="inline-flex max-w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--control-bg)] px-2 py-1 text-[11px] text-[var(--text-secondary)]"
              title={attachmentSummary}
            >
              <Paperclip className="shrink-0" size={13} weight="regular" />
              <span className="min-w-0 flex-1 truncate">{attachmentSummary}</span>
            </span>
          ) : null}
          {canAttachSelection ? (
            <button
              aria-pressed={selectionAttached}
              className={[
                "inline-flex max-w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-[var(--radius-md)] border px-2 py-1 text-[11px] transition-[background-color,border-color,color] duration-100 ease-out",
                selectionAttached
                  ? "border-[var(--border)] bg-[var(--control-bg)] text-[var(--text-secondary)]"
                  : "border-[var(--border-subtle)] text-[var(--text-muted)]"
              ].join(" ")}
              onClick={() => setIncludeSelection((current) => !current)}
              title={selectionSummary}
              type="button"
            >
              <Paperclip className="shrink-0" size={13} weight="regular" />
              <span className="min-w-0 flex-1 truncate">{selectionSummary}</span>
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="relative min-w-0 overflow-visible rounded-[var(--radius-lg)] bg-white px-2 py-2 shadow-none transition-colors duration-100 ease-out">
        <textarea
          aria-label="Message"
          className="block max-h-32 min-h-[44px] w-full resize-none overflow-y-auto bg-transparent px-1 py-1 text-[13px] leading-5 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submitMessage();
            }
          }}
          placeholder="Send follow-up"
          ref={textareaRef}
          rows={1}
          value={value}
        />
        <div className="mt-1 flex h-8 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1">
            <div className="relative z-[110]" ref={plusMenuRef}>
              <button
                aria-expanded={plusMenuOpen}
                aria-haspopup="menu"
                aria-label="Composer actions"
                className={iconButtonClass}
                onClick={() => {
                  setPlusMenuOpen((current) => !current);
                  setModelMenuOpen(false);
                }}
                type="button"
              >
                <Plus size={18} weight="regular" />
              </button>
              {plusMenuTransition.shouldRender ? (
                <div className={`absolute bottom-full left-0 z-[120] mb-1 w-52 ${menuPanelClass} ${plusMenuTransition.className}`}>
                  <button
                    className={menuItemClass}
                    onClick={() => {
                      fileInputRef.current?.click();
                      setPlusMenuOpen(false);
                    }}
                    type="button"
                  >
                    <Paperclip size={14} weight="regular" />
                    <span className="min-w-0 flex-1 truncate">Add photos & files</span>
                    {attachmentsCount > 0 ? (
                      <span className="text-[11px] text-[var(--text-muted)]">{attachmentsCount}</span>
                    ) : null}
                  </button>
                  <button
                    className={menuItemClass}
                    onClick={() => setPlanMode((current) => !current)}
                    type="button"
                  >
                    <SlidersHorizontal size={14} weight="regular" />
                    <span className="min-w-0 flex-1 truncate">Plan mode</span>
                    <ComposerSwitch active={planMode} />
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <ContextWindowIndicator contextBudget={contextBudget} />
            <div className="relative z-[110]" ref={modelMenuRef}>
              <button
                aria-controls={modelMenuOpen ? "composer-model-menu" : undefined}
                aria-expanded={modelMenuOpen}
                aria-haspopup="listbox"
                className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-md)] px-2 text-[12px] text-[var(--text-secondary)] transition-[background-color,color] duration-100 ease-out hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
                onClick={() => {
                  setModelMenuOpen((current) => !current);
                  setPlusMenuOpen(false);
                }}
                type="button"
              >
                <span className="max-w-36 truncate">{activeModelLabel}</span>
                <CaretDown
                  className={modelMenuOpen ? "rotate-180 transition-transform duration-100 ease-out" : "rotate-0 transition-transform duration-100 ease-out"}
                  size={12}
                  weight="regular"
                />
              </button>
              {modelMenuTransition.shouldRender ? (
                <div
                  aria-label="Model"
                  className={`absolute bottom-full right-0 z-[120] mb-1 w-[218px] ${menuPanelClass} ${modelMenuTransition.className}`}
                  id="composer-model-menu"
                  role="listbox"
                >
                  {marketplaceModelLabel ? (
                    <div className="mb-1 border-b border-[var(--border-subtle)] pb-1">
                      <div className="grid h-8 w-full grid-cols-[minmax(0,1fr)_16px] items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--control-bg)] px-2 text-left">
                        <span className="min-w-0">
                          <span className="block truncate text-[12px] text-[var(--text-primary)]">
                            {marketplaceModelLabel}
                          </span>
                          <span className="block truncate text-[11px] text-[var(--text-muted)]">
                            Marketplace
                          </span>
                        </span>
                        <Check className="justify-self-end" size={14} weight="regular" />
                      </div>
                    </div>
                  ) : null}
                  <div className="max-h-40 overflow-auto">
                    {composerModels.map((model) => (
                      <button
                        aria-label={`${model.label}, ${model.detail}, ${model.providerModelId}`}
                        aria-selected={!marketplaceModelLabel && model.id === chatMode}
                        className={[
                          "grid h-8 w-full grid-cols-[minmax(0,1fr)_16px] items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left transition-[background-color,color] duration-75 ease-out",
                          !marketplaceModelLabel && model.id === chatMode ? "bg-[var(--control-bg)] text-[var(--text-primary)]" : "",
                          "text-[var(--text-primary)] hover:bg-[var(--control-bg-hover)]"
                        ].join(" ")}
                        key={model.id}
                        onClick={() => chooseModel(model)}
                        role="option"
                        type="button"
                      >
                        <span className="min-w-0 truncate text-[12px]">{model.label}</span>
                        {!marketplaceModelLabel && model.id === chatMode ? (
                          <Check className="justify-self-end" size={14} weight="regular" />
                        ) : null}
                      </button>
                    ))}
                  </div>
                  <div className="mt-1 border-t border-[var(--border-subtle)] pt-1">
                    <button
                      className="flex h-8 w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left text-[var(--text-secondary)] transition-[background-color,color] duration-75 ease-out active:bg-[var(--control-bg)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
                      onClick={() => {
                        onOpenMarketplace();
                        setModelMenuOpen(false);
                      }}
                      type="button"
                    >
                      <Storefront size={14} weight="regular" />
                      <span className="min-w-0 flex-1 truncate">Browse marketplace</span>
                    </button>
                    <button
                      className="flex h-8 w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left text-[var(--text-secondary)] transition-[background-color,color] duration-75 ease-out active:bg-[var(--control-bg)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
                      onClick={() => {
                        onOpenModels();
                        setModelMenuOpen(false);
                      }}
                      type="button"
                    >
                      <Gear size={14} weight="regular" />
                      <span className="min-w-0 flex-1 truncate">Model settings</span>
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            <button
              aria-label="Send"
              className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] bg-[var(--text-primary)] text-[var(--bg-workspace-main)] transition-opacity duration-100 ease-out hover:opacity-90 disabled:cursor-default disabled:opacity-40 disabled:transition-none"
              disabled={!canSend}
              type="submit"
            >
              <ArrowUp size={16} weight="bold" />
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

export function ChatPane({
  chatMode,
  composerModels,
  contextBudget,
  marketplaceModelLabel,
  onArchiveThread,
  onClearThread,
  onChatModeChange,
  onOpenMarketplace,
  onNewThread,
  onOpenModels,
  onRenameThread,
  onRestoreThread,
  onRestoreToMessage,
  onSendMessage,
  onToggleThreadPinned,
  sidebarCollapsed,
  selectedElement,
  thread
}: {
  chatMode: ChatMode;
  composerModels: readonly ComposerModelOption[];
  contextBudget?: ContextBudgetInfo | null;
  marketplaceModelLabel?: string | null;
  onArchiveThread: (threadId: string) => void;
  onClearThread: (threadId: string) => void;
  onChatModeChange: (mode: ChatMode) => void;
  onOpenMarketplace: () => void;
  onNewThread: () => void;
  onOpenModels: () => void;
  onRenameThread: (threadId: string, title: string) => void;
  onRestoreThread: (threadId: string) => void;
  onRestoreToMessage: (threadId: string, messageId: string) => void;
  onSendMessage: (message: string, context: ComposerContext) => void;
  onToggleThreadPinned: (threadId: string) => void;
  sidebarCollapsed: boolean;
  selectedElement: SelectedElement | null;
  thread: Thread | null;
}) {
  const threadActionsRef = useRef<HTMLDivElement | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [composerDraftRequest, setComposerDraftRequest] = useState<{ id: string; value: string } | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const actionsMenuTransition = useMenuTransition(actionsOpen);

  useEffect(() => {
    if (!actionsOpen) {
      setRenaming(false);
    }
  }, [actionsOpen]);

  useDismissableLayer(actionsOpen, [threadActionsRef], () => setActionsOpen(false));

  function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!thread) {
      return;
    }

    onRenameThread(thread.id, renameDraft);
    setActionsOpen(false);
    setRenaming(false);
  }

  function editPrompt(message: ChatMessage) {
    setComposerDraftRequest({
      id: `${message.id}_${Date.now().toString(36)}`,
      value: readableMessageContent(message)
    });
  }

  const sidebarHeaderRevealClass = sidebarCollapsed
    ? "max-w-[220px] opacity-100 translate-x-0 pointer-events-auto"
    : "max-w-0 opacity-0 -translate-x-1 pointer-events-none";

  return (
    <section
      aria-label="AI chat"
      className="grid min-h-0 min-w-0 overflow-hidden grid-rows-[40px_minmax(0,1fr)_auto] bg-[var(--bg-sidebar)]"
    >
      <div className="relative flex min-w-0 items-center justify-between rounded-tl-[10px] bg-[var(--bg-workspace-main)] px-4">
        <div
          aria-hidden={!sidebarCollapsed}
          className={`flex min-w-0 flex-1 items-center overflow-hidden transition-[max-width,opacity,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] transform-gpu ${sidebarHeaderRevealClass}`}
        >
          <div className="flex min-w-0 items-center gap-2">
            <div className="truncate text-[12px] font-medium text-[var(--text-primary)]">
              {thread?.title ?? "No thread selected"}
            </div>
            <button
              aria-label="New Agent"
              className={iconButtonClass}
              onClick={() => onNewThread()}
              tabIndex={sidebarCollapsed ? 0 : -1}
              title="New Agent"
              type="button"
            >
              <NotePencil size={15} weight="regular" />
            </button>
          </div>
        </div>
        <div className="relative shrink-0" ref={threadActionsRef}>
          <button
            aria-expanded={actionsOpen}
            aria-haspopup="menu"
            aria-label="Thread actions"
            className={iconButtonClass}
            onClick={() => setActionsOpen((open) => !open)}
            type="button"
          >
            <DotsThree size={18} weight="bold" />
          </button>
          {actionsMenuTransition.shouldRender ? (
            <div className={`absolute right-0 top-full z-10 mt-1 w-48 ${menuPanelClass} ${actionsMenuTransition.className} text-[var(--text-secondary)]`}>
            {renaming ? (
              <form className="space-y-1" onSubmit={submitRename}>
                <input
                  aria-label="Thread name"
                  className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--control-bg)] px-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                  onChange={(event) => setRenameDraft(event.target.value)}
                  value={renameDraft}
                />
                <div className="flex justify-end gap-1">
                  <button className={controlClass} onClick={() => setRenaming(false)} type="button">
                    Cancel
                  </button>
                  <button className={controlClass} disabled={!renameDraft.trim()} type="submit">
                    Save
                  </button>
                </div>
              </form>
            ) : (
              <>
                <button
                  className="h-8 w-full rounded-[var(--radius-sm)] px-2 text-left transition-[background-color,color] duration-75 ease-out active:bg-[var(--control-bg)] hover:bg-[var(--control-bg-hover)] disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent"
                  disabled={!thread}
                  onClick={() => {
                    if (thread) {
                      onToggleThreadPinned(thread.id);
                    }
                    setActionsOpen(false);
                  }}
                  type="button"
                >
                  {thread?.pinned ? "Unpin thread" : "Pin thread"}
                </button>
                <button
                  className="h-8 w-full rounded-[var(--radius-sm)] px-2 text-left transition-[background-color,color] duration-75 ease-out active:bg-[var(--control-bg)] hover:bg-[var(--control-bg-hover)] disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent"
                  disabled={!thread}
                  onClick={() => {
                    if (!thread) {
                      return;
                    }

                    setRenameDraft(thread.title);
                    setRenaming(true);
                  }}
                  type="button"
                >
                  Rename thread
                </button>
                <button
                  className="h-8 w-full rounded-[var(--radius-sm)] px-2 text-left transition-[background-color,color] duration-75 ease-out active:bg-[var(--control-bg)] hover:bg-[var(--control-bg-hover)] disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent"
                  disabled={!thread}
                  onClick={() => {
                    if (thread?.archived) {
                      onRestoreThread(thread.id);
                    } else if (thread) {
                      onArchiveThread(thread.id);
                    }
                    setActionsOpen(false);
                  }}
                  type="button"
                >
                  {thread?.archived ? "Restore thread" : "Archive thread"}
                </button>
                <button
                  className="h-8 w-full rounded-[var(--radius-sm)] px-2 text-left transition-[background-color,color] duration-75 ease-out active:bg-[var(--control-bg)] hover:bg-[var(--control-bg-hover)] disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent"
                  disabled={!thread}
                  onClick={() => {
                    if (thread) {
                      onClearThread(thread.id);
                    }
                    setActionsOpen(false);
                  }}
                  type="button"
                >
                  Clear transcript
                </button>
              </>
            )}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-col overflow-auto overflow-x-hidden bg-[var(--bg-workspace-main)]">
        {thread && thread.messages.length > 0 ? (
          thread.messages.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              onEditPrompt={editPrompt}
              onRestoreToMessage={(messageId) => onRestoreToMessage(thread.id, messageId)}
            />
          ))
        ) : (
          <div className="grid min-h-[240px] flex-1 place-items-center px-8 text-center">
            <img
              alt="Quartz Canvas"
              className="h-[56px] w-[56px] object-contain"
              draggable={false}
              src={logoBlackUrl}
            />
          </div>
        )}
      </div>

      <PromptComposer
        chatMode={chatMode}
        composerModels={composerModels}
        contextBudget={contextBudget}
        draftRequest={composerDraftRequest}
        marketplaceModelLabel={marketplaceModelLabel}
        onChatModeChange={onChatModeChange}
        onOpenMarketplace={onOpenMarketplace}
        onOpenModels={onOpenModels}
        onSubmit={onSendMessage}
        selectedElement={selectedElement}
      />
    </section>
  );
}

export function BrowserToolbar({
  canGoBack,
  canGoForward,
  mode,
  onBack,
  onForward,
  onModeChange,
  onNavigate,
  onReload,
  onZoomChange,
  url,
  zoom
}: {
  canGoBack: boolean;
  canGoForward: boolean;
  mode: BrowserMode;
  onBack: () => void;
  onForward: () => void;
  onModeChange: (mode: BrowserMode) => void;
  onNavigate: (url: string) => void;
  onReload: () => void;
  onZoomChange: (zoom: number) => void;
  url: string;
  zoom: number;
}) {
  const zoomMenuRef = useRef<HTMLDivElement | null>(null);
  const [draftUrl, setDraftUrl] = useState(url);
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const zoomMenuTransition = useMenuTransition(zoomMenuOpen);

  useEffect(() => {
    setDraftUrl(url);
  }, [url]);

  useDismissableLayer(zoomMenuOpen, [zoomMenuRef], () => setZoomMenuOpen(false));

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-[var(--border)] px-2">
      <button className={iconButtonClass} disabled={!canGoBack} onClick={onBack} title="Back" type="button">
        <ArrowLeft size={15} weight="regular" />
      </button>
      <button className={iconButtonClass} disabled={!canGoForward} onClick={onForward} title="Forward" type="button">
        <ArrowRight size={15} weight="regular" />
      </button>
      <button className={iconButtonClass} disabled={!url} onClick={onReload} title="Reload" type="button">
        <ArrowClockwise size={15} weight="regular" />
      </button>
      <div aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-transparent" />
      <form
        className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-md)] bg-transparent px-2 text-[12px] text-[var(--text-secondary)] transition-[background-color,color] duration-100 ease-out hover:bg-[var(--bg-sidebar)] hover:text-[var(--text-primary)]"
        onSubmit={(event) => {
          event.preventDefault();
          onNavigate(draftUrl);
        }}
      >
        <GlobeSimple size={14} weight="regular" />
        <input
          aria-label="Preview URL"
          className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text-primary)] outline-none"
          onChange={(event) => setDraftUrl(event.target.value)}
          placeholder="Enter URL"
          value={draftUrl}
        />
      </form>
      <div aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-transparent" />
      <button
        className={[
          controlClass,
          mode === "interact" ? "bg-[var(--control-bg-hover)] text-[var(--text-primary)]" : ""
        ].join(" ")}
        disabled={!url}
        onClick={() => onModeChange("interact")}
        type="button"
      >
        Interact
      </button>
      <button
        className={[
          "inline-flex h-7 items-center gap-1 rounded-[var(--radius-md)] px-2 text-[12px] font-medium transition-[background-color,color,opacity] duration-100 ease-out disabled:cursor-default disabled:opacity-45 disabled:transition-none disabled:hover:bg-transparent",
          mode === "select"
            ? "bg-[var(--text-primary)] text-[var(--bg-workspace-main)]"
            : "text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
        ].join(" ")}
        disabled={!url}
        onClick={() => onModeChange("select")}
        type="button"
      >
        <CursorClick size={14} weight="regular" />
        Edit
      </button>
      <div className="relative shrink-0" ref={zoomMenuRef}>
        <button
          aria-expanded={zoomMenuOpen}
          aria-haspopup="menu"
          aria-label="Zoom"
          className={iconButtonClass}
          disabled={!url}
          onClick={() => setZoomMenuOpen((current) => !current)}
          title="Zoom"
          type="button"
        >
          <MagnifyingGlassPlus size={15} weight="regular" />
        </button>
        {zoomMenuTransition.shouldRender ? (
          <div
            aria-label="Zoom options"
            className={`absolute right-0 top-full z-20 mt-1 w-32 ${menuPanelClass} ${zoomMenuTransition.className} text-[var(--text-secondary)]`}
            role="menu"
          >
            {[75, 90, 100, 125, 150, 200].map((value) => (
              <button
                aria-checked={zoom === value}
                className={[
                  "grid h-8 w-full grid-cols-[minmax(0,1fr)_14px] items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left text-[12px] transition-[background-color,color] duration-75 ease-out",
                  zoom === value
                    ? "bg-[var(--control-bg)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
                ].join(" ")}
                key={value}
                onClick={() => {
                  onZoomChange(value);
                  setZoomMenuOpen(false);
                }}
                role="menuitemradio"
                type="button"
              >
                <span>{value}%</span>
                {zoom === value ? <Check className="justify-self-end" size={13} weight="regular" /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function SelectionOverlay() {
  return null;
}

function elementLabel(element: Element) {
  const htmlElement = element as HTMLElement;
  const label =
    htmlElement.dataset.qcLabel ||
    htmlElement.dataset.component ||
    htmlElement.getAttribute("aria-label") ||
    htmlElement.id ||
    element.tagName.toLowerCase();

  return label.toString().trim() || element.tagName.toLowerCase();
}

function elementSource(element: Element) {
  const htmlElement = element as HTMLElement;
  return (
    htmlElement.dataset.qcSource ||
    htmlElement.dataset.source ||
    htmlElement.dataset.file ||
    "unmapped"
  );
}

const nonSelectablePreviewTags = new Set(["html", "body", "head", "script", "style", "link", "meta", "title", "base"]);
const appRootElementIds = new Set(["root", "app", "__next", "svelte", "vite-root", "tauri-root"]);
const structuralPreviewTags = new Set(["div", "main", "section", "article", "aside"]);

function selectableElementFromPoint(documentInsideFrame: Document, x: number, y: number) {
  const elements =
    typeof documentInsideFrame.elementsFromPoint === "function"
      ? documentInsideFrame.elementsFromPoint(x, y)
      : [documentInsideFrame.elementFromPoint(x, y)].filter((element): element is Element => Boolean(element));

  return elements.find(isSelectablePreviewElement) ?? null;
}

function isSelectablePreviewElement(element: Element) {
  const documentInsideFrame = element.ownerDocument;
  const tag = element.tagName.toLowerCase();
  if (
    !tag ||
    element === documentInsideFrame.documentElement ||
    element === documentInsideFrame.body ||
    nonSelectablePreviewTags.has(tag) ||
    element.id === bridgeScriptId
  ) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) {
    return false;
  }

  const view = element.ownerDocument.defaultView;
  const viewportWidth = view?.innerWidth ?? 1;
  const viewportHeight = view?.innerHeight ?? 1;
  const coversViewport = rect.width >= viewportWidth * 0.82 && rect.height >= viewportHeight * 0.72;
  const rootId = ((element as HTMLElement).id || "").toLowerCase();

  if (appRootElementIds.has(rootId)) {
    return false;
  }

  if (element.parentElement === documentInsideFrame.body && appRootElementIds.has(rootId)) {
    return false;
  }

  if (coversViewport && structuralPreviewTags.has(tag) && !hasStrongSelectionSignal(element)) {
    return false;
  }

  return true;
}

function hasStrongSelectionSignal(element: Element) {
  const htmlElement = element as HTMLElement;
  const tag = element.tagName.toLowerCase();

  if (
    htmlElement.dataset.source ||
    htmlElement.dataset.qcSource ||
    htmlElement.dataset.sourceId ||
    htmlElement.dataset.testid ||
    htmlElement.dataset.component ||
    htmlElement.getAttribute("aria-label")
  ) {
    return true;
  }

  if (htmlElement.id && !appRootElementIds.has(htmlElement.id.toLowerCase())) {
    return true;
  }

  return [
    "a",
    "button",
    "canvas",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "img",
    "input",
    "label",
    "li",
    "p",
    "select",
    "span",
    "svg",
    "textarea",
    "video"
  ].includes(tag);
}

function isPointInsidePreviewViewport(iframe: HTMLIFrameElement, x: number, y: number) {
  const width = iframe.contentWindow?.innerWidth ?? iframe.clientWidth;
  const height = iframe.contentWindow?.innerHeight ?? iframe.clientHeight;
  return x >= 0 && y >= 0 && x <= width && y <= height;
}

type FetchPreviewDocumentResponse = {
  readonly url: string;
  readonly contentType: string;
  readonly html: string;
};

type PreviewDocument = {
  readonly contentType: string;
  readonly html: string;
  readonly url: string;
};

export type LocalhostProjectPreview = {
  readonly url: string;
  readonly port: number;
  readonly title: string;
  readonly framework?: string | null;
  readonly rootPath?: string | null;
  readonly source: "desktop" | "web";
  readonly surfaceKind?: ApplicationSurfaceKind | null;
  readonly surfaceSignals?: readonly string[];
};

type ScanLocalhostProjectsResponse = {
  readonly projects: readonly LocalhostProjectPreview[];
};

type SelectionBridgeStatus = "idle" | "loading" | "ready" | "failed";
type LocalhostScanStatus = "idle" | "scanning" | "ready" | "failed";

const bridgeScriptId = "quartz-selection-bridge";
const thumbnailPreviewParam = "qcPreviewThumb";
const quartzCanvasAppTitle = "quartz canvas";
const localhostScanPorts = [
  3000, 3001, 3002, 3003, 4000, 4173, 4174, 4200, 4321, 5000, 5173, 5174, 5175, 5176, 5177,
  5178, 5179, 6006, 7000, 8000, 8080, 9000, 1420
] as const;

async function fetchPreviewDocumentText(url: string): Promise<PreviewDocument> {
  const response = await invoke<FetchPreviewDocumentResponse>("fetch_preview_document", {
    request: { url }
  });
  return response;
}

async function fetchSelectablePreviewHtml(url: string): Promise<string> {
  const response = await fetchPreviewDocumentText(url);
  const needsRuntimeInlining = shouldInlinePreviewRuntime(response.html);
  const html = await instrumentPreviewHtml(response.html, response.url);

  if (needsRuntimeInlining && !hasInlinedPreviewRuntime(html)) {
    throw new Error("preview runtime could not be inlined");
  }

  return html;
}

async function scanLocalhostProjects(): Promise<readonly LocalhostProjectPreview[]> {
  const [nativeProjects, browserProjects] = await Promise.all([
    scanNativeLocalhostProjects(),
    scanBrowserLocalhostProjects()
  ]);
  return normalizeLocalhostProjects([...nativeProjects, ...browserProjects]);
}

async function scanNativeLocalhostProjects(): Promise<readonly LocalhostProjectPreview[]> {
  try {
    const response = await invoke<ScanLocalhostProjectsResponse>("scan_localhost_projects");
    return response.projects;
  } catch {
    return [];
  }
}

async function scanBrowserLocalhostProjects(): Promise<readonly LocalhostProjectPreview[]> {
  const projects = await Promise.all(localhostScanPorts.map((port) => probeBrowserLocalhostPort(port)));
  return projects.filter((project): project is LocalhostProjectPreview => Boolean(project));
}

async function probeBrowserLocalhostPort(port: number): Promise<LocalhostProjectPreview | null> {
  const url = `http://localhost:${port}/`;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 700);

  try {
    await fetch(url, {
      cache: "no-store",
      mode: "no-cors",
      signal: controller.signal
    });
    return {
      url,
      port,
      title: `localhost:${port}`,
      framework: null,
      source: "web",
      surfaceKind: "unknown",
      surfaceSignals: ["browser localhost probe"]
    };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function normalizeLocalhostProjects(
  projects: readonly LocalhostProjectPreview[]
): readonly LocalhostProjectPreview[] {
  const byPort = new Map<number, LocalhostProjectPreview>();
  const currentAppPorts = new Set(
    projects.filter(isCurrentQuartzCanvasApp).map((project) => project.port)
  );

  for (const project of projects) {
    if (currentAppPorts.has(project.port) || isCurrentQuartzCanvasApp(project)) {
      continue;
    }

    const current = byPort.get(project.port);
    if (!current || compareLocalhostProjectStrength(project, current) > 0) {
      byPort.set(project.port, project);
    }
  }

  return [...byPort.values()].sort((left, right) => localhostPortRank(left.port) - localhostPortRank(right.port));
}

function compareLocalhostProjectStrength(left: LocalhostProjectPreview, right: LocalhostProjectPreview) {
  return localhostProjectStrength(left) - localhostProjectStrength(right);
}

function localhostProjectStrength(project: LocalhostProjectPreview) {
  const surfaceKind = project.surfaceKind ?? (project.source === "desktop" ? "desktop" : "unknown");
  const surfaceScore = surfaceKind === "desktop" ? 300 : surfaceKind === "web" ? 200 : 100;
  const sourceScore = project.source === "desktop" ? 30 : 0;
  const metadataScore =
    (project.rootPath ? 4 : 0) +
    (project.framework ? 2 : 0) +
    (project.title.trim() && project.title.trim() !== `localhost:${project.port}` ? 1 : 0);

  return surfaceScore + sourceScore + metadataScore;
}

function isCurrentQuartzCanvasApp(project: LocalhostProjectPreview) {
  if (project.title.trim().toLowerCase() === quartzCanvasAppTitle) {
    return true;
  }

  const currentPort = Number.parseInt(window.location.port, 10);
  if (Number.isFinite(currentPort) && project.port === currentPort) {
    return true;
  }

  try {
    return new URL(project.url).origin === window.location.origin;
  } catch {
    return false;
  }
}

function localhostPortRank(port: number) {
  const rank = localhostScanPorts.findIndex((candidate) => candidate === port);
  return rank === -1 ? Number.MAX_SAFE_INTEGER : rank;
}

function projectThumbnailUrl(url: string): string {
  try {
    const thumbnailUrl = new URL(url);
    thumbnailUrl.searchParams.set(thumbnailPreviewParam, "1");
    return thumbnailUrl.toString();
  } catch {
    return url;
  }
}

function isThumbnailPreview(): boolean {
  return new URLSearchParams(window.location.search).has(thumbnailPreviewParam);
}

async function instrumentPreviewHtml(html: string, url: string) {
  const identity = createBridgeIdentity(url);
  const baseTag = `<base href="${escapeHtmlAttribute(url)}">`;
  const snapshotPolicyTag = createSelectionSnapshotPolicyTag();
  const scriptTag = `<script id="${bridgeScriptId}">${createSelectionBridgeScript(identity)}</script>`;
  let nextHtml = shouldInlinePreviewRuntime(html)
    ? await inlineLocalPreviewRuntime(html, url)
    : stripExecutablePreviewCode(html);
  const headInsert = /<base\b/i.test(nextHtml) ? snapshotPolicyTag : `${baseTag}${snapshotPolicyTag}`;

  nextHtml = /<head[^>]*>/i.test(nextHtml)
    ? nextHtml.replace(/<head[^>]*>/i, (match) => `${match}${headInsert}`)
    : `${headInsert}${nextHtml}`;

  return /<\/body>/i.test(nextHtml)
    ? nextHtml.replace(/<\/body>/i, `${scriptTag}</body>`)
    : `${nextHtml}${scriptTag}`;
}

function shouldInlinePreviewRuntime(html: string) {
  const lower = html.toLowerCase();
  const hasRuntimeScript = /<script\b[^>]*\bsrc\s*=/i.test(html);
  const hasClientRoot =
    /<div\b[^>]*\bid=["'](?:root|app|__next|svelte|vite-root)["'][^>]*>\s*<\/div>/i.test(html) ||
    /<main\b[^>]*\bid=["'](?:root|app)["'][^>]*>\s*<\/main>/i.test(html);
  const looksLikeBundledShell =
    lower.includes("/assets/") ||
    lower.includes("/src/") ||
    lower.includes("/@vite/client") ||
    lower.includes("type=\"module\"") ||
    lower.includes("type='module'");

  return hasRuntimeScript && hasClientRoot && looksLikeBundledShell;
}

function hasInlinedPreviewRuntime(html: string) {
  return /<script\b[^>]*\bdata-quartz-inlined-from=/i.test(html);
}

async function inlineLocalPreviewRuntime(html: string, url: string) {
  let nextHtml = removePreviewCsp(html);
  nextHtml = stripPreviewHints(nextHtml);
  nextHtml = await inlineLocalStylesheets(nextHtml, url);
  nextHtml = await inlineLocalScripts(nextHtml, url);
  return nextHtml;
}

function removePreviewCsp(html: string) {
  return html.replace(/<meta\b[^>]*http-equiv=["']?content-security-policy["']?[^>]*>/gi, "");
}

function stripPreviewHints(html: string) {
  return html.replace(/<link\b[^>]*>/gi, (linkTag) => (shouldStripPreviewLink(linkTag) ? "" : linkTag));
}

async function inlineLocalStylesheets(html: string, url: string) {
  const linkPattern = /<link\b[^>]*>/gi;
  const replacements = await Promise.all(
    Array.from(html.matchAll(linkPattern), async (match) => {
      const linkTag = match[0];
      const rel = readHtmlAttribute(linkTag, "rel")
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      const href = readHtmlAttribute(linkTag, "href");

      if (!rel.includes("stylesheet") || !href) {
        return [linkTag, linkTag] as const;
      }

      const assetUrl = localAssetUrl(url, href);
      if (!assetUrl) {
        return [linkTag, ""] as const;
      }

      try {
        const asset = await fetchPreviewDocumentText(assetUrl);
        return [
          linkTag,
          `<style data-quartz-inlined-from="${escapeHtmlAttribute(asset.url)}">\n${escapeStyleText(asset.html)}\n</style>`
        ] as const;
      } catch {
        return [linkTag, linkTag] as const;
      }
    })
  );

  return applyStringReplacements(html, replacements);
}

async function inlineLocalScripts(html: string, url: string) {
  const scriptPattern = /<script\b[^>]*\bsrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>\s*<\/script>/gi;
  const replacements = await Promise.all(
    Array.from(html.matchAll(scriptPattern), async (match) => {
      const scriptTag = match[0];
      const source = readHtmlAttribute(scriptTag, "src");
      const assetUrl = localAssetUrl(url, source);

      if (!assetUrl) {
        return [scriptTag, ""] as const;
      }

      try {
        const asset = await fetchPreviewDocumentText(assetUrl);
        const type = readHtmlAttribute(scriptTag, "type") || "module";
        return [
          scriptTag,
          `<script type="${escapeHtmlAttribute(type)}" data-quartz-inlined-from="${escapeHtmlAttribute(asset.url)}">\n${escapeScriptText(asset.html)}\n</script>`
        ] as const;
      } catch {
        return [scriptTag, ""] as const;
      }
    })
  );

  return applyStringReplacements(html, replacements);
}

function localAssetUrl(documentUrl: string, rawAssetUrl: string) {
  try {
    const documentOrigin = new URL(documentUrl).origin;
    const assetUrl = new URL(rawAssetUrl, documentUrl);
    return assetUrl.origin === documentOrigin ? assetUrl.toString() : null;
  } catch {
    return null;
  }
}

function applyStringReplacements(value: string, replacements: readonly (readonly [string, string])[]) {
  return replacements.reduce((current, [from, to]) => current.replace(from, to), value);
}

function escapeStyleText(value: string) {
  return value.replace(/<\/style/gi, "<\\/style");
}

function escapeScriptText(value: string) {
  return value.replace(/<\/script/gi, "<\\/script");
}

function stripExecutablePreviewCode(html: string) {
  return stripPreviewHints(removePreviewCsp(html)).replace(/<script\b[\s\S]*?<\/script>/gi, "");
}

function shouldStripPreviewLink(linkTag: string) {
  const rel = readHtmlAttribute(linkTag, "rel")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const as = readHtmlAttribute(linkTag, "as").toLowerCase();
  const href = readHtmlAttribute(linkTag, "href").toLowerCase();

  if (rel.some((value) => ["modulepreload", "prefetch", "preconnect", "dns-prefetch"].includes(value))) {
    return true;
  }

  if (!rel.includes("preload")) {
    return false;
  }

  return as === "script" || as === "font" || href.includes("/_next/static/chunks/");
}

function readHtmlAttribute(tag: string, attributeName: string) {
  const escapedAttributeName = attributeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b${escapedAttributeName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = tag.match(pattern);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

function createSelectionSnapshotPolicyTag() {
  return `<style id="quartz-selection-snapshot-policy">html,body,*{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;}body{font-synthesis-weight:auto;}*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;scroll-behavior:auto!important;}</style>`;
}

function createBridgeIdentity(url: string) {
  const routeFingerprint = `route_${stableHash(url.replace(/[?#].*$/, ""))}`;
  return {
    projectId: "local-preview",
    projectEpoch: "workspace",
    previewSessionId: `preview_${stableHash(url)}`,
    bridgeSessionId: `bridge_${stableHash(`${url}|selection`)}`,
    pageNavigationId: `page_${stableHash(`${url}|navigation`)}`,
    routeFingerprint,
    bridgeRevision: 1
  };
}

function createSelectionBridgeScript(identity: ReturnType<typeof createBridgeIdentity>) {
  return `
(() => {
  const identity = ${JSON.stringify(identity)};
  const protocol = "quartz.domBridge.v1";
  const ignoredIds = new Set(["${bridgeScriptId}"]);
  const ignoredTags = new Set(["html", "body", "head", "script", "style", "link", "meta", "title", "base"]);
  const rootElementIds = new Set(["root", "app", "__next", "svelte", "vite-root", "tauri-root"]);
  const structuralTags = new Set(["div", "main", "section", "article", "aside"]);
  let hovered = null;
  let selected = null;

  function now() {
    return new Date().toISOString();
  }

  function hash(value) {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      result ^= value.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(16).padStart(8, "0");
  }

  function post(type, payload) {
    window.parent.postMessage({
      protocol,
      type,
      eventId: "evt_" + hash(type + "|" + now() + "|" + Math.random()),
      emittedAt: now(),
      ...identity,
      payload
    }, "*");
  }

  function clean(value, maxLength = 512) {
    return String(value || "").replace(/\\s+/g, " ").trim().slice(0, maxLength);
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/["\\\\]/g, "\\\\$&");
  }

  function attributeSelector(name, value) {
    return "[" + name + "=\\"" + String(value).replace(/["\\\\]/g, "\\\\$&") + "\\"]";
  }

  function sameTagIndex(element) {
    const parent = element.parentElement;
    if (!parent) return 1;
    return Array.from(parent.children).filter((child) => child.tagName === element.tagName).indexOf(element) + 1;
  }

  function childIndex(element) {
    const parent = element.parentElement;
    if (!parent) return 1;
    return Array.from(parent.children).indexOf(element) + 1;
  }

  function roleFor(element) {
    const explicit = element.getAttribute("role");
    if (explicit) return explicit;
    const tag = element.tagName.toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a" && element.hasAttribute("href")) return "link";
    if (tag === "img") return "img";
    if (tag === "nav") return "navigation";
    if (tag === "main") return "main";
    if (tag === "header") return "banner";
    if (tag === "footer") return "contentinfo";
    if (tag === "input" || tag === "textarea") return "textbox";
    return "";
  }

  function segmentFor(element) {
    const tag = element.tagName.toLowerCase();
    for (const name of ["data-source-id", "data-testid", "data-test", "data-qa", "data-quartz-id", "data-component", "data-component-name", "id"]) {
      const value = element.getAttribute(name);
      if (value) {
        return { selector: tag + attributeSelector(name, value), reliability: name === "id" ? "semantic" : "instrumented" };
      }
    }
    const role = roleFor(element);
    if (role) {
      return { selector: tag + attributeSelector("role", role) + ":nth-of-type(" + sameTagIndex(element) + ")", reliability: "semantic" };
    }
    return { selector: tag + ":nth-of-type(" + sameTagIndex(element) + ")", reliability: "structural" };
  }

  function stableSelector(element) {
    const parts = [];
    let current = element;
    let reliability = "structural";
    for (let depth = 0; current && depth < 12; depth += 1) {
      const segment = segmentFor(current);
      parts.unshift(segment.selector);
      if (segment.reliability === "instrumented" || reliability === "instrumented") reliability = "instrumented";
      else if (segment.reliability === "semantic" || reliability === "semantic") reliability = "semantic";
      const selector = parts.join(" > ");
      try {
        if (document.querySelectorAll(selector).length === 1) return { selector, reliability };
      } catch {}
      current = current.parentElement;
    }
    return { selector: parts.join(" > "), reliability };
  }

  function domPath(element) {
    const path = [];
    let current = element;
    for (let depth = 0; current && depth < 12; depth += 1) {
      const segment = segmentFor(current);
      const entry = {
        tagName: current.tagName.toLowerCase(),
        childIndex: childIndex(current),
        sameTagIndex: sameTagIndex(current),
        selectorSegment: segment.selector
      };
      const role = roleFor(current);
      const testId = current.getAttribute("data-testid") || current.getAttribute("data-test") || current.getAttribute("data-qa");
      const sourceFile = current.getAttribute("data-source-file") || current.getAttribute("data-source");
      if (role) entry.role = role;
      if (testId) entry.testId = testId;
      if (sourceFile) entry.sourceFile = sourceFile;
      path.unshift(entry);
      current = current.parentElement;
    }
    return path;
  }

  function attributesFor(element) {
    const attributes = {};
    for (const attribute of Array.from(element.attributes).slice(0, 64)) {
      attributes[attribute.name.slice(0, 80)] = clean(attribute.value, 1024);
    }
    return attributes;
  }

  function elementPayload(element) {
    const selector = stableSelector(element);
    const rect = element.getBoundingClientRect();
    const tag = element.tagName.toLowerCase();
    return {
      ...identity,
      referenceKind: "dom_element",
      elementReferenceId: "el_" + hash(identity.bridgeSessionId + "|" + selector.selector),
      capturedAt: now(),
      stableSelector: selector.selector || tag,
      selectorReliability: selector.reliability,
      domPath: domPath(element),
      roleHints: {
        role: roleFor(element),
        accessibleName: clean(element.getAttribute("aria-label") || element.getAttribute("alt") || element.getAttribute("title") || ""),
        text: clean(element.textContent || ""),
        labelText: clean(element.closest("label")?.textContent || "")
      },
      boundingBox: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        viewportWidth: window.innerWidth || 1,
        viewportHeight: window.innerHeight || 1
      },
      attributes: attributesFor(element),
      redactions: [],
      visibility: { visible: rect.width > 0 && rect.height > 0, reasons: rect.width > 0 && rect.height > 0 ? [] : ["empty_bounds"] },
      frame: { sameOrigin: true, framePath: [] }
    };
  }

  function pointer(event) {
    return {
      clientX: event.clientX,
      clientY: event.clientY,
      button: Math.max(0, Number.isFinite(event.button) ? event.button : 0),
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey
    };
  }

  function hasStrongSelectionSignal(element) {
    const tag = element.tagName.toLowerCase();
    if (
      element.getAttribute("data-source") ||
      element.getAttribute("data-qc-source") ||
      element.getAttribute("data-source-id") ||
      element.getAttribute("data-testid") ||
      element.getAttribute("data-component") ||
      element.getAttribute("aria-label")
    ) {
      return true;
    }
    const id = String(element.id || "").toLowerCase();
    if (id && !rootElementIds.has(id)) {
      return true;
    }
    return ["a", "button", "canvas", "h1", "h2", "h3", "h4", "h5", "h6", "img", "input", "label", "li", "p", "select", "span", "svg", "textarea", "video"].includes(tag);
  }

  function isSelectableElement(element) {
    if (!element || ignoredIds.has(element.id)) return false;
    const tag = element.tagName.toLowerCase();
    if (!tag || ignoredTags.has(tag)) return false;
    if (element === document.documentElement || element === document.body) return false;
    const id = String(element.id || "").toLowerCase();
    if (rootElementIds.has(id)) return false;
    if (element.parentElement === document.body && rootElementIds.has(id)) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const coversViewport = rect.width >= (window.innerWidth || 1) * 0.82 && rect.height >= (window.innerHeight || 1) * 0.72;
    return !(coversViewport && structuralTags.has(tag) && !hasStrongSelectionSignal(element));
  }

  function selectableElementFromPoint(clientX, clientY) {
    const elements = typeof document.elementsFromPoint === "function"
      ? document.elementsFromPoint(clientX, clientY)
      : [document.elementFromPoint(clientX, clientY)].filter(Boolean);
    return elements.find(isSelectableElement) || null;
  }

  function targetElement(event) {
    return selectableElementFromPoint(event.clientX, event.clientY);
  }

  function revealStreamedReactSegments() {
    const segments = Array.from(document.querySelectorAll("[id^='S:']"));
    for (const segment of segments) {
      const segmentId = segment.id.slice(2);
      const boundary = document.getElementById("B:" + segmentId);
      if (!boundary || !boundary.parentNode) {
        segment.removeAttribute("hidden");
        continue;
      }

      const parent = boundary.parentNode;
      let cursor = boundary.nextSibling;
      while (cursor) {
        const next = cursor.nextSibling;
        const isBoundaryEnd =
          cursor.nodeType === Node.COMMENT_NODE && String(cursor.nodeValue || "").trim() === "/$";
        parent.removeChild(cursor);
        if (isBoundaryEnd) break;
        cursor = next;
      }

      while (segment.firstChild) {
        parent.insertBefore(segment.firstChild, boundary);
      }
      boundary.remove();
      segment.remove();
    }
  }

  function settleStaticPreviewLayout() {
    document.documentElement.style.scrollBehavior = "auto";
    for (const element of Array.from(document.querySelectorAll("[style]"))) {
      const htmlElement = element;
      const style = String(htmlElement.getAttribute("style") || "").replace(/\\s+/g, "").toLowerCase();
      const isInitialAnimationState = style.includes("opacity:0") && style.includes("transform:");
      if (!isInitialAnimationState || htmlElement.hasAttribute("hidden")) continue;
      htmlElement.style.opacity = "1";
      htmlElement.style.transform = "none";
    }
  }

  function setOutline(element, color, width) {
    if (!element) return;
    element.dataset.quartzPreviousOutline = element.style.outline || "";
    element.dataset.quartzPreviousOutlineOffset = element.style.outlineOffset || "";
    element.style.outline = width + " solid " + color;
    element.style.outlineOffset = "2px";
  }

  function clearOutline(element) {
    if (!element) return;
    element.style.outline = element.dataset.quartzPreviousOutline || "";
    element.style.outlineOffset = element.dataset.quartzPreviousOutlineOffset || "";
    delete element.dataset.quartzPreviousOutline;
    delete element.dataset.quartzPreviousOutlineOffset;
  }

  window.addEventListener("pointermove", (event) => {
    const element = targetElement(event);
    if (!element || element === hovered) return;
    if (hovered && hovered !== selected) clearOutline(hovered);
    hovered = element;
    if (hovered !== selected) setOutline(hovered, "#4da3ff", "1px");
    post("quartz.element.hovered", { element: elementPayload(element), pointer: pointer(event) });
  }, { passive: true });

  try {
    revealStreamedReactSegments();
    settleStaticPreviewLayout();
  } catch {}

  window.addEventListener("click", (event) => {
    const element = targetElement(event);
    if (!element) {
      post("quartz.bridge.blocked", { reason: "unsupported_document", message: "No selectable element at pointer." });
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (selected && selected !== element) clearOutline(selected);
    selected = element;
    setOutline(selected, "#4da3ff", "2px");
    const payload = elementPayload(element);
    post("quartz.element.selected", {
      selectionId: "sel_" + payload.elementReferenceId + "_" + identity.bridgeRevision,
      element: payload,
      pointer: pointer(event),
      inputModality: "mouse"
    });
  }, true);

  function hasSelectableCandidates() {
    return Array.from(document.querySelectorAll("a,button,canvas,h1,h2,h3,h4,h5,h6,img,input,label,li,p,select,span,svg,textarea,video,[data-source],[data-source-id],[data-testid],[data-component],[aria-label]")).some(isSelectableElement);
  }

  function postReadyWhenSelectable() {
    const startedAt = performance.now();
    function check() {
      if (hasSelectableCandidates() || performance.now() - startedAt > 2000) {
        post("quartz.bridge.ready", { capabilities: ["hover", "select", "scroll", "element-reference"], bridgeBuildId: "workspace-inline-v2" });
        return;
      }
      requestAnimationFrame(check);
    }
    requestAnimationFrame(check);
  }

  postReadyWhenSelectable();
})();
`;
}

function selectedElementFromReference(
  selectionId: string,
  element: ElementReferencePayload,
  previewUrl: string
): SelectedElement {
  const lastSegment = element.domPath[element.domPath.length - 1];
  const tag = lastSegment?.tagName ?? "element";
  const label =
    element.roleHints.accessibleName ||
    element.roleHints.text ||
    element.attributes["data-component"] ||
    element.attributes["data-component-name"] ||
    element.attributes.id ||
    tag;
  const source =
    [...element.domPath].reverse().find((segment) => segment.sourceFile)?.sourceFile ||
    element.attributes["data-source-file"] ||
    element.attributes["data-source"] ||
    element.stableSelector;

  return {
    id: selectionId,
    label,
    previewUrl,
    tag,
    source,
    selector: element.stableSelector,
    reliability: element.selectorReliability,
    rect: {
      left: element.boundingBox.left,
      top: element.boundingBox.top,
      width: element.boundingBox.width,
      height: element.boundingBox.height
    }
  };
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function LocalhostProjectPicker({
  onRefresh,
  onSelect,
  projects,
  scanStatus
}: {
  onRefresh: () => void;
  onSelect: (project: LocalhostProjectPreview) => void;
  projects: readonly LocalhostProjectPreview[];
  scanStatus: LocalhostScanStatus;
}) {
  const isScanning = scanStatus === "scanning";
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const launchTimeoutRef = useRef<number | null>(null);
  const [launchingProject, setLaunchingProject] = useState<LocalhostProjectPreview | null>(null);
  const [launchFrame, setLaunchFrame] = useState<{
    expanded: boolean;
    height: number;
    left: number;
    top: number;
    width: number;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (launchTimeoutRef.current !== null) {
        window.clearTimeout(launchTimeoutRef.current);
      }
    };
  }, []);

  function launchProject(project: LocalhostProjectPreview, element: HTMLElement) {
    if (launchingProject) {
      return;
    }

    const pickerBounds = pickerRef.current?.getBoundingClientRect();
    const cardBounds = element.getBoundingClientRect();

    setLaunchingProject(project);
    setLaunchFrame({
      expanded: false,
      height: cardBounds.height,
      left: pickerBounds ? cardBounds.left - pickerBounds.left : 0,
      top: pickerBounds ? cardBounds.top - pickerBounds.top : 0,
      width: cardBounds.width
    });

    window.requestAnimationFrame(() => {
      setLaunchFrame((current) => (current ? { ...current, expanded: true } : current));
    });

    if (launchTimeoutRef.current !== null) {
      window.clearTimeout(launchTimeoutRef.current);
    }
    launchTimeoutRef.current = window.setTimeout(() => {
      onSelect(project);
    }, 320);
  }

  function launchProjectFromKeyboard(project: LocalhostProjectPreview, event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    launchProject(project, event.currentTarget);
  }

  return (
    <div className="relative h-full overflow-hidden bg-white text-[var(--text-primary)]" ref={pickerRef}>
      <div className="h-full overflow-auto px-6 py-5">
        <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col items-center justify-center gap-4">
          {projects.length > 0 ? (
            <div className="grid w-full justify-center gap-3 [grid-template-columns:repeat(auto-fit,minmax(240px,320px))]">
              {projects.map((project) => (
                <div
                  aria-disabled={launchingProject !== null}
                  className={[
                    "group relative aspect-video min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-white text-left transition-[border-color,opacity,transform] duration-150 hover:border-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring-outer)]",
                    launchingProject ? "cursor-default opacity-50" : "cursor-pointer"
                  ].join(" ")}
                  key={project.url}
                  onClick={(event: MouseEvent<HTMLDivElement>) => launchProject(project, event.currentTarget)}
                  onKeyDown={(event) => launchProjectFromKeyboard(project, event)}
                  role="button"
                  tabIndex={launchingProject ? -1 : 0}
                >
                  <LocalhostProjectPreviewFrame project={project} />
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-[13px] text-[var(--text-muted)]">
              {isScanning ? "Scanning localhost..." : "No localhost projects found"}
            </div>
          )}
          <button
            aria-label={isScanning ? "Scanning localhost projects" : "Refresh localhost projects"}
            className={iconButtonClass}
            disabled={isScanning}
            onClick={onRefresh}
            title={isScanning ? "Scanning" : "Refresh"}
            type="button"
          >
            <ArrowClockwise className={isScanning ? "animate-spin" : ""} size={15} weight="regular" />
          </button>
        </div>
      </div>
      {launchingProject && launchFrame ? (
        <div
          className="pointer-events-none absolute z-20 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-white transition-[left,top,width,height,border-radius] duration-300 ease-out"
          style={{
            borderRadius: launchFrame.expanded ? 0 : undefined,
            height: launchFrame.expanded ? "100%" : launchFrame.height,
            left: launchFrame.expanded ? 0 : launchFrame.left,
            top: launchFrame.expanded ? 0 : launchFrame.top,
            width: launchFrame.expanded ? "100%" : launchFrame.width
          }}
        >
          <LocalhostProjectPreviewFrame expanded project={launchingProject} />
        </div>
      ) : null}
    </div>
  );
}

function LocalhostProjectPreviewFrame({
  expanded,
  project
}: {
  expanded?: boolean;
  project: LocalhostProjectPreview;
}) {
  return (
    <>
      <iframe
        aria-hidden="true"
        className={[
          "pointer-events-none block origin-top-left border-0 bg-white",
          expanded ? "h-full w-full scale-100" : "h-[200%] w-[200%] scale-50"
        ].join(" ")}
        src={projectThumbnailUrl(project.url)}
        tabIndex={-1}
        title={`${project.title} preview`}
      />
      <span className="absolute inset-x-0 bottom-0 border-t border-[var(--border)] bg-white/95 px-2 py-1.5">
        <span className="flex min-w-0 items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block truncate text-[12px] font-medium">{project.title}</span>
            <span className="block truncate text-[11px] text-[var(--text-muted)]">{project.url}</span>
          </span>
          <span className="shrink-0 text-[11px] text-[var(--text-muted)]">
            {localhostProjectPreviewKindLabel(project)}
          </span>
        </span>
      </span>
    </>
  );
}

function localhostProjectPreviewKindLabel(project: LocalhostProjectPreview) {
  if (project.surfaceKind === "desktop") {
    return localhostProjectSurfaceLabel(project);
  }

  return project.framework ?? localhostProjectSurfaceLabel(project);
}

function localhostProjectSurfaceLabel(project: LocalhostProjectPreview) {
  switch (project.surfaceKind ?? project.source) {
    case "desktop":
      return "desktop app";
    case "web":
      return "web app";
    case "unknown":
      return "reachable";
  }
}

export function BrowserPreviewPane({
  canGoBack,
  canGoForward,
  mode,
  onBack,
  onForward,
  onModeChange,
  onNavigate,
  onSelectLocalhostProject,
  onLoadStateChange,
  onReload,
  onSelectionBlocked,
  onSelectionReady,
  onSelectElement,
  onZoomChange,
  selectionBlockedReason,
  selectedElement,
  url,
  zoom
}: {
  canGoBack: boolean;
  canGoForward: boolean;
  mode: BrowserMode;
  onBack: () => void;
  onForward: () => void;
  onModeChange: (mode: BrowserMode) => void;
  onNavigate: (url: string) => void;
  onSelectLocalhostProject: (project: LocalhostProjectPreview) => void;
  onLoadStateChange: (state: LoadState) => void;
  onReload: () => void;
  onSelectionBlocked: (reason: string) => void;
  onSelectionReady: () => void;
  onSelectElement: (element: SelectedElement) => void;
  onZoomChange: (zoom: number) => void;
  selectionBlockedReason: string | null;
  selectedElement: SelectedElement | null;
  url: string;
  zoom: number;
}) {
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const selectionIframeRef = useRef<HTMLIFrameElement | null>(null);
  const [selectableHtml, setSelectableHtml] = useState<string | null>(null);
  const [selectionBridgeStatus, setSelectionBridgeStatus] = useState<SelectionBridgeStatus>("idle");
  const [localhostProjects, setLocalhostProjects] = useState<readonly LocalhostProjectPreview[]>([]);
  const [localhostScanStatus, setLocalhostScanStatus] = useState<LocalhostScanStatus>("idle");
  const thumbnailPreview = isThumbnailPreview();
  const previewScale = zoom / 100;
  const hasSelectionSnapshot = mode === "select" && Boolean(selectableHtml);
  const canUseSelectionLayer = Boolean(url) && hasSelectionSnapshot && selectionBridgeStatus === "ready";
  const currentSelectedElement = selectedElement?.previewUrl === url ? selectedElement : null;

  function refreshLocalhostProjects() {
    setLocalhostScanStatus("scanning");
    scanLocalhostProjects()
      .then((projects) => {
        setLocalhostProjects(projects);
        setLocalhostScanStatus("ready");
      })
      .catch(() => {
        setLocalhostProjects([]);
        setLocalhostScanStatus("failed");
      });
  }

  useEffect(() => {
    if (url || thumbnailPreview) {
      return;
    }

    let canceled = false;
    setLocalhostScanStatus("scanning");
    scanLocalhostProjects()
      .then((projects) => {
        if (canceled) {
          return;
        }
        setLocalhostProjects(projects);
        setLocalhostScanStatus("ready");
      })
      .catch(() => {
        if (canceled) {
          return;
        }
        setLocalhostProjects([]);
        setLocalhostScanStatus("failed");
      });

    return () => {
      canceled = true;
    };
  }, [thumbnailPreview, url]);

  useEffect(() => {
    if (!url || mode !== "select") {
      setSelectableHtml(null);
      setSelectionBridgeStatus("idle");
      return;
    }

    let canceled = false;
    setSelectionBridgeStatus("loading");
    setSelectableHtml(null);

    fetchSelectablePreviewHtml(url)
      .then((html) => {
        if (canceled) {
          return;
        }
        setSelectableHtml(html);
      })
      .catch(() => {
        if (canceled) {
          return;
        }
        setSelectionBridgeStatus("failed");
        onSelectionBlocked("Edit unavailable for this preview.");
      });

    return () => {
      canceled = true;
    };
  }, [mode, onSelectionBlocked, url]);

  useEffect(() => {
    if (mode !== "select" || !selectableHtml || selectionBridgeStatus !== "loading") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSelectionBridgeStatus("failed");
      onSelectionBlocked("Edit unavailable for this preview.");
    }, 3000);

    return () => window.clearTimeout(timeoutId);
  }, [mode, onSelectionBlocked, selectableHtml, selectionBridgeStatus]);

  useEffect(() => {
    function handleBridgeMessage(event: MessageEvent<unknown>) {
      const parsed = sanitizeBridgeEventEnvelope(event.data);
      if (!parsed.ok) {
        return;
      }

      if (event.source !== selectionIframeRef.current?.contentWindow) {
        return;
      }

      const bridgeEvent = parsed.event;
      switch (bridgeEvent.type) {
        case "quartz.bridge.ready":
          window.setTimeout(() => {
            setSelectionBridgeStatus("ready");
            onSelectionReady();
          }, 80);
          return;
        case "quartz.bridge.blocked": {
          const payload = bridgeEvent.payload as { message: string };
          setSelectionBridgeStatus("failed");
          onSelectionBlocked(payload.message);
          return;
        }
        case "quartz.element.hovered":
          return;
        case "quartz.element.selected": {
          const payload = bridgeEvent.payload as {
            selectionId: string;
            element: ElementReferencePayload;
          };
          setSelectionBridgeStatus("ready");
          onSelectElement(selectedElementFromReference(payload.selectionId, payload.element, url));
          return;
        }
        case "quartz.selection.revalidated":
        case "quartz.preview.navigation":
          return;
      }
    }

    window.addEventListener("message", handleBridgeMessage);
    return () => window.removeEventListener("message", handleBridgeMessage);
  }, [onSelectElement, onSelectionBlocked, onSelectionReady, url]);

  function selectFromFrame(event: MouseEvent<HTMLDivElement>) {
    if (mode !== "select") {
      return;
    }

    if (selectionBridgeStatus !== "ready") {
      onSelectionBlocked(
        selectionBridgeStatus === "loading" ? "Preparing selector." : "Edit unavailable for this preview."
      );
      return;
    }

    const iframe = selectionIframeRef.current;
    if (!iframe) {
      onSelectionBlocked("Preview is not loaded.");
      return;
    }

    const iframeBounds = previewIframeRef.current?.getBoundingClientRect() ?? iframe.getBoundingClientRect();
    const x = (event.clientX - iframeBounds.left) / previewScale;
    const y = (event.clientY - iframeBounds.top) / previewScale;

    event.preventDefault();
    event.stopPropagation();

    try {
      const documentInsideFrame = iframe.contentDocument;
      const element =
        documentInsideFrame && isPointInsidePreviewViewport(iframe, x, y)
          ? selectableElementFromPoint(documentInsideFrame, x, y)
          : null;

      if (!element) {
        onSelectionBlocked("No selectable element at pointer.");
        return;
      }

      const rect = element.getBoundingClientRect();
      onSelectElement({
        id: `${element.tagName.toLowerCase()}-${Math.round(rect.left)}-${Math.round(rect.top)}`,
        label: elementLabel(element),
        previewUrl: url,
        tag: element.tagName.toLowerCase(),
        source: elementSource(element),
        rect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height
        }
      });
    } catch {
      onSelectionBlocked("Selection bridge blocked by the preview page.");
    }
  }

  function scrollFrameFromSelectionLayer(event: WheelEvent<HTMLDivElement>) {
    const iframeWindow = previewIframeRef.current?.contentWindow;
    const selectionWindow = selectionIframeRef.current?.contentWindow;
    if (!iframeWindow) {
      return;
    }

    try {
      iframeWindow.scrollBy({
        left: event.deltaX,
        top: event.deltaY,
        behavior: "auto"
      });
      selectionWindow?.scrollBy({
        left: event.deltaX,
        top: event.deltaY,
        behavior: "auto"
      });
      event.preventDefault();
    } catch {
      onSelectionBlocked("Switch to Interact to scroll this preview.");
    }
  }

  return (
    <section
      aria-label="Custom browser preview"
      className="grid min-h-0 min-w-0 grid-rows-[40px_minmax(0,1fr)] bg-[var(--bg-workspace-main)]"
    >
      <BrowserToolbar
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        mode={mode}
        onBack={onBack}
        onForward={onForward}
        onModeChange={onModeChange}
        onNavigate={onNavigate}
        onReload={onReload}
        onZoomChange={onZoomChange}
        url={url}
        zoom={zoom}
      />
      <div className="relative min-h-0 overflow-hidden bg-white">
        {url ? (
          <div
            className="relative h-full origin-top-left"
            style={{
              height: `${100 / previewScale}%`,
              transform: `scale(${previewScale})`,
              width: `${100 / previewScale}%`
            }}
          >
            <iframe
              key={url}
              className="block h-full min-h-0 w-full border-0 bg-white"
              onLoad={() => {
                onLoadStateChange("loaded");
              }}
              ref={previewIframeRef}
              src={url}
              title="Quartz Canvas preview"
            />
            {hasSelectionSnapshot ? (
              <iframe
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 block h-full min-h-0 w-full border-0 bg-white opacity-0"
                ref={selectionIframeRef}
                srcDoc={selectableHtml ?? undefined}
                tabIndex={-1}
                title="Quartz Canvas selection snapshot"
              />
            ) : null}
          </div>
        ) : (
          <LocalhostProjectPicker
            onRefresh={refreshLocalhostProjects}
            onSelect={onSelectLocalhostProject}
            projects={localhostProjects}
            scanStatus={localhostScanStatus}
          />
        )}
        {canUseSelectionLayer ? (
          <div
            aria-label="Selection layer"
            className="absolute inset-0 cursor-crosshair"
            onClick={selectFromFrame}
            onWheel={scrollFrameFromSelectionLayer}
          />
        ) : null}
        {mode === "select" && selectionBridgeStatus === "loading" ? (
          <div className="pointer-events-none absolute left-3 top-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
            Preparing selector...
          </div>
        ) : null}
        {mode === "select" && currentSelectedElement?.rect ? (
          <div
            className={[
              "pointer-events-none absolute border bg-[#4da3ff]/5",
              currentSelectedElement.stale
                ? "border-dashed border-[var(--warning)]"
                : "border-2 border-[#4da3ff]"
            ].join(" ")}
            style={{
              left: currentSelectedElement.rect.left * previewScale,
              top: currentSelectedElement.rect.top * previewScale,
              width: currentSelectedElement.rect.width * previewScale,
              height: currentSelectedElement.rect.height * previewScale
            }}
          >
            <span
              className={[
                "absolute left-0 top-[-28px] max-w-[280px] truncate rounded-[var(--radius-md)] px-2 py-1 text-[11px] font-medium text-white",
                currentSelectedElement.stale ? "bg-[var(--warning)]" : "bg-[#4da3ff]"
              ].join(" ")}
            >
              {currentSelectedElement.stale
                ? "Stale - Reselect"
                : `${currentSelectedElement.label} - ${currentSelectedElement.tag}`}
            </span>
          </div>
        ) : null}
        {url && selectionBlockedReason ? (
          <div className="pointer-events-none absolute left-3 top-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
            {selectionBlockedReason}
          </div>
        ) : null}
      </div>
    </section>
  );
}
