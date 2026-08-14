import { useEffect, useState } from "react";
import { BarChart3, Loader2, X } from "lucide-react";
import type { UsageStats } from "@shared/protocol";
import { useAppStore } from "@/stores/app-store";
import { formatCost, formatTokens } from "@/lib/format";
import { useT } from "@/lib/i18n";

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }): React.JSX.Element {
  return (
    <div className="flex-1 rounded-xl border border-border bg-bg p-3.5">
      <div className="text-[11px] text-fg-muted">{label}</div>
      <div className="pt-1 font-serif-display text-xl leading-none">{value}</div>
      {sub && <div className="pt-1 text-[10.5px] text-fg-muted">{sub}</div>}
    </div>
  );
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

  const maxDayTokens = stats ? Math.max(1, ...stats.perDay.map((d) => d.tokens)) : 1;

  return (
    <div
      className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={() => setOpen(false)}
    >
      <div
        className="dialog-in flex max-h-[82vh] w-[680px] flex-col overflow-hidden rounded-2xl border border-border-strong bg-bg-secondary shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-3.5">
          <BarChart3 size={15} className="text-accent" />
          <span className="text-sm font-medium">{t("usage.title")}</span>
          <span className="text-[11px] text-fg-muted">{t("usage.subtitle")}</span>
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
                  sub={t("usage.tokenSub", {
                    in: formatTokens(stats.inputTokens),
                    out: formatTokens(stats.outputTokens),
                    cache: formatTokens(stats.cacheReadTokens),
                  })}
                />
                <StatCard
                  label={t("usage.totalCost")}
                  value={stats.cost > 0 ? formatCost(stats.cost) : "$0"}
                  sub={stats.cost === 0 ? t("usage.noPrice") : undefined}
                />
              </div>

              {stats.perDay.length > 0 && (
                <div>
                  <div className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                    {t("usage.dailyTitle", { n: stats.perDay.length })}
                  </div>
                  <div className="flex h-28 items-end justify-start gap-1.5 rounded-xl border border-border bg-bg p-3">
                    {stats.perDay.map((d) => (
                      <div
                        key={d.date}
                        className="group relative flex h-full max-w-[52px] flex-1 flex-col items-center justify-end gap-1"
                        title={`${t("usage.dayTitle", { date: d.date, tokens: formatTokens(d.tokens), n: d.messages })}${d.cost > 0 ? ` · ${formatCost(d.cost)}` : ""}`}
                      >
                        <div
                          className="w-full min-w-[6px] rounded-t bg-accent/70 transition-colors group-hover:bg-accent"
                          style={{ height: `${Math.max(3, (d.tokens / maxDayTokens) * 100)}%` }}
                        />
                        <span className="text-[9px] leading-none text-fg-muted">
                          {d.date.slice(5).replace("-", "/")}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {stats.perModel.length > 0 && (
                <div>
                  <div className="pb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                    {t("usage.byModel")}
                  </div>
                  <div className="overflow-hidden rounded-xl border border-border">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border bg-bg-tertiary/50 text-left text-[10.5px] text-fg-muted">
                          <th className="px-3 py-2 font-medium">{t("usage.model")}</th>
                          <th className="px-3 py-2 text-right font-medium">{t("usage.messages")}</th>
                          <th className="px-3 py-2 text-right font-medium">{t("usage.inToken")}</th>
                          <th className="px-3 py-2 text-right font-medium">{t("usage.outToken")}</th>
                          <th className="px-3 py-2 text-right font-medium">{t("usage.cache")}</th>
                          <th className="px-3 py-2 text-right font-medium">{t("usage.cost")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.perModel.map((m) => (
                          <tr key={m.model} className="border-b border-border/50 bg-bg last:border-0">
                            <td className="px-3 py-2 font-mono text-[11px]">{m.model}</td>
                            <td className="px-3 py-2 text-right text-fg-secondary">{m.messages}</td>
                            <td className="px-3 py-2 text-right text-fg-secondary">
                              {formatTokens(m.inputTokens)}
                            </td>
                            <td className="px-3 py-2 text-right text-fg-secondary">
                              {formatTokens(m.outputTokens)}
                            </td>
                            <td className="px-3 py-2 text-right text-fg-secondary">
                              {formatTokens(m.cacheReadTokens)}
                            </td>
                            <td className="px-3 py-2 text-right text-fg-secondary">
                              {m.cost > 0 ? formatCost(m.cost) : t("common.dash")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
