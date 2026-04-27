export type AppTheme = "dark" | "light";
export type AppThemeMode = AppTheme | "system";

const settingsStorageKey = "quartz-canvas-settings-v1";
let activeSystemThemeCleanup: (() => void) | null = null;

const sharedTokens = {
  "--font-sans": "\"Inter\", -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif",
  "--overlay-bg": "rgba(0, 0, 0, 0.75)",
  "--accent": "#ffffff",
  "--accent-rgb": "255 255 255",
  "--success": "#10b981",
  "--warning": "#f59e0b",
  "--danger": "#ef4444",
  "--shadow-elevated": "0 14px 45px rgba(0, 0, 0, 0.1)",
  "--shadow-elevated-hover": "0 18px 65px rgba(0, 0, 0, 0.15)",
  "--shadow-menu": "0 18px 60px rgba(0, 0, 0, 0.2)",
  "--chrome-glass-bg": "rgba(255, 255, 255, 0.02)",
  "--chrome-glass-border": "rgba(255, 255, 255, 0.08)",
  "--radius-sm": "4px",
  "--radius-md": "6px",
  "--radius-lg": "8px",
  "--padding-control": "6px 12px",
  "--padding-card": "20px",
  "--gap-stage": "32px",
  "--gap-grid": "12px",
  "--switch-thumb": "#f5f5f7",
  "--sidebar-hover-bg": "rgba(255, 255, 255, 0.04)",
  "--sidebar-hover-bg-strong": "rgba(255, 255, 255, 0.06)",
  "--mica-wash": "rgba(255, 255, 255, 0.04)"
} satisfies Record<string, string>;

const themeTokens: Record<AppTheme, Record<string, string>> = {
  dark: {
    ...sharedTokens,
    "--bg-black": "#000000",
    "--bg-sidebar": "#202020",
    "--bg-topbar": "#202020",
    "--bg-elevated": "#1c1c1e",
    "--bg-surface": "#2c2c2e",
    "--bg-workspace-main": "#141415",
    "--border": "rgba(255, 255, 255, 0.1)",
    "--border-subtle": "rgba(255, 255, 255, 0.05)",
    "--text-primary": "#f5f5f7",
    "--text-secondary": "#a1a1a6",
    "--text-muted": "#86868b",
    "--control-bg": "rgba(255, 255, 255, 0.04)",
    "--control-bg-hover": "rgba(255, 255, 255, 0.08)",
    "--control-bg-pressed": "rgba(255, 255, 255, 0.12)",
    "--sidebar-hover-bg": "rgba(255, 255, 255, 0.05)",
    "--sidebar-hover-bg-strong": "rgba(255, 255, 255, 0.08)",
    "--sidebar-selected-bg": "rgba(0, 0, 0, 0.16)",
    "--mica-wash": "rgba(94, 82, 63, 0.08)",
    "--focus-ring-outer": "rgba(255, 255, 255, 0.05)",
    "--switch-thumb": "#f5f5f7",
    "--chrome-glass-bg": "rgba(24, 24, 26, 0.72)",
    "--chrome-glass-border": "rgba(255, 255, 255, 0.10)"
  },
  light: {
    ...sharedTokens,
    "--bg-black": "#f4f2ec",
    "--bg-sidebar": "rgba(244, 242, 236, 0.88)",
    "--bg-topbar": "rgba(244, 242, 236, 0.88)",
    "--bg-elevated": "#fffefc",
    "--bg-surface": "#fffefc",
    "--bg-workspace-main": "#fafaf8",
    "--border": "#e4e2dd",
    "--border-subtle": "#f3f1eb",
    "--text-primary": "#0c0c0b",
    "--text-secondary": "#71706d",
    "--text-muted": "#999790",
    "--control-bg": "#f3f1eb",
    "--control-bg-hover": "#e4e2dd",
    "--control-bg-pressed": "#e4e2dd",
    "--sidebar-hover-bg": "rgba(12, 12, 11, 0.035)",
    "--sidebar-hover-bg-strong": "rgba(12, 12, 11, 0.055)",
    "--sidebar-selected-bg": "rgba(12, 12, 11, 0.045)",
    "--mica-wash": "rgba(236, 228, 213, 0.12)",
    "--focus-ring-outer": "rgba(12, 12, 11, 0.09)",
    "--overlay-bg": "rgba(12, 12, 11, 0.14)",
    "--accent": "#0c0c0b",
    "--accent-rgb": "12 12 11",
    "--success": "#55775f",
    "--warning": "#9a6e31",
    "--danger": "#a4554a",
    "--shadow-elevated": "0 12px 32px rgba(32, 26, 18, 0.05)",
    "--shadow-elevated-hover": "0 18px 44px rgba(32, 26, 18, 0.08)",
    "--shadow-menu": "0 22px 56px rgba(32, 26, 18, 0.1)",
    "--switch-thumb": "var(--bg-elevated)",
    "--chrome-glass-bg": "rgba(255, 254, 252, 0.72)",
    "--chrome-glass-border": "rgba(228, 226, 221, 0.88)"
  }
};

export function applyDocumentTheme(theme: AppTheme) {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme;

  for (const [token, value] of Object.entries(themeTokens[theme])) {
    root.style.setProperty(token, value);
  }
}

function isThemeMode(value: unknown): value is AppThemeMode {
  return value === "system" || value === "dark" || value === "light";
}

function resolveThemeMode(mode: AppThemeMode): AppTheme {
  if (mode !== "system") {
    return mode;
  }

  if (typeof window === "undefined") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function readStoredThemeMode(): AppThemeMode {
  if (typeof window === "undefined") {
    return "system";
  }

  try {
    const stored = window.localStorage.getItem(settingsStorageKey);
    if (!stored) {
      return "system";
    }

    const parsed = JSON.parse(stored) as { readonly appearanceMode?: unknown };
    return isThemeMode(parsed.appearanceMode) ? parsed.appearanceMode : "system";
  } catch {
    return "system";
  }
}

export function setDocumentThemeMode(mode: AppThemeMode) {
  activeSystemThemeCleanup?.();
  activeSystemThemeCleanup = null;

  applyDocumentTheme(resolveThemeMode(mode));

  if (typeof window === "undefined" || mode !== "system") {
    return;
  }

  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const handleSystemThemeChange = () => {
    applyDocumentTheme(query.matches ? "dark" : "light");
  };

  query.addEventListener("change", handleSystemThemeChange);
  activeSystemThemeCleanup = () => query.removeEventListener("change", handleSystemThemeChange);
}
