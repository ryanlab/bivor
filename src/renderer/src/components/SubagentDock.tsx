/**
 * 子 agent 可视化面板：每个并行子 agent 一张实时卡片——状态、当前动作、
 * 回合进度、工具调用数、实时花费与耗时。点卡片可展开查看派生时的任务全文。
 * 数据由 host 在子会话的每个 turn / 工具调用时推送（SubagentUpdatePayload）。
 */
import { useEffect, useState } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  Loader2,
  Monitor,
  X,
  XCircle,
} from "lucide-react";
import type { SubagentUpdatePayload } from "@shared/protocol";
import { useAppStore, type ChatState } from "@/stores/app-store";
import { formatCost } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useT, type Translator } from "@/lib/i18n";

function elapsedLabel(startedAt: number | undefined, now: number): string | undefined {
  if (!startedAt) return undefined;
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
}

function stateLabel(state: SubagentUpdatePayload["state"], t: Translator): string {
  return t(`subagent.${state}`);
}

function StatusIcon({ state }: { state: SubagentUpdatePayload["state"] }): React.JSX.Element {
  if (state === "running") return <Loader2 size={13} className="shrink-0 animate-spin text-accent" />;
  if (state === "done") return <Check size={13} className="shrink-0 text-success" />;
  return <XCircle size={13} className="shrink-0 text-danger" />;
}

function SubagentCard({
  sa,
  now,
  onDismiss,
}: {
  sa: SubagentUpdatePayload;
  now: number;
  onDismiss: () => void;
}): React.JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const running = sa.state === "running";
  const progress =
    sa.maxTurns && sa.maxTurns > 0 ? Math.min(100, (sa.turns / sa.maxTurns) * 100) : 0;
  const elapsed = elapsedLabel(sa.startedAt, now);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border bg-bg-secondary transition-colors",
        running ? "border-accent/40" : "border-border",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {open ? (
          <ChevronDown size={11} className="shrink-0 text-fg-muted" />
        ) : (
          <ChevronRight size={11} className="shrink-0 text-fg-muted" />
        )}
        <StatusIcon state={sa.state} />
        <span className="shrink-0 text-[11.5px] font-medium">{sa.name}</span>
        <span
          className={cn(
            "shrink-0 rounded-full px-1.5 py-px text-[9.5px]",
            running
              ? "bg-accent-muted text-accent"
              : sa.state === "done"
                ? "bg-success/10 text-success"
                : "bg-danger/10 text-danger",
          )}
        >
          {stateLabel(sa.state, t)}
        </span>
        {sa.readonly && (
          <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-bg-hover px-1.5 py-px text-[9.5px] text-fg-muted">
            <Eye size={9} />
            {t("subagent.readonly")}
          </span>
        )}
        {sa.vm && (
          <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-info/10 px-1.5 py-px text-[9.5px] text-info">
            <Monitor size={9} />
            VM
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-right font-mono text-[10px] text-fg-muted">
          {running ? (sa.activity ?? "") : ""}
        </span>
        <span className="shrink-0 tabular-nums text-[10px] text-fg-muted">
          {elapsed && running ? elapsed : ""}
          {sa.cost != null && sa.cost > 0 && ` ${formatCost(sa.cost)}`}
        </span>
        {!running && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation();
                onDismiss();
              }
            }}
            className="shrink-0 rounded p-0.5 text-fg-muted hover:bg-bg-hover hover:text-fg"
          >
            <X size={11} />
          </span>
        )}
      </button>

      {/* 回合进度：跑向上限时颜色转警示，一眼看出快被熔断的子任务 */}
      <div className="mx-3 mb-1.5 flex items-center gap-2">
        <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-bg-hover">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              progress > 80 ? "bg-warning" : running ? "bg-accent" : "bg-fg-muted/40",
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="shrink-0 tabular-nums text-[10px] text-fg-muted">
          {t("subagent.progress", {
            turns: sa.maxTurns ? `${sa.turns}/${sa.maxTurns}` : sa.turns,
            n: sa.toolCalls,
          })}
        </span>
      </div>

      {open && (
        <div className="space-y-1.5 border-t border-border px-3 py-2">
          {sa.task && (
            <div>
              <div className="pb-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-fg-muted">
                {t("subagent.task")}
              </div>
              <div className="selectable whitespace-pre-wrap text-[11px] leading-relaxed text-fg-secondary">
                {sa.task}
              </div>
            </div>
          )}
          {!running && sa.activity && (
            <div>
              <div className="pb-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-fg-muted">
                {t("subagent.summary")}
              </div>
              <div className="selectable text-[11px] leading-relaxed text-fg-muted">
                {sa.activity}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SubagentDock({ chat }: { chat: ChatState }): React.JSX.Element | null {
  const t = useT();
  const dismissSubagent = useAppStore((s) => s.dismissSubagent);
  const subagents = Object.values(chat.subagents ?? {});
  const anyRunning = subagents.some((sa) => sa.state === "running");

  // 有运行中的子 agent 时每秒刷新，让耗时实时走动。
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyRunning]);

  if (subagents.length === 0) return null;

  const runningCount = subagents.filter((sa) => sa.state === "running").length;
  const totalCost = subagents.reduce((n, sa) => n + (sa.cost ?? 0), 0);

  return (
    <div className="fade-up mb-2 space-y-1">
      <div className="flex items-center gap-1.5 px-1 text-[10.5px] text-fg-muted">
        <Bot size={11} className="text-warning" />
        <span className="font-medium text-fg-secondary">{t("subagent.title")}</span>
        {runningCount > 0 ? (
          <span>{t("mission.running", { n: runningCount })}</span>
        ) : (
          <span>{t("subagent.allDone")}</span>
        )}
        {totalCost > 0 && <span>· {formatCost(totalCost)}</span>}
        <span className="flex-1" />
        {runningCount === 0 && (
          <button
            type="button"
            onClick={() => subagents.forEach((sa) => dismissSubagent(chat.chatId, sa.id))}
            className="rounded px-1.5 py-0.5 hover:bg-bg-hover hover:text-fg-secondary"
          >
            {t("subagent.clear")}
          </button>
        )}
      </div>
      {subagents.map((sa) => (
        <SubagentCard
          key={sa.id}
          sa={sa}
          now={now}
          onDismiss={() => dismissSubagent(chat.chatId, sa.id)}
        />
      ))}
    </div>
  );
}
