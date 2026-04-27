import { useState, type FormEvent, type MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AppleLogo,
  CircleNotch,
  EnvelopeSimple,
  GoogleLogo,
  Key,
  Minus,
  WarningCircle,
  X
} from "@phosphor-icons/react";
import { useAuth } from "./AuthContext";

const DESKTOP_E2E = import.meta.env.VITE_DESKTOP_E2E === "1";
const signInLogoUrl = "/logoBig.png";

type AuthGateProps = {
  readonly children: React.ReactNode;
};

export function AuthGate({ children }: AuthGateProps) {
  const { error, isAuthenticated, loading, signIn, validateToken } = useAuth();
  const [manualCode, setManualCode] = useState("");
  const [manualOpen, setManualOpen] = useState(false);

  if (DESKTOP_E2E || isAuthenticated) {
    return <>{children}</>;
  }

  async function submitManualCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await validateToken(manualCode);
  }

  return (
    <div className="fixed inset-0 z-[999] flex h-dvh w-screen overflow-hidden bg-[var(--bg-workspace-main)] font-[var(--font-sans)] text-[13px] text-[var(--text-primary)] antialiased">
      <header
        className="absolute left-0 right-0 top-0 z-20 flex h-10 select-none items-center justify-end px-3"
        data-tauri-drag-region
        onMouseDown={startWindowDrag}
      >
        <div className="h-full min-w-0 flex-1" data-tauri-drag-region />
        <div
          className="flex h-full items-center gap-0.5"
          onDoubleClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            aria-label="Minimize"
            className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--text-muted)] transition-[background-color,color] duration-100 ease-out hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)] focus-visible:bg-[var(--control-bg-hover)] focus-visible:text-[var(--text-primary)] focus-visible:outline-none"
            onClick={() => void getCurrentWindow().minimize().catch(() => undefined)}
            type="button"
          >
            <Minus size={15} weight="regular" />
          </button>
          <button
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--text-muted)] transition-[background-color,color] duration-100 ease-out hover:bg-[var(--danger)]/10 hover:text-[var(--danger)] focus-visible:bg-[var(--danger)]/10 focus-visible:text-[var(--danger)] focus-visible:outline-none"
            onClick={() => void getCurrentWindow().close().catch(() => undefined)}
            type="button"
          >
            <X size={15} weight="regular" />
          </button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 items-center justify-center px-6 pb-8 pt-10">
        {loading ? (
          <div className="flex w-full max-w-[340px] flex-col items-center gap-5">
            <img alt="Quartz Canvas" className="h-8 w-auto opacity-90" draggable={false} src={signInLogoUrl} />
            <CircleNotch className="animate-spin text-[var(--text-muted)]" size={18} weight="regular" />
          </div>
        ) : (
          <section className="flex w-full max-w-[340px] flex-col items-center gap-9">
            <img alt="Quartz Canvas" className="h-8 w-auto opacity-90" draggable={false} src={signInLogoUrl} />

            <div className="flex flex-col items-center gap-2 text-center">
              <h1 className="m-0 text-[32px] font-bold leading-tight tracking-[-0.02em]" style={{ fontFamily: "'Syne', var(--font-sans)" }}>
                Welcome back
              </h1>
              <p className="m-0 text-[14px] leading-5 text-[var(--text-secondary)]">
                Access your projects and workspaces.
              </p>
            </div>

            {error ? (
              <div className="flex w-full items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--danger)]/20 bg-[var(--danger)]/10 px-3 py-2.5 text-[12px] leading-4 text-[var(--danger)]">
                <WarningCircle className="mt-0.5 shrink-0" size={14} weight="regular" />
                <span className="min-w-0">{error}</span>
              </div>
            ) : null}

            {!manualOpen ? (
              <div className="flex w-full flex-col gap-2.5">
                <AuthButton icon={<GoogleLogo size={16} weight="regular" />} label="Continue with Google" onClick={() => void signIn("google")} />
                <AuthButton icon={<AppleLogo size={16} weight="fill" />} label="Continue with Apple" onClick={() => void signIn("apple")} />
                <div className="flex items-center gap-3 py-0.5">
                  <div className="h-px flex-1 bg-[var(--border)]" />
                  <span className="text-[12px] text-[var(--text-muted)]">or</span>
                  <div className="h-px flex-1 bg-[var(--border)]" />
                </div>
                <AuthButton icon={<EnvelopeSimple size={16} weight="regular" />} label="Continue with Email" onClick={() => void signIn("email")} />
                <button
                  className="mt-1 h-7 text-[12px] text-[var(--text-muted)] transition-colors duration-100 ease-out hover:text-[var(--text-primary)] focus-visible:text-[var(--text-primary)] focus-visible:outline-none"
                  onClick={() => setManualOpen(true)}
                  type="button"
                >
                  Trouble signing in? Enter code manually
                </button>
              </div>
            ) : (
              <form className="flex w-full flex-col gap-3" onSubmit={submitManualCode}>
                <label className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]" htmlFor="auth-code">
                  Connection code
                </label>
                <div className="grid h-[46px] grid-cols-[18px_minmax(0,1fr)] items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-5 transition-colors focus-within:border-[var(--accent)]">
                  <Key className="text-[var(--text-muted)]" size={15} weight="regular" />
                  <input
                    autoComplete="one-time-code"
                    autoFocus
                    className="h-full min-w-0 bg-transparent font-mono text-[14px] uppercase tracking-[0.18em] text-[var(--text-primary)] outline-none placeholder:tracking-normal placeholder:text-[var(--text-muted)]"
                    id="auth-code"
                    maxLength={64}
                    onChange={(event) => setManualCode(event.target.value.toUpperCase())}
                    placeholder="Paste code"
                    spellCheck={false}
                    value={manualCode}
                  />
                </div>
                <button
                  className="h-[46px] rounded-full bg-[var(--text-primary)] px-4 text-[14px] font-semibold text-[var(--bg-workspace-main)] transition-[opacity,transform] duration-100 ease-out hover:opacity-90 active:scale-[0.992] disabled:cursor-default disabled:opacity-40 disabled:active:scale-100 focus-visible:outline-none"
                  disabled={!manualCode.trim()}
                  type="submit"
                >
                  Connect
                </button>
                <button
                  className="h-7 text-[12px] text-[var(--text-muted)] transition-colors duration-100 ease-out hover:text-[var(--text-primary)] focus-visible:text-[var(--text-primary)] focus-visible:outline-none"
                  onClick={() => setManualOpen(false)}
                  type="button"
                >
                  Back
                </button>
              </form>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function AuthButton({
  icon,
  label,
  onClick
}: {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      className="grid h-[46px] w-full grid-cols-[18px_minmax(0,1fr)_18px] items-center rounded-full bg-[var(--bg-elevated)] px-4 text-[14px] font-medium tracking-[-0.1px] text-[var(--text-primary)] transition-[background-color,transform] duration-100 ease-out hover:bg-[var(--control-bg-hover)] active:scale-[0.992] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
      onClick={onClick}
      type="button"
    >
      <span className="grid place-items-center text-[var(--text-secondary)]">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function startWindowDrag(event: MouseEvent<HTMLElement>) {
  if (event.button !== 0 || event.detail > 1) {
    return;
  }

  event.preventDefault();
  void getCurrentWindow().startDragging().catch(() => undefined);
}
