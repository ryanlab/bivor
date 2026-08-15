import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Cpu,
  FileJson,
  GitBranch,
  GitCompareArrows,
  Loader2,
  Monitor,
  Search,
  SquareTerminal,
  X,
} from "lucide-react";
import { ApprovalCard } from "@/components/ApprovalCard";
import { HarnessCanvas } from "@/components/HarnessCanvas";
import { SandboxPanel } from "@/components/SandboxPanel";
import { TerminalDrawer } from "@/components/TerminalDrawer";
import { useAppStore, type ChatState } from "@/stores/app-store";
import type { AssistantMessage } from "@/lib/pi-messages";
import { isAssistantMessage } from "@/lib/pi-messages";
import { formatCost, formatTokens, shortenPath } from "@/lib/format";
import { MessageList } from "@/components/messages/MessageList";
import { Composer } from "@/components/Composer";
import { ChangesPanel, collectChanges } from "@/components/ChangesPanel";
import { WorktreeMergePanel } from "@/components/WorktreeMergePanel";
import { TreePanel } from "@/components/TreePanel";
import { Titlebar, WindowChrome, CollapsedTitlebar } from "@/components/WindowChrome";
import { cn } from "@/lib/cn";
import { Switch } from "@/components/Switch";
import { ShieldQuestion } from "lucide-react";
import { getRuntimePreset } from "@shared/runtime-presets";
import { useT } from "@/lib/i18n";

/**
 * Project trust gate: shown while session init is blocked on whether to load
 * project-local extensions/skills (.pi 目录可执行代码，恶意仓库可借此注入)。
 */
function TrustCard({ chat }: { chat: ChatState }): React.JSX.Element {
  const t = useT();
  const respondTrust = useAppStore((s) => s.respondTrust);
  const req = chat.trustRequest!;
  return (
    <div className="flex flex-1 items-center justify-center px-8">
      <div className="dialog-in w-[440px] rounded-2xl border border-border-strong bg-bg-secondary p-5 shadow-xl">
        <div className="flex items-center gap-2 pb-2">
          <ShieldQuestion size={17} className="text-warning" />
          <span className="text-sm font-medium">{t("trust.title")}</span>
        </div>
        <p className="text-xs leading-relaxed text-fg-secondary">
          <span className="font-mono text-fg">{shortenPath(req.cwd)}</span>{" "}
          {t("trust.body")}
        </p>
        {req.resources.length > 0 && (
          <div className="mt-2.5 max-h-28 overflow-y-auto rounded-lg border border-border bg-bg px-2.5 py-2">
            {req.resources.map((r) => (
              <div key={r} className="truncate font-mono text-[10.5px] text-fg-muted">
                {r.startsWith(req.cwd) ? r.slice(req.cwd.length + 1) : r}
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => respondTrust(chat.chatId, true, true)}
            className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover"
          >
            {t("trust.remember")}
          </button>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => respondTrust(chat.chatId, true, false)}
              className="flex-1 rounded-lg border border-border px-3 py-2 text-xs text-fg-secondary transition-colors hover:bg-bg-hover"
            >
              {t("trust.once")}
            </button>
            <button
              type="button"
              onClick={() => respondTrust(chat.chatId, false, false)}
              className="flex-1 rounded-lg border border-border px-3 py-2 text-xs text-fg-secondary transition-colors hover:border-danger/40 hover:text-danger"
            >
              {t("trust.deny")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function usageSummary(chat: ChatState): { cost: number } {
  let cost = 0;
  for (const m of chat.messages) {
    if (isAssistantMessage(m)) {
      const usage = (m as AssistantMessage).usage;
      if (usage) cost += usage.cost?.total ?? 0;
    }
  }
  return { cost };
}

/** Plain text of a message, for in-session search. */
function messageText(m: unknown): string {
  const msg = m as { role?: string; content?: unknown; command?: string; output?: string };
  if (msg.role === "toolResult") return "";
  if (msg.role === "bashExecution") return `${msg.command ?? ""} ${msg.output ?? ""}`;
  const c = msg.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .filter((b): b is { type: string; text: string } => (b as { type?: string }).type === "text")
      .map((b) => b.text)
      .join("\n");
  }
  return "";
}

/** In-session search bar (Cmd+F): message-level hit navigation. */
function SearchBar({
  chat,
  onTarget,
  onClose,
}: {
  chat: ChatState;
  onTarget: (idx: number | null) => void;
  onClose: () => void;
}): React.JSX.Element {
  const t = useT();
  const [query, setQuery] = useState("");
  const [cur, setCur] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: number[] = [];
    chat.messages.forEach((m, i) => {
      if (messageText(m).toLowerCase().includes(q)) out.push(i);
    });
    return out;
  }, [query, chat.messages]);

  useEffect(() => {
    setCur(0);
    onTarget(hits.length > 0 ? hits[0] : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits]);

  const go = (dir: 1 | -1): void => {
    if (hits.length === 0) return;
    const next = (cur + dir + hits.length) % hits.length;
    setCur(next);
    onTarget(hits[next]);
  };

  return (
    <div className="dialog-in absolute right-4 top-2 z-40 flex items-center gap-1 rounded-xl border border-border-strong bg-bg px-2 py-1.5 shadow-xl">
      <Search size={13} className="shrink-0 text-fg-muted" />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") go(e.shiftKey ? -1 : 1);
          if (e.key === "Escape") onClose();
        }}
        placeholder={t("chat.searchPlaceholder")}
        className="w-44 bg-transparent text-xs outline-none placeholder:text-fg-muted"
      />
      <span className="shrink-0 tabular-nums text-[10.5px] text-fg-muted">
        {hits.length > 0 ? `${cur + 1}/${hits.length}` : query ? "0" : ""}
      </span>
      <button
        type="button"
        onClick={() => go(-1)}
        disabled={hits.length === 0}
        className="rounded p-0.5 text-fg-muted hover:bg-bg-hover disabled:opacity-30"
      >
        <ChevronUp size={13} />
      </button>
      <button
        type="button"
        onClick={() => go(1)}
        disabled={hits.length === 0}
        className="rounded p-0.5 text-fg-muted hover:bg-bg-hover disabled:opacity-30"
      >
        <ChevronDown size={13} />
      </button>
      <button
        type="button"
        onClick={onClose}
        className="rounded p-0.5 text-fg-muted hover:bg-bg-hover hover:text-fg"
      >
        <X size={13} />
      </button>
    </div>
  );
}

/**
 * Context-window gauge: a live SVG ring fed by the SDK's getContextUsage()
 * (accurate across compactions, unlike summing message usage). Opens a popover
 * with exact numbers, the auto-compaction switch, and one-click compaction.
 */
function ContextGauge({ chat }: { chat: ChatState }): React.JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const requestContext = useAppStore((s) => s.requestContext);
  const setAutoCompaction = useAppStore((s) => s.setAutoCompaction);
  const compact = useAppStore((s) => s.compact);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    requestContext(chat.chatId);
    const onClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open, chat.chatId, requestContext]);

  const usage = chat.contextUsage;
  const pct = usage?.percent ?? null;
  const tone =
    pct === null ? "var(--t-fg-muted)" : pct >= 85 ? "var(--t-danger)" : pct >= 60 ? "var(--t-warning)" : "var(--t-accent)";
  const R = 5.5;
  const C = 2 * Math.PI * R;
  const dash = pct === null ? 0 : (Math.min(100, pct) / 100) * C;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title={t("chat.contextTitle")}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "no-drag flex items-center gap-1.5 rounded-md p-1.5 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-secondary",
          open && "bg-bg-hover text-fg",
        )}
      >
        {chat.compacting ? (
          <Loader2 size={14} className="animate-spin text-accent" />
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" className="-rotate-90">
            <circle cx="7" cy="7" r={R} fill="none" stroke="var(--t-border-strong)" strokeWidth="2" />
            {pct !== null && (
              <circle
                cx="7"
                cy="7"
                r={R}
                fill="none"
                stroke={tone}
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={`${dash} ${C - dash}`}
                className="transition-all duration-500"
              />
            )}
          </svg>
        )}
        {pct !== null && <span className="text-[11px] tabular-nums">{Math.round(pct)}%</span>}
      </button>
      {open && (
        <div className="dialog-in absolute right-0 top-full z-50 mt-1.5 w-72 rounded-xl border border-border-strong bg-bg p-3 shadow-2xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">{t("chat.contextWindow")}</span>
            {usage?.tokens != null && usage.contextWindow > 0 && (
              <span className="font-mono text-[11px] text-fg-secondary">
                {formatTokens(usage.tokens)} / {formatTokens(usage.contextWindow)}
              </span>
            )}
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-hover">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, pct ?? 0)}%`, background: tone }}
            />
          </div>
          {usage?.tokens == null && (
            <div className="pt-2 text-[11px] leading-relaxed text-fg-muted">
              {t("chat.contextEmpty")}
            </div>
          )}
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-fg-secondary">{t("chat.autoCompact")}</span>
            <Switch
              on={chat.autoCompaction ?? true}
              onClick={() => setAutoCompaction(chat.chatId, !(chat.autoCompaction ?? true))}
            />
          </div>
          <button
            type="button"
            disabled={chat.isStreaming || chat.compacting}
            onClick={() => {
              compact(chat.chatId);
              setOpen(false);
            }}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-fg-secondary transition-colors hover:border-border-strong hover:text-fg disabled:opacity-40"
          >
            <Archive size={12} />
            {chat.compacting ? t("chat.compacting") : t("chat.compactNow")}
          </button>
          <p className="pt-2 text-[10.5px] leading-relaxed text-fg-muted">
            {t("chat.compactHint")}
          </p>
        </div>
      )}
    </div>
  );
}

function StatsPopover({ chat }: { chat: ChatState }): React.JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const requestStats = useAppStore((s) => s.requestStats);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    requestStats(chat.chatId);
    const onClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open, chat.chatId, requestStats]);

  const s = chat.stats;
  const rows: [string, string][] = s
    ? [
        [t("chat.messages"), t("chat.qa", { q: s.userMessages, a: s.assistantMessages })],
        [t("chat.toolCalls"), String(s.toolCalls)],
        [t("chat.inputTokens"), formatTokens(s.tokens.input)],
        [t("chat.outputTokens"), formatTokens(s.tokens.output)],
        [t("chat.cacheRead"), formatTokens(s.tokens.cacheRead)],
        [t("chat.totalTokens"), formatTokens(s.tokens.total)],
        [t("chat.totalCost"), formatCost(s.cost)],
        ...(s.contextTokens && s.contextWindow
          ? ([
              [
                t("chat.currentContext"),
                `${formatTokens(s.contextTokens)} / ${formatTokens(s.contextWindow)} (${Math.round((s.contextTokens / s.contextWindow) * 100)}%)`,
              ],
            ] as [string, string][])
          : []),
      ]
    : [];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title={t("chat.statsTitle")}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "no-drag rounded-md p-1.5 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-secondary",
          open && "bg-bg-hover text-fg",
        )}
      >
        <BarChart3 size={14} />
      </button>
      {open && (
        <div className="dialog-in absolute right-0 top-full z-50 mt-1.5 w-64 rounded-xl border border-border-strong bg-bg p-1 shadow-2xl">
          <div className="px-2.5 py-1.5 text-xs font-medium">{t("chat.statsAll")}</div>
          {!s && <div className="px-2.5 py-3 text-xs text-fg-muted">{t("common.loading")}</div>}
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="flex items-center justify-between px-2.5 py-1 text-xs"
            >
              <span className="text-fg-muted">{label}</span>
              <span className="font-mono text-fg-secondary">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatView({ chat }: { chat: ChatState }): React.JSX.Element {
  const t = useT();
  const setTreeOpen = useAppStore((s) => s.setTreeOpen);
  const setHarnessOpen = useAppStore((s) => s.setHarnessOpen);
  const setSandboxOpen = useAppStore((s) => s.setSandboxOpen);
  const setTermOpen = useAppStore((s) => s.setTermOpen);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const [showChanges, setShowChanges] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTarget, setSearchTarget] = useState<number | null>(null);
  const { cost } = useMemo(() => usageSummary(chat), [chat]);
  const changeCount = useMemo(() => collectChanges(chat).length, [chat]);
  /** agent 正在本机跑命令时，终端按钮亮起提示 */
  const agentBusy =
    chat.bashRunning ||
    Object.values(chat.toolRuns).some(
      (r) => r.status === "running" && (r.toolName === "bash" || r.toolName === "code_run"),
    );

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const firstUser = chat.messages.find((m) => m.role === "user");
  const firstUserText =
    firstUser && typeof (firstUser as { content?: unknown }).content === "string"
      ? ((firstUser as { content: string }).content as string)
      : undefined;
  const title = chat.sessionName || firstUserText?.slice(0, 60) || (chat.kind === "daily" ? t("chat.newChat") : t("chat.newSession"));
  const isDaily = chat.kind === "daily";
  const preset = getRuntimePreset(chat.presetId, chat.kind);
  const ui = preset.ui;

  if (chat.status === "initializing") {
    if (chat.trustRequest) {
      return (
        <div className="flex min-w-0 flex-1 flex-col">
          <CollapsedTitlebar />
          <TrustCard chat={chat} />
        </div>
      );
    }
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <CollapsedTitlebar />
        <div className="flex flex-1 items-center justify-center gap-2 text-fg-muted">
          <Loader2 size={16} className="animate-spin" />
          {chat.kind === "daily" ? t("chat.startingChat") : t("chat.startingAgent")}
        </div>
      </div>
    );
  }

  if (chat.status === "error") {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <CollapsedTitlebar />
        <div className="flex flex-1 items-center justify-center px-8">
          <div className="max-w-md rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {chat.error ?? (chat.kind === "daily" ? t("chat.startChatFailed") : t("chat.startAgentFailed"))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* Header */}
      <Titlebar className="gap-2 pr-4">
        {sidebarCollapsed && <WindowChrome trafficLights />}
        <div className={cn("min-w-0 flex-1", sidebarCollapsed ? "pl-1" : "pl-5")}>
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-medium">{title}</span>
            {preset.id !== "coding" && preset.id !== "daily" && (
              <span
                title={preset.description}
                className="shrink-0 rounded-full bg-accent-muted px-2 py-0.5 text-[10.5px] text-accent"
              >
                {preset.id === "daily" || preset.id === "coding" || preset.id === "review" || preset.id === "minimal"
                  ? t(`preset.${preset.id}`)
                  : preset.name}
              </span>
            )}
            {chat.executionWorld === "vm" && (
              <span
                title={t("chat.vmTitle")}
                className="shrink-0 rounded-full bg-info/15 px-2 py-0.5 text-[10.5px] text-info"
              >
                {t("chat.vmBadge")}
              </span>
            )}
            {chat.worktree && <WorktreeMergePanel chat={chat} />}
            {!isDaily && (
              <span className="truncate text-xs text-fg-muted">{shortenPath(chat.cwd)}</span>
            )}
          </div>
        </div>
        {cost > 0 && <span className="text-xs text-fg-muted">{formatCost(cost)}</span>}
        <ContextGauge chat={chat} />
        {ui.changes && (
          <button
            type="button"
            title={t("chat.changes")}
            onClick={() => setShowChanges((v) => !v)}
            className={cn(
              "no-drag flex items-center gap-1 rounded-md p-1.5 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-secondary",
              showChanges && "bg-bg-hover text-fg",
            )}
          >
            <GitCompareArrows size={14} />
            {changeCount > 0 && <span className="text-[11px]">{changeCount}</span>}
          </button>
        )}
        <StatsPopover chat={chat} />
        {ui.bashBang && (
          <button
            type="button"
            title={t("chat.terminal")}
            onClick={() => setTermOpen(chat.chatId, !chat.termOpen)}
            className={cn(
              "no-drag relative rounded-md p-1.5 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-secondary",
              chat.termOpen && "bg-bg-hover text-fg",
            )}
          >
            <SquareTerminal size={14} />
            {agentBusy && (
              <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
            )}
          </button>
        )}
        {ui.sandbox && (
          <button
            type="button"
            title={t("chat.sandbox")}
            onClick={() => setSandboxOpen(chat.chatId, !chat.sandboxOpen)}
            className={cn(
              "no-drag relative rounded-md p-1.5 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-secondary",
              chat.sandboxOpen && "bg-bg-hover text-fg",
            )}
          >
            <Monitor size={14} />
            {chat.sandbox?.status === "running" && (
              <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-success" />
            )}
          </button>
        )}
        {ui.harness && (
          <button
            type="button"
            title={t("chat.harness")}
            onClick={() => setHarnessOpen(chat.chatId, !chat.harnessOpen)}
            className={cn(
              "no-drag rounded-md p-1.5 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-secondary",
              chat.harnessOpen && "bg-bg-hover text-fg",
            )}
          >
            <Cpu size={14} />
          </button>
        )}
        {ui.tree && (
          <button
            type="button"
            title={t("chat.tree")}
            onClick={() => setTreeOpen(chat.chatId, !chat.treeOpen)}
            className={cn(
              "no-drag rounded-md p-1.5 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-secondary",
              chat.treeOpen && "bg-bg-hover text-fg",
            )}
          >
            <GitBranch size={14} />
          </button>
        )}
        {chat.sessionFile && (
          <button
            type="button"
            title={t("chat.revealSession")}
            onClick={() => window.pi.system.revealPath(chat.sessionFile!)}
            className="no-drag rounded-md p-1.5 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-secondary"
          >
            <FileJson size={14} />
          </button>
        )}
      </Titlebar>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {searchOpen && (
            <SearchBar
              chat={chat}
              onTarget={setSearchTarget}
              onClose={() => {
                setSearchOpen(false);
                setSearchTarget(null);
              }}
            />
          )}
          <MessageList chat={chat} searchTarget={searchOpen ? searchTarget : null} />
          {chat.pendingApprovals.length > 0 && (
            <div className="pointer-events-none absolute inset-x-4 bottom-32 z-30">
              <ApprovalCard chat={chat} />
            </div>
          )}
          <Composer chat={chat} />
        </div>
      </div>
      {((ui.changes && showChanges) || (ui.tree && chat.treeOpen) || (ui.sandbox && chat.sandboxOpen)) && (
        <div className="flex min-h-0 shrink-0 py-2.5 pr-2.5">
          <div className="flex min-h-0 divide-x divide-border/40 overflow-hidden rounded-2xl bg-bg-secondary shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.04]">
            {ui.changes && showChanges && <ChangesPanel chat={chat} onClose={() => setShowChanges(false)} />}
            {ui.tree && chat.treeOpen && <TreePanel chat={chat} />}
            {ui.sandbox && chat.sandboxOpen && <SandboxPanel chat={chat} />}
          </div>
        </div>
      )}
      {ui.harness && chat.harnessOpen && <HarnessCanvas key={chat.chatId} chat={chat} />}
      </div>
      {/* 底部终端抽屉：Agent 常驻 shell + 用户终端，横跨整个聊天区 */}
      {ui.bashBang && chat.termOpen && <TerminalDrawer chat={chat} />}
    </div>
  );
}
