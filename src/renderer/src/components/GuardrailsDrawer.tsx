/**
 * Harness governance drawer: per-tool policies (allow/ask/deny), command
 * rules, budgets, and the policy event timeline. Changes apply immediately
 * (no session reload needed — the policy gate reads live state).
 */
import { useEffect, useMemo, useState } from "react";
import { Plus, ShieldCheck, Trash2, X } from "lucide-react";
import type { CommandRule, HarnessGuardrails, ToolPolicyMode } from "@shared/protocol";
import { useAppStore, type ChatState } from "@/stores/app-store";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/format";
import { useT, type Translator } from "@/lib/i18n";

function modes(t: Translator): { id: ToolPolicyMode; label: string }[] {
  return [
    { id: "allow", label: t("guardrails.allow") },
    { id: "ask", label: t("guardrails.ask") },
    { id: "deny", label: t("guardrails.deny") },
  ];
}

function presetRules(t: Translator): CommandRule[] {
  return [
    { pattern: "rm\\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)", action: "ask", note: t("guardrails.ruleRm") },
    { pattern: "(curl|wget).*\\|\\s*(ba)?sh", action: "deny", note: t("guardrails.rulePipe") },
    { pattern: "git\\s+push\\s+.*(--force|-f)\\b", action: "ask", note: t("guardrails.ruleForcePush") },
    { pattern: "\\bsudo\\b", action: "ask", note: t("guardrails.ruleSudo") },
  ];
}

const KIND_STYLE: Record<string, string> = {
  blocked: "text-danger",
  denied: "text-danger",
  budget_stop: "text-warning",
  asked: "text-fg-muted",
  approved: "text-success",
};

function kindLabel(kind: string, t: Translator): string {
  const keys: Record<string, string> = {
    blocked: "guardrails.blocked",
    denied: "guardrails.denied",
    budget_stop: "guardrails.budgetStop",
    asked: "guardrails.asked",
    approved: "guardrails.approved",
  };
  return keys[kind] ? t(keys[kind]) : kind;
}

export function GuardrailsDrawer({
  chat,
  onClose,
}: {
  chat: ChatState;
  onClose: () => void;
}): React.JSX.Element {
  const t = useT();
  const applyGuardrails = useAppStore((s) => s.applyGuardrails);
  const requestGuardrails = useAppStore((s) => s.requestGuardrails);

  const g = chat.guardrails;
  const [toolPolicies, setToolPolicies] = useState<Record<string, ToolPolicyMode>>({});
  const [rules, setRules] = useState<CommandRule[]>([]);
  const [maxTurns, setMaxTurns] = useState("");
  const [maxCalls, setMaxCalls] = useState("");
  const [maxCost, setMaxCost] = useState("");
  const [subMaxConcurrent, setSubMaxConcurrent] = useState("");
  const [subMaxTurns, setSubMaxTurns] = useState("");
  const [maxRepeats, setMaxRepeats] = useState("");
  const [newPattern, setNewPattern] = useState("");
  const [newAction, setNewAction] = useState<"deny" | "ask">("ask");

  useEffect(() => {
    requestGuardrails(chat.chatId);
  }, [chat.chatId, requestGuardrails]);

  useEffect(() => {
    if (!g) return;
    setToolPolicies(g.toolPolicies);
    setRules(g.commandRules);
    setMaxTurns(g.maxTurnsPerPrompt ? String(g.maxTurnsPerPrompt) : "");
    setMaxCalls(g.maxToolCallsPerPrompt ? String(g.maxToolCallsPerPrompt) : "");
    setMaxCost(g.maxSessionCostUsd ? String(g.maxSessionCostUsd) : "");
    setSubMaxConcurrent(g.subagentMaxConcurrent ? String(g.subagentMaxConcurrent) : "");
    setSubMaxTurns(g.subagentMaxTurns ? String(g.subagentMaxTurns) : "");
    setMaxRepeats(g.maxRepeatedToolCalls != null ? String(g.maxRepeatedToolCalls) : "");
  }, [g]);

  const toolNames = useMemo(() => {
    const fromHarness = chat.harness?.tools.map((t) => t.name) ?? [];
    return [...new Set([...fromHarness, ...Object.keys(toolPolicies)])];
  }, [chat.harness, toolPolicies]);

  const buildPayload = (): HarnessGuardrails => ({
    toolPolicies: Object.fromEntries(
      Object.entries(toolPolicies).filter(([, v]) => v !== "allow"),
    ),
    commandRules: rules,
    maxTurnsPerPrompt: Number(maxTurns) > 0 ? Number(maxTurns) : undefined,
    maxToolCallsPerPrompt: Number(maxCalls) > 0 ? Number(maxCalls) : undefined,
    maxSessionCostUsd: Number(maxCost) > 0 ? Number(maxCost) : undefined,
    subagentMaxConcurrent: Number(subMaxConcurrent) > 0 ? Number(subMaxConcurrent) : undefined,
    subagentMaxTurns: Number(subMaxTurns) > 0 ? Number(subMaxTurns) : undefined,
    // 0 = 关闭循环熔断；留空 = 默认（3）
    maxRepeatedToolCalls: maxRepeats === "" ? undefined : Number(maxRepeats),
  });

  const apply = (): void => applyGuardrails(chat.chatId, buildPayload());

  const dirty = useMemo(() => {
    if (!g) return false;
    return JSON.stringify(buildPayload()) !== JSON.stringify({
      toolPolicies: g.toolPolicies,
      commandRules: g.commandRules,
      maxTurnsPerPrompt: g.maxTurnsPerPrompt,
      maxToolCallsPerPrompt: g.maxToolCallsPerPrompt,
      maxSessionCostUsd: g.maxSessionCostUsd,
      subagentMaxConcurrent: g.subagentMaxConcurrent,
      subagentMaxTurns: g.subagentMaxTurns,
      maxRepeatedToolCalls: g.maxRepeatedToolCalls,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, toolPolicies, rules, maxTurns, maxCalls, maxCost, subMaxConcurrent, subMaxTurns, maxRepeats]);

  return (
    <div className="flex h-full w-[380px] shrink-0 flex-col border-l border-border bg-bg-secondary">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3.5">
        <ShieldCheck size={14} className="text-accent" />
        <span className="flex-1 text-[13px] font-medium">{t("guardrails.title")}</span>
        {dirty && (
          <button
            type="button"
            onClick={apply}
            className="rounded-lg bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-fg hover:bg-accent-hover"
          >
            {t("guardrails.apply")}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-secondary"
        >
          <X size={13} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {/* 工具策略 */}
        <section>
          <div className="pb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
            {t("guardrails.toolPolicy")}
          </div>
          <div className="space-y-1.5">
            {toolNames.map((name) => {
              const mode = toolPolicies[name] ?? "allow";
              return (
                <div key={name} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{name}</span>
                  <div className="flex overflow-hidden rounded-lg border border-border">
                    {modes(t).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setToolPolicies((p) => ({ ...p, [name]: m.id }))}
                        className={cn(
                          "px-2 py-1 text-[10.5px] transition-colors",
                          mode === m.id
                            ? m.id === "deny"
                              ? "bg-danger/15 font-medium text-danger"
                              : m.id === "ask"
                                ? "bg-warning/15 font-medium text-warning"
                                : "bg-success/15 font-medium text-success"
                            : "text-fg-muted hover:bg-bg-hover",
                        )}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 命令规则 */}
        <section>
          <div className="pb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
            {t("guardrails.cmdRules")}
          </div>
          <div className="space-y-1.5">
            {rules.map((r, i) => (
              <div key={`${r.pattern}-${i}`} className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5">
                <span
                  className={cn(
                    "shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-medium",
                    r.action === "deny" ? "bg-danger/15 text-danger" : "bg-warning/15 text-warning",
                  )}
                >
                  {r.action === "deny" ? t("guardrails.deny") : t("guardrails.ask")}
                </span>
                <code className="min-w-0 flex-1 truncate text-[10.5px] text-fg-secondary" title={r.pattern}>
                  {r.note ?? r.pattern}
                </code>
                <button
                  type="button"
                  onClick={() => setRules((prev) => prev.filter((_, j) => j !== i))}
                  className="shrink-0 rounded p-0.5 text-fg-muted hover:text-danger"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <input
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                placeholder={t("guardrails.patternPh")}
                className="min-w-0 flex-1 rounded-lg border border-border bg-bg-input px-2 py-1.5 font-mono text-[10.5px] outline-none focus:border-accent/60"
              />
              <select
                value={newAction}
                onChange={(e) => setNewAction(e.target.value as "deny" | "ask")}
                className="rounded-lg border border-border bg-bg-input px-1.5 py-1.5 text-[10.5px] outline-none"
              >
                <option value="ask">{t("guardrails.ask")}</option>
                <option value="deny">{t("guardrails.deny")}</option>
              </select>
              <button
                type="button"
                disabled={!newPattern.trim()}
                onClick={() => {
                  setRules((prev) => [...prev, { pattern: newPattern.trim(), action: newAction }]);
                  setNewPattern("");
                }}
                className="rounded-lg border border-border p-1.5 text-fg-secondary hover:border-border-strong disabled:opacity-40"
              >
                <Plus size={12} />
              </button>
            </div>
            <button
              type="button"
              onClick={() =>
                setRules((prev) => {
                  const have = new Set(prev.map((r) => r.pattern));
                  return [...prev, ...presetRules(t).filter((r) => !have.has(r.pattern))];
                })
              }
              className="text-[10.5px] text-accent hover:underline"
            >
              {t("guardrails.addPresets")}
            </button>
          </div>
        </section>

        {/* 预算 */}
        <section>
          <div className="pb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
            {t("guardrails.budgets")}
          </div>
          <div className="space-y-2">
            {[
              { label: t("guardrails.maxTurns"), value: maxTurns, set: setMaxTurns, hint: t("guardrails.unitTurns") },
              { label: t("guardrails.maxCalls"), value: maxCalls, set: setMaxCalls, hint: t("guardrails.unitCalls") },
              { label: t("guardrails.maxCost"), value: maxCost, set: setMaxCost, hint: "USD" },
              { label: t("guardrails.subConcurrent"), value: subMaxConcurrent, set: setSubMaxConcurrent, hint: t("guardrails.unitAgents") },
              { label: t("guardrails.subTurns"), value: subMaxTurns, set: setSubMaxTurns, hint: t("guardrails.unitTurns") },
              { label: t("guardrails.maxRepeats"), value: maxRepeats, set: setMaxRepeats, hint: t("guardrails.unitCalls") },
            ].map((f) => (
              <div key={f.label} className="flex items-center gap-2">
                <span className="flex-1 text-[11.5px] text-fg-secondary">{f.label}</span>
                <input
                  value={f.value}
                  onChange={(e) => f.set(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder={t("guardrails.unlimited")}
                  className="w-20 rounded-lg border border-border bg-bg-input px-2 py-1 text-right text-[11px] outline-none focus:border-accent/60"
                />
                <span className="w-8 text-[10px] text-fg-muted">{f.hint}</span>
              </div>
            ))}
          </div>
        </section>

        {/* 事件时间线 */}
        <section>
          <div className="pb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
            {t("guardrails.events")} {chat.policyEvents.length > 0 && `(${chat.policyEvents.length})`}
          </div>
          {chat.policyEvents.length === 0 ? (
            <div className="text-[11px] text-fg-muted">{t("guardrails.noEvents")}</div>
          ) : (
            <div className="space-y-1">
              {[...chat.policyEvents].reverse().map((e) => (
                <div key={e.id} className="rounded-lg border border-border px-2 py-1.5 text-[10.5px]">
                  <div className="flex items-center gap-2">
                    <span className={cn("font-medium", KIND_STYLE[e.kind])}>{kindLabel(e.kind, t)}</span>
                    <span className="font-mono text-fg-secondary">{e.toolName}</span>
                    <span className="flex-1" />
                    <span className="text-fg-muted">
                      {formatTime(e.time, { hour12: false })}
                    </span>
                  </div>
                  <div className="truncate pt-0.5 text-fg-muted" title={e.detail}>
                    {e.detail}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
