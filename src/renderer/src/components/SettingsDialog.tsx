import { useEffect, useState } from "react";
import {
  Check,
  ExternalLink,
  Globe,
  Info,
  KeyRound,
  Loader2,
  LogIn,
  Monitor,
  MonitorPlay,
  Moon,
  Palette,
  Rocket,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import type { AuthFlowEvent, AuthPromptPayload, ProviderInfo } from "@shared/protocol";
import { useAppStore } from "@/stores/app-store";
import type { ThemePreference } from "@/lib/theme";
import { ipcErrorMessage } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { LOCALES } from "@shared/i18n";
import { cn } from "@/lib/cn";

// ---------- OAuth login flow ----------

interface FlowState {
  flowId: string;
  providerId: string;
  status: "running" | "done" | "error";
  messages: string[];
  prompt?: { promptId: string; prompt: AuthPromptPayload };
  error?: string;
}

function OAuthFlowPanel({
  flow,
  onEvent,
  onClose,
}: {
  flow: FlowState;
  onEvent: (updater: (f: FlowState) => FlowState) => void;
  onClose: () => void;
}): React.JSX.Element {
  const t = useT();
  const [input, setInput] = useState("");

  const respond = (value: string): void => {
    if (!flow.prompt) return;
    window.pi.auth.respondToPrompt(flow.flowId, flow.prompt.promptId, value);
    onEvent((f) => ({ ...f, prompt: undefined }));
    setInput("");
  };

  return (
    <div className="fade-up mt-2 rounded-xl border border-accent/30 bg-accent-muted/50 p-3.5">
      <div className="flex items-center gap-2 pb-1">
        {flow.status === "running" && <Loader2 size={13} className="animate-spin text-accent" />}
        {flow.status === "done" && <Check size={13} className="text-success" />}
        {flow.status === "error" && <X size={13} className="text-danger" />}
        <span className="text-xs font-medium">
          {flow.status === "running" && t("settings.loginRunning")}
          {flow.status === "done" && t("settings.loginDone")}
          {flow.status === "error" && t("settings.loginFailed", { error: flow.error ?? "" })}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => {
            if (flow.status === "running") window.pi.auth.cancelLogin(flow.flowId);
            onClose();
          }}
          className="rounded p-0.5 text-fg-muted hover:text-fg"
        >
          <X size={13} />
        </button>
      </div>
      {flow.messages.length > 0 && (
        <div className="selectable space-y-0.5 py-1 text-[11.5px] leading-relaxed text-fg-secondary">
          {flow.messages.slice(-4).map((m, i) => (
            <div key={i}>{m}</div>
          ))}
        </div>
      )}
      {flow.prompt && (
        <div className="pt-1.5">
          <div className="pb-1.5 text-xs text-fg-secondary">{flow.prompt.prompt.message}</div>
          {flow.prompt.prompt.type === "select" ? (
            <div className="space-y-1">
              {flow.prompt.prompt.options?.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => respond(o.id)}
                  className="block w-full rounded-lg border border-border bg-bg px-3 py-2 text-left text-xs transition-colors hover:border-accent/50 hover:bg-bg-hover"
                >
                  <div className="font-medium">{o.label}</div>
                  {o.description && <div className="text-fg-muted">{o.description}</div>}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                autoFocus
                type={flow.prompt.prompt.type === "secret" ? "password" : "text"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && input.trim()) respond(input.trim());
                }}
                placeholder={flow.prompt.prompt.placeholder ?? t("settings.pasteCode")}
                className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-fg outline-none placeholder:text-fg-muted focus:border-accent"
              />
              <button
                type="button"
                onClick={() => input.trim() && respond(input.trim())}
                disabled={!input.trim()}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-40"
              >
                {t("common.submit")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Provider row ----------

function ProviderRow({ provider }: { provider: ProviderInfo }): React.JSX.Element {
  const t = useT();
  const loadCatalog = useAppStore((s) => s.loadCatalog);
  const [expanded, setExpanded] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [flow, setFlow] = useState<FlowState>();

  useEffect(() => {
    if (!flow) return;
    const unsub = window.pi.auth.onFlowEvent((event: AuthFlowEvent) => {
      if (event.flowId !== flow.flowId) return;
      setFlow((f) => {
        if (!f) return f;
        switch (event.kind) {
          case "prompt":
            return { ...f, prompt: { promptId: event.promptId, prompt: event.prompt } };
          case "info":
            return { ...f, messages: [...f.messages, event.message] };
          case "progress":
            return { ...f, messages: [...f.messages, event.message] };
          case "auth_url":
            return {
              ...f,
              messages: [...f.messages, event.instructions ?? t("settings.authOpened")],
            };
          case "device_code":
            return {
              ...f,
              messages: [
                ...f.messages,
                t("settings.deviceCode", { uri: event.verificationUri, code: event.userCode }),
              ],
            };
          case "done":
            void loadCatalog();
            return { ...f, status: "done", prompt: undefined };
          case "error":
            return { ...f, status: "error", error: event.message, prompt: undefined };
        }
      });
    });
    return unsub;
  }, [flow?.flowId, loadCatalog]);

  const save = async (): Promise<void> => {
    if (!key.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      await window.pi.providers.setApiKey(provider.id, key.trim());
      setKey("");
      setExpanded(false);
      await loadCatalog();
    } catch (err) {
      setError(ipcErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await window.pi.providers.removeApiKey(provider.id);
      await loadCatalog();
    } catch (err) {
      setError(ipcErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const startOAuth = async (): Promise<void> => {
    const flowId = await window.pi.auth.startLogin(provider.id);
    setFlow({ flowId, providerId: provider.id, status: "running", messages: [] });
  };

  return (
    <div className="rounded-xl border border-border bg-bg transition-colors hover:border-border-strong">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left"
      >
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            provider.authenticated ? "bg-success" : "bg-border-strong",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-[13px]">{provider.name}</span>
        {provider.auth.includes("oauth") && (
          <span className="rounded-md bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-fg-muted">
            {t("settings.oauthSupported")}
          </span>
        )}
        {provider.authenticated && (
          <span className="text-xs text-fg-muted">{provider.authSource ?? t("common.authenticated")}</span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-border px-3.5 py-3">
          <div className="flex gap-2">
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
              placeholder={
                provider.envVar
                  ? t("settings.apiKeyOrEnv", { env: provider.envVar })
                  : t("settings.apiKey")
              }
              className="min-w-0 flex-1 rounded-lg border border-border bg-bg-input px-2.5 py-1.5 text-xs text-fg outline-none placeholder:text-fg-muted focus:border-accent"
            />
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || !key.trim()}
              className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-40"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              {busy ? t("settings.verifying") : t("common.save")}
            </button>
            {provider.authenticated && (
              <button
                type="button"
                title={t("settings.removeCreds")}
                onClick={() => void remove()}
                disabled={busy}
                className="rounded-lg border border-border px-2 py-1.5 text-fg-muted transition-colors hover:border-danger/50 hover:text-danger disabled:opacity-40"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
          {provider.auth.includes("oauth") && !flow && (
            <button
              type="button"
              onClick={() => void startOAuth()}
              className="mt-2 flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-fg-secondary transition-colors hover:border-accent/50 hover:text-accent"
            >
              <LogIn size={12} />
              {t("settings.oauthLogin")}
            </button>
          )}
          {flow && (
            <OAuthFlowPanel
              flow={flow}
              onEvent={(updater) => setFlow((f) => (f ? updater(f) : f))}
              onClose={() => setFlow(undefined)}
            />
          )}
          {error && <div className="mt-2 text-xs text-danger">{error}</div>}
          {!error && (
            <div className="mt-2 text-[11px] text-fg-muted">{t("settings.keyVerifyHint")}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Tabs ----------

function AuthTab(): React.JSX.Element {
  const t = useT();
  const providers = useAppStore((s) => s.providers);
  return (
    <div>
      <p className="pb-3 text-xs leading-relaxed text-fg-muted">
        {t("settings.authIntro", { path: "\0" }).split("\0")[0]}
        <code className="rounded bg-bg-tertiary px-1">~/.pi/agent/auth.json</code>
        {t("settings.authIntro", { path: "\0" }).split("\0")[1]}
      </p>
      <div className="space-y-2">
        {providers.length === 0 && (
          <div className="py-6 text-center text-xs text-fg-muted">
            <Loader2 size={14} className="mx-auto mb-2 animate-spin" />
            {t("settings.loadingProviders")}
          </div>
        )}
        {providers.map((p) => (
          <ProviderRow key={p.id} provider={p} />
        ))}
      </div>
    </div>
  );
}

function AppearanceTab(): React.JSX.Element {
  const t = useT();
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const locale = useAppStore((s) => s.locale);
  const setLocale = useAppStore((s) => s.setLocale);
  const themeOptions: { id: ThemePreference; label: string; icon: React.ReactNode }[] = [
    { id: "system", label: t("settings.themeSystem"), icon: <Monitor size={16} /> },
    { id: "light", label: t("settings.themeLight"), icon: <Sun size={16} /> },
    { id: "dark", label: t("settings.themeDark"), icon: <Moon size={16} /> },
  ];
  return (
    <div className="space-y-5">
      <div>
        <div className="pb-2 text-xs font-medium text-fg-secondary">{t("settings.theme")}</div>
        <div className="grid grid-cols-3 gap-2">
          {themeOptions.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setTheme(o.id)}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3.5 transition-all",
                theme === o.id
                  ? "border-accent/60 bg-accent-muted text-fg"
                  : "border-border bg-bg text-fg-secondary hover:border-border-strong",
              )}
            >
              {o.icon}
              <span className="text-xs">{o.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="pb-2 text-xs font-medium text-fg-secondary">{t("locale.label")}</div>
        <div className="grid grid-cols-2 gap-2">
          {LOCALES.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setLocale(o.id)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-xl border px-3 py-3.5 transition-all",
                locale === o.id
                  ? "border-accent/60 bg-accent-muted text-fg"
                  : "border-border bg-bg text-fg-secondary hover:border-border-strong",
              )}
            >
              <span className="text-sm font-medium">{o.nativeLabel}</span>
              <span className="text-[11px] text-fg-muted">{o.label}</span>
            </button>
          ))}
        </div>
        <p className="pt-2 text-[11px] leading-relaxed text-fg-muted">{t("locale.hint")}</p>
      </div>
    </div>
  );
}

function SandboxTab(): React.JSX.Element {
  const t = useT();
  const [key, setKey] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void window.pi.config.get().then((c) => {
      setKey(c.e2bApiKey ?? "");
      setLoaded(true);
    });
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-medium">{t("settings.sandboxTitle")}</div>
        <p className="pt-1 text-xs leading-relaxed text-fg-muted">{t("settings.sandboxIntro")}</p>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-fg-secondary">E2B API Key</label>
        <input
          type="password"
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setSaved(false);
          }}
          placeholder="e2b_..."
          disabled={!loaded}
          className="w-full rounded-lg border border-border bg-bg-input px-3 py-2 font-mono text-xs outline-none focus:border-accent/60"
        />
        <p className="text-[11px] text-fg-muted">{t("settings.e2bHint")}</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            void window.pi.config.set({ e2bApiKey: key.trim() || undefined }).then(() => {
              setSaved(true);
              setTimeout(() => setSaved(false), 2500);
            });
          }}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-hover"
        >
          {t("common.save")}
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-success">
            <Check size={12} />
            {t("common.saved")}
          </span>
        )}
      </div>
    </div>
  );
}

function WebTab(): React.JSX.Element {
  const t = useT();
  const [key, setKey] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void window.pi.config.get().then((c) => {
      setKey(c.tavilyApiKey ?? "");
      setLoaded(true);
    });
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-medium">{t("settings.webTitle")}</div>
        <p className="pt-1 text-xs leading-relaxed text-fg-muted">{t("settings.webIntro")}</p>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-fg-secondary">Tavily API Key</label>
        <input
          type="password"
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setSaved(false);
          }}
          placeholder="tvly-..."
          disabled={!loaded}
          className="w-full rounded-lg border border-border bg-bg-input px-3 py-2 font-mono text-xs outline-none focus:border-accent/60"
        />
        <p className="text-[11px] text-fg-muted">{t("settings.tavilyHint")}</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            void window.pi.config.set({ tavilyApiKey: key.trim() || undefined }).then(() => {
              setSaved(true);
              setTimeout(() => setSaved(false), 2500);
            });
          }}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-hover"
        >
          {t("common.save")}
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-success">
            <Check size={12} />
            {t("common.saved")}
          </span>
        )}
      </div>
    </div>
  );
}

function DeployTab(): React.JSX.Element {
  const t = useT();
  const [token, setToken] = useState("");
  const [teamId, setTeamId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void window.pi.config.get().then((c) => {
      setToken(c.vercelToken ?? "");
      setTeamId(c.vercelTeamId ?? "");
      setLoaded(true);
    });
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-medium">{t("settings.deployTitle")}</div>
        <p className="pt-1 text-xs leading-relaxed text-fg-muted">{t("settings.deployIntro")}</p>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-fg-secondary">Vercel Token</label>
        <input
          type="password"
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
            setSaved(false);
          }}
          placeholder="vercel_…"
          disabled={!loaded}
          className="w-full rounded-lg border border-border bg-bg-input px-3 py-2 font-mono text-xs outline-none focus:border-accent/60"
        />
        <p className="text-[11px] text-fg-muted">{t("settings.vercelHint")}</p>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-fg-secondary">{t("settings.teamId")}</label>
        <input
          type="text"
          value={teamId}
          onChange={(e) => {
            setTeamId(e.target.value);
            setSaved(false);
          }}
          placeholder="team_…"
          disabled={!loaded}
          className="w-full rounded-lg border border-border bg-bg-input px-3 py-2 font-mono text-xs outline-none focus:border-accent/60"
        />
        <p className="text-[11px] text-fg-muted">{t("settings.teamHint")}</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            void window.pi.config
              .set({
                vercelToken: token.trim() || undefined,
                vercelTeamId: teamId.trim() || undefined,
              })
              .then(() => {
                setSaved(true);
                setTimeout(() => setSaved(false), 2500);
              });
          }}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-hover"
        >
          {t("common.save")}
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-success">
            <Check size={12} />
            {t("common.saved")}
          </span>
        )}
      </div>
    </div>
  );
}

function AboutTab(): React.JSX.Element {
  const t = useT();
  return (
    <div className="space-y-3 text-[13px] leading-relaxed text-fg-secondary">
      <div>
        <div className="font-serif-display text-lg text-fg">{t("app.name")}</div>
        <div className="text-xs text-fg-muted">{t("settings.aboutVersion")}</div>
      </div>
      <p className="text-xs">
        {t("settings.aboutBody")}{" "}
        <a
          href="https://pi.dev"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 text-accent hover:underline"
        >
          pi.dev <ExternalLink size={10} />
        </a>
      </p>
      <p className="text-xs text-fg-muted">{t("settings.aboutStorage")}</p>
    </div>
  );
}

// ---------- Dialog ----------

const TAB_IDS = ["auth", "sandbox", "web", "deploy", "appearance", "about"] as const;
type TabId = (typeof TAB_IDS)[number];

export function SettingsDialog(): React.JSX.Element | null {
  const t = useT();
  const open = useAppStore((s) => s.settingsOpen);
  const requestedTab = useAppStore((s) => s.settingsTab);
  const setOpen = useAppStore((s) => s.setSettingsOpen);
  const [tab, setTab] = useState<TabId>("auth");

  useEffect(() => {
    if (open && requestedTab && TAB_IDS.includes(requestedTab as TabId)) {
      setTab(requestedTab as TabId);
    }
  }, [open, requestedTab]);
  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: "auth", label: t("settings.tabs.auth"), icon: <KeyRound size={14} /> },
    { id: "sandbox", label: t("settings.tabs.sandbox"), icon: <MonitorPlay size={14} /> },
    { id: "web", label: t("settings.tabs.web"), icon: <Globe size={14} /> },
    { id: "deploy", label: t("settings.tabs.deploy"), icon: <Rocket size={14} /> },
    { id: "appearance", label: t("settings.tabs.appearance"), icon: <Palette size={14} /> },
    { id: "about", label: t("settings.tabs.about"), icon: <Info size={14} /> },
  ];

  if (!open) return null;

  return (
    <div
      className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={() => setOpen(false)}
    >
      <div
        className="dialog-in flex h-[480px] max-h-[80vh] w-[640px] overflow-hidden rounded-2xl border border-border-strong bg-bg-secondary shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left nav */}
        <div className="flex w-40 shrink-0 flex-col border-r border-border bg-bg-tertiary/50 p-2">
          <div className="px-2.5 pb-2 pt-1.5 text-[13px] font-semibold">{t("settings.title")}</div>
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors",
                tab === item.id
                  ? "bg-bg-hover font-medium text-fg"
                  : "text-fg-secondary hover:bg-bg-hover/60",
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-end px-3 pt-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
            >
              <X size={16} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            {tab === "auth" && <AuthTab />}
            {tab === "sandbox" && <SandboxTab />}
            {tab === "web" && <WebTab />}
            {tab === "deploy" && <DeployTab />}
            {tab === "appearance" && <AppearanceTab />}
            {tab === "about" && <AboutTab />}
          </div>
        </div>
      </div>
    </div>
  );
}
