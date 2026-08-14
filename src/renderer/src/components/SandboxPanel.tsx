/**
 * 云端虚拟机面板：执行世界开关（bash/read/write/edit 的后端在本机与
 * 云端 VM 间热切换，工具名不变）+ E2B 桌面流。无论当前世界是哪边，
 * 面板始终反映 VM 的真实状态——本机世界下也能看到还在跑的 VM。
 * 本机终端在底部抽屉（TerminalDrawer），与这里完全分离。
 */
import { HardDrive, KeyRound, Loader2, Monitor, Power, RefreshCw, Trash2, X } from "lucide-react";
import { useAppStore, type ChatState } from "@/stores/app-store";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";

function WorldSwitch({ chat }: { chat: ChatState }): React.JSX.Element {
  const t = useT();
  const setExecutionWorld = useAppStore((s) => s.setExecutionWorld);
  const world = chat.executionWorld ?? "local";
  const noKey = chat.sandbox === undefined;
  const worlds = [
    { id: "local" as const, label: t("sandbox.local"), icon: HardDrive },
    { id: "vm" as const, label: t("sandbox.vm"), icon: Monitor },
  ];
  return (
    <div className="flex items-center gap-2 border-b border-border/40 px-3.5 py-2">
      <span className="text-[11px] text-fg-muted">{t("sandbox.world")}</span>
      <div className="flex overflow-hidden rounded-lg border border-border">
        {worlds.map(({ id, label, icon: Icon }) => {
          const disabled = id === "vm" && noKey;
          return (
            <button
              key={id}
              type="button"
              disabled={disabled}
              title={disabled ? t("sandbox.needKey") : undefined}
              onClick={() => setExecutionWorld(chat.chatId, id)}
              className={cn(
                "flex items-center gap-1 px-2 py-1 text-[11px] transition-colors",
                world === id
                  ? "bg-accent text-accent-fg"
                  : "text-fg-muted hover:bg-bg-hover hover:text-fg-secondary",
                disabled && "cursor-not-allowed opacity-45 hover:bg-transparent hover:text-fg-muted",
              )}
            >
              <Icon size={11} />
              {label}
            </button>
          );
        })}
      </div>
      <span className="min-w-0 flex-1 truncate text-right text-[10.5px] text-fg-muted">
        {world === "vm" ? t("sandbox.vmHint") : t("sandbox.localHint")}
      </span>
    </div>
  );
}

export function SandboxPanel({ chat }: { chat: ChatState }): React.JSX.Element {
  const t = useT();
  const setSandboxOpen = useAppStore((s) => s.setSandboxOpen);
  const createSandbox = useAppStore((s) => s.createSandbox);
  const destroySandbox = useAppStore((s) => s.destroySandbox);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);

  const sb = chat.sandbox;
  const noKey = sb === undefined;

  return (
    <div className="flex w-[420px] shrink-0 flex-col bg-transparent">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/40 px-3.5">
        <Monitor size={14} className="text-fg-muted" />
        <span className="flex-1 text-[13px] font-medium">{t("chat.sandbox")}</span>
        {sb?.status === "running" && (
          <span className="flex items-center gap-1.5 rounded-md bg-success/10 px-1.5 py-0.5 text-[10.5px] text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            {t("common.running")}
          </span>
        )}
        <button
          type="button"
          title={t("sandbox.refresh")}
          onClick={() => window.pi.chat.command(chat.chatId, { type: "sandbox_status" })}
          className="rounded-md p-1 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-secondary"
        >
          <RefreshCw size={12.5} />
        </button>
        <button
          type="button"
          title={t("common.close")}
          onClick={() => setSandboxOpen(chat.chatId, false)}
          className="rounded-md p-1 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-secondary"
        >
          <X size={13} />
        </button>
      </div>

      <WorldSwitch chat={chat} />

      <div className="flex min-h-0 flex-1 flex-col">
        {noKey && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
            <KeyRound size={26} className="text-fg-muted" />
            <div className="text-sm font-medium">{t("sandbox.needKey")}</div>
            <p className="text-xs leading-relaxed text-fg-muted">{t("settings.sandboxIntro")}</p>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="rounded-xl bg-accent px-3.5 py-2 text-xs font-medium text-accent-fg hover:bg-accent-hover"
            >
              {t("sandbox.goSettings")}
            </button>
            <a
              href="https://e2b.dev"
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-accent hover:underline"
            >
              {t("sandbox.getKey")}
            </a>
          </div>
        )}

        {sb?.status === "none" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
            <Monitor size={26} className="text-fg-muted" />
            <div className="text-sm font-medium">{t("sandbox.notStarted")}</div>
            <p className="text-xs leading-relaxed text-fg-muted">{t("sandbox.autoStart")}</p>
            <button
              type="button"
              onClick={() => createSandbox(chat.chatId)}
              className="flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-xs font-medium text-accent-fg hover:bg-accent-hover"
            >
              <Power size={13} />
              {t("sandbox.start")}
            </button>
          </div>
        )}

        {sb?.status === "creating" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <Loader2 size={24} className="animate-spin text-accent" />
            <div className="text-xs text-fg-muted">{t("sandbox.creating")}</div>
          </div>
        )}

        {sb?.status === "error" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
            <div className="text-sm font-medium text-danger">{t("sandbox.startFailed")}</div>
            <p className="selectable max-w-full break-all text-xs leading-relaxed text-fg-muted">
              {sb.message}
            </p>
            <button
              type="button"
              onClick={() => createSandbox(chat.chatId)}
              className="rounded-xl border border-border px-3 py-1.5 text-xs text-fg-secondary hover:border-border-strong"
            >
              {t("common.retry")}
            </button>
          </div>
        )}

        {sb?.status === "running" && (
          <>
            {sb.streamUrl ? (
              <div className="relative min-h-0 flex-1 bg-black">
                <webview
                  key={sb.streamUrl}
                  src={sb.streamUrl}
                  allowpopups={true}
                  partition="persist:e2b-vm"
                  className="absolute inset-0 h-full w-full"
                />
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
                <Loader2 size={20} className="animate-spin text-accent" />
                <div className="text-xs text-fg-muted">{t("sandbox.streamConnecting")}</div>
              </div>
            )}
            <div className="flex items-center gap-2 border-t border-border px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-fg-muted">
                {sb.sandboxId}
              </span>
              {sb.streamUrl && (
                <a
                  href={sb.streamUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-border px-2 py-1 text-[11px] text-fg-secondary hover:border-border-strong"
                >
                  {t("sandbox.openBrowser")}
                </a>
              )}
              <button
                type="button"
                onClick={() => destroySandbox(chat.chatId)}
                className="flex items-center gap-1 rounded-lg border border-danger/30 px-2 py-1 text-[11px] text-danger hover:bg-danger/10"
              >
                <Trash2 size={11} />
                {t("sandbox.destroy")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
