import { useState, useEffect } from "react";
import { BarChart3, Loader2, X } from "lucide-react";
import type { UsageStats } from "@shared/protocol";
import { useAppStore } from "@/stores/app-store";
import { formatCost, formatTokens } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";

function StatCard({
  label,
  value,
  accent,
  title,
}: {
  label: string;
  value: string;
  accent?: boolean;
  title?: string;
}): React.JSX.Element {
  return (
    <div title={title} className="flex-1 rounded-xl border border-border bg-bg p-3.5">
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

type BarItem = {
  key: string;
  label: string;
  value: number;
  heading: string;
  rows: { label: string; value: string }[];
};

function UsageBars({ items, wide }: { items: BarItem[]; wide?: boolean }): React.JSX.Element {
  const [active, setActive] = useState<string | null>(null);
  const max = Math.max(1, ...items.map((item) => item.value));

  return (
    <div className="rounded-xl border border-border bg-bg p-3">
      <div className="flex h-28 items-end justify-start gap-1.5">
        {items.map((item, i) => {
          const focused = active === item.key;
          const pin =
            i === 0 ? "left-0" : i === items.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2";
          return (
            <button
              key={item.key}
              type="button"
              onMouseEnter={() => setActive(item.key)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(item.key)}
              onBlur={() => setActive(null)}
              className={cn(
                "relative flex h-full flex-1 flex-col items-center justify-end gap-1 rounded-md outline-none",
                wide ? "max-w-[88px]" : "max-w-[52px]",
              )}
            >
              <div
                className={cn(
                  "w-full min-w-[6px] rounded-t bg-accent/70 transition-colors",
                  focused && "bg-accent",
                )}
                style={{ height: `${Math.max(3, (item.value / max) * 100)}%` }}
              />
              <span className="w-full truncate text-center text-[9px] leading-none text-fg-muted">
                {item.label}
              </span>
              {focused && (
                <div className={cn("absolute bottom-full z-20 pb-2", pin)}>
                  <div className="dialog-in w-52 rounded-xl border border-border-strong bg-bg p-1 text-left shadow-2xl">
                    <div className="truncate px-2.5 py-1.5 text-xs font-medium">{item.heading}</div>
                    {item.rows.map((row) => (
                      <div
                        key={row.label}
                        className="flex items-center justify-between px-2.5 py-1 text-xs"
                      >
                        <span className="text-fg-muted">{row.label}</span>
                        <span className="font-mono text-fg-secondary">{row.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function shortModel(model: string): string {
  return model.split("/").pop() ?? model;
}

export function UsageDialog(): React.JSX.Element | null {
  const t = useT();
  const open = useAppStore((s) => s.usageOpen);
  const setOpen = useAppStore((s) => s.setUsageOpen);
  const appMode = useAppStore((s) => s.appMode);
  const dailyCwd = useAppStore((s) => s.dailyCwd);
  const projectPath = useAppStore((s) => s.activeProjectPath);
  const cwd = appMode === "daily" ? dailyCwd : projectPath;
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !cwd) return;
    setStats(null);
    setError(null);
    window.pi.sessions
      .usage(cwd)
      .then(setStats)
      .catch((e: Error) => setError(e.message));
  }, [open, cwd]);

  if (!open) return null;

  return (
    <div
      className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={() => setOpen(false)}
    >
      <div
        className="dialog-in flex max-h-[85vh] w-[1080px] flex-col overflow-hidden rounded-2xl border border-border-strong bg-bg-secondary shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-3.5">
          <BarChart3 size={15} className="text-accent" />
          <span className="text-sm font-medium">{t("usage.title")}</span>
          <span className="font-mono text-[11px] text-fg-muted">{t("usage.subtitle")}</span>
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
          {error && <div className="text-xs text-danger">{error}</div>}
          {!stats && !error && (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={18} className="animate-spin text-fg-muted" />
            </div>
          )}
          {stats && (
            <div className="space-y-5">
              <div className="flex gap-3">
                <StatCard label={t("usage.sessions")} value={String(stats.sessions)} />
                <StatCard label={t("usage.replies")} value={String(stats.messages)} />
                <StatCard
                  label={t("usage.tokenTotal")}
                  value={formatTokens(stats.inputTokens + stats.outputTokens)}
                  title={t("usage.tokenSub", {
                    in: formatTokens(stats.inputTokens),
                    out: formatTokens(stats.outputTokens),
                    cache: formatTokens(stats.cacheReadTokens),
                  })}
                />
                <StatCard label={t("usage.cache")} value={formatTokens(stats.cacheReadTokens)} />
                <StatCard
                  label={t("usage.totalCost")}
                  value={stats.cost > 0 ? formatCost(stats.cost) : "$0"}
                  accent={stats.cost > 0}
                  title={stats.cost === 0 ? t("usage.noPrice") : undefined}
                />
              </div>

              {stats.perDay.length > 0 && (
                <div>
                  <SectionTitle>{t("usage.dailyTitle", { n: stats.perDay.length })}</SectionTitle>
                  <UsageBars
                    items={stats.perDay.map((d) => ({
                      key: d.date,
                      label: d.date.slice(5).replace("-", "/"),
                      value: d.tokens,
                      heading: d.date,
                      rows: [
                        { label: t("usage.messages"), value: String(d.messages) },
                        { label: t("usage.tokenTotal"), value: formatTokens(d.tokens) },
                        {
                          label: t("usage.cost"),
                          value: d.cost > 0 ? formatCost(d.cost) : t("common.dash"),
                        },
                      ],
                    }))}
                  />
                </div>
              )}

              {stats.perModel.length > 0 && (
                <div>
                  <SectionTitle>{t("usage.byModel")}</SectionTitle>
                  <UsageBars
                    wide
                    items={stats.perModel.map((m) => ({
                      key: m.model,
                      label: shortModel(m.model),
                      value: m.inputTokens + m.outputTokens,
                      heading: m.model,
                      rows: [
                        { label: t("usage.messages"), value: String(m.messages) },
                        { label: t("usage.inToken"), value: formatTokens(m.inputTokens) },
                        { label: t("usage.outToken"), value: formatTokens(m.outputTokens) },
                        { label: t("usage.cache"), value: formatTokens(m.cacheReadTokens) },
                        {
                          label: t("usage.cost"),
                          value: m.cost > 0 ? formatCost(m.cost) : t("common.dash"),
                        },
                      ],
                    }))}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
