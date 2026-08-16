import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  GitBranch,
  GitFork,
  Loader2,
  MessageSquare,
  Plus,
  ShieldAlert,
  Wrench,
  X,
} from "lucide-react";
import { useAppStore, type ChatState } from "@/stores/app-store";
import { isAssistantMessage, isUserMessage, userMessageText } from "@/lib/pi-messages";
import type { AssistantMessage } from "@/lib/pi-messages";
import { formatCost, formatTokens, shortenPath } from "@/lib/format";
import { useT } from "@/lib/i18n";
import type { Translator } from "@/lib/i18n";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { cn } from "@/lib/cn";

function chatTitle(chat: ChatState, t: Translator): string {
  if (chat.sessionName) return chat.sessionName;
  const firstUser = chat.messages.find(isUserMessage);
  if (firstUser) return userMessageText(firstUser).slice(0, 60) || t("mission.newSession");
  return t("mission.newSession");
}

function lastActivity(chat: ChatState, t: Translator): string {
  if (chat.status === "initializing") return t("mission.starting");
  if (chat.status === "error") return chat.error ?? t("mission.startFailed");
  const runningTool = Object.values(chat.toolRuns).find((r) => r.status === "running");
  if (runningTool) {
    const arg =
      runningTool.toolName === "bash"
        ? String(runningTool.args.command ?? "")
        : String(runningTool.args.path ?? runningTool.args.file_path ?? "");
    return `${runningTool.toolName} ${arg}`.slice(0, 80);
  }
  if (chat.retrying)
    return t("mission.retrying", { attempt: chat.retrying.attempt, max: chat.retrying.maxAttempts });
  if (chat.compacting) return t("mission.compacting");
  if (chat.isStreaming) {
    const last = chat.streaming?.content.at(-1);
    if (last?.type === "thinking") return t("mission.thinking");
    if (last?.type === "text" && last.text) return last.text.slice(-80);
    return t("mission.generating");
  }
  const lastAssistant = [...chat.messages].reverse().find(isAssistantMessage);
  if (lastAssistant) {
    const text = lastAssistant.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join(" ");
    if (text) return text.slice(0, 100);
  }
  return t("mission.waiting");
}

function usage(chat: ChatState): { cost: number; tokens?: number } {
  let cost = 0;
  let tokens: number | undefined;
  for (const m of chat.messages) {
    if (isAssistantMessage(m)) {
      const u = (m as AssistantMessage).usage;
      if (u) {
        cost += u.cost?.total ?? 0;
        tokens = u.totalTokens;
      }
    }
  }
  return { cost, tokens };
}

/**
 * Orphaned worktree branches for the current project (created earlier but not
 * open as a task right now) — reopen them or clean them up.
 */
function WorktreeSection(): React.JSX.Element | null {
  const t = useT();
  const activeProjectPath = useAppStore((s) => s.activeProjectPath);
  const activeProjectIsGit = useAppStore((s) => s.activeProjectIsGit);
  const chats = useAppStore((s) => s.chats);
  const openChat = useAppStore((s) => s.openChat);
  const [worktrees, setWorktrees] = useState<{ path: string; branch: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const openCwds = useMemo(
    () => new Set(Object.values(chats).map((c) => c.cwd)),
    [chats],
  );

  const refresh = useCallback(() => {
    if (!activeProjectPath || !activeProjectIsGit) {
      setWorktrees([]);
      return;
    }
    window.pi.worktrees
      .list(activeProjectPath)
      .then((all) => setWorktrees(all.filter((w) => !w.isMain && w.branch?.startsWith("pi/"))))
      .catch(() => setWorktrees([]));
  }, [activeProjectPath, activeProjectIsGit]);

  useEffect(() => {
    refresh();
  }, [refresh, chats]);

  const orphans = worktrees.filter((w) => !openCwds.has(w.path));
  if (orphans.length === 0) return null;

  return (
    <div className="pt-6">
      <div className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {t("mission.orphanTitle", { n: orphans.length })}
      </div>
      <div className="space-y-1.5">
        {orphans.map((w) => (
          <div
            key={w.path}
            className="flex items-center gap-2.5 rounded-xl border border-border bg-bg px-3.5 py-2.5"
          >
            <GitBranch size={13} className="shrink-0 text-fg-muted" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-secondary">
              {w.branch}
            </span>
            <button
              type="button"
              disabled={busy === w.path}
              onClick={() =>
                void openChat({
                  cwd: w.path,
                  worktree: { branch: w.branch, projectPath: activeProjectPath! },
                })
              }
              className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-[11px] text-fg-secondary transition-colors hover:border-border-strong hover:text-accent"
            >
              {t("mission.continueTask")}
            </button>
            <button
              type="button"
              disabled={busy === w.path}
              onClick={() => {
                setBusy(w.path);
                void window.pi.worktrees
                  .remove(activeProjectPath!, w.path, w.branch)
                  .then(refresh)
                  .finally(() => setBusy(null));
              }}
              className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-[11px] text-fg-muted transition-colors hover:border-danger/40 hover:text-danger disabled:opacity-40"
            >
              {busy === w.path ? <Loader2 size={11} className="animate-spin" /> : t("common.cleanup")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function TaskCard({ chat }: { chat: ChatState }): React.JSX.Element {
  const t = useT();
  const setActiveChat = useAppStore((s) => s.setActiveChat);
  const closeChat = useAppStore((s) => s.closeChat);
  const respondApproval = useAppStore((s) => s.respondApproval);
  const { cost, tokens } = usage(chat);
  const toolCount = Object.keys(chat.toolRuns).length;
  const approval = chat.pendingApprovals[0];
  const runningSubs = Object.values(chat.subagents ?? {}).filter((s) => s.state === "running");
  const ctxPct = chat.contextUsage?.percent;

  return (
    <div
      onClick={() => setActiveChat(chat.chatId)}
      className={cn(
        "group relative flex cursor-pointer flex-col gap-2 rounded-2xl border bg-bg p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg",
        chat.isStreaming
          ? "border-accent/40 shadow-[0_0_0_1px_var(--t-accent-muted)]"
          : "border-border hover:border-border-strong",
      )}
    >
      <div className="flex items-start gap-2">
        <div
          className={cn(
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
            chat.isStreaming ? "bg-accent-muted" : "bg-bg-tertiary",
          )}
        >
          {chat.isStreaming ? (
            <Loader2 size={14} className="animate-spin text-accent" />
          ) : chat.worktree ? (
            <GitBranch size={14} className="text-fg-secondary" />
          ) : (
            <MessageSquare size={14} className="text-fg-secondary" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium leading-snug">{chatTitle(chat, t)}</div>
          <div className="truncate text-[11px] text-fg-muted">
            {chat.worktree ? `⎇ ${chat.worktree.branch}` : shortenPath(chat.cwd)}
          </div>
        </div>
        <button
          type="button"
          title={t("mission.closeTask")}
          onClick={(e) => {
            e.stopPropagation();
            closeChat(chat.chatId);
          }}
          className="hidden shrink-0 rounded-md p-1 text-fg-muted hover:bg-bg-hover hover:text-fg group-hover:block"
        >
          <X size={13} />
        </button>
      </div>

      <div
        className={cn(
          "line-clamp-2 min-h-[2.4em] text-[12px] leading-relaxed",
          chat.isStreaming ? "text-fg-secondary" : "text-fg-muted",
        )}
      >
        {lastActivity(chat, t)}
      </div>

      {approval && (
        <div className="flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-2.5 py-1.5">
          <ShieldAlert size={13} className="shrink-0 text-warning" />
          <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-fg-secondary">
            {approval.toolName}{" "}
            {String(
              (approval.input as { command?: string }).command ?? JSON.stringify(approval.input),
            ).slice(0, 60)}
          </span>
          <button
            type="button"
            title={t("mission.approve")}
            onClick={(e) => {
              e.stopPropagation();
              respondApproval(chat.chatId, approval.id, true);
            }}
            className="shrink-0 rounded-md bg-accent p-1 text-accent-fg hover:bg-accent-hover"
          >
            <Check size={11} />
          </button>
          <button
            type="button"
            title={t("mission.reject")}
            onClick={(e) => {
              e.stopPropagation();
              respondApproval(chat.chatId, approval.id, false);
            }}
            className="shrink-0 rounded-md border border-border p-1 text-fg-secondary hover:text-danger"
          >
            <X size={11} />
          </button>
        </div>
      )}

      {runningSubs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {runningSubs.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1 rounded-lg bg-accent-muted px-1.5 py-0.5 text-[10px] text-accent"
            >
              <GitFork size={9} />
              {s.name} · {t("mission.turns", { n: s.turns })}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 text-[11px] text-fg-muted">
        {chat.model && <span className="truncate">{chat.model.name}</span>}
        {toolCount > 0 && (
          <span className="flex shrink-0 items-center gap-1">
            <Wrench size={10} />
            {toolCount}
          </span>
        )}
        {tokens !== undefined && <span className="shrink-0">{formatTokens(tokens)}</span>}
        {cost > 0 && <span className="shrink-0">{formatCost(cost)}</span>}
        {typeof ctxPct === "number" && (
          <span className="flex shrink-0 items-center gap-1" title={t("mission.contextUsage", { pct: ctxPct.toFixed(0) })}>
            <span className="h-1 w-8 overflow-hidden rounded-full bg-bg-hover">
              <span
                className={cn(
                  "block h-full rounded-full",
                  ctxPct >= 85 ? "bg-danger" : ctxPct >= 60 ? "bg-warning" : "bg-accent",
                )}
                style={{ width: `${Math.min(ctxPct, 100)}%` }}
              />
            </span>
            {ctxPct.toFixed(0)}%
          </span>
        )}
        <span className="flex-1" />
        <ArrowRight
          size={12}
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        />
      </div>
    </div>
  );
}

export function MissionControl(): React.JSX.Element {
  const t = useT();
  const appMode = useAppStore((s) => s.appMode);
  const chats = useAppStore((s) => s.chats);
  const chatOrder = useAppStore((s) => s.chatOrder);
  const activeProjectIsGit = useAppStore((s) => s.activeProjectIsGit);
  const showWelcome = useAppStore((s) => s.showWelcome);
  const openWorktreeChat = useAppStore((s) => s.openWorktreeChat);
  const isDaily = appMode === "daily";

  const list = useMemo(
    () => chatOrder.map((id) => chats[id]).filter((c) => c?.kind === appMode),
    [chats, chatOrder, appMode],
  );

  if (list.length === 0) return <WelcomeScreen />;

  const running = list.filter((c) => c.isStreaming).length;
  const approvals = list.reduce((n, c) => n + c.pendingApprovals.length, 0);
  const subs = list.reduce(
    (n, c) => n + Object.values(c.subagents ?? {}).filter((s) => s.state === "running").length,
    0,
  );
  const totalCost = list.reduce((n, c) => n + usage(c).cost, 0);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl px-8 pb-10">
        <div className="flex items-end justify-between pb-5 pt-2">
          <div>
            <h1 className="font-serif-display text-[26px] leading-tight">
              {isDaily ? t("mission.overviewChat") : t("mission.overviewTask")}
            </h1>
            <p className="pt-0.5 text-xs text-fg-muted">
              {isDaily ? t("mission.countChat", { n: list.length }) : t("mission.countTask", { n: list.length })}
              {running > 0 ? ` · ${t("mission.running", { n: running })}` : ` · ${t("mission.allIdle")}`}
              {!isDaily && subs > 0 ? ` · ${t("mission.subagents", { n: subs })}` : ""}
              {approvals > 0 ? ` · ${t("mission.pending", { n: approvals })}` : ""}
              {totalCost > 0 ? ` · ${t("mission.totalCost", { cost: formatCost(totalCost) })}` : ""}
            </p>
          </div>
          <div className="flex gap-2">
            {!isDaily && activeProjectIsGit && (
              <button
                type="button"
                onClick={() => void openWorktreeChat()}
                className="flex items-center gap-1.5 rounded-xl border border-border bg-bg px-3 py-2 text-xs text-fg-secondary transition-colors hover:border-border-strong hover:text-accent"
              >
                <GitBranch size={13} />
                {t("mission.parallel")}
              </button>
            )}
            <button
              type="button"
              onClick={showWelcome}
              className="flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover"
            >
              <Plus size={13} />
              {isDaily ? t("sidebar.newChat") : t("sidebar.newTask")}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {list.map((chat) => (
            <TaskCard key={chat.chatId} chat={chat} />
          ))}
        </div>

        {!isDaily && <WorktreeSection />}
      </div>
    </div>
  );
}
