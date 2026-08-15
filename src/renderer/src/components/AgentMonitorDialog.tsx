/**
 * Agent 运行状况面板：统一展示所有 pi agent 宿主进程（含定时任务的无头执行）
 * 的进程指标（PID / CPU / 内存及趋势 / 运行时长）与会话状态（运行中 / 空闲 /
 * 待审批 / 出错），并提供行内处置（停止本轮 / 关闭会话 / 强杀进程）。
 * 另有异常提示（长时间运行 / 疑似无响应 / 内存偏高）、定时任务概览（含行内
 * 立即运行 / 启停）与策略审批事件流。打开期间每 2 秒轮询一次主进程快照。
 */
import { useEffect, useState } from "react";
import {
  Activity,
  AlarmClock,
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Cloud,
  GitFork,
  Loader2,
  MessageSquare,
  Pause,
  Play,
  ShieldAlert,
  Square,
  Zap,
  Trash2,
  X,
} from "lucide-react";
import type { AgentMonitorSnapshot, AgentProcessInfo, PolicyEventPayload } from "@shared/protocol";
import { useAppStore, type ChatState } from "@/stores/app-store";
import { formatCost, formatDateTime, formatRelativeTime, formatTokens } from "@/lib/format";
import { isAssistantMessage, isUserMessage, userMessageText } from "@/lib/pi-messages";
import type { AssistantMessage } from "@/lib/pi-messages";
import { useT } from "@/lib/i18n";
import type { Translator } from "@/lib/i18n";
import { cn } from "@/lib/cn";

const POLL_MS = 2000;
/** 单轮 prompt 超过该时长在面板中标黄提示 */
const LONG_RUN_MS = 10 * 60 * 1000;
/** 生成中但超过该时长没有任何会话事件 → 疑似无响应 */
const STALL_MS = 2 * 60 * 1000;
/** 宿主进程内存超过该值标黄提示 */
const HIGH_MEM_BYTES = 1.5 * 1024 * 1024 * 1024;
/** 进程表每页显示的 agent 行数（Bivor 自身行固定，不参与分页） */
const PAGE_SIZE = 10;

type AgentStatus =
  | "initializing"
  | "streaming"
  | "approval"
  | "idle"
  | "error"
  | "headless"
  | "exiting";

function statusOf(proc: AgentProcessInfo, chat?: ChatState): AgentStatus {
  if (proc.exiting) return "exiting";
  // chat 类型进程在 store 里已无对应会话 → 刚被关闭、正在清理退出。
  // （带 exiting 标记的快照可能还没轮询到，先行显示退出中，避免闪现强杀按钮。
  //   不存在长期孤儿：主进程会在渲染层销毁/整页刷新时 dispose 其全部 chat 进程。）
  if (!chat) return proc.kind === "headless" ? "headless" : "exiting";
  if (chat.status === "error") return "error";
  if (chat.status === "initializing") return "initializing";
  if (chat.pendingApprovals.length > 0) return "approval";
  if (chat.isStreaming) return "streaming";
  return "idle";
}

const STATUS_STYLE: Record<AgentStatus, string> = {
  initializing: "bg-bg-hover text-fg-secondary",
  streaming: "bg-accent-muted text-accent",
  approval: "bg-warning/15 text-warning",
  idle: "bg-bg-hover text-fg-muted",
  error: "bg-danger/15 text-danger",
  headless: "bg-accent-muted text-accent",
  exiting: "bg-bg-hover text-fg-muted",
};

function titleOf(proc: AgentProcessInfo, chat: ChatState | undefined, t: Translator): string {
  if (proc.label) return proc.label;
  if (chat?.sessionName) return chat.sessionName;
  const firstUser = chat?.messages.find(isUserMessage);
  if (firstUser) {
    const text = userMessageText(firstUser).slice(0, 50);
    if (text) return text;
  }
  return proc.kind === "headless" ? t("monitor.headlessTask") : t("mission.newSession");
}

function activityOf(chat: ChatState | undefined, t: Translator): string {
  if (!chat) return t("common.dash");
  if (chat.status === "error") return chat.error ?? t("mission.startFailed");
  if (chat.status === "initializing") return t("mission.starting");
  const runningTool = Object.values(chat.toolRuns).find((r) => r.status === "running");
  if (runningTool) {
    const arg =
      runningTool.toolName === "bash"
        ? String(runningTool.args.command ?? "")
        : String(runningTool.args.path ?? runningTool.args.file_path ?? "");
    return `${runningTool.toolName} ${arg}`.slice(0, 60);
  }
  if (chat.retrying)
    return t("mission.retrying", { attempt: chat.retrying.attempt, max: chat.retrying.maxAttempts });
  if (chat.compacting) return t("mission.compacting");
  if (chat.isStreaming) {
    const last = chat.streaming?.content.at(-1);
    if (last?.type === "thinking") return t("mission.thinking");
    return t("mission.generating");
  }
  if (chat.lastError) return chat.lastError.slice(0, 60);
  return t("mission.waiting");
}

/**
 * 会话累计 token / 成本。面板在流式输出期间会高频重渲染，
 * 这里按 messages 数组身份缓存（store 不可变更新，身份不变即内容不变），
 * 避免每次渲染对所有会话做全量消息扫描。
 */
const usageCache = new WeakMap<readonly unknown[], { cost: number; tokens: number }>();

function usageOf(chat?: ChatState): { cost: number; tokens: number } {
  if (!chat) return { cost: 0, tokens: 0 };
  const cached = usageCache.get(chat.messages);
  if (cached) return cached;
  let cost = 0;
  let tokens = 0;
  for (const m of chat.messages) {
    if (isAssistantMessage(m)) {
      const usage = (m as AssistantMessage).usage;
      cost += usage?.cost?.total ?? 0;
      tokens += usage?.totalTokens ?? 0;
    }
  }
  const result = { cost, tokens };
  usageCache.set(chat.messages, result);
  return result;
}

/** 可排序列;点击表头在 降序 → 升序 → 无排序 间循环 */
type SortKey = "cpu" | "memory" | "uptime" | "context" | "tokens" | "cost";

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatMemory(bytes?: number): string {
  if (bytes === undefined) return "—";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(0)} MB`;
}

/** 行内小图标按钮的公共样式；文字色与 hover 色由使用处补充 */
const ICON_BTN = "rounded-md border border-border p-1 transition-colors";

/** 数值 + 趋势线的表格单元（CPU / 内存列） */
function MetricCell({
  value,
  points,
  warn,
}: {
  value: string;
  points: number[];
  warn?: boolean;
}): React.JSX.Element {
  return (
    <td className="px-3 py-2 text-center text-fg-secondary">
      <div className="flex flex-col items-center gap-0.5 whitespace-nowrap">
        <span>{value}</span>
        <Sparkline points={points} warn={warn} />
      </div>
    </td>
  );
}

/**
 * 迷你趋势线：按序列自身最大值归一化，突出形状而非绝对值。
 * 采样点不足时也渲染同尺寸空白占位，保证行高从一开始就固定，不会在图表出现时跳动。
 */
function Sparkline({ points, warn }: { points: number[]; warn?: boolean }): React.JSX.Element {
  const w = 36;
  const h = 8;
  let d = "";
  if (points.length >= 2) {
    const max = Math.max(...points, 1e-6);
    const step = w / (points.length - 1);
    d = points
      .map(
        (v, i) =>
          `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - (v / max) * (h - 1)).toFixed(1)}`,
      )
      .join(" ");
  }
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className={cn("shrink-0", warn ? "text-warning" : "text-fg-muted/60")}
    >
      {d && <path d={d} fill="none" stroke="currentColor" strokeWidth="1" />}
    </svg>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }): React.JSX.Element {
  return (
    <div className="flex-1 rounded-xl border border-border bg-bg p-3.5">
      <div className="text-[11px] text-fg-muted">{label}</div>
      <div className={cn("pt-1 font-serif-display text-xl leading-none", accent && "text-accent")}>
        {value}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
      {children}
    </div>
  );
}

const POLICY_STYLE: Record<PolicyEventPayload["kind"], string> = {
  blocked: "bg-danger/15 text-danger",
  asked: "bg-warning/15 text-warning",
  approved: "bg-accent-muted text-accent",
  denied: "bg-danger/15 text-danger",
  budget_stop: "bg-danger/15 text-danger",
};

export function AgentMonitorDialog(): React.JSX.Element | null {
  const t = useT();
  const open = useAppStore((s) => s.monitorOpen);
  const setOpen = useAppStore((s) => s.setMonitorOpen);
  const chats = useAppStore((s) => s.chats);
  const scheduledTasks = useAppStore((s) => s.scheduledTasks);
  const setActiveChat = useAppStore((s) => s.setActiveChat);
  const closeChat = useAppStore((s) => s.closeChat);
  const abort = useAppStore((s) => s.abort);
  const runTaskNow = useAppStore((s) => s.runScheduledTaskNow);
  const saveTask = useAppStore((s) => s.saveScheduledTask);
  const [snapshot, setSnapshot] = useState<AgentMonitorSnapshot | null>(null);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);

  useEffect(() => {
    if (!open) return;
    setSnapshot(null);
    setPage(0);
    setSort(null);
    void useAppStore.getState().refreshScheduledTasks();
    let cancelled = false;
    const refresh = (): void => {
      void window.pi.monitor
        .snapshot()
        .then((snap) => {
          // 每次都是新对象，setState 必然重渲染，"运行时长 / 告警"随轮询跟着走
          if (!cancelled) setSnapshot(snap);
        })
        .catch(() => undefined);
    };
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [open]);

  if (!open) return null;

  const processes = snapshot?.processes ?? [];
  const rows = processes.map((proc) => {
    const chat = chats[proc.chatId] as ChatState | undefined;
    const { cost, tokens } = usageOf(chat);
    return { proc, chat, status: statusOf(proc, chat), cost, tokens };
  });
  const sortValue = (r: (typeof rows)[number], key: SortKey): number => {
    switch (key) {
      case "cpu":
        return r.proc.cpuPercent ?? -1;
      case "memory":
        return r.proc.memoryBytes ?? -1;
      case "uptime":
        return Date.now() - r.proc.startedAt;
      case "context":
        return r.chat?.contextUsage?.percent ?? -1;
      case "tokens":
        return r.tokens;
      case "cost":
        return r.cost;
    }
  };
  const sortedRows = sort
    ? [...rows].sort((a, b) => {
        const diff = sortValue(a, sort.key) - sortValue(b, sort.key);
        return sort.dir === "desc" ? -diff : diff;
      })
    : rows;
  // Bivor 自身行固定在每页顶部，agent 行超过 10 条时分页
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pagedRows = sortedRows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const toggleSort = (key: SortKey): void => {
    setSort((prev) => {
      if (prev?.key !== key) return { key, dir: "desc" };
      if (prev.dir === "desc") return { key, dir: "asc" };
      return null;
    });
  };
  const sortTh = (key: SortKey, label: string): React.JSX.Element => (
    <th className="px-3 py-1.5 text-center font-semibold">
      <button
        type="button"
        onClick={() => toggleSort(key)}
        className={cn(
          "inline-flex items-center gap-0.5 uppercase tracking-wider transition-colors hover:text-fg",
          sort?.key === key && "text-fg",
        )}
      >
        {label}
        {sort?.key === key &&
          (sort.dir === "desc" ? <ArrowDown size={9} /> : <ArrowUp size={9} />)}
      </button>
    </th>
  );
  const runningCount = rows.filter((r) => r.status === "streaming" || r.status === "headless").length;
  const approvalCount = rows.reduce((n, r) => n + (r.chat?.pendingApprovals.length ?? 0), 0);
  // 合计包含 Bivor 自身 + 所有 agent 宿主进程
  const totalMemory =
    (snapshot?.self.memoryBytes ?? 0) + processes.reduce((n, p) => n + (p.memoryBytes ?? 0), 0);
  const totalCpu =
    (snapshot?.self.cpuPercent ?? 0) + processes.reduce((n, p) => n + (p.cpuPercent ?? 0), 0);

  const visibleTasks = scheduledTasks.filter((task) => task.enabled || task.running || task.lastRun);
  const policyFeed = Object.values(chats)
    .flatMap((chat) =>
      chat.policyEvents.map((event) => ({ event, title: chat.sessionName ?? undefined, chatId: chat.chatId })),
    )
    .sort((a, b) => b.event.time - a.event.time)
    .slice(0, 10);

  const statusLabel: Record<AgentStatus, string> = {
    initializing: t("monitor.statusInitializing"),
    streaming: t("monitor.statusStreaming"),
    approval: t("monitor.statusApproval"),
    idle: t("monitor.statusIdle"),
    error: t("monitor.statusError"),
    headless: t("monitor.statusHeadless"),
    exiting: t("monitor.statusExiting"),
  };
  const policyLabel: Record<PolicyEventPayload["kind"], string> = {
    blocked: t("monitor.policyBlocked"),
    asked: t("monitor.policyAsked"),
    approved: t("monitor.policyApproved"),
    denied: t("monitor.policyDenied"),
    budget_stop: t("monitor.policyBudgetStop"),
  };

  return (
    <div
      className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={() => setOpen(false)}
    >
      <div
        className="dialog-in flex max-h-[85vh] w-[960px] flex-col overflow-hidden rounded-2xl border border-border-strong bg-bg-secondary shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-3.5">
          <Activity size={15} className="text-accent" />
          <span className="text-sm font-medium">{t("monitor.title")}</span>
          {snapshot && (
            <span className="font-mono text-[11px] text-fg-muted">
              <span className="text-accent">Bivor v{snapshot.appVersion}</span>{" "}
              (<span className="text-success">PI v{snapshot.piVersion}</span>)
            </span>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md p-1 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
          >
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {!snapshot && (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={18} className="animate-spin text-fg-muted" />
            </div>
          )}

          {snapshot && (
            <div className="space-y-5">
              <div className="flex gap-3">
                <StatCard label={t("monitor.procs")} value={String(processes.length)} />
                <StatCard
                  label={t("monitor.runningCount")}
                  value={String(runningCount)}
                  accent={runningCount > 0}
                />
                <StatCard label={t("monitor.pendingApprovals")} value={String(approvalCount)} />
                <StatCard label={t("monitor.totalCpu")} value={`${totalCpu.toFixed(1)}%`} />
                <StatCard label={t("monitor.totalMemory")} value={formatMemory(totalMemory)} />
              </div>

              <div className="overflow-hidden rounded-xl border border-border">
                  <table className="w-full table-fixed text-xs [&_td]:align-middle [&_th]:align-middle">
                    <thead>
                      <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-fg-muted/80">
                        <th className="px-3 py-1.5 font-semibold">{t("monitor.colSession")}</th>
                        <th className="px-3 py-1.5 text-center font-semibold">{t("monitor.colStatus")}</th>
                        <th className="px-3 py-1.5 text-center font-semibold">{t("monitor.colActivity")}</th>
                        <th className="px-3 py-1.5 text-center font-semibold">PID</th>
                        {sortTh("cpu", "CPU")}
                        {sortTh("memory", t("monitor.colMemory"))}
                        {sortTh("uptime", t("monitor.colUptime"))}
                        {sortTh("context", t("monitor.colContext"))}
                        {sortTh("tokens", t("monitor.colTokens"))}
                        {sortTh("cost", t("monitor.colCost"))}
                        <th className="px-3 py-1.5 text-center font-semibold">{t("monitor.colActions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-border/50 bg-bg last:border-0">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <Activity size={11} className="shrink-0 text-fg-muted" />
                            <span className="truncate">{t("monitor.selfRow")}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className="inline-flex items-center rounded-md bg-bg-hover px-1.5 py-0.5 text-[10.5px] text-fg-muted">
                            {t("monitor.statusSelf")}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center text-fg-muted">{t("common.dash")}</td>
                        <td className="px-3 py-2 text-center font-mono text-[11px] text-fg-secondary">
                          {snapshot.self.pid}
                        </td>
                        <MetricCell
                          value={`${snapshot.self.cpuPercent.toFixed(1)}%`}
                          points={snapshot.self.cpuHistory}
                        />
                        <MetricCell
                          value={formatMemory(snapshot.self.memoryBytes)}
                          points={snapshot.self.memoryHistory}
                        />
                        <td className="whitespace-nowrap px-3 py-2 text-center text-fg-secondary">
                          {snapshot.self.startedAt
                            ? formatDuration(Date.now() - snapshot.self.startedAt)
                            : t("common.dash")}
                        </td>
                        <td className="px-3 py-2 text-center text-fg-muted">{t("common.dash")}</td>
                        <td className="px-3 py-2 text-center text-fg-muted">{t("common.dash")}</td>
                        <td className="px-3 py-2 text-center text-fg-muted">{t("common.dash")}</td>
                        <td className="px-3 py-2" />
                      </tr>
                      {pagedRows.map(({ proc, chat, status, cost, tokens }) => {
                        const subs = Object.values(chat?.subagents ?? {}).filter(
                          (s) => s.state === "running",
                        ).length;
                        const ctxPct = chat?.contextUsage?.percent;
                        const clickable = Boolean(chat);
                        const isVm =
                          chat?.executionWorld === "vm" || chat?.sandbox?.status === "running";
                        const sandboxCreating = chat?.sandbox?.status === "creating";
                        const longRunMin =
                          chat?.isStreaming && chat.streamingSince
                            ? Math.floor((Date.now() - chat.streamingSince) / 60_000)
                            : 0;
                        const highMem = (proc.memoryBytes ?? 0) > HIGH_MEM_BYTES;
                        // 等待审批 / 限流重试退避是合法的长时间静默，不算疑似无响应
                        const stalledMs =
                          chat?.isStreaming &&
                          chat.lastEventAt &&
                          chat.pendingApprovals.length === 0 &&
                          !chat.retrying
                            ? Date.now() - chat.lastEventAt
                            : 0;
                        const stalled = stalledMs > STALL_MS;
                        return (
                          <tr
                            key={proc.chatId}
                            onClick={() => {
                              if (!chat) return;
                              setActiveChat(proc.chatId);
                              setOpen(false);
                            }}
                            className={cn(
                              "border-b border-border/50 bg-bg last:border-0",
                              clickable && "cursor-pointer",
                            )}
                          >
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1.5">
                                {proc.kind === "headless" ? (
                                  <AlarmClock size={11} className="shrink-0 text-fg-muted" />
                                ) : (
                                  <MessageSquare size={11} className="shrink-0 text-fg-muted" />
                                )}
                                <span className="truncate">{titleOf(proc, chat, t)}</span>
                                {subs > 0 && (
                                  <span
                                    title={t("mission.subagents", { n: subs })}
                                    className="inline-flex shrink-0 items-center gap-0.5 rounded bg-accent-muted px-1 text-[9.5px] text-accent"
                                  >
                                    <GitFork size={8} />
                                    {subs}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap items-center justify-center gap-1">
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px]",
                                    STATUS_STYLE[status],
                                  )}
                                >
                                  {(status === "streaming" ||
                                    status === "headless" ||
                                    status === "exiting") && (
                                    <Loader2 size={9} className="animate-spin" />
                                  )}
                                  {status === "approval" && <ShieldAlert size={9} />}
                                  {statusLabel[status]}
                                </span>
                                {stalled && (
                                  <span
                                    title={t("monitor.alertStalledHint", {
                                      m: Math.floor(stalledMs / 60_000),
                                    })}
                                    className="rounded-md bg-warning/15 px-1.5 py-0.5 text-[10.5px] text-warning"
                                  >
                                    {t("monitor.alertStalled")}
                                  </span>
                                )}
                                {(isVm || sandboxCreating) && (
                                  <span
                                    title={
                                      sandboxCreating
                                        ? t("monitor.sandboxCreating")
                                        : chat?.sandbox?.status === "running"
                                          ? t("monitor.sandboxRunning")
                                          : t("monitor.envVm")
                                    }
                                    className="inline-flex items-center gap-1 rounded-md bg-accent-muted px-1.5 py-0.5 text-[10.5px] text-accent"
                                  >
                                    {sandboxCreating ? (
                                      <Loader2 size={9} className="animate-spin" />
                                    ) : (
                                      <Cloud size={9} />
                                    )}
                                    {t("monitor.envVm")}
                                    {chat?.sandbox?.status === "running" && chat.sandboxSince && (
                                      <span className="font-mono">
                                        {formatDuration(Date.now() - chat.sandboxSince)}
                                      </span>
                                    )}
                                  </span>
                                )}
                                {longRunMin >= LONG_RUN_MS / 60_000 && (
                                  <span
                                    title={t("monitor.alertLongRun", { m: longRunMin })}
                                    className="rounded-md bg-warning/15 px-1.5 py-0.5 text-[10.5px] text-warning"
                                  >
                                    {t("monitor.alertLongRunShort", { m: longRunMin })}
                                  </span>
                                )}
                                {highMem && (
                                  <span className="rounded-md bg-warning/15 px-1.5 py-0.5 text-[10.5px] text-warning">
                                    {t("monitor.alertHighMem")}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="truncate px-3 py-2 text-center text-fg-muted">
                              {activityOf(chat, t)}
                            </td>
                            <td className="px-3 py-2 text-center font-mono text-[11px] text-fg-secondary">
                              {proc.pid ?? t("common.dash")}
                            </td>
                            <MetricCell
                              value={
                                proc.cpuPercent !== undefined
                                  ? `${proc.cpuPercent.toFixed(1)}%`
                                  : t("common.dash")
                              }
                              points={proc.cpuHistory}
                            />
                            <MetricCell
                              value={formatMemory(proc.memoryBytes)}
                              points={proc.memoryHistory}
                              warn={highMem}
                            />
                            <td className="whitespace-nowrap px-3 py-2 text-center text-fg-secondary">
                              {formatDuration(Date.now() - proc.startedAt)}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {typeof ctxPct === "number" ? (
                                <span
                                  className={cn(
                                    ctxPct >= 85
                                      ? "text-danger"
                                      : ctxPct >= 60
                                        ? "text-warning"
                                        : "text-fg-secondary",
                                  )}
                                >
                                  {ctxPct.toFixed(0)}%
                                </span>
                              ) : (
                                <span className="text-fg-muted">–</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-center font-mono text-[11px] text-fg-secondary">
                              {tokens > 0 ? formatTokens(tokens) : t("common.dash")}
                            </td>
                            <td className="px-3 py-2 text-center text-fg-secondary">
                              {cost > 0 ? formatCost(cost) : t("common.dash")}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center justify-center gap-1">
                                {status === "exiting" ? (
                                  <span className="text-fg-muted">{t("common.dash")}</span>
                                ) : (
                                  <>
                                    {chat?.isStreaming && (
                                      <button
                                        type="button"
                                        title={t("monitor.actionStop")}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          abort(proc.chatId);
                                        }}
                                        className={cn(
                                          ICON_BTN,
                                          "text-fg-secondary hover:border-warning/40 hover:text-warning",
                                        )}
                                      >
                                        <Square size={10} />
                                      </button>
                                    )}
                                    {chat ? (
                                      <button
                                        type="button"
                                        title={t("monitor.actionClose")}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          closeChat(proc.chatId);
                                        }}
                                        className={cn(
                                          ICON_BTN,
                                          "text-fg-muted hover:border-danger/40 hover:text-danger",
                                        )}
                                      >
                                        <X size={10} />
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        title={t("monitor.actionKill")}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void window.pi.monitor.kill(proc.chatId);
                                        }}
                                        className={cn(
                                          ICON_BTN,
                                          "text-fg-muted hover:border-danger/40 hover:text-danger",
                                        )}
                                      >
                                        <Trash2 size={10} />
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-1.5 pt-1">
                  <button
                    type="button"
                    disabled={safePage === 0}
                    onClick={() => setPage(safePage - 1)}
                    className={cn(ICON_BTN, "text-fg-muted enabled:hover:text-fg disabled:opacity-40")}
                  >
                    <ChevronLeft size={12} />
                  </button>
                  <span className="min-w-8 text-center font-mono text-[11px] text-fg-muted">
                    {safePage + 1} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={safePage >= totalPages - 1}
                    onClick={() => setPage(safePage + 1)}
                    className={cn(ICON_BTN, "text-fg-muted enabled:hover:text-fg disabled:opacity-40")}
                  >
                    <ChevronRight size={12} />
                  </button>
                </div>
              )}

              {visibleTasks.length > 0 && (
                <div>
                  <SectionTitle>{t("monitor.scheduleTitle")}</SectionTitle>
                  <div className="space-y-1.5">
                    {visibleTasks.map((task) => (
                      <div
                        key={task.id}
                        className="flex items-center gap-2.5 rounded-xl border border-border bg-bg px-3.5 py-2"
                      >
                        <AlarmClock size={12} className="shrink-0 text-fg-muted" />
                        <span className="min-w-0 flex-1 truncate text-xs text-fg-secondary">
                          {task.name}
                        </span>
                        {task.running ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent-muted px-1.5 py-0.5 text-[10.5px] text-accent">
                            <Loader2 size={9} className="animate-spin" />
                            {t("monitor.scheduleRunning")}
                          </span>
                        ) : task.enabled && task.nextRunAt ? (
                          <span className="shrink-0 text-[11px] text-fg-muted">
                            {t("monitor.scheduleNext", {
                              time: formatDateTime(task.nextRunAt, {
                                month: "numeric",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              }),
                            })}
                          </span>
                        ) : (
                          <span className="shrink-0 text-[11px] text-fg-muted">
                            {t("monitor.schedulePaused")}
                          </span>
                        )}
                        {task.lastRun && (
                          <span
                            title={task.lastRun.error}
                            className={cn(
                              "shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px]",
                              task.lastRun.status === "ok"
                                ? "bg-bg-hover text-fg-muted"
                                : "bg-danger/15 text-danger",
                            )}
                          >
                            {task.lastRun.status === "ok"
                              ? t("monitor.scheduleLastOk")
                              : t("monitor.scheduleLastError")}
                          </span>
                        )}
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            title={t("monitor.taskRunNow")}
                            disabled={task.running}
                            onClick={() => void runTaskNow(task.id)}
                            className={cn(
                              ICON_BTN,
                              "text-fg-muted enabled:hover:text-accent disabled:opacity-40",
                            )}
                          >
                            <Zap size={10} />
                          </button>
                          <button
                            type="button"
                            title={task.enabled ? t("monitor.taskPause") : t("monitor.taskResume")}
                            onClick={() => void saveTask({ ...task, enabled: !task.enabled })}
                            className={cn(ICON_BTN, "text-fg-muted hover:text-fg")}
                          >
                            {task.enabled ? <Pause size={10} /> : <Play size={10} />}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {policyFeed.length > 0 && (
                <div>
                  <SectionTitle>{t("monitor.policyTitle")}</SectionTitle>
                  <div className="space-y-1.5">
                    {policyFeed.map(({ event, title, chatId }) => (
                      <div
                        key={`${chatId}-${event.id}`}
                        className="flex items-center gap-2.5 rounded-xl border border-border bg-bg px-3.5 py-2"
                      >
                        <span
                          className={cn(
                            "shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px]",
                            POLICY_STYLE[event.kind],
                          )}
                        >
                          {policyLabel[event.kind]}
                        </span>
                        <span className="shrink-0 font-mono text-[11px] text-fg-secondary">
                          {event.toolName}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[11px] text-fg-muted">
                          {event.detail}
                        </span>
                        {title && (
                          <span className="max-w-[140px] shrink-0 truncate text-[10.5px] text-fg-muted">
                            {title}
                          </span>
                        )}
                        <span className="shrink-0 text-[10.5px] text-fg-muted">
                          {formatRelativeTime(event.time)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          )}
        </div>
      </div>
    </div>
  );
}
