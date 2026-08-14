/**
 * Trajectory 抽屉：逐步展示"这一步模型实际看见了什么"。
 * 每一步 = 一次模型请求：装配来源（prompt 段 / 工具 / 技能）在请求
 * 发出的瞬间由 host 快照，因此中途改过 Harness 也能精确回放差异。
 */
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Footprints, X } from "lucide-react";
import type { TrajectoryStepPayload } from "@shared/protocol";
import { useAppStore, type ChatState } from "@/stores/app-store";
import { formatCost, formatTime, formatTokens } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";

function basename(p?: string): string | undefined {
  return p?.split("/").filter(Boolean).pop();
}

function timeLabel(ts: number): string {
  return formatTime(ts, { hour12: false });
}

function StepCard({ step }: { step: TrajectoryStepPayload }): React.JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const failed = step.toolCalls.filter((c) => c.isError).length;

  return (
    <div
      className={cn(
        "rounded-xl border bg-bg px-2.5 py-2",
        step.status === "running" ? "border-accent/50" : "border-border",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left"
      >
        {open ? (
          <ChevronDown size={12} className="shrink-0 text-fg-muted" />
        ) : (
          <ChevronRight size={12} className="shrink-0 text-fg-muted" />
        )}
        <span className="text-[11px] font-medium tabular-nums">#{step.index + 1}</span>
        <span className="text-[10.5px] text-fg-muted">{timeLabel(step.time)}</span>
        {step.status === "running" && (
          <span className="rounded-full bg-accent-muted px-1.5 text-[10px] text-accent">
            {t("trajectory.running")}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-right text-[10.5px] text-fg-muted">
          {step.toolCalls.length > 0
            ? `${t("trajectory.tools", { n: step.toolCalls.length })}${failed > 0 ? t("trajectory.failed", { n: failed }) : ""}`
            : t("trajectory.noTools")}
        </span>
      </button>

      {/* 摘要行：模型 + 上下文 + 工具数（始终可见） */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-[18px] pt-0.5 text-[10.5px] text-fg-muted">
          {step.model && <span className="font-mono">{step.model}</span>}
          {step.world === "vm" && <span className="text-info">{t("chat.vmBadge")}</span>}
          {step.contextTokens != null && (
            <span>{t("trajectory.context", { n: formatTokens(step.contextTokens) })}</span>
          )}
        <span>{t("trajectory.toolsRegistered", { n: step.activeTools.length })}</span>
        {step.usage && step.usage.cost > 0 && <span>{formatCost(step.usage.cost)}</span>}
      </div>

      {open && (
        <div className="mt-1.5 space-y-2 border-t border-border pl-[18px] pt-1.5">
          <div>
            <div className="pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              {t("trajectory.promptAssembly")} · {formatTokens(Math.round(step.systemPromptChars / 3.6))}
            </div>
            {step.sections.map((sec, i) => (
              <div key={i} className="flex items-baseline gap-1.5 text-[10.5px]">
                <span className="shrink-0 text-fg-secondary">{sec.label}</span>
                {sec.source && (
                  <span className="min-w-0 truncate font-mono text-fg-muted" title={sec.source}>
                    {basename(sec.source)}
                  </span>
                )}
                {sec.chars != null && (
                  <span className="ml-auto shrink-0 tabular-nums text-fg-muted">
                    {formatTokens(Math.round(sec.chars / 3.6))}
                  </span>
                )}
              </div>
            ))}
          </div>

          {step.skills.length > 0 && (
            <div>
              <div className="pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                {t("trajectory.skills")} · {step.skills.length}
              </div>
              <div className="flex flex-wrap gap-1">
                {step.skills.map((s) => (
                  <span key={s} className="rounded bg-bg-hover px-1.5 py-0.5 text-[10px] text-fg-secondary">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              {t("trajectory.activeTools")} · {step.activeTools.length}
            </div>
            <div className="flex flex-wrap gap-1">
              {step.activeTools.map((t) => (
                <span key={t} className="rounded bg-bg-hover px-1.5 py-0.5 font-mono text-[10px] text-fg-secondary">
                  {t}
                </span>
              ))}
            </div>
          </div>

          {step.toolCalls.length > 0 && (
            <div>
              <div className="pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                {t("trajectory.stepCalls")}
              </div>
              {step.toolCalls.map((c, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[10.5px]">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      c.isError ? "bg-danger" : "bg-success",
                    )}
                  />
                  <span className="font-mono text-fg-secondary">{c.name}</span>
                </div>
              ))}
            </div>
          )}

          {step.usage && (
            <div className="flex gap-3 text-[10.5px] text-fg-muted">
              <span>{t("trajectory.input", { n: formatTokens(step.usage.input) })}</span>
              <span>{t("trajectory.output", { n: formatTokens(step.usage.output) })}</span>
              {step.usage.cost > 0 && <span>{formatCost(step.usage.cost)}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TrajectoryDrawer({
  chat,
  onClose,
}: {
  chat: ChatState;
  onClose: () => void;
}): React.JSX.Element {
  const t = useT();
  const requestTrajectory = useAppStore((s) => s.requestTrajectory);

  useEffect(() => {
    requestTrajectory(chat.chatId);
  }, [chat.chatId, requestTrajectory]);

  const steps = chat.trajectory ?? [];
  // 新步在上：调试时最关心"最近一步模型看见了什么"。
  const ordered = [...steps].reverse();

  return (
    <div className="flex w-[340px] shrink-0 flex-col border-l border-border bg-bg">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <Footprints size={13} className="text-accent" />
        <span className="text-xs font-medium">{t("trajectory.title")}</span>
        <span className="text-[10.5px] text-fg-muted">{t("trajectory.subtitle", { n: steps.length })}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-fg-muted hover:bg-bg-hover hover:text-fg"
        >
          <X size={13} />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2.5">
        {ordered.length === 0 && (
          <div className="px-2 py-6 text-center text-[11px] leading-relaxed text-fg-muted">
            {t("trajectory.empty")}
          </div>
        )}
        {ordered.map((s) => (
          <StepCard key={s.index} step={s} />
        ))}
      </div>
    </div>
  );
}
