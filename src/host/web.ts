/**
 * 联网工具：web_search（Tavily API）+ web_fetch（抓页面转 markdown）。
 * web_fetch 无需任何 key；web_search 需要 TAVILY_API_KEY（设置 → 联网（Tavily））。
 * 两者都无本机副作用，因此日常模式也开放。
 */
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

const FETCH_TIMEOUT_MS = 20_000;
const MAX_CONTENT_CHARS = 20_000;

export function webSearchAvailable(): boolean {
  return Boolean(process.env.TAVILY_API_KEY);
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

function buildWebSearchTool(): ToolDefinition {
  return {
    name: "web_search",
    label: "网页搜索",
    description:
      "联网搜索实时信息。返回每条结果的标题、URL 和摘要片段。适合查最新文档、新闻、报错信息、库版本等训练数据之外的内容。需要更完整的页面内容时，对结果 URL 用 web_fetch。",
    promptSnippet: "web_search: 联网搜索实时信息（标题 + URL + 摘要）",
    parameters: Type.Object({
      query: Type.String({ description: "搜索关键词" }),
      max_results: Type.Optional(Type.Number({ description: "结果条数，默认 5，最大 10" })),
    }),
    execute: async (_id, params) => {
      const key = process.env.TAVILY_API_KEY;
      if (!key) {
        return {
          content: [
            { type: "text", text: "未配置搜索 API Key。请让用户在 设置 → 联网（Tavily） 里填入 Tavily API Key（tavily.com 有免费额度）。" },
          ],
          details: {},
          isError: true,
        } as never;
      }
      const p = params as { query: string; max_results?: number };
      const res = await fetchWithTimeout("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          query: p.query,
          max_results: Math.min(Math.max(p.max_results ?? 5, 1), 10),
          include_answer: "basic",
        }),
      });
      if (!res.ok) {
        throw new Error(`Tavily 搜索失败: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        answer?: string;
        results?: { title: string; url: string; content: string }[];
      };
      const lines: string[] = [];
      if (data.answer) lines.push(`[摘要] ${data.answer}\n`);
      for (const r of data.results ?? []) {
        lines.push(`- ${r.title}\n  ${r.url}\n  ${r.content.slice(0, 300)}`);
      }
      return {
        content: [{ type: "text", text: lines.join("\n") || "没有搜索结果。" }],
        details: {},
      };
    },
  };
}

function buildWebFetchTool(): ToolDefinition {
  return {
    name: "web_fetch",
    label: "网页抓取",
    description:
      "抓取一个 URL 并把正文转成 markdown 返回（去除脚本样式导航等噪音）。适合阅读文档页、文章、README、API 响应。JSON 响应会原样返回。不支持需要登录的页面——那种情况用 browser 工具。",
    promptSnippet: "web_fetch: 抓取 URL 正文并转成 markdown",
    parameters: Type.Object({
      url: Type.String({ description: "完整 URL（http/https）" }),
    }),
    execute: async (_id, params) => {
      const { url } = params as { url: string };
      if (!/^https?:\/\//i.test(url)) throw new Error("URL 必须以 http:// 或 https:// 开头");
      const res = await fetchWithTimeout(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const contentType = res.headers.get("content-type") ?? "";
      const raw = await res.text();

      let text: string;
      if (contentType.includes("json") || /^\s*[[{]/.test(raw)) {
        text = raw;
      } else {
        const { NodeHtmlMarkdown } = await import("node-html-markdown");
        // 去掉正文无关的大块结构，再转 markdown
        const cleaned = raw
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<(nav|footer|header|aside)[\s\S]*?<\/\1>/gi, "")
          .replace(/<svg[\s\S]*?<\/svg>/gi, "");
        text = NodeHtmlMarkdown.translate(cleaned);
      }
      if (text.length > MAX_CONTENT_CHARS) {
        text = `${text.slice(0, MAX_CONTENT_CHARS)}\n\n…（截断，原文共 ${text.length} 字符）`;
      }
      return { content: [{ type: "text", text: text || "（页面无正文内容）" }], details: {} };
    },
  };
}

export function buildWebTools(): ToolDefinition[] {
  return [buildWebSearchTool(), buildWebFetchTool()];
}
