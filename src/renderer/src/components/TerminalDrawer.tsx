/**
 * 底部终端抽屉（Cursor 式）：横跨聊天区底部。
 * - Agent tab：agent 命令的常驻 shell（真实 zsh，可键入接管/直接使用）
 * - 终端 N：用户自己的 PTY shell，可开任意多个
 * - 右侧：本机命令沙箱（seatbelt）三档开关
 * 云端 VM 是独立的右侧面板（SandboxPanel），与这里完全分离。
 */
import { useEffect } from "react";
import { Bot, Eraser, Plus, Shield, X } from "lucide-react";
import type { LocalSandboxMode } from "@shared/protocol";
import { useAppStore, type ChatState } from "@/stores/app-store";
import { LocalTerminal } from "@/components/LocalTerminal";
import { UserTerminal } from "@/components/UserTerminal";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";

/** 本机命令沙箱（macOS seatbelt）三档开关：关闭 / 限写工作区 / 严格。 */
function SandboxModeSwitch({ chat }: { chat: ChatState }): React.JSX.Element | null {
  const t = useT();
  const setLocalSandbox = useAppStore((s) => s.setLocalSandbox);
  if (window.pi.system.platform !== "darwin") return null;
  const mode = chat.localSandbox ?? "off";
  const modes: { id: LocalSandboxMode; label: string }[] = [
    { id: "off", label: t("sandbox.modeOff") },
    { id: "workspace", label: t("sandbox.modeWorkspace") },
    { id: "strict", label: t("sandbox.modeStrict") },
  ];
  return (
    <div className="flex items-center gap-1.5" title={t(`sandbox.modeHint_${mode}`)}>
      <Shield size={11} className="text-fg-muted" />
      <div className="flex overflow-hidden rounded-md border border-border">
        {modes.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setLocalSandbox(chat.chatId, id)}
            className={cn(
              "px-1.5 py-0.5 text-[10.5px] transition-colors",
              mode === id
                ? "bg-accent text-accent-fg"
                : "text-fg-muted hover:bg-bg-hover hover:text-fg-secondary",
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function TerminalDrawer({ chat }: { chat: ChatState }): React.JSX.Element {
  const t = useT();
  const setTermOpen = useAppStore((s) => s.setTermOpen);
  const clearLocalTerm = useAppStore((s) => s.clearLocalTerm);
  const addUserTerminal = useAppStore((s) => s.addUserTerminal);
  const ensureUserTerminal = useAppStore((s) => s.ensureUserTerminal);
  const removeUserTerminal = useAppStore((s) => s.removeUserTerminal);
  const setLocalTab = useAppStore((s) => s.setLocalTab);

  const userTerms = chat.userTerms ?? [];
  /** Agent tab 只在 agent 真正在本机跑过命令后才出现 */
  const agentUsed = Boolean(chat.agentTermUsed);
  /** agent 是否正在跑命令（bash / code_run 工具，或用户 ! 直跑） */
  const agentBusy =
    chat.bashRunning ||
    Object.values(chat.toolRuns).some(
      (r) => r.status === "running" && (r.toolName === "bash" || r.toolName === "code_run"),
    );

  // 存储的 tab 可能还不可见（agent 未用过 / 终端已关闭），回落到可用项
  const stored = chat.localTab;
  const localTab =
    stored && (stored === "agent" ? agentUsed : userTerms.includes(stored))
      ? stored
      : (userTerms[0] ?? (agentUsed ? "agent" : undefined));

  // 打开抽屉时若一个终端都没有，自动建一个（Cursor 行为）。
  // ensureUserTerminal 自带幂等判断，StrictMode 双跑不会建出两个。
  const empty = userTerms.length === 0 && !agentUsed;
  useEffect(() => {
    if (empty) ensureUserTerminal(chat.chatId);
  }, [empty, chat.chatId, ensureUserTerminal]);

  return (
    <div className="flex h-[280px] shrink-0 flex-col border-t border-border/40 bg-bg">
      <div className="flex shrink-0 items-center gap-1 border-b border-border/40 px-3 py-1.5">
        {userTerms.map((termId, i) => (
          <span
            key={termId}
            className={cn(
              "group flex shrink-0 items-center rounded-md transition-colors",
              localTab === termId ? "bg-bg-hover" : "hover:bg-bg-hover/50",
            )}
          >
            <button
              type="button"
              onClick={() => setLocalTab(chat.chatId, termId)}
              className={cn(
                "py-0.5 pl-2 pr-1 text-[11px]",
                localTab === termId
                  ? "font-medium text-fg"
                  : "text-fg-muted hover:text-fg-secondary",
              )}
            >
              {t("sandbox.termN", { n: i + 1 })}
            </button>
            <button
              type="button"
              title={t("common.close")}
              onClick={() => removeUserTerminal(chat.chatId, termId)}
              className="rounded p-0.5 pr-1 text-fg-muted opacity-0 transition-opacity hover:text-fg group-hover:opacity-100"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        {agentUsed && (
          <button
            type="button"
            title={agentBusy ? t("sandbox.agentBusy") : t("sandbox.agentTabTitle")}
            onClick={() => setLocalTab(chat.chatId, "agent")}
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11px] transition-colors",
              localTab === "agent"
                ? "bg-accent/15 font-medium text-accent"
                : "text-fg-muted hover:text-fg-secondary",
            )}
          >
            <Bot size={11} className={localTab === "agent" ? "text-accent" : undefined} />
            {t("sandbox.tabAgent")}
            {agentBusy && (
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
              </span>
            )}
          </button>
        )}
        <button
          type="button"
          title={t("sandbox.newTerm")}
          onClick={() => addUserTerminal(chat.chatId)}
          className="shrink-0 rounded-md p-1 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-secondary"
        >
          <Plus size={12} />
        </button>

        <div className="flex-1" />

        <SandboxModeSwitch chat={chat} />
        {localTab === "agent" && (
          <button
            type="button"
            title={t("sandbox.clearTerm")}
            onClick={() => clearLocalTerm(chat.chatId)}
            className="rounded-md p-1 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-secondary"
          >
            <Eraser size={12} />
          </button>
        )}
        <button
          type="button"
          title={t("common.close")}
          onClick={() => setTermOpen(chat.chatId, false)}
          className="rounded-md p-1 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-secondary"
        >
          <X size={12.5} />
        </button>
      </div>

      {localTab === "agent" ? (
        <LocalTerminal
          chatId={chat.chatId}
          chunks={chat.localTerm ?? []}
          placeholder={t("sandbox.termEmpty")}
        />
      ) : localTab ? (
        <UserTerminal key={localTab} chatId={chat.chatId} termId={localTab} cwd={chat.cwd} />
      ) : (
        <div className="flex-1" />
      )}
    </div>
  );
}
