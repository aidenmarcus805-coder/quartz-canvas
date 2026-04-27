import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Browsers,
  CaretDown,
  Cpu,
  Folder,
  GearSix,
  UserCircle
} from "@phosphor-icons/react";
import {
  AiModelsPane,
  type AiModelImportRequest,
  type AiMarketplaceModelSettings,
  type AiModelRuntimeSettings
} from "./aiModelsPane";
import { Switch } from "./switch";

export type SettingsSectionId =
  | "general"
  | "ai-models"
  | "browser"
  | "projects"
  | "profile";

export type SettingsWorkMode = "coding" | "everyday";
export type SettingsPermissionMode = "default" | "auto-review" | "full-access";
export type SettingsOpenDestination = "threads" | "projects" | "search" | "skills";
export type SettingsAppearanceMode = "system" | "dark" | "light";
export type SettingsShell = "powershell" | "cmd" | "bash";
export type SettingsBrowserMode = "interact" | "select";

export type SettingsState = {
  readonly workMode: SettingsWorkMode;
  readonly permissionMode: SettingsPermissionMode;
  readonly defaultOpenDestination: SettingsOpenDestination;
  readonly restoreLastWorkspace: boolean;
  readonly confirmDestructiveActions: boolean;
  readonly appearanceMode: SettingsAppearanceMode;
  readonly workspaceRoot: string;
  readonly defaultShell: SettingsShell;
  readonly autosaveIntervalSeconds: number;
  readonly preserveTerminalCwd: boolean;
  readonly displayName: string;
  readonly initials: string;
  readonly locale: string;
  readonly personalizeSuggestions: boolean;
  readonly browserUseEnabled: boolean;
  readonly browserMode: SettingsBrowserMode;
  readonly detectLocalhostProjects: boolean;
  readonly defaultBrowserUrl: string;
  readonly showArchivedChats: boolean;
  readonly keepPinnedChatsVisible: boolean;
  readonly autoArchiveAfterDays: number;
  readonly archivedSort: "recent" | "oldest" | "project";
};

export type SettingsPaneProps = {
  readonly className?: string;
  readonly section?: SettingsSectionId;
  readonly initialSection?: SettingsSectionId;
  readonly initialSettings?: Partial<SettingsState>;
  readonly aiModelSettings?: Partial<AiModelRuntimeSettings>;
  readonly marketplaceModel?: AiMarketplaceModelSettings | null;
  readonly onAiModelImportRequest?: (request: AiModelImportRequest) => void;
  readonly onAiModelSettingsChange?: (settings: AiModelRuntimeSettings) => void;
  readonly onBack?: () => void;
  readonly onClearMarketplaceModel?: () => void;
  readonly onOpenMarketplace?: () => void;
  readonly onSettingsChange?: (settings: SettingsState) => void;
};

const storageKey = "quartz-canvas-settings-v1";

const defaultSettings: SettingsState = {
  workMode: "coding",
  permissionMode: "full-access",
  defaultOpenDestination: "threads",
  restoreLastWorkspace: true,
  confirmDestructiveActions: true,
  appearanceMode: "system",
  workspaceRoot: "",
  defaultShell: "powershell",
  autosaveIntervalSeconds: 30,
  preserveTerminalCwd: true,
  displayName: "Aiden",
  initials: "AE",
  locale: "en-US",
  personalizeSuggestions: true,
  browserUseEnabled: true,
  browserMode: "interact",
  detectLocalhostProjects: true,
  defaultBrowserUrl: "",
  showArchivedChats: false,
  keepPinnedChatsVisible: true,
  autoArchiveAfterDays: 30,
  archivedSort: "recent"
};

export const settingsSections: readonly {
  readonly id: SettingsSectionId;
  readonly label: string;
  readonly icon: ReactNode;
}[] = [
  { id: "general", label: "General", icon: <GearSix size={15} weight="regular" /> },
  { id: "ai-models", label: "AI Models", icon: <Cpu size={15} weight="regular" /> },
  { id: "browser", label: "Browser", icon: <Browsers size={15} weight="regular" /> },
  { id: "projects", label: "Projects & Chats", icon: <Folder size={15} weight="regular" /> },
  { id: "profile", label: "Profile", icon: <UserCircle size={15} weight="regular" /> }
];

const inputClass =
  "h-8 min-w-0 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--control-bg)] px-2 text-[12px] text-[var(--text-primary)] outline-none transition-colors duration-100 placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:bg-[var(--bg-elevated)]";

const numberInputClass =
  "h-8 w-20 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--control-bg)] px-2 text-right text-[12px] tabular-nums text-[var(--text-primary)] outline-none transition-colors duration-100 focus:border-[var(--accent)] focus:bg-[var(--bg-elevated)]";

const plainButtonClass =
  "h-7 rounded-[var(--radius-md)] px-2 text-[12px] font-medium text-[var(--text-secondary)] transition-[background-color,color,opacity] duration-100 ease-out hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-[var(--text-secondary)]";

function isStringOption<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === "string" && options.includes(value as T);
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

function sanitizeSettings(settings: Partial<SettingsState>): SettingsState {
  return {
    workMode: isStringOption(settings.workMode, ["coding", "everyday"]) ? settings.workMode : defaultSettings.workMode,
    permissionMode: isStringOption(settings.permissionMode, ["default", "auto-review", "full-access"])
      ? settings.permissionMode
      : defaultSettings.permissionMode,
    defaultOpenDestination: isStringOption(settings.defaultOpenDestination, [
      "threads",
      "projects",
      "search",
      "skills"
    ])
      ? settings.defaultOpenDestination
      : defaultSettings.defaultOpenDestination,
    restoreLastWorkspace: cleanBoolean(settings.restoreLastWorkspace, defaultSettings.restoreLastWorkspace),
    confirmDestructiveActions: cleanBoolean(
      settings.confirmDestructiveActions,
      defaultSettings.confirmDestructiveActions
    ),
    appearanceMode: isStringOption(settings.appearanceMode, ["system", "dark", "light"])
      ? settings.appearanceMode
      : defaultSettings.appearanceMode,
    workspaceRoot: cleanString(settings.workspaceRoot, defaultSettings.workspaceRoot),
    defaultShell: isStringOption(settings.defaultShell, ["powershell", "cmd", "bash"])
      ? settings.defaultShell
      : defaultSettings.defaultShell,
    autosaveIntervalSeconds: Math.round(
      cleanNumber(settings.autosaveIntervalSeconds, defaultSettings.autosaveIntervalSeconds, 5, 300)
    ),
    preserveTerminalCwd: cleanBoolean(settings.preserveTerminalCwd, defaultSettings.preserveTerminalCwd),
    displayName: cleanString(settings.displayName, defaultSettings.displayName),
    initials: cleanString(settings.initials, defaultSettings.initials).slice(0, 3).toUpperCase(),
    locale: cleanString(settings.locale, defaultSettings.locale),
    personalizeSuggestions: cleanBoolean(settings.personalizeSuggestions, defaultSettings.personalizeSuggestions),
    browserUseEnabled: cleanBoolean(settings.browserUseEnabled, defaultSettings.browserUseEnabled),
    browserMode: isStringOption(settings.browserMode, ["interact", "select"])
      ? settings.browserMode
      : defaultSettings.browserMode,
    detectLocalhostProjects: cleanBoolean(settings.detectLocalhostProjects, defaultSettings.detectLocalhostProjects),
    defaultBrowserUrl: cleanString(settings.defaultBrowserUrl, defaultSettings.defaultBrowserUrl),
    showArchivedChats: cleanBoolean(settings.showArchivedChats, defaultSettings.showArchivedChats),
    keepPinnedChatsVisible: cleanBoolean(settings.keepPinnedChatsVisible, defaultSettings.keepPinnedChatsVisible),
    autoArchiveAfterDays: Math.round(
      cleanNumber(settings.autoArchiveAfterDays, defaultSettings.autoArchiveAfterDays, 0, 365)
    ),
    archivedSort: isStringOption(settings.archivedSort, ["recent", "oldest", "project"])
      ? settings.archivedSort
      : defaultSettings.archivedSort
  };
}

function readStoredSettings() {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const stored = window.localStorage.getItem(storageKey);
    return stored ? (JSON.parse(stored) as Partial<SettingsState>) : {};
  } catch {
    return {};
  }
}

function joinClasses(...classes: readonly (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
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
    <div className="grid min-h-10 grid-cols-[240px_minmax(0,1fr)] items-center gap-5 py-1.5 max-[820px]:grid-cols-1 max-[820px]:gap-1.5">
      <div className="min-w-0">
        <div className="truncate text-[12px] font-medium leading-4 text-[var(--text-primary)]">{label}</div>
        {detail ? <div className="truncate text-[11px] leading-4 text-[var(--text-muted)]">{detail}</div> : null}
      </div>
      <div className="flex min-w-0 justify-end max-[820px]:justify-start">{children}</div>
    </div>
  );
}

function ToggleGroup<T extends string>({
  ariaLabel,
  options,
  onChange,
  value
}: {
  readonly ariaLabel: string;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
  readonly value: T;
}) {
  return (
    <div
      aria-label={ariaLabel}
      className="inline-flex min-w-0 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--control-bg)] p-0.5"
      role="radiogroup"
    >
      {options.map((option) => (
        <button
          aria-checked={option.value === value}
          className={joinClasses(
            "h-8 rounded-[var(--radius-sm)] px-2.5 text-[12px] transition-[background-color,color] duration-100 ease-out",
            option.value === value
              ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
              : "text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
          )}
          key={option.value}
          onClick={() => onChange(option.value)}
          role="radio"
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function SettingSelect<T extends string>({
  ariaLabel,
  options,
  onChange,
  value
}: {
  readonly ariaLabel: string;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
  readonly value: T;
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
    <div className="relative inline-flex w-52 max-w-full" ref={menuRef}>
      <button
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        className="flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--control-bg)] px-2 text-left text-[12px] text-[var(--text-primary)] outline-none transition-[background-color,border-color] duration-100 hover:bg-[var(--control-bg-hover)] focus:border-[var(--accent)] focus:bg-[var(--bg-elevated)]"
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
          className="absolute right-0 top-[calc(100%+4px)] z-50 w-full min-w-40 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-menu)]"
          role="listbox"
        >
          {options.map((option) => (
            <button
              aria-selected={option.value === value}
              className={joinClasses(
                "flex h-7 w-full items-center px-2 text-left text-[12px] transition-colors duration-100",
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

function CompactNumber({
  max,
  min,
  onChange,
  step = 1,
  suffix,
  value
}: {
  readonly max: number;
  readonly min: number;
  readonly onChange: (value: number) => void;
  readonly step?: number;
  readonly suffix?: string;
  readonly value: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        className={numberInputClass}
        max={max}
        min={min}
        onChange={(event) => onChange(clamp(Number(event.target.value), min, max))}
        step={step}
        type="number"
        value={value}
      />
      {suffix ? <span className="w-14 text-[12px] text-[var(--text-muted)]">{suffix}</span> : null}
    </div>
  );
}

export function SettingsPane({
  aiModelSettings,
  className,
  initialSection = "general",
  initialSettings,
  marketplaceModel,
  onAiModelImportRequest,
  onAiModelSettingsChange,
  onBack,
  onClearMarketplaceModel,
  onOpenMarketplace,
  section,
  onSettingsChange
}: SettingsPaneProps) {
  const activeSection = section ?? initialSection;
  const [settings, setSettings] = useState(() =>
    sanitizeSettings({ ...defaultSettings, ...readStoredSettings(), ...initialSettings })
  );
  const activeSectionLabel = useMemo(
    () => settingsSections.find((section) => section.id === activeSection)?.label ?? "Settings",
    [activeSection]
  );

  function updateSettings(next: Partial<SettingsState>) {
    setSettings((current) => sanitizeSettings({ ...current, ...next }));
  }

  function resetSettings() {
    setSettings(defaultSettings);
  }

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, JSON.stringify(settings));
    }
    onSettingsChange?.(settings);
  }, [onSettingsChange, settings]);

  return (
    <section
      aria-label="Settings"
      className={joinClasses(
        "grid min-h-0 min-w-0 grid-rows-[40px_minmax(0,1fr)] overflow-hidden bg-[var(--bg-workspace-main)] text-[13px] text-[var(--text-primary)]",
        className
      )}
    >
      <div className="flex min-w-0 items-center justify-between border-b border-[var(--border)] px-3">
        <div className="flex min-w-0 items-center gap-2">
          {onBack ? (
            <button
              aria-label="Back to workspace"
              className="flex h-7 items-center gap-1.5 rounded-[var(--radius-md)] px-2 text-[12px] font-medium text-[var(--text-secondary)] transition-[background-color,color] duration-100 ease-out hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]"
              onClick={onBack}
              type="button"
            >
              <ArrowLeft size={14} weight="regular" />
              <span>Back</span>
            </button>
          ) : null}
          <div className="h-4 w-px bg-[var(--border-subtle)]" />
          <GearSix className="shrink-0 text-[var(--text-muted)]" size={15} weight="regular" />
          <div className="truncate text-[12px] font-medium">Settings</div>
          <div className="hidden truncate text-[11px] text-[var(--text-muted)] min-[760px]:block">
            {activeSectionLabel}
          </div>
        </div>
        {activeSection === "ai-models" ? null : (
          <button className={plainButtonClass} onClick={resetSettings} type="button">
            Reset
          </button>
        )}
      </div>

      <div className={joinClasses("min-h-0 min-w-0", activeSection === "ai-models" ? "overflow-hidden" : "overflow-auto")}>
        <div
          className={joinClasses(
            "w-full",
            activeSection === "ai-models" ? "h-full max-w-none p-0" : "max-w-[980px] px-6 py-3"
          )}
        >
          {activeSection === "general" ? (
            <>
              <Section title="Workspace">
                <Row label="Work mode">
                  <ToggleGroup
                    ariaLabel="Work mode"
                    onChange={(workMode) => updateSettings({ workMode })}
                    options={[
                      { value: "coding", label: "Coding" },
                      { value: "everyday", label: "Everyday" }
                    ]}
                    value={settings.workMode}
                  />
                </Row>
                <Row label="Theme">
                  <SettingSelect
                    ariaLabel="Theme"
                    onChange={(appearanceMode) => updateSettings({ appearanceMode })}
                    options={[
                      { value: "system", label: "System" },
                      { value: "dark", label: "Dark" },
                      { value: "light", label: "Light" }
                    ]}
                    value={settings.appearanceMode}
                  />
                </Row>
                <Row label="Default open destination">
                  <SettingSelect
                    ariaLabel="Default open destination"
                    onChange={(defaultOpenDestination) => updateSettings({ defaultOpenDestination })}
                    options={[
                      { value: "threads", label: "Threads" },
                      { value: "projects", label: "Projects" },
                      { value: "search", label: "Search" },
                      { value: "skills", label: "Skills" }
                    ]}
                    value={settings.defaultOpenDestination}
                  />
                </Row>
                <Row label="Restore last workspace">
                  <Switch
                    checked={settings.restoreLastWorkspace}
                    label="Restore last workspace"
                    onChange={(restoreLastWorkspace) => updateSettings({ restoreLastWorkspace })}
                  />
                </Row>
              </Section>

              <Section title="Permissions">
                <Row label="Permission preset">
                  <ToggleGroup
                    ariaLabel="Permission preset"
                    onChange={(permissionMode) => updateSettings({ permissionMode })}
                    options={[
                      { value: "default", label: "Default" },
                      { value: "auto-review", label: "Auto-review" },
                      { value: "full-access", label: "Full access" }
                    ]}
                    value={settings.permissionMode}
                  />
                </Row>
                <Row label="Confirm destructive actions">
                  <Switch
                    checked={settings.confirmDestructiveActions}
                    label="Confirm destructive actions"
                    onChange={(confirmDestructiveActions) => updateSettings({ confirmDestructiveActions })}
                  />
                </Row>
              </Section>
            </>
          ) : null}

          {activeSection === "projects" ? (
            <>
              <Section title="Workspace defaults">
                <Row label="Workspace root">
                  <input
                    aria-label="Workspace root"
                    className={`${inputClass} w-[360px] max-w-full`}
                    onChange={(event) => updateSettings({ workspaceRoot: event.target.value })}
                    placeholder="C:\\Users\\aiden\\Documents"
                    spellCheck={false}
                    value={settings.workspaceRoot}
                  />
                </Row>
                <Row label="Default shell">
                  <SettingSelect
                    ariaLabel="Default shell"
                    onChange={(defaultShell) => updateSettings({ defaultShell })}
                    options={[
                      { value: "powershell", label: "PowerShell" },
                      { value: "cmd", label: "Command Prompt" },
                      { value: "bash", label: "Bash" }
                    ]}
                    value={settings.defaultShell}
                  />
                </Row>
                <Row label="Autosave interval">
                  <CompactNumber
                    max={300}
                    min={5}
                    onChange={(autosaveIntervalSeconds) => updateSettings({ autosaveIntervalSeconds })}
                    suffix="seconds"
                    value={settings.autosaveIntervalSeconds}
                  />
                </Row>
                <Row label="Preserve terminal cwd">
                  <Switch
                    checked={settings.preserveTerminalCwd}
                    label="Preserve terminal cwd"
                    onChange={(preserveTerminalCwd) => updateSettings({ preserveTerminalCwd })}
                  />
                </Row>
              </Section>

              <Section title="Chat archive">
                <Row label="Show archived chats">
                  <Switch
                    checked={settings.showArchivedChats}
                    label="Show archived chats"
                    onChange={(showArchivedChats) => updateSettings({ showArchivedChats })}
                  />
                </Row>
                <Row label="Pinned chats">
                  <Switch
                    checked={settings.keepPinnedChatsVisible}
                    label="Keep pinned chats visible"
                    onChange={(keepPinnedChatsVisible) => updateSettings({ keepPinnedChatsVisible })}
                  />
                </Row>
                <Row label="Auto-archive after">
                  <CompactNumber
                    max={365}
                    min={0}
                    onChange={(autoArchiveAfterDays) => updateSettings({ autoArchiveAfterDays })}
                    suffix="days"
                    value={settings.autoArchiveAfterDays}
                  />
                </Row>
                <Row label="Sort archived">
                  <SettingSelect
                    ariaLabel="Sort archived"
                    onChange={(archivedSort) => updateSettings({ archivedSort })}
                    options={[
                      { value: "recent", label: "Recent first" },
                      { value: "oldest", label: "Oldest first" },
                      { value: "project", label: "Project" }
                    ]}
                    value={settings.archivedSort}
                  />
                </Row>
              </Section>
            </>
          ) : null}

          {activeSection === "profile" ? (
            <Section title="Profile">
              <Row label="Display name">
                <input
                  aria-label="Display name"
                  className={`${inputClass} w-56`}
                  onChange={(event) => updateSettings({ displayName: event.target.value })}
                  value={settings.displayName}
                />
              </Row>
              <Row label="Initials">
                <input
                  aria-label="Initials"
                  className={`${inputClass} w-20 text-center uppercase`}
                  maxLength={3}
                  onChange={(event) => updateSettings({ initials: event.target.value })}
                  value={settings.initials}
                />
              </Row>
              <Row label="Locale">
                <input
                  aria-label="Locale"
                  className={`${inputClass} w-36`}
                  onChange={(event) => updateSettings({ locale: event.target.value })}
                  spellCheck={false}
                  value={settings.locale}
                />
              </Row>
              <Row label="Personalized suggestions">
                <Switch
                  checked={settings.personalizeSuggestions}
                  label="Personalized suggestions"
                  onChange={(personalizeSuggestions) => updateSettings({ personalizeSuggestions })}
                />
              </Row>
            </Section>
          ) : null}

          {activeSection === "ai-models" ? (
            <div className="h-full min-w-0">
              <AiModelsPane
                className="h-full bg-transparent"
                embedded
                initialSettings={aiModelSettings}
                marketplaceModel={marketplaceModel}
                onClearMarketplaceModel={onClearMarketplaceModel}
                onImportRequest={onAiModelImportRequest}
                onOpenMarketplace={onOpenMarketplace}
                onSettingsChange={onAiModelSettingsChange}
              />
            </div>
          ) : null}

          {activeSection === "browser" ? (
            <Section title="Browser">
              <Row label="Browser use">
                <Switch
                  checked={settings.browserUseEnabled}
                  label="Browser use"
                  onChange={(browserUseEnabled) => updateSettings({ browserUseEnabled })}
                />
              </Row>
              <Row label="Default mode">
                <ToggleGroup
                  ariaLabel="Default browser mode"
                  onChange={(browserMode) => updateSettings({ browserMode })}
                  options={[
                    { value: "interact", label: "Interact" },
                    { value: "select", label: "Select" }
                  ]}
                  value={settings.browserMode}
                />
              </Row>
              <Row label="Detect localhost projects">
                <Switch
                  checked={settings.detectLocalhostProjects}
                  label="Detect localhost projects"
                  onChange={(detectLocalhostProjects) => updateSettings({ detectLocalhostProjects })}
                />
              </Row>
              <Row label="Default URL">
                <input
                  aria-label="Default browser URL"
                  className={`${inputClass} w-[360px] max-w-full`}
                  onChange={(event) => updateSettings({ defaultBrowserUrl: event.target.value })}
                  placeholder="http://localhost:3000"
                  spellCheck={false}
                  value={settings.defaultBrowserUrl}
                />
              </Row>
            </Section>
          ) : null}
        </div>
      </div>
    </section>
  );
}
