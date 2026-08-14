/**
 * Subagents: the agent can spawn parallel child agents in the same workspace.
 * Each subagent is a full in-memory AgentSession (same SDK, same model) with
 * its own context window — ideal for parallel exploration, big-file digestion,
 * or isolated risky work, without polluting the parent's context.
 */
import {
  createAgentSession,
  SessionManager,
  type AgentSession,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { SubagentUpdatePayload } from "@shared/protocol";
import { guardrails } from "./guardrails";
import { buildSandboxTools, sandboxAvailable } from "./sandbox";

const MAX_CONCURRENT = 4;
const DEFAULT_MAX_TURNS = 24;
const HARD_MAX_TURNS = 50;
const WALL_CLOCK_LIMIT_MS = 15 * 60 * 1000;

interface SubagentDeps {
  getCwd: () => string;
  /** Parent session, used to inherit the current model. */
  getParent: () => AgentSession | undefined;
  onUpdate: (update: SubagentUpdatePayload) => void;
}

const running = new Map<string, AgentSession>();
let seq = 0;
/** Cost of finished subagent runs; live runs are added from session stats. */
let finishedCost = 0;

export function activeSubagentCount(): number {
  return running.size;
}

/** Total USD spent by subagents (finished + live), counted into parent budget. */
export function totalSubagentCost(): number {
  let live = 0;
  for (const s of running.values()) {
    try {
      live += s.getSessionStats().cost;
    } catch {
      // session mid-teardown
    }
  }
  return finishedCost + live;
}

export async function abortAllSubagents(): Promise<void> {
  await Promise.allSettled([...running.values()].map((s) => s.abort()));
}

function lastAssistantText(session: AgentSession): string {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const m = session.messages[i] as { role?: string; content?: unknown };
    if (m.role !== "assistant") continue;
    const c = m.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      const text = c
        .filter((b): b is { type: string; text: string } => (b as { type?: string }).type === "text")
        .map((b) => b.text)
        .join("\n");
      if (text.trim()) return text;
    }
  }
  return "";
}

export function buildSubagentTool(deps: SubagentDeps): ToolDefinition {
  return {
    name: "subagent_run",
    label: "子 Agent",
    description:
      "派生一个并行子 agent 在同一工作目录执行独立子任务，拥有全新的上下文窗口。适合：并行探索多个方向、消化大量文件后只带回结论、执行与主线无关的封闭子任务。子任务描述必须自包含（子 agent 看不到当前对话）。结果返回子 agent 的最终报告。最多同时 4 个；可在一条消息里发多个调用实现并行。vm=true 时子 agent 额外获得云端 VM 工具（与父会话共享同一台 VM），适合让子 agent 在隔离环境跑不可信代码。",
    promptSnippet: "subagent_run: 派生并行子 agent 处理自包含子任务，返回最终报告",
    executionMode: "parallel",
    parameters: Type.Object({
      task: Type.String({
        description: "自包含的任务描述：目标、约束、期望返回什么。子 agent 没有当前对话的记忆",
      }),
      name: Type.Optional(Type.String({ description: "短标签（显示在 UI），如 explore-auth" })),
      readonly: Type.Optional(
        Type.Boolean({ description: "true 时子 agent 只能读（read/grep/find/ls），不能改文件或跑命令" }),
      ),
      max_turns: Type.Optional(
        Type.Number({ description: `最大回合数，默认 ${DEFAULT_MAX_TURNS}，上限 ${HARD_MAX_TURNS}` }),
      ),
      vm: Type.Optional(
        Type.Boolean({
          description: "true 时子 agent 获得 vm_* 云端虚拟机工具（与父会话共享同一台 VM）。需要已配置 E2B Key",
        }),
      ),
    }),
    execute: async (_id, params) => {
      const p = params as {
        task: string;
        name?: string;
        readonly?: boolean;
        max_turns?: number;
        vm?: boolean;
      };
      const maxConcurrent = guardrails.subagentMaxConcurrent || MAX_CONCURRENT;
      if (running.size >= maxConcurrent) {
        return {
          content: [
            { type: "text", text: `已有 ${running.size} 个子 agent 在运行（上限 ${maxConcurrent}），请等待后再派生` },
          ],
          details: {},
          isError: true,
        };
      }
      const id = `sub-${++seq}`;
      const name = p.name?.trim() || `子任务 ${seq}`;
      // Harness governance caps the per-run turn limit regardless of tool params.
      const turnCap = guardrails.subagentMaxTurns || HARD_MAX_TURNS;
      const maxTurns = Math.min(Math.max(p.max_turns ?? DEFAULT_MAX_TURNS, 1), turnCap);
      const wantVm = Boolean(p.vm) && sandboxAvailable();
      const startedAt = Date.now();
      let session: AgentSession | undefined;

      const update = (u: Partial<SubagentUpdatePayload>): void => {
        let cost: number | undefined;
        try {
          cost = session?.getSessionStats().cost;
        } catch {
          // session mid-setup / teardown
        }
        deps.onUpdate({
          id,
          name,
          state: "running",
          turns: 0,
          toolCalls: 0,
          task: p.task.slice(0, 300),
          maxTurns,
          startedAt,
          readonly: Boolean(p.readonly),
          vm: wantVm,
          cost,
          ...u,
        });
      };

      update({ activity: "启动中…" });
      try {
        const parent = deps.getParent();
        const created = await createAgentSession({
          cwd: deps.getCwd(),
          model: parent?.model,
          sessionManager: SessionManager.inMemory(deps.getCwd()),
          ...(p.readonly ? { tools: ["read", "grep", "find", "ls"] } : {}),
          // Shares the parent's sandbox singleton — same VM, same files.
          ...(wantVm ? { customTools: buildSandboxTools() } : {}),
        });
        session = created.session;
        running.set(id, session);

        let turns = 0;
        let toolCalls = 0;
        let aborted: string | undefined;
        const unsub = session.subscribe((e: { type: string; toolName?: string }) => {
          if (e.type === "turn_end") {
            turns++;
            update({ turns, toolCalls });
            if (turns >= maxTurns && session) {
              aborted = `达到最大回合数 ${maxTurns}`;
              void session.abort();
            }
          } else if (e.type === "tool_execution_start") {
            toolCalls++;
            update({ turns, toolCalls, activity: e.toolName });
          }
        });
        const timer = setTimeout(() => {
          aborted = "达到 15 分钟时间上限";
          void session?.abort();
        }, WALL_CLOCK_LIMIT_MS);

        try {
          await session.prompt(p.task);
        } finally {
          clearTimeout(timer);
          unsub();
        }

        const report = lastAssistantText(session);
        const stats = session.getSessionStats();
        const vmNote = p.vm && !wantVm ? " · VM 请求被忽略（未配置 E2B Key）" : wantVm ? " · VM" : "";
        const summary = `[子 agent ${name}] ${turns} 回合 · ${toolCalls} 次工具调用 · $${stats.cost.toFixed(4)}${vmNote}${aborted ? ` · 提前终止（${aborted}）` : ""}`;
        update({ state: aborted ? "aborted" : "done", turns, toolCalls, activity: summary, cost: stats.cost });
        return {
          content: [
            { type: "text", text: `${summary}\n\n${report || "（子 agent 没有产出文本报告）"}` },
          ],
          details: { turns, toolCalls, cost: stats.cost, aborted },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        update({ state: "error", activity: message });
        return {
          content: [{ type: "text", text: `子 agent 失败: ${message}` }],
          details: {},
          isError: true,
        };
      } finally {
        running.delete(id);
        try {
          if (session) finishedCost += session.getSessionStats().cost;
        } catch {
          // stats unavailable mid-teardown
        }
        session?.dispose();
      }
    },
  };
}
