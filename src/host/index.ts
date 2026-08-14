/**
 * Agent host: runs inside an Electron utilityProcess, one per chat.
 * Embeds the pi SDK via AgentSessionRuntime (supports fork/session replacement)
 * and relays events to the main process.
 */
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  hasTrustRequiringProjectResources,
  ModelRuntime,
  ProjectTrustStore,
  SessionManager,
  type AgentSession,
  type CreateAgentSessionRuntimeFactory,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type {
  ChatKind,
  ChatStateSnapshot,
  HarnessPayload,
  HostEvent,
  HostInbound,
  HostInit,
  ModelInfo,
  SessionTreeNode,
  SlashCommandPayload,
  ThinkingLevel,
} from "@shared/protocol";
import {
  buildSandboxTools,
  currentSandboxStatus,
  destroySandbox,
  ensureSandbox,
  onSandboxStatus,
  sandboxAvailable,
} from "./sandbox";
import { Type } from "@sinclair/typebox";
import {
  cancelPendingApprovals,
  createGuardrailExtension,
  guardrails,
  requestHumanApproval,
  resolveApproval,
  setGuardrailHooks,
  setGuardrails,
} from "./guardrails";
import { abortAllSubagents, buildSubagentTool, totalSubagentCost } from "./subagents";
import { buildMemoryTool, memorySystemPrompt } from "./memory";
import { applyPresetToolPolicy, filterCustomTools } from "./preset";
import { getRuntimePreset, localizePreset, presetKind, type RuntimePresetDef } from "@shared/runtime-presets";
import { t as translate } from "@shared/locales";
import type { Locale } from "@shared/i18n";
import { createTrajectoryRecorder, type TrajectoryRecorder } from "./trajectory";
import {
  buildWorldToolDefinitions,
  currentWorld,
  onLocalTermData,
  onWorldChange,
  resizeAgentTerm,
  setWorld,
  warmLocalAgentShell,
  worldBashOperations,
  writeAgentTerm,
} from "./execution-world";
import {
  currentLocalSandboxMode,
  onLocalSandboxChange,
  setLocalSandboxMode,
} from "./local-sandbox";
import { applyProgressiveDisclosure, buildDisclosureTools } from "./tool-disclosure";
import { buildCodeRunTool } from "./code-mode";
import { buildWebTools } from "./web";
import { buildBrowserTool, closeBrowser } from "./browser";
import { buildDeployTool } from "./deploy";

interface ParentPort {
  on(event: "message", listener: (e: { data: HostInbound }) => void): void;
  postMessage(data: HostEvent): void;
}

const parentPort = (process as unknown as { parentPort: ParentPort }).parentPort;

type Runtime = Awaited<ReturnType<typeof createAgentSessionRuntime>>;

let chatId = "";
let cwd = process.cwd();
let chatKind: ChatKind = "coding";
let locale: Locale = "zh";
let preset: RuntimePresetDef = getRuntimePreset(undefined, "coding");

function ht(key: string, vars?: Record<string, string | number>): string {
  return translate(locale, key, vars);
}
let trajectory: TrajectoryRecorder | undefined;
let runtime: Runtime | undefined;
let session: AgentSession | undefined;
let unsubscribe: (() => void) | undefined;
let sessionName: string | undefined;
let autoNameAttempted = false;

/**
 * Mutable harness orchestration state. The resource-loader overrides passed at
 * services creation read these sets, so `session.reload()` re-applies them —
 * per-session hot re-wiring of skills / extensions / system prompt.
 */
const harnessState = {
  disabledSkills: new Set<string>(),
  disabledExtensions: new Set<string>(),
  extraSystemPrompt: "",
};
/**
 * Agent self-tune: an approved harness_propose queues a change here, applied
 * (with reload) once the agent loop ends — reloading mid-stream is unsafe.
 */
let pendingHarnessChange:
  | { enableSkills: string[]; disableSkills: string[]; extraSystemPrompt?: string }
  | undefined;

/** Resolver for an in-flight project trust prompt (blocks session init). */
let pendingTrust: ((v: { trusted: boolean; remember: boolean }) => void) | undefined;

/** Full (unfiltered) resource lists captured inside the overrides. */
let fullSkills: { name: string; description: string; filePath: string; sourceInfo?: { source?: string } }[] = [];
let fullExtensions: {
  path: string;
  tools: Map<string, unknown>;
  commands: Map<string, unknown>;
  sourceInfo?: { source?: string };
}[] = [];

function send(event: HostEvent): void {
  try {
    parentPort.postMessage(event);
  } catch {
    try {
      parentPort.postMessage(JSON.parse(JSON.stringify(event)) as HostEvent);
    } catch (err) {
      console.error("[host] failed to serialize event", err);
    }
  }
}

function serializeModel(model: unknown): ModelInfo | undefined {
  if (!model || typeof model !== "object") return undefined;
  const m = model as Record<string, unknown>;
  return {
    provider: String(m.provider ?? ""),
    id: String(m.id ?? ""),
    name: String(m.name ?? m.id ?? ""),
    contextWindow: typeof m.contextWindow === "number" ? m.contextWindow : undefined,
    reasoning: typeof m.reasoning === "boolean" ? m.reasoning : undefined,
    input: Array.isArray(m.input) ? (m.input as string[]) : undefined,
  };
}

function snapshot(): ChatStateSnapshot {
  const s = session!;
  return {
    chatId,
    cwd,
    sessionId: s.sessionId,
    sessionFile: s.sessionFile,
    sessionName: sessionName ?? s.sessionName,
    model: serializeModel(s.model),
    thinkingLevel: s.thinkingLevel as ThinkingLevel,
    isStreaming: s.isStreaming,
    kind: chatKind,
    presetId: preset.id,
    executionWorld: currentWorld(),
    localSandbox: currentLocalSandboxMode(),
    messages: JSON.parse(JSON.stringify(s.messages)) as unknown[],
  };
}

/**
 * 按执行世界启停专属工具：
 * - grep/find/ls 只有本机实现，VM 世界下收起（避免模型误搜本机文件）
 * - vm_gui/vm_file/vm_screenshot 是 VM 专属能力，本机世界下收起，
 *   避免模型在本机任务里无谓地开云端 VM；确有需要时模型仍可用
 *   tool_search / tool_activate 找回
 */
function applyWorldToolActivation(world: "local" | "vm"): void {
  const s = session;
  if (!s) return;
  const localOnly = ["grep", "find", "ls"];
  const vmOnly = ["vm_gui", "vm_file", "vm_screenshot"];
  const known = new Set(s.getAllTools().map((t) => t.name));
  const active = new Set(s.getActiveToolNames());
  const enable = world === "vm" ? vmOnly : localOnly;
  const disable = world === "vm" ? localOnly : vmOnly;
  for (const n of disable) active.delete(n);
  for (const n of enable) if (known.has(n)) active.add(n);
  s.setActiveToolsByName([...active]);
}

/**
 * Strip redundant heavy payloads from streaming delta events. The renderer
 * reconstructs the partial message from deltas; full messages arrive on
 * message_start / message_end / state snapshots.
 */
function slimEvent(event: Record<string, unknown>): Record<string, unknown> {
  if (event.type === "message_update") {
    const inner = event.assistantMessageEvent as Record<string, unknown> | undefined;
    if (inner && typeof inner.type === "string" && (inner.type as string).endsWith("_delta")) {
      return {
        type: "message_update",
        assistantMessageEvent: { ...inner, partial: undefined },
      };
    }
    return event;
  }
  return event;
}

/**
 * Generate a short session title with the current model after the first
 * exchange completes. Mirrors what polished agent UIs (Claude/ChatGPT) do.
 */
async function maybeAutoName(): Promise<void> {
  const s = session;
  if (!s || autoNameAttempted || s.sessionName || !s.model) return;
  const firstUser = s.messages.find((m) => (m as { role?: string }).role === "user");
  if (!firstUser) return;
  autoNameAttempted = true;
  try {
    const userText = (() => {
      const c = (firstUser as { content?: unknown }).content;
      if (typeof c === "string") return c;
      if (Array.isArray(c)) {
        return c
          .map((b) => ((b as { type?: string; text?: string }).type === "text" ? (b as { text?: string }).text : ""))
          .join(" ");
      }
      return "";
    })().slice(0, 600);
    if (!userText.trim()) return;
    const result = await s.modelRuntime.completeSimple(s.model, {
      systemPrompt:
        "你是标题生成器。用户会给你一段任务描述，你输出一个不超过 20 个字的简短标题概括这个任务。只输出标题本身，不要引号、句号或任何解释。使用与任务描述相同的语言。",
      messages: [{ role: "user", content: userText, timestamp: Date.now() }],
    });
    const title = result.content
      .filter((b) => (b as { type?: string }).type === "text")
      .map((b) => (b as { text?: string }).text ?? "")
      .join("")
      .trim()
      .replace(/^["'「『]|["'」』]$/g, "")
      .slice(0, 40);
    if (title && session === s) {
      s.setSessionName(title);
      sessionName = title;
      send({ type: "state", snapshot: snapshot() });
    }
  } catch {
    // Auto-naming is best-effort; never surface errors.
  }
}

function subscribeToSession(): void {
  unsubscribe?.();
  const s = session!;
  sessionName = s.sessionName;
  unsubscribe = s.subscribe((event) => {
    const e = event as unknown as Record<string, unknown>;
    if (e.type === "session_info_changed") {
      sessionName = (e.name as string | undefined) ?? undefined;
    }
    trajectory?.onSessionEvent(e);
    send({ type: "session_event", event: slimEvent(e) });
    if (e.type === "agent_start" || e.type === "agent_end" || e.type === "compaction_end") {
      send({ type: "state", snapshot: snapshot() });
    }
    if (e.type === "agent_end" || e.type === "compaction_end" || e.type === "turn_end") {
      sendContext();
    }
    if (e.type === "agent_end") {
      void maybeAutoName();
      void applyPendingHarnessChange();
    }
  });
}

function sendContext(): void {
  const s = session;
  if (!s) return;
  try {
    const usage = s.getContextUsage();
    send({
      type: "context",
      usage: usage
        ? { tokens: usage.tokens, contextWindow: usage.contextWindow, percent: usage.percent }
        : null,
      autoCompaction: s.autoCompactionEnabled,
    });
  } catch {
    // context usage is best-effort
  }
}

/** Apply an agent-proposed (and user-approved) harness change after the run. */
async function applyPendingHarnessChange(): Promise<void> {
  const change = pendingHarnessChange;
  const s = session;
  if (!change || !s) return;
  pendingHarnessChange = undefined;
  try {
    for (const name of change.enableSkills) harnessState.disabledSkills.delete(name);
    for (const name of change.disableSkills) harnessState.disabledSkills.add(name);
    if (change.extraSystemPrompt !== undefined) {
      harnessState.extraSystemPrompt = change.extraSystemPrompt;
    }
    await s.reload();
    send({ type: "harness", harness: serializeHarness() });
    send({ type: "state", snapshot: snapshot() });
  } catch (err) {
    send({
      type: "harness_error",
      message: `自调优应用失败: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

/** 独有能力：agent 可以提案调整自己的 harness，经人工批准后热生效。 */
function buildSelfTuneTool(): ToolDefinition {
  return {
    name: "harness_propose",
    label: "Harness 自调优",
    description:
      "提案修改你自己的 harness 装配：启用/停用技能，或设置追加系统指令。用于当前任务需要某个被停用的技能、或用户的偏好应固化为长期指令时。提案会弹给用户审批，批准后在本轮结束时热生效（对话保留）。不要频繁使用。",
    promptSnippet: "harness_propose: 提案调整自身装配（技能启停/追加指令），需用户批准",
    parameters: Type.Object({
      reason: Type.String({ description: "为什么需要这次变更（展示给用户）" }),
      enable_skills: Type.Optional(Type.Array(Type.String(), { description: "要启用的技能名" })),
      disable_skills: Type.Optional(Type.Array(Type.String(), { description: "要停用的技能名" })),
      extra_system_prompt: Type.Optional(
        Type.String({ description: "整体替换现有追加系统指令（空字符串表示清除）" }),
      ),
    }),
    execute: async (_id, params) => {
      const p = params as {
        reason: string;
        enable_skills?: string[];
        disable_skills?: string[];
        extra_system_prompt?: string;
      };
      const approved = await requestHumanApproval(
        "harness_propose",
        params as Record<string, unknown>,
        "agent 自调优提案",
      );
      if (!approved) {
        return {
          content: [{ type: "text", text: "用户拒绝了此提案。请继续用当前配置完成任务。" }],
          details: {},
        };
      }
      pendingHarnessChange = {
        enableSkills: p.enable_skills ?? [],
        disableSkills: p.disable_skills ?? [],
        extraSystemPrompt: p.extra_system_prompt,
      };
      return {
        content: [
          {
            type: "text",
            text: "提案已获批准，将在本轮任务结束后热生效（技能启停需要重载装配）。请先完成当前任务。",
          },
        ],
        details: {},
      };
    },
  };
}

function serializeTree(): SessionTreeNode[] {
  const sm = session!.sessionManager;
  const activeIds = new Set(sm.getBranch().map((e) => e.id));

  function preview(entry: Record<string, unknown>): { preview?: string; role?: string } {
    if (entry.type === "message") {
      const message = entry.message as Record<string, unknown> | undefined;
      if (!message) return {};
      const role = String(message.role ?? "");
      let text = "";
      const content = message.content;
      if (typeof content === "string") {
        text = content;
      } else if (Array.isArray(content)) {
        text = content
          .map((b) => {
            const bb = b as { type?: string; text?: string; name?: string };
            if (bb.type === "text") return bb.text ?? "";
            if (bb.type === "toolCall") return `[${bb.name}]`;
            return "";
          })
          .filter(Boolean)
          .join(" ");
      }
      return { preview: text.slice(0, 100), role };
    }
    return {};
  }

  function convert(node: {
    entry: Record<string, unknown> & { id: string; parentId?: string | null; timestamp?: string };
    children: unknown[];
    label?: string;
  }): SessionTreeNode {
    const p = preview(node.entry);
    return {
      id: node.entry.id,
      parentId: node.entry.parentId ?? undefined,
      type: String(node.entry.type ?? ""),
      preview: p.preview,
      role: p.role,
      label: node.label,
      onActivePath: activeIds.has(node.entry.id),
      timestamp: node.entry.timestamp ? Date.parse(String(node.entry.timestamp)) : undefined,
      children: (node.children as Parameters<typeof convert>[0][]).map(convert),
    };
  }

  return (sm.getTree() as unknown as Parameters<typeof convert>[0][]).map(convert);
}

/** All slash-commands prompt() can expand: templates, /skill:name, extension commands. */
function serializeCommands(): SlashCommandPayload[] {
  const s = session!;
  const out: SlashCommandPayload[] = [];
  for (const t of s.promptTemplates) {
    out.push({
      name: t.name,
      description: t.description,
      argumentHint: t.argumentHint,
      kind: "template",
    });
  }
  for (const sk of fullSkills) {
    if (harnessState.disabledSkills.has(sk.name)) continue;
    out.push({ name: `skill:${sk.name}`, description: sk.description, kind: "skill" });
  }
  for (const e of fullExtensions) {
    if (harnessState.disabledExtensions.has(e.path) || e.path.includes("bivor-guardrails")) {
      continue;
    }
    for (const c of e.commands.keys()) {
      out.push({ name: String(c), kind: "extension" });
    }
  }
  return out;
}

function sendCommands(): void {
  if (!session) return;
  try {
    send({ type: "commands", commands: serializeCommands() });
  } catch {
    // best-effort
  }
}

function serializeHarness(): HarnessPayload {
  const s = session!;
  const loader = s.resourceLoader;
  const ext = loader.getExtensions();
  const prompts = loader.getPrompts();
  const agentsFiles = loader.getAgentsFiles().agentsFiles;
  const active = new Set(s.getActiveToolNames());
  const systemPrompt = s.systemPrompt ?? "";

  const basename = (p: string): string => p.split("/").filter(Boolean).pop() ?? p;

  return {
    preset: { id: preset.id, name: preset.name },
    systemPrompt: { chars: systemPrompt.length, text: systemPrompt },
    systemPromptSource: loader.getSystemPromptSource()?.path,
    agentsFiles: agentsFiles.map((f) => ({ path: f.path, chars: f.content.length })),
    appendSystemPromptSources: loader.getAppendSystemPromptSources().map((x) => x.path),
    extraSystemPrompt: harnessState.extraSystemPrompt,
    skills: fullSkills.map((sk) => ({
      name: sk.name,
      description: sk.description,
      filePath: sk.filePath,
      source: sk.sourceInfo?.source ?? "",
      disabled: harnessState.disabledSkills.has(sk.name),
    })),
    extensions: fullExtensions
      // 治理门自身是内部基础设施，不允许在画布上被关闭
      .filter((e) => !e.path.includes("bivor-guardrails"))
      .map((e) => ({
        path: e.path,
        name: basename(e.path).replace(/\.(ts|js|mjs)$/, ""),
        source: e.sourceInfo?.source ?? "",
        tools: [...e.tools.keys()].map(String),
        commands: [...e.commands.keys()].map(String),
        disabled: harnessState.disabledExtensions.has(e.path),
      })),
    extensionErrors: ext.errors.map((e) => ({ path: e.path, error: e.error })),
    prompts: prompts.prompts.map((p) => ({
      name: p.name,
      description: (p as { description?: string }).description,
      source: (p as { sourceInfo?: { source?: string } }).sourceInfo?.source ?? "",
    })),
    tools: s.getAllTools().map((t) => ({
      name: t.name,
      description: t.description?.slice(0, 120),
      active: active.has(t.name),
    })),
  };
}

/** 模型请求瞬间的装配快照（Trajectory 每步的事实来源）。 */
function captureAssembly(): Omit<
  import("@shared/protocol").TrajectoryStepPayload,
  "index" | "run" | "time" | "toolCalls" | "usage" | "status"
> {
  const s = session!;
  const loader = s.resourceLoader;
  const systemPrompt = s.systemPrompt ?? "";
  const sections: { label: string; source?: string; chars?: number }[] = [];
  const base = loader.getSystemPromptSource()?.path;
  sections.push({ label: ht("host.systemPrompt"), source: base });
  for (const f of loader.getAgentsFiles().agentsFiles) {
    sections.push({ label: "AGENTS.md", source: f.path, chars: f.content.length });
  }
  for (const p of loader.getAppendSystemPromptSources()) {
    sections.push({ label: ht("host.append"), source: p.path });
  }
  const memory = memorySystemPrompt(cwd);
  if (memory) sections.push({ label: ht("host.memory"), chars: memory.length });
  if (preset.appendSystemPrompt) {
    sections.push({
      label: ht("host.presetPrompt", { name: preset.name }),
      chars: preset.appendSystemPrompt.length,
    });
  }
  if (harnessState.extraSystemPrompt) {
    sections.push({ label: ht("host.extraPrompt"), chars: harnessState.extraSystemPrompt.length });
  }
  let contextTokens: number | null = null;
  try {
    contextTokens = s.getContextUsage()?.tokens ?? null;
  } catch {
    // best-effort
  }
  const model = s.model as { id?: string } | undefined;
  return {
    model: model?.id,
    thinkingLevel: String(s.thinkingLevel),
    world: currentWorld(),
    systemPromptChars: systemPrompt.length,
    sections,
    activeTools: s.getActiveToolNames(),
    skills: fullSkills
      .filter((sk) => !harnessState.disabledSkills.has(sk.name))
      .map((sk) => sk.name),
    extraPromptChars: harnessState.extraSystemPrompt.length,
    contextTokens,
  };
}

async function init(msg: HostInit): Promise<void> {
  chatId = msg.chatId;
  cwd = msg.cwd;
  locale = msg.locale === "en" ? "en" : "zh";
  preset = localizePreset(getRuntimePreset(msg.presetId, msg.kind), locale);
  chatKind = presetKind(preset);
  try {
    process.chdir(cwd);
  } catch {
    send({ type: "init_error", message: ht("host.cwdFail", { cwd }) });
    return;
  }

  try {
    const createRuntime: CreateAgentSessionRuntimeFactory = async (args) => {
      const services = await createAgentSessionServices({
        cwd: args.cwd,
        resourceLoaderOptions: {
          skillsOverride: (base) => {
            fullSkills = base.skills;
            return {
              skills: base.skills.filter((sk) => !harnessState.disabledSkills.has(sk.name)),
              diagnostics: base.diagnostics,
            };
          },
          extensionsOverride: (base) => {
            fullExtensions = base.extensions as typeof fullExtensions;
            return {
              ...base,
              extensions: base.extensions.filter(
                (ext) => !harnessState.disabledExtensions.has(ext.path),
              ),
            };
          },
          appendSystemPromptOverride: (base) => {
            const out = [...base];
            const memory = memorySystemPrompt(cwd);
            if (memory) out.push(memory);
            if (preset.appendSystemPrompt) out.push(preset.appendSystemPrompt);
            if (harnessState.extraSystemPrompt) out.push(harnessState.extraSystemPrompt);
            return out;
          },
          extensionFactories: [createGuardrailExtension()],
        },
        resourceLoaderReloadOptions: {
          // Gate project-local extensions/skills behind explicit user trust
          // (same store as the pi CLI, so decisions carry over both ways).
          resolveProjectTrust: async ({ extensionsResult }) => {
            // Called on every reload — only gate when the project actually has
            // trust-requiring local resources.
            if (!hasTrustRequiringProjectResources(cwd)) return true;
            const store = new ProjectTrustStore(getAgentDir());
            const decision = store.get(cwd);
            if (typeof decision === "boolean") return decision;
            const resources = extensionsResult.extensions
              .map((e) => e.path)
              .filter((p) => p.startsWith(cwd));
            // Extensions alone miss project skills; list those too so the user
            // sees everything the trust decision would load.
            try {
              const { readdirSync, existsSync } = await import("node:fs");
              const { join } = await import("node:path");
              for (const base of [join(cwd, ".pi", "skills"), join(cwd, ".agents", "skills")]) {
                if (!existsSync(base)) continue;
                for (const dir of readdirSync(base, { withFileTypes: true })) {
                  if (dir.isDirectory() && existsSync(join(base, dir.name, "SKILL.md"))) {
                    resources.push(join(base, dir.name, "SKILL.md"));
                  }
                }
              }
            } catch {
              // listing is informational only
            }
            const answer = await new Promise<{ trusted: boolean; remember: boolean }>(
              (resolve) => {
                pendingTrust = resolve;
                send({ type: "trust_request", cwd, resources });
              },
            );
            pendingTrust = undefined;
            if (answer.remember) store.set(cwd, answer.trusted);
            return answer.trusted;
          },
        },
      });
      return {
        ...(await createAgentSessionFromServices({
          services,
          sessionManager: args.sessionManager,
          sessionStartEvent: args.sessionStartEvent,
          customTools: filterCustomTools(preset, [
            // 世界路由版 bash/read/write/edit：同名覆盖内建工具，
            // 后端在本机与云端 VM 间按会话热切换。
            ...buildWorldToolDefinitions(args.cwd),
            ...buildSandboxTools(),
            ...buildWebTools(),
            buildDeployTool(() => cwd),
            buildBrowserTool(),
            ...buildDisclosureTools(() => session),
            buildCodeRunTool(),
            buildSelfTuneTool(),
            buildMemoryTool({
              getCwd: () => cwd,
              onSaved: (content) => send({ type: "memory", content }),
            }),
            buildSubagentTool({
              getCwd: () => cwd,
              getParent: () => session,
              onUpdate: (update) => send({ type: "subagent", update }),
            }),
          ]),
        })),
        services,
        diagnostics: services.diagnostics,
      };
    };

    runtime = await createAgentSessionRuntime(createRuntime, {
      cwd,
      agentDir: getAgentDir(),
      sessionManager: msg.sessionFile
        ? SessionManager.open(msg.sessionFile)
        : SessionManager.create(cwd),
    });
    session = runtime.session;

    if (msg.model) {
      const modelRuntime = await ModelRuntime.create();
      const model = modelRuntime.getModel(msg.model.provider, msg.model.modelId);
      if (model) await session.setModel(model);
    }
    if (msg.thinkingLevel) {
      session.setThinkingLevel(msg.thinkingLevel as never);
    }
    applyPresetToolPolicy(session, preset);
    if (preset.toolDisclosure) {
      applyProgressiveDisclosure(session, preset.toolDisclosure.threshold);
    }
    // 初始世界是本机：把 VM 专属工具收出在册表，防止模型无谓开 VM
    applyWorldToolActivation(currentWorld());
    if (preset.guardrails) {
      // Preset 护栏叠层：作为初始值写入策略门，用户之后仍可在 UI 调整。
      setGuardrails({
        ...guardrails,
        ...preset.guardrails,
        toolPolicies: { ...guardrails.toolPolicies, ...preset.guardrails.toolPolicies },
        commandRules: [...guardrails.commandRules, ...preset.guardrails.commandRules],
      });
    }
    trajectory = createTrajectoryRecorder({
      capture: captureAssembly,
      emit: (steps) => send({ type: "trajectory", steps }),
    });

    setGuardrailHooks({
      requestApproval: (request) => send({ type: "approval_request", request }),
      resolvedApproval: (id) => send({ type: "approval_resolved", id }),
      emitPolicyEvent: (event) => send({ type: "policy_event", event }),
      getSessionCost: () => {
        try {
          // Subagent spend counts against the parent's session budget.
          return (session?.getSessionStats().cost ?? 0) + totalSubagentCost();
        } catch {
          return 0;
        }
      },
    });
    onSandboxStatus((sb) => send({ type: "sandbox", sandbox: sb }));
    onWorldChange((world) => send({ type: "execution_world", world }));
    onLocalTermData((data) => send({ type: "local_term", data }));
    onLocalSandboxChange((mode) => send({ type: "local_sandbox", mode }));
    if (preset.ui.sandbox) warmLocalAgentShell();
    subscribeToSession();
    send({ type: "ready", snapshot: snapshot() });
    sendContext();
    sendCommands();
    if (preset.ui.sandbox && sandboxAvailable()) {
      send({ type: "sandbox", sandbox: currentSandboxStatus() });
    }
  } catch (err) {
    send({ type: "init_error", message: err instanceof Error ? err.message : String(err) });
  }
}

async function handleCommand(msg: HostInbound): Promise<void> {
  if (msg.type === "init") {
    await init(msg);
    return;
  }
  if (msg.type === "trust_response") {
    // Arrives while init() is still blocked on the trust prompt — must be
    // handled before the session-exists check.
    pendingTrust?.({ trusted: msg.trusted, remember: msg.remember });
    return;
  }
  if (!session) {
    send({ type: "prompt_error", message: ht("host.notReady") });
    return;
  }
  const s = session;
  switch (msg.type) {
    case "prompt": {
      try {
        const images = msg.images?.map((img) => ({
          type: "image" as const,
          data: img.data,
          mimeType: img.mimeType,
        }));
        await s.prompt(msg.text, {
          ...(images && images.length > 0 ? { images } : {}),
          ...(msg.streamingBehavior ? { streamingBehavior: msg.streamingBehavior } : {}),
        });
        send({ type: "prompt_done" });
      } catch (err) {
        send({ type: "prompt_error", message: err instanceof Error ? err.message : String(err) });
      }
      send({ type: "state", snapshot: snapshot() });
      break;
    }
    case "steer":
    case "followUp": {
      const imgs = msg.images?.map((img) => ({
        type: "image" as const,
        data: img.data,
        mimeType: img.mimeType,
      }));
      try {
        if (msg.type === "steer") await s.steer(msg.text, imgs);
        else await s.followUp(msg.text, imgs);
      } catch (err) {
        // Don't escalate a steer/followUp failure to a fatal chat death.
        send({ type: "prompt_error", message: err instanceof Error ? err.message : String(err) });
      }
      break;
    }
    case "clear_queue": {
      try {
        s.clearQueue(); // SDK emits queue_update itself
      } catch {
        // nothing queued
      }
      break;
    }
    case "abort_retry":
      s.abortRetry(); // SDK emits auto_retry_end itself
      break;
    case "abort":
      cancelPendingApprovals();
      await abortAllSubagents();
      await s.abort();
      send({ type: "state", snapshot: snapshot() });
      break;
    case "set_model": {
      const modelRuntime = await ModelRuntime.create();
      const model = modelRuntime.getModel(msg.provider, msg.modelId);
      if (model) {
        await s.setModel(model);
        send({ type: "state", snapshot: snapshot() });
      } else {
        send({ type: "prompt_error", message: ht("host.modelMissing", { provider: msg.provider, modelId: msg.modelId }) });
      }
      break;
    }
    case "set_thinking_level":
      s.setThinkingLevel(msg.level as never);
      send({ type: "state", snapshot: snapshot() });
      break;
    case "set_name":
      s.setSessionName(msg.name);
      sessionName = msg.name;
      send({ type: "state", snapshot: snapshot() });
      break;
    case "get_tree":
      send({ type: "tree", nodes: serializeTree() });
      break;
    case "fork": {
      // In-file branch navigation (keeps full history in the same session file).
      // With summarize, pi condenses the abandoned branch via LLM and carries
      // the summary into the new branch's context.
      try {
        const result = await s.navigateTree(
          msg.entryId,
          msg.summarize ? { summarize: true } : undefined,
        );
        send({ type: "navigated", editorText: result.editorText });
        send({ type: "state", snapshot: snapshot() });
        send({ type: "tree", nodes: serializeTree() });
      } catch (err) {
        send({ type: "prompt_error", message: err instanceof Error ? err.message : String(err) });
      }
      break;
    }
    case "fork_user_message": {
      // Message-level "edit & branch": map the Nth user message on the active
      // branch to its session entry, then reuse tree navigation.
      try {
        const userEntries = s.sessionManager
          .getBranch()
          .filter(
            (e) =>
              (e as { type?: string }).type === "message" &&
              ((e as { message?: { role?: string } }).message?.role ?? "") === "user",
          );
        const entry = userEntries[msg.userIndex] as { id?: string } | undefined;
        if (!entry?.id) throw new Error("找不到对应的消息节点");
        const result = await s.navigateTree(entry.id);
        send({ type: "navigated", editorText: result.editorText });
        send({ type: "state", snapshot: snapshot() });
        send({ type: "tree", nodes: serializeTree() });
      } catch (err) {
        send({ type: "prompt_error", message: err instanceof Error ? err.message : String(err) });
      }
      break;
    }
    case "compact":
      try {
        await s.compact();
      } catch (err) {
        send({ type: "prompt_error", message: err instanceof Error ? err.message : String(err) });
      }
      send({ type: "state", snapshot: snapshot() });
      sendContext();
      break;
    case "get_context":
      sendContext();
      break;
    case "list_commands":
      sendCommands();
      break;
    case "set_auto_compaction":
      s.setAutoCompactionEnabled(msg.enabled);
      sendContext();
      break;
    case "bash": {
      try {
        // 走世界路由后端：命令进本机终端视图、受沙箱管控，VM 世界下落在 VM
        const result = await s.executeBash(
          msg.command,
          (chunk) => {
            send({ type: "bash_chunk", data: chunk });
          },
          { operations: worldBashOperations },
        );
        send({ type: "bash_done", exitCode: result.exitCode });
      } catch (err) {
        send({ type: "bash_done", error: err instanceof Error ? err.message : String(err) });
      }
      send({ type: "state", snapshot: snapshot() });
      break;
    }
    case "abort_bash":
      s.abortBash();
      break;
    case "get_stats": {
      const stats = s.getSessionStats();
      const usage = s.getContextUsage();
      send({
        type: "stats",
        stats: {
          userMessages: stats.userMessages,
          assistantMessages: stats.assistantMessages,
          toolCalls: stats.toolCalls,
          totalMessages: stats.totalMessages,
          tokens: stats.tokens,
          cost: stats.cost,
          contextTokens: usage?.tokens ?? undefined,
          contextWindow: usage?.contextWindow,
        },
      });
      break;
    }
    case "list_tools": {
      const active = new Set(s.getActiveToolNames());
      send({
        type: "tools",
        tools: s.getAllTools().map((t) => ({
          name: t.name,
          description: (t as { description?: string }).description?.slice(0, 120),
          active: active.has(t.name),
        })),
      });
      break;
    }
    case "set_tools": {
      s.setActiveToolsByName(msg.names);
      const active = new Set(s.getActiveToolNames());
      send({
        type: "tools",
        tools: s.getAllTools().map((t) => ({
          name: t.name,
          description: (t as { description?: string }).description?.slice(0, 120),
          active: active.has(t.name),
        })),
      });
      // Keep the canvas's harness copy in sync without a renderer-side delay hack.
      send({ type: "harness", harness: serializeHarness() });
      break;
    }
    case "export_html": {
      const path = await s.exportToHtml();
      send({ type: "exported", path });
      break;
    }
    case "export_jsonl": {
      const path = s.exportToJsonl();
      send({ type: "exported", path });
      break;
    }
    case "get_guardrails":
      send({ type: "guardrails", guardrails });
      break;
    case "set_guardrails":
      setGuardrails(msg.guardrails);
      send({ type: "guardrails", guardrails });
      break;
    case "approval_response":
      resolveApproval(msg.id, msg.approved);
      send({ type: "approval_resolved", id: msg.id });
      break;
    case "sandbox_create":
      try {
        await ensureSandbox();
      } catch {
        // status event already emitted
      }
      break;
    case "sandbox_destroy":
      await destroySandbox();
      break;
    case "sandbox_status":
      // 无 API key 时保持前端的"未配置"引导（不回发状态）
      if (sandboxAvailable()) {
        send({ type: "sandbox", sandbox: currentSandboxStatus() });
      }
      break;
    case "get_harness":
      send({ type: "harness", harness: serializeHarness() });
      break;
    case "set_harness": {
      try {
        if (s.isStreaming) {
          throw new Error("代理正在运行中，无法热更 Harness。请等待当前任务结束或先中止。");
        }
        harnessState.disabledSkills = new Set(msg.disabledSkills);
        harnessState.disabledExtensions = new Set(msg.disabledExtensions);
        harnessState.extraSystemPrompt = msg.extraSystemPrompt;
        await s.reload();
        send({ type: "harness", harness: serializeHarness() });
        send({ type: "state", snapshot: snapshot() });
        sendCommands();
      } catch (err) {
        send({
          type: "harness_error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }
    case "get_state":
      send({ type: "state", snapshot: snapshot() });
      break;
    case "get_trajectory":
      send({ type: "trajectory", steps: trajectory?.steps ?? [] });
      break;
    case "set_local_sandbox":
      setLocalSandboxMode(msg.mode);
      break;
    case "agent_term_input":
      writeAgentTerm(msg.data);
      break;
    case "agent_term_resize":
      resizeAgentTerm(msg.cols, msg.rows);
      break;
    case "set_execution_world": {
      if (msg.world === "vm" && !sandboxAvailable()) {
        send({ type: "prompt_error", message: ht("host.e2bMissing") });
        break;
      }
      setWorld(msg.world);
      applyWorldToolActivation(msg.world);
      send({ type: "harness", harness: serializeHarness() });
      send({ type: "state", snapshot: snapshot() });
      break;
    }
  }
}

parentPort.on("message", (e) => {
  void handleCommand(e.data).catch((err) => {
    send({ type: "fatal", message: err instanceof Error ? err.message : String(err) });
  });
});

let shuttingDown = false;
async function gracefulShutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await abortAllSubagents();
    await closeBrowser();
    await destroySandbox();
  } catch {
    // best effort
  }
  process.exit(0);
}
process.on("SIGTERM", () => void gracefulShutdown());
process.on("message", (m: unknown) => {
  if (m && typeof m === "object" && (m as { type?: string }).type === "shutdown") {
    void gracefulShutdown();
  }
});

process.on("uncaughtException", (err) => {
  send({ type: "fatal", message: ht("host.processCrash", { error: err.message }) });
});
process.on("unhandledRejection", (reason) => {
  send({ type: "fatal", message: ht("host.processCrash", { error: String(reason) }) });
});
