import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

/**
 * Project long-term memory: a plain markdown file at .pi/memory.md that the
 * agent can append to via the memory_save tool. Its content is injected into
 * every session's system prompt, giving agents durable cross-session memory
 * that stays versionable and human-auditable.
 */

export function memoryPath(cwd: string): string {
  return join(cwd, ".pi", "memory.md");
}

export function readMemory(cwd: string): string {
  try {
    const p = memoryPath(cwd);
    if (!existsSync(p)) return "";
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

/** System prompt section built from the memory file; empty string when no memory. */
export function memorySystemPrompt(cwd: string): string {
  const content = readMemory(cwd).trim();
  if (!content) return "";
  return [
    "# 项目长期记忆",
    "以下是此前会话中沉淀的项目级长期记忆（用户偏好、项目约定、踩过的坑）。请遵循这些记忆；如果发现某条已过时或错误，告知用户。",
    "",
    content,
  ].join("\n");
}

const CATEGORIES = ["preference", "convention", "pitfall", "fact"] as const;
const CATEGORY_LABEL: Record<string, string> = {
  preference: "偏好",
  convention: "约定",
  pitfall: "坑",
  fact: "事实",
};

export function buildMemoryTool(opts: {
  getCwd: () => string;
  onSaved: (content: string) => void;
}): ToolDefinition {
  return {
    name: "memory_save",
    label: "长期记忆",
    description:
      "把一条值得跨会话记住的信息写入项目长期记忆（.pi/memory.md），之后每个新会话都会自动带上。适合记录：用户明确表达的偏好（如「回复用中文」「测试用 vitest」）、项目约定（构建/部署方式）、踩过的坑及解法。一条记忆一句话，不要存临时性内容或大段代码。",
    promptSnippet: "memory_save: 沉淀跨会话的项目长期记忆（偏好/约定/坑）",
    parameters: Type.Object({
      content: Type.String({ description: "要记住的内容，一句话，具体且自包含" }),
      category: Type.Optional(
        Type.Unsafe<(typeof CATEGORIES)[number]>(
          Type.String({
            description: "分类：preference(偏好) | convention(约定) | pitfall(坑) | fact(事实)",
          }),
        ),
      ),
    }),
    execute: async (_id, params) => {
      const p = params as { content: string; category?: string };
      const text = p.content.trim();
      if (!text) {
        return { content: [{ type: "text", text: "记忆内容为空，未保存。" }], details: {} };
      }
      const cwd = opts.getCwd();
      const file = memoryPath(cwd);
      const existing = readMemory(cwd);
      if (existing.includes(text)) {
        return { content: [{ type: "text", text: "这条记忆已存在，无需重复保存。" }], details: {} };
      }
      const date = new Date().toISOString().slice(0, 10);
      const tag = p.category && CATEGORY_LABEL[p.category] ? `【${CATEGORY_LABEL[p.category]}】` : "";
      const line = `- ${tag}${text} _(${date})_\n`;
      mkdirSync(join(cwd, ".pi"), { recursive: true });
      const needsHeader = !existing.trim();
      appendFileSync(file, (needsHeader ? "# 项目记忆\n\n" : "") + line, "utf8");
      opts.onSaved(readMemory(cwd));
      return {
        content: [
          {
            type: "text",
            text: `已存入项目长期记忆（.pi/memory.md）。此记忆将注入之后每个新会话的系统提示。`,
          },
        ],
        details: {},
      };
    },
  };
}
