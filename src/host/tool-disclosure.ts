/**
 * 工具渐进披露（dsh ToolSearch 思路）：扩展 / MCP 工具一多，全量 schema
 * 会撑爆上下文。超过阈值时只保留核心工具在册，长尾工具收进目录，
 * 模型需要时用 tool_search 检索、tool_activate 启用（下一步生效）。
 */
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

interface SessionLike {
  getAllTools(): { name: string; description?: string }[];
  getActiveToolNames(): string[];
  setActiveToolsByName(names: string[]): void;
}

/** 始终保留在册的核心工具：内建七件套 + 桌面自带能力。 */
const CORE_TOOL_NAMES = new Set([
  "read",
  "write",
  "edit",
  "bash",
  "grep",
  "find",
  "ls",
  "memory_save",
  "subagent_run",
  "harness_propose",
  "vm_gui",
  "vm_file",
  "vm_screenshot",
  "code_run",
  "tool_search",
  "tool_activate",
  "web_search",
  "web_fetch",
  "browser",
  "deploy",
]);

/**
 * 超过阈值时收起长尾（非核心）工具。核心工具与用户手动启用的
 * 状态不受影响；被收起的工具随时可被 tool_activate 找回。
 */
export function applyProgressiveDisclosure(session: SessionLike, threshold: number): boolean {
  const all = session.getAllTools().map((t) => t.name);
  if (all.length <= threshold) return false;
  const active = session.getActiveToolNames().filter((n) => CORE_TOOL_NAMES.has(n));
  session.setActiveToolsByName(active);
  return true;
}

export function buildDisclosureTools(getSession: () => SessionLike | undefined): ToolDefinition[] {
  const search: ToolDefinition = {
    name: "tool_search",
    label: "工具搜索",
    description:
      "搜索完整工具目录（包括当前未启用的扩展 / MCP 工具）。当没有合适的已启用工具时先搜索，再用 tool_activate 启用需要的工具。",
    promptSnippet: "tool_search: 检索完整工具目录（含未启用的长尾工具）",
    parameters: Type.Object({
      query: Type.String({ description: "关键词，匹配工具名与描述" }),
    }),
    execute: async (_id, params) => {
      const s = getSession();
      if (!s) throw new Error("会话未初始化");
      const q = String((params as { query: string }).query).toLowerCase();
      const active = new Set(s.getActiveToolNames());
      const hits = s
        .getAllTools()
        .filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            (t.description ?? "").toLowerCase().includes(q),
        )
        .slice(0, 10);
      const text =
        hits.length === 0
          ? `没有匹配「${q}」的工具。`
          : hits
              .map(
                (t) =>
                  `${t.name}${active.has(t.name) ? "（已启用）" : ""} — ${(t.description ?? "").slice(0, 100)}`,
              )
              .join("\n");
      return {
        content: [
          {
            type: "text",
            text: `${text}\n\n未启用的工具需先调用 tool_activate 启用，schema 会在下一步加入。`,
          },
        ],
        details: {},
      };
    },
  };

  const activate: ToolDefinition = {
    name: "tool_activate",
    label: "启用工具",
    description:
      "启用一个或多个目录中的工具（通常先用 tool_search 找到名字）。启用后工具 schema 在下一步加入，届时即可调用。",
    promptSnippet: "tool_activate: 启用目录中的工具（下一步生效）",
    parameters: Type.Object({
      names: Type.Array(Type.String(), { description: "要启用的工具名" }),
    }),
    execute: async (_id, params) => {
      const s = getSession();
      if (!s) throw new Error("会话未初始化");
      const known = new Set(s.getAllTools().map((t) => t.name));
      const requested = (params as { names: string[] }).names;
      const found = requested.filter((n) => known.has(n));
      const missing = requested.filter((n) => !known.has(n));
      if (found.length > 0) {
        s.setActiveToolsByName([...new Set([...s.getActiveToolNames(), ...found])]);
      }
      const lines = [
        found.length > 0 && `已启用: ${found.join(", ")}（schema 下一步生效，届时直接调用）`,
        missing.length > 0 && `未找到: ${missing.join(", ")}（用 tool_search 确认名字）`,
      ].filter(Boolean);
      return { content: [{ type: "text", text: lines.join("\n") || "没有变化。" }], details: {} };
    },
  };

  return [search, activate];
}
