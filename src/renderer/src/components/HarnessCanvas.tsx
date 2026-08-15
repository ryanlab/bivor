/**
 * Harness Canvas: node-graph orchestration of the agent assembly.
 * Every resource (system prompt, extra prompt, tools, extensions, skills,
 * templates) is a draggable node wired into the Agent core, which feeds the
 * model. Toggles re-wire the harness live via session.reload() in the host.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useUpdateNodeInternals,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  BookOpen,
  Bot,
  Cpu,
  FileText,
  GitFork,
  Layers,
  Loader2,
  Plug,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { GuardrailsDrawer } from "@/components/GuardrailsDrawer";
import { TrajectoryDrawer } from "@/components/TrajectoryDrawer";
import { ModelPicker } from "@/components/ModelPicker";
import { thinkingLevelOf, useAppStore, type ChatState } from "@/stores/app-store";
import { formatTokens } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Switch } from "@/components/Switch";
import { useT } from "@/lib/i18n";

const estTokens = (chars: number): string => formatTokens(Math.round(chars / 3.6));

/* ---------- custom nodes ---------- */

function shell(extra?: string): string {
  return cn(
    "rounded-2xl border bg-bg shadow-lg transition-all",
    extra ?? "border-border",
  );
}

function NodeChrome({
  icon,
  title,
  badge,
  dimmed,
  children,
  width = 240,
  accent,
}: {
  icon: React.ReactNode;
  title: string;
  badge?: string;
  dimmed?: boolean;
  children?: React.ReactNode;
  width?: number;
  accent?: boolean;
}): React.JSX.Element {
  return (
    <div
      style={{ width }}
      className={cn(
        shell(accent ? "border-accent/50" : undefined),
        dimmed && "opacity-45 saturate-50",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span className={cn(accent ? "text-accent" : "text-fg-secondary")}>{icon}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{title}</span>
        {badge && <span className="shrink-0 text-[10px] text-fg-muted">{badge}</span>}
      </div>
      {children && <div className="border-t border-border px-3 py-2">{children}</div>}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}): React.JSX.Element {
  return (
    <Switch
      size="sm"
      on={checked}
      className="nodrag"
      onClick={() => onChange(!checked)}
    />
  );
}

type AnyData = Record<string, unknown>;

function AgentNode(): React.JSX.Element {
  const t = useT();
  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-accent" />
      <div className="flex w-[170px] flex-col items-center gap-1.5 rounded-2xl border-2 border-accent bg-accent-muted px-4 py-5 shadow-xl">
        <Cpu size={22} className="text-accent" />
        <div className="text-[13px] font-semibold">{t("harness.core")}</div>
        <div className="text-[10px] text-fg-muted">{t("harness.coreHint")}</div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-accent" />
    </>
  );
}

function ModelNode({ data }: NodeProps): React.JSX.Element {
  const t = useT();
  const d = data as AnyData;
  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-accent" />
      <button
        type="button"
        onClick={() => (d.onPick as () => void)()}
        className="nodrag w-[200px] rounded-2xl border border-accent/50 bg-bg text-left shadow-lg transition-colors hover:border-accent"
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <Bot size={14} className="text-accent" />
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
            {String(d.name ?? t("harness.noModel"))}
          </span>
        </div>
        <div className="border-t border-border px-3 py-1.5 text-[10px] text-fg-muted">
          {t("harness.thinking", { level: String(d.thinking) })}
        </div>
      </button>
    </>
  );
}

function SubagentsNode({ data }: NodeProps): React.JSX.Element {
  const t = useT();
  const d = data as AnyData;
  const list = d.list as { id: string; name: string; state: string; turns: number; toolCalls: number }[];
  const active = list.filter((s) => s.state === "running").length;
  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-accent" />
      <div
        className={cn(
          "w-[210px] rounded-2xl border bg-bg shadow-lg",
          active > 0 ? "border-accent/60" : "border-border",
        )}
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <GitFork size={13} className={active > 0 ? "text-accent" : "text-fg-muted"} />
          <span className="flex-1 text-[12px] font-medium">{t("harness.subagents")}</span>
          <span className="text-[10px] text-fg-muted">
            {active > 0 ? t("harness.running", { n: active }) : t("common.idle")}
          </span>
        </div>
        <div className="space-y-1 border-t border-border px-3 py-1.5">
          {list.length === 0 && (
            <div className="text-[10px] leading-relaxed text-fg-muted">
              {t("harness.subHint")}
            </div>
          )}
          {list.map((s) => (
            <div key={s.id} className="flex items-center gap-1.5 text-[10.5px]">
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  s.state === "running"
                    ? "animate-pulse bg-accent"
                    : s.state === "done"
                      ? "bg-success"
                      : "bg-danger",
                )}
              />
              <span className="min-w-0 flex-1 truncate text-fg-secondary">{s.name}</span>
              <span className="shrink-0 text-fg-muted">
                {t("harness.subStats", { turns: s.turns, tools: s.toolCalls })}
              </span>
            </div>
          ))}
          <div className="pt-0.5 text-[9.5px] text-fg-muted">
            {t("harness.subLimits", { concurrent: String(d.maxConcurrent), turns: String(d.maxTurns) })}
          </div>
        </div>
      </div>
    </>
  );
}

function SysPromptNode({ data }: NodeProps): React.JSX.Element {
  const t = useT();
  const d = data as AnyData;
  const [expanded, setExpanded] = useState(false);
  const files = d.files as { path: string; chars: number }[];
  return (
    <>
      <NodeChrome
        icon={<ScrollText size={14} />}
        title={t("harness.systemPrompt")}
        badge={`≈${String(d.tokens)} tokens`}
        accent
        width={260}
      >
        <div className="space-y-1">
          {files.map((f) => (
            <div key={f.path} className="flex items-center gap-1.5 text-[10.5px]">
              <FileText size={10} className="shrink-0 text-fg-muted" />
              <span className="min-w-0 flex-1 truncate font-mono text-fg-secondary">
                {f.path.split(/[\\/]/).slice(-2).join("/")}
              </span>
              <span className="shrink-0 text-fg-muted">≈{estTokens(f.chars)}</span>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="nodrag text-[10.5px] text-fg-muted hover:text-fg-secondary"
          >
            {expanded ? t("harness.collapse") : t("harness.expand")}
          </button>
          {expanded && (
            <pre className="nodrag nowheel selectable max-h-44 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-bg-secondary p-2 text-[9.5px] leading-relaxed text-fg-muted">
              {String(d.text)}
            </pre>
          )}
        </div>
      </NodeChrome>
      <Handle type="source" position={Position.Right} className="!bg-border-strong" />
    </>
  );
}

function ExtraPromptNode({ data }: NodeProps): React.JSX.Element {
  const t = useT();
  const d = data as AnyData;
  const value = String(d.value ?? "");
  return (
    <>
      <NodeChrome
        icon={<Sparkles size={14} />}
        title={t("harness.extra")}
        badge={value ? t("harness.extraChars", { n: value.length }) : t("harness.extraEmpty")}
        dimmed={!value}
        width={260}
      >
        <textarea
          value={value}
          onChange={(e) => (d.onChange as (v: string) => void)(e.target.value)}
          rows={3}
          placeholder={t("harness.extraPh")}
          className="nodrag nowheel w-full resize-none rounded-lg border border-border bg-bg-input p-2 text-[10.5px] leading-relaxed outline-none placeholder:text-fg-muted focus:border-accent/60"
        />
      </NodeChrome>
      <Handle type="source" position={Position.Right} className="!bg-border-strong" />
    </>
  );
}

function ToolsNode({ data }: NodeProps): React.JSX.Element {
  const t = useT();
  const d = data as AnyData;
  const tools = d.tools as { name: string; active: boolean; description?: string }[];
  return (
    <>
      <NodeChrome
        icon={<Wrench size={14} />}
        title={t("harness.tools")}
        badge={`${tools.filter((t) => t.active).length}/${tools.length}`}
        width={260}
      >
        <div className="flex flex-wrap gap-1">
          {tools.map((tool) => (
            <button
              key={tool.name}
              type="button"
              title={tool.description}
              onClick={() => (d.onToggle as (n: string) => void)(tool.name)}
              className={cn(
                "nodrag rounded-md border px-1.5 py-0.5 font-mono text-[10px] transition-colors",
                tool.active
                  ? "border-accent/30 bg-accent-muted text-fg"
                  : "border-border text-fg-muted line-through hover:text-fg-secondary",
              )}
            >
              {tool.name}
            </button>
          ))}
        </div>
        <div className="pt-1 text-[9.5px] text-fg-muted">{t("harness.clickApply")}</div>
      </NodeChrome>
      <Handle type="source" position={Position.Right} className="!bg-border-strong" />
    </>
  );
}

function SkillNode({ data }: NodeProps): React.JSX.Element {
  const d = data as AnyData;
  const disabled = Boolean(d.disabled);
  return (
    <>
      <NodeChrome
        icon={<BookOpen size={13} />}
        title={String(d.name)}
        dimmed={disabled}
        width={230}
      >
        <div className="flex items-start gap-2">
          <Toggle checked={!disabled} onChange={() => (d.onToggle as () => void)()} />
          <div className="line-clamp-2 min-w-0 flex-1 text-[9.5px] leading-relaxed text-fg-muted">
            {String(d.description)}
          </div>
        </div>
      </NodeChrome>
      <Handle type="source" position={Position.Right} className="!bg-border-strong" />
    </>
  );
}

function ExtensionNode({ data }: NodeProps): React.JSX.Element {
  const t = useT();
  const d = data as AnyData;
  const disabled = Boolean(d.disabled);
  const tools = d.tools as string[];
  const commands = d.commands as string[];
  return (
    <>
      <NodeChrome icon={<Plug size={13} />} title={String(d.name)} dimmed={disabled} width={230}>
        <div className="flex items-start gap-2">
          <Toggle checked={!disabled} onChange={() => (d.onToggle as () => void)()} />
          <div className="min-w-0 flex-1 truncate text-[9.5px] text-fg-muted">
            {tools.length > 0 && t("harness.toolsList", { names: tools.join(", ") })}
            {tools.length > 0 && commands.length > 0 && " · "}
            {commands.length > 0 && `/${commands.join(" /")}`}
            {tools.length === 0 && commands.length === 0 && t("harness.none")}
          </div>
        </div>
      </NodeChrome>
      <Handle type="source" position={Position.Right} className="!bg-border-strong" />
    </>
  );
}

function TemplatesNode({ data }: NodeProps): React.JSX.Element {
  const t = useT();
  const d = data as AnyData;
  const prompts = d.prompts as { name: string }[];
  return (
    <>
      <NodeChrome
        icon={<FileText size={13} />}
        title={t("harness.prompts")}
        badge={t("harness.promptCount", { n: prompts.length })}
        width={230}
      >
        <div className="flex flex-wrap gap-1">
          {prompts.slice(0, 8).map((p) => (
            <span key={p.name} className="rounded-md bg-bg-tertiary px-1.5 py-0.5 font-mono text-[9.5px] text-fg-secondary">
              /{p.name}
            </span>
          ))}
        </div>
      </NodeChrome>
      <Handle type="source" position={Position.Right} className="!bg-border-strong" />
    </>
  );
}

function GateNode({ data }: NodeProps): React.JSX.Element {
  const t = useT();
  const d = data as AnyData;
  const constrained = Number(d.constrainedTools ?? 0);
  const rules = Number(d.rules ?? 0);
  const budgets = Number(d.budgets ?? 0);
  const events = Number(d.events ?? 0);
  const active = constrained + rules + budgets > 0;
  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-accent" />
      <button
        type="button"
        onClick={() => (d.onOpen as () => void)()}
        className={cn(
          "nodrag flex w-[190px] flex-col items-center gap-1 rounded-2xl border-2 bg-bg px-4 py-3.5 text-center shadow-xl transition-colors",
          active ? "border-warning/60" : "border-dashed border-border-strong",
        )}
      >
        <ShieldCheck size={18} className={active ? "text-warning" : "text-fg-muted"} />
        <div className="text-[12px] font-semibold">{t("harness.gate")}</div>
        <div className="text-[9.5px] leading-relaxed text-fg-muted">
          {active
            ? t("harness.constraints", { tools: constrained, rules, budgets })
            : t("harness.noConstraints")}
        </div>
        {events > 0 && (
          <div className="rounded-full bg-warning/15 px-2 py-0.5 text-[9px] text-warning">
            {t("harness.events", { n: events })}
          </div>
        )}
      </button>
      <Handle type="source" position={Position.Right} className="!bg-accent" />
    </>
  );
}

const nodeTypes = {
  agent: AgentNode,
  gate: GateNode,
  model: ModelNode,
  sysPrompt: SysPromptNode,
  extraPrompt: ExtraPromptNode,
  tools: ToolsNode,
  skill: SkillNode,
  extension: ExtensionNode,
  templates: TemplatesNode,
  subagents: SubagentsNode,
};

/* ---------- canvas ---------- */

/**
 * Replacing node objects while ReactFlow is still measuring can leave
 * `handleBounds` unregistered, in which case edges silently never render.
 * Re-register node internals whenever the node set changes.
 */
function SyncNodeInternals({ nodes }: { nodes: Node[] }): null {
  const updateNodeInternals = useUpdateNodeInternals();
  const ids = nodes.map((n) => n.id).join("|");
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      updateNodeInternals(ids.split("|").filter(Boolean));
    });
    return () => cancelAnimationFrame(frame);
  }, [ids, updateNodeInternals]);
  return null;
}

export function HarnessCanvas({ chat }: { chat: ChatState }): React.JSX.Element {
  const t = useT();
  const setHarnessOpen = useAppStore((s) => s.setHarnessOpen);
  const requestHarness = useAppStore((s) => s.requestHarness);
  const applyHarness = useAppStore((s) => s.applyHarness);
  const setTools = useAppStore((s) => s.setTools);
  const requestTools = useAppStore((s) => s.requestTools);

  const h = chat.harness;
  const [disabledSkills, setDisabledSkills] = useState<Set<string>>(new Set());
  const [disabledExtensions, setDisabledExtensions] = useState<Set<string>>(new Set());
  const [extraPrompt, setExtraPrompt] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [trajOpen, setTrajOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const setModel = useAppStore((s) => s.setModel);
  const setModelThinking = useAppStore((s) => s.setModelThinking);
  const modelThinking = useAppStore((s) => s.modelThinking);
  const presets = useAppStore((s) => s.harnessPresets);
  const loadPresets = useAppStore((s) => s.loadPresets);
  const saveHarnessPreset = useAppStore((s) => s.saveHarnessPreset);
  const applyHarnessPreset = useAppStore((s) => s.applyHarnessPreset);
  const deleteHarnessPreset = useAppStore((s) => s.deleteHarnessPreset);

  const dirty = useMemo(() => {
    if (!h) return false;
    const curSkills = new Set(h.skills.filter((s) => s.disabled).map((s) => s.name));
    const curExts = new Set(h.extensions.filter((e) => e.disabled).map((e) => e.path));
    return (
      extraPrompt !== h.extraSystemPrompt ||
      curSkills.size !== disabledSkills.size ||
      [...disabledSkills].some((n) => !curSkills.has(n)) ||
      curExts.size !== disabledExtensions.size ||
      [...disabledExtensions].some((p) => !curExts.has(p))
    );
  }, [h, disabledSkills, disabledExtensions, extraPrompt]);

  // Sync local editing state from the incoming harness — but never while the
  // user has unsaved edits, or an unrelated harness refresh would silently
  // roll their changes back.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (!h || dirtyRef.current) return;
    setDisabledSkills(new Set(h.skills.filter((s) => s.disabled).map((s) => s.name)));
    setDisabledExtensions(new Set(h.extensions.filter((e) => e.disabled).map((e) => e.path)));
    setExtraPrompt(h.extraSystemPrompt);
  }, [h]);

  const toggleTool = useCallback(
    (name: string) => {
      const tools = chat.harness?.tools ?? [];
      const names = tools
        .filter((t) => (t.name === name ? !t.active : t.active))
        .map((t) => t.name);
      setTools(chat.chatId, names);
      // host echoes back both `tools` and a fresh `harness` after applying
    },
    [chat.harness, chat.chatId, setTools],
  );

  const { initialNodes, initialEdges } = useMemo(() => {
    if (!h) return { initialNodes: [] as Node[], initialEdges: [] as Edge[] };
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    let y = 0;
    const X_IN = 0;
    const gap = 18;

    const addInput = (
      id: string,
      type: string,
      data: AnyData,
      height: number,
      enabled: boolean,
    ): void => {
      nodes.push({ id, type, position: { x: X_IN, y }, data });
      edges.push({
        id: `e-${id}`,
        source: id,
        target: "gate",
        animated: enabled,
        style: enabled
          ? { stroke: "var(--t-accent)", strokeWidth: 1.5, opacity: 0.75 }
          : { stroke: "var(--t-border-strong)", strokeDasharray: "4 4", opacity: 0.5 },
      });
      y += height + gap;
    };

    addInput(
      "sys",
      "sysPrompt",
      {
        tokens: estTokens(h.systemPrompt.chars),
        files: h.agentsFiles,
        text: h.systemPrompt.text,
      },
      110 + h.agentsFiles.length * 18,
      true,
    );
    addInput(
      "extra",
      "extraPrompt",
      { value: extraPrompt, onChange: setExtraPrompt },
      150,
      extraPrompt.length > 0,
    );
    addInput(
      "tools",
      "tools",
      { tools: h.tools, onToggle: toggleTool },
      120 + Math.ceil(h.tools.length / 4) * 22,
      h.tools.some((t) => t.active),
    );
    for (const ext of h.extensions) {
      const off = disabledExtensions.has(ext.path);
      addInput(
        `ext-${ext.path}`,
        "extension",
        {
          name: ext.name,
          tools: ext.tools,
          commands: ext.commands,
          disabled: off,
          onToggle: () =>
            setDisabledExtensions((prev) => {
              const next = new Set(prev);
              if (next.has(ext.path)) next.delete(ext.path);
              else next.add(ext.path);
              return next;
            }),
        },
        86,
        !off,
      );
    }
    for (const skill of h.skills) {
      const off = disabledSkills.has(skill.name);
      addInput(
        `skill-${skill.name}`,
        "skill",
        {
          name: skill.name,
          description: skill.description,
          disabled: off,
          onToggle: () =>
            setDisabledSkills((prev) => {
              const next = new Set(prev);
              if (next.has(skill.name)) next.delete(skill.name);
              else next.add(skill.name);
              return next;
            }),
        },
        92,
        !off,
      );
    }
    if (h.prompts.length > 0) {
      addInput("templates", "templates", { prompts: h.prompts }, 100, true);
    }

    const centerY = Math.max((y - gap) / 2 - 60, 40);
    const gr = chat.guardrails;
    nodes.push({
      id: "gate",
      type: "gate",
      position: { x: 400, y: centerY + 10 },
      data: {
        constrainedTools: gr ? Object.values(gr.toolPolicies).filter((m) => m !== "allow").length : 0,
        rules: gr?.commandRules.length ?? 0,
        budgets: gr
          ? [gr.maxTurnsPerPrompt, gr.maxToolCallsPerPrompt, gr.maxSessionCostUsd].filter(Boolean).length
          : 0,
        events: chat.policyEvents.length,
        onOpen: () => setDrawerOpen(true),
      },
    });
    nodes.push({ id: "agent", type: "agent", position: { x: 680, y: centerY }, data: {} });
    nodes.push({
      id: "model",
      type: "model",
      position: { x: 960, y: centerY + 28 },
      data: {
        name: chat.model?.name,
        thinking: chat.thinkingLevel,
        onPick: () => setModelOpen(true),
      },
    });
    edges.push({
      id: "e-gate-agent",
      source: "gate",
      target: "agent",
      animated: true,
      style: { stroke: "var(--t-warning)", strokeWidth: 1.5, opacity: 0.8 },
    });
    edges.push({
      id: "e-agent-model",
      source: "agent",
      target: "model",
      animated: chat.isStreaming,
      style: { stroke: "var(--t-accent)", strokeWidth: 2 },
    });
    const subs = Object.values(chat.subagents ?? {});
    nodes.push({
      id: "subagents",
      type: "subagents",
      position: { x: 960, y: centerY + 140 },
      data: {
        list: subs,
        maxConcurrent: gr?.subagentMaxConcurrent ?? 4,
        maxTurns: gr?.subagentMaxTurns ?? 50,
      },
    });
    edges.push({
      id: "e-agent-subagents",
      source: "agent",
      target: "subagents",
      animated: subs.some((s) => s.state === "running"),
      style: subs.some((s) => s.state === "running")
        ? { stroke: "var(--t-accent)", strokeWidth: 1.5, opacity: 0.8 }
        : { stroke: "var(--t-border-strong)", strokeDasharray: "4 4", opacity: 0.5 },
    });
    return { initialNodes: nodes, initialEdges: edges };
  }, [h, disabledSkills, disabledExtensions, extraPrompt, toggleTool, chat.model?.name, chat.thinkingLevel, chat.isStreaming, chat.guardrails, chat.policyEvents.length, chat.subagents]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges] = useEdgesState(initialEdges);

  // Rebuild while preserving user-dragged positions.
  useEffect(() => {
    setNodes((prev) => {
      const pos = new Map(prev.map((n) => [n.id, n.position]));
      return initialNodes.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position }));
    });
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const requestGuardrails = useAppStore((s) => s.requestGuardrails);
  useEffect(() => {
    requestHarness(chat.chatId);
    requestTools(chat.chatId);
    requestGuardrails(chat.chatId);
    void loadPresets();
  }, [chat.chatId, requestHarness, requestTools, requestGuardrails, loadPresets]);

  return (
    <div className="overlay-in fixed inset-0 z-40 flex flex-col bg-bg/95 backdrop-blur-sm">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border pl-24 pr-5">
        <Cpu size={15} className="text-accent" />
        <span className="text-sm font-medium">{t("harness.title")}</span>
        {h?.preset && (
          <span
            title={t("harness.presetTitle")}
            className="rounded-full bg-accent-muted px-2 py-0.5 text-[10.5px] text-accent"
          >
            {(() => {
              const key = `preset.${h.preset.id}`;
              const label = t(key);
              return label === key ? h.preset.name : label;
            })()}
          </span>
        )}
        <span className="text-[11px] text-fg-muted">{t("harness.hint")}</span>
        <span className="flex-1" />

        {/* 轨迹：每步模型实际所见 */}
        <button
          type="button"
          onClick={() => setTrajOpen((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-fg-secondary hover:border-border-strong",
            trajOpen && "border-accent/50 text-accent",
          )}
        >
          <ScrollText size={12} />
          {t("trajectory.title")}
        </button>

        {/* 预设库 */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setPresetsOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-fg-secondary hover:border-border-strong"
          >
            <Layers size={12} />
            {t("harness.presets")}
            {presets.length > 0 && ` (${presets.length})`}
          </button>
          {presetsOpen && (
            <div className="dialog-in absolute right-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-xl border border-border-strong bg-bg shadow-2xl">
              <div className="max-h-56 overflow-y-auto p-1">
                {presets.length === 0 && (
                  <div className="px-3 py-3 text-center text-[11px] text-fg-muted">
                    {t("harness.noPresets")}
                  </div>
                )}
                {presets.map((p) => (
                  <div
                    key={p.name}
                    className="group flex items-center gap-1.5 rounded-lg px-2 py-1.5 hover:bg-bg-hover"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        applyHarnessPreset(chat.chatId, p);
                        setPresetsOpen(false);
                      }}
                      className="min-w-0 flex-1 truncate text-left text-[12px]"
                    >
                      {p.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteHarnessPreset(p.name)}
                      className="rounded p-0.5 text-fg-muted opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1.5 border-t border-border p-2">
                <input
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder={t("harness.presetNamePh")}
                  className="min-w-0 flex-1 rounded-md border border-border bg-bg-input px-2 py-1 text-[11px] outline-none focus:border-accent/60"
                />
                <button
                  type="button"
                  disabled={!presetName.trim()}
                  onClick={() => {
                    void saveHarnessPreset(chat.chatId, presetName.trim());
                    setPresetName("");
                  }}
                  className="rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-40"
                >
                  {t("common.save")}
                </button>
              </div>
            </div>
          )}
        </div>

        <ModelPicker
          model={chat.model}
          align="bottom"
          hideTrigger
          open={modelOpen}
          onOpenChange={setModelOpen}
          onSelect={(m) => {
            setModel(chat.chatId, m);
            setModelOpen(false);
          }}
          thinkingFor={(m) =>
            chat.model && m.provider === chat.model.provider && m.id === chat.model.id
              ? chat.thinkingLevel
              : thinkingLevelOf(modelThinking, m)
          }
          onThinkingLevel={(m, l) => setModelThinking(m, l, chat.chatId)}
        />

        {chat.harnessError && (
          <span className="max-w-60 truncate text-[11px] text-danger">{chat.harnessError}</span>
        )}
        {dirty && (
          <button
            type="button"
            disabled={chat.harnessBusy || chat.isStreaming}
            onClick={() =>
              applyHarness(chat.chatId, {
                disabledSkills: [...disabledSkills],
                disabledExtensions: [...disabledExtensions],
                extraSystemPrompt: extraPrompt,
              })
            }
            className="flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-1.5 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {chat.harnessBusy && <Loader2 size={12} className="animate-spin" />}
            {chat.isStreaming ? t("harness.applyLater") : t("harness.applyNow")}
          </button>
        )}
        <button
          type="button"
          onClick={() => setHarnessOpen(chat.chatId, false)}
          className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1">
        {!h || nodes.length === 0 ? (
          // Wait until node/edge state is populated before mounting ReactFlow:
          // mounting empty and injecting the graph afterwards leaves edges
          // permanently invalidated on the first open.
          <div className="flex h-full items-center justify-center gap-2 text-xs text-fg-muted">
            <Loader2 size={14} className="animate-spin" />
            {t("harness.loading")}
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
            minZoom={0.3}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
            nodesConnectable={false}
            deleteKeyCode={null}
          >
            <SyncNodeInternals nodes={nodes} />
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="var(--t-border-strong)" />
          </ReactFlow>
        )}
        </div>
        {trajOpen && <TrajectoryDrawer chat={chat} onClose={() => setTrajOpen(false)} />}
        {drawerOpen && <GuardrailsDrawer chat={chat} onClose={() => setDrawerOpen(false)} />}
      </div>
    </div>
  );
}
