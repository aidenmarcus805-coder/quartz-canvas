import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import {
  getAuthSession,
  openAuthUrl,
  signOutSession,
  verifyLicenseKey,
  type AuthUser
} from "./commands";

type AuthProviderValue = {
  error: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  signIn: (provider?: "google" | "apple" | "email") => Promise<void>;
  signOut: () => Promise<void>;
  user: AuthUser | null;
  validateToken: (token: string) => Promise<void>;
};

const AuthContext = createContext<AuthProviderValue | null>(null);

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const lastDeepLinkAt = useRef(0);

  const validateToken = useCallback(async (rawToken: string) => {
    const token = rawToken.trim().replace(/[^a-zA-Z0-9._-]/g, "");
    if (!token) {
      setError("Connection code is required.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await verifyLicenseKey({ key: token });
      if (!response.activated || !response.user) {
        throw new Error(response.error || "Invalid or expired connection code.");
      }

      setUser(response.user);
    } catch (caught) {
      setUser(null);
      setError(caught instanceof Error ? caught.message : "Auth failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  const signIn = useCallback(async (provider?: "google" | "apple" | "email") => {
    setError(null);

    let baseUrl = import.meta.env.VITE_AUTH_URL || "https://quartzeditor.com";
    baseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;

    const params = new URLSearchParams({
      callbackUrl: "/api/desktop/token",
      app: "quartz-canvas",
      scheme: "quartz-canvas"
    });

    if (provider) {
      params.set("prompt", provider);
    }

    try {
      await openAuthUrl({ url: `${baseUrl}/signin?${params.toString()}` });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open browser.");
    }
  }, []);

  const signOut = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      await signOutSession();
      setUser(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign out.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let canceled = false;

    getAuthSession()
      .then((session) => {
        if (!canceled) {
          setUser(session.authenticated ? session.user ?? null : null);
        }
      })
      .catch(() => {
        if (!canceled) {
          setUser(null);
        }
      })
      .finally(() => {
        if (!canceled) {
          setLoading(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    let unsubscribeDeepLink: (() => void) | undefined;
    let unsubscribeManual: (() => void) | undefined;
    let disposed = false;

    function handleUrls(urls: readonly string[]) {
      for (const url of urls) {
        const token = tokenFromDeepLink(url);
        if (token) {
          const now = Date.now();
          if (now - lastDeepLinkAt.current < 900) {
            return;
          }
          lastDeepLinkAt.current = now;
          void validateToken(token);
          return;
        }
      }
    }

    async function subscribe() {
      try {
        unsubscribeDeepLink = await onOpenUrl((urls) => handleUrls(urls));
      } catch {
        // Browser builds and older Tauri shells do not expose deep links.
      }

      try {
        const currentUrls = await getCurrent();
        if (currentUrls?.length) {
          handleUrls(currentUrls);
        }
      } catch {
        // Requires the desktop deep-link plugin and permission.
      }

      try {
        unsubscribeManual = await listen<string[]>("deep_link_from_args", (event) => {
          handleUrls(event.payload);
        });
      } catch {
        // Manual warm-start links are a desktop-only enhancement.
      }

      if (disposed) {
        unsubscribeDeepLink?.();
        unsubscribeManual?.();
      }
    }

    void subscribe();

    return () => {
      disposed = true;
      unsubscribeDeepLink?.();
      unsubscribeManual?.();
    };
  }, [validateToken]);

  const value = useMemo<AuthProviderValue>(
    () => ({
      error,
      isAuthenticated: Boolean(user),
      loading,
      signIn,
      signOut,
      user,
      validateToken
    }),
    [error, loading, signIn, signOut, user, validateToken]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}

function tokenFromDeepLink(urlValue: string) {
  try {
    const normalized = urlValue.replace("autocut://auth/?", "autocut://auth?");
    const url = new URL(normalized);
    const supportedProtocol =
      url.protocol === "quartz-canvas:" || url.protocol === "quartz:" || url.protocol === "autocut:";
    const supportedHost = url.host === "auth" || url.pathname.replace(/^\//, "") === "auth";

    if (!supportedProtocol || !supportedHost) {
      return null;
    }

    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
    return (
      url.searchParams.get("token") ??
      url.searchParams.get("code") ??
      url.searchParams.get("desktopToken") ??
      hashParams.get("token") ??
      hashParams.get("code") ??
      hashParams.get("desktopToken")
    );
  } catch {
    return null;
  }
}
