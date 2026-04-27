import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AuthGate } from "./auth/AuthGate";
import { readStoredThemeMode, setDocumentThemeMode } from "./styles/theme";
import { WorkspaceLayout } from "./workspace";

export function App() {
  useEffect(() => {
    setDocumentThemeMode(readStoredThemeMode());
    try {
      void getCurrentWindow().emit("quartz-canvas:app-ready");
    } catch {
      // Browser builds and pre-window startup do not expose the Tauri window.
    }
  }, []);

  return (
    <AuthGate>
      <WorkspaceLayout />
    </AuthGate>
  );
}
