/**
 * 把当前工作区部署到 Vercel 预览（或生产）环境。
 * 走 REST Files + Deployments API，不依赖 vercel CLI / Git。
 * 每次调用都请求人工审批，避免静默上线。
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { requestHumanApproval } from "./guardrails";

const API = "https://api.vercel.com";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 2000;
const UPLOAD_CONCURRENCY = 8;
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  ".jj",
  ".next",
  ".nuxt",
  ".output",
  ".vercel",
  ".turbo",
  ".svelte-kit",
  ".cache",
  ".parcel-cache",
  "dist",
  "build",
  "out",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".idea",
  ".vscode",
  ".pi",
]);

const SECRET_NAME =
  /^(?:\.env(?:\..+)?|.*\.(?:pem|key|p12|pfx|crt|cer)|id_rsa|id_ed25519|credentials\.json|\.netrc|\.npmrc)$/i;

const FRAMEWORKS = new Set([
  "nextjs",
  "vite",
  "astro",
  "nuxtjs",
  "sveltekit",
  "remix",
  "create-react-app",
  "vue",
  "express",
  "hono",
  "nitro",
  "static",
]);

function fail(text: string): { content: { type: "text"; text: string }[]; details: Record<string, unknown>; isError: true } {
  return { content: [{ type: "text", text }], details: {}, isError: true };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function sanitizeProjectName(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return s || "pi-preview";
}

function resolveDeployRoot(cwd: string, dir?: string): string {
  const cwdResolved = resolve(cwd);
  const root = resolve(cwd, dir?.trim() || ".");
  if (root !== cwdResolved && !root.startsWith(cwdResolved + sep)) {
    throw new Error("dir 必须位于当前工作区内部。");
  }
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`目录不存在：${dir || "."}`);
  }
  return root;
}

interface CollectedFile {
  rel: string;
  buf: Buffer;
  sha: string;
}

function collectFiles(root: string): { files: CollectedFile[]; skipped: string[] } {
  const files: CollectedFile[] = [];
  const skipped: string[] = [];
  let total = 0;

  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (IGNORE_DIRS.has(name) || name === ".DS_Store") continue;
      if (SECRET_NAME.test(name)) {
        skipped.push(relative(root, join(dir, name)).split(sep).join("/"));
        continue;
      }
      const full = join(dir, name);
      let st: ReturnType<typeof lstatSync>;
      try {
        st = lstatSync(full);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (!st.isFile()) continue;
      const rel = relative(root, full).split(sep).join("/");
      if (st.size > MAX_FILE_BYTES) {
        skipped.push(`${rel}（${formatBytes(st.size)}，超过单文件上限）`);
        continue;
      }
      if (files.length >= MAX_FILES) {
        throw new Error(`文件数超过 ${MAX_FILES}，请用 dir 指定更小的子目录。`);
      }
      total += st.size;
      if (total > MAX_TOTAL_BYTES) {
        throw new Error(`总大小超过 ${formatBytes(MAX_TOTAL_BYTES)}，请用 dir 指定更小的子目录，或排除大资源。`);
      }
      const buf = readFileSync(full);
      files.push({
        rel,
        buf,
        sha: createHash("sha1").update(buf).digest("hex"),
      });
    }
  };

  walk(root);
  return { files, skipped };
}

function detectFramework(root: string, explicit?: string): string | null {
  const raw = explicit?.trim().toLowerCase();
  if (raw === "static") return null;
  if (raw && raw !== "auto" && FRAMEWORKS.has(raw)) return raw;
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.next) return "nextjs";
    if (deps.nuxt) return "nuxtjs";
    if (deps.astro) return "astro";
    if (deps["@sveltejs/kit"]) return "sveltekit";
    if (deps["@remix-run/node"] || deps["@remix-run/react"]) return "remix";
    if (deps.vite) return "vite";
    if (deps["react-scripts"]) return "create-react-app";
  } catch {
    // no package.json → static
  }
  return null;
}

function teamQuery(): string {
  const teamId = process.env.VERCEL_TEAM_ID?.trim();
  return teamId ? `teamId=${encodeURIComponent(teamId)}` : "";
}

function withQuery(path: string): string {
  const q = teamQuery();
  if (!q) return `${API}${path}`;
  return `${API}${path}${path.includes("?") ? "&" : "?"}${q}`;
}

async function vercelFetch(
  path: string,
  init: RequestInit & { token: string },
  signal?: AbortSignal,
): Promise<Response> {
  const { token, headers: hdrs, ...rest } = init;
  const headers = new Headers(hdrs);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(withQuery(path), { ...rest, headers, signal });
}

async function readError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const j = JSON.parse(text) as { error?: { message?: string }; message?: string };
    return j.error?.message || j.message || text.slice(0, 400);
  } catch {
    return text.slice(0, 400) || `HTTP ${res.status}`;
  }
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  const n = Math.min(concurrency, Math.max(items.length, 1));
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const item = items[i++];
        await fn(item);
      }
    }),
  );
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error("已取消"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

interface VercelDeployment {
  id?: string;
  url?: string;
  name?: string;
  readyState?: string;
  errorMessage?: string;
  readyStateReason?: string;
  inspectorUrl?: string;
  alias?: string[];
}

async function fetchBuildLogs(token: string, id: string, signal?: AbortSignal): Promise<string> {
  try {
    const res = await vercelFetch(
      `/v3/deployments/${encodeURIComponent(id)}/events?builds=1&direction=backward&limit=40`,
      { token },
      signal,
    );
    if (!res.ok) return "";
    const raw = await res.text();
    const events: { text?: string; payload?: { text?: string } }[] = [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) events.push(...parsed);
      else if (parsed && typeof parsed === "object" && Array.isArray((parsed as { events?: unknown }).events)) {
        events.push(...((parsed as { events: typeof events }).events));
      }
    } catch {
      for (const line of raw.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        try {
          events.push(JSON.parse(t) as (typeof events)[number]);
        } catch {
          // ignore malformed lines
        }
      }
    }
    const lines: string[] = [];
    for (const ev of events) {
      const t = ev.text || ev.payload?.text;
      if (t) lines.push(t);
    }
    return lines.slice(-25).join("\n");
  } catch {
    return "";
  }
}

export function buildDeployTool(getCwd: () => string): ToolDefinition {
  return {
    name: "deploy",
    label: "部署",
    description:
      "把当前工作区（或指定子目录）部署到 Vercel，返回可公开访问的 URL。默认预览部署，不会覆盖生产域名。适合静态站、Vite、Next.js、Astro 等。不要上传密钥；.env 会被自动跳过。需要用户在设置里配置 Vercel Token，且每次部署都会弹出审批。",
    promptSnippet: "deploy: 把工作区部署到 Vercel 并返回预览 URL",
    parameters: Type.Object({
      project: Type.Optional(
        Type.String({
          description: "Vercel 项目名（小写字母/数字/连字符）。省略则用目录名。已存在则更新该项目。",
        }),
      ),
      dir: Type.Optional(
        Type.String({ description: "相对工作区的子目录，默认整个项目。不要包含 node_modules。" }),
      ),
      framework: Type.Optional(
        Type.String({
          description:
            "框架：auto（默认，按 package.json 检测）| nextjs | vite | astro | nuxtjs | sveltekit | remix | static",
        }),
      ),
      prod: Type.Optional(
        Type.Boolean({
          description: "true 则部署到 production（会覆盖生产别名）。默认 false，即 preview。",
        }),
      ),
    }),
    execute: async (_id, params, signal) => {
      const token = process.env.VERCEL_TOKEN?.trim();
      if (!token) {
        return fail("未配置 Vercel Token。请让用户在 设置 → 部署运维（Vercel） 里填入（vercel.com/account/tokens）。保存后需新建会话。");
      }

      const p = params as { project?: string; dir?: string; framework?: string; prod?: boolean };
      const cwd = getCwd();
      let root: string;
      try {
        root = resolveDeployRoot(cwd, p.dir);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }

      let collected: { files: CollectedFile[]; skipped: string[] };
      try {
        collected = collectFiles(root);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
      if (collected.files.length === 0) {
        return fail("没有可部署的文件。请确认目录非空，且不是只有 node_modules / dist。");
      }

      const fallbackName = root.split(/[/\\]/).filter(Boolean).pop() || "pi-preview";
      const project = sanitizeProjectName(p.project?.trim() || fallbackName);
      const framework = detectFramework(root, p.framework);
      const prod = Boolean(p.prod);
      const totalBytes = collected.files.reduce((n, f) => n + f.buf.byteLength, 0);

      const approved = await requestHumanApproval(
        "deploy",
        {
          project,
          dir: p.dir || ".",
          framework: framework ?? "static",
          target: prod ? "production" : "preview",
          files: collected.files.length,
          size: formatBytes(totalBytes),
        },
        prod ? "生产部署：会覆盖线上别名" : "预览部署",
      );
      if (!approved) {
        return fail("用户拒绝了本次部署。");
      }
      if (signal?.aborted) return fail("已取消");

      try {
        await mapPool(collected.files, UPLOAD_CONCURRENCY, async (file) => {
          if (signal?.aborted) throw new Error("已取消");
          const res = await vercelFetch(
            "/v2/files",
            {
              token,
              method: "POST",
              headers: {
                "Content-Length": String(file.buf.byteLength),
                "x-vercel-digest": file.sha,
                "Content-Type": "application/octet-stream",
              },
              body: file.buf,
            },
            signal,
          );
          if (!res.ok && res.status !== 409) {
            throw new Error(`上传 ${file.rel} 失败：${await readError(res)}`);
          }
        });

        const createRes = await vercelFetch(
          "/v13/deployments?forceNew=1&skipAutoDetectionConfirmation=1",
          {
            token,
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: project,
              files: collected.files.map((f) => ({
                file: f.rel,
                sha: f.sha,
                size: f.buf.byteLength,
              })),
              projectSettings: { framework },
              ...(prod ? { target: "production" } : {}),
            }),
          },
          signal,
        );
        if (!createRes.ok) {
          return fail(`创建部署失败：${await readError(createRes)}`);
        }
        let dep = (await createRes.json()) as VercelDeployment;
        const id = dep.id;
        if (!id) return fail("Vercel 未返回 deployment id。");

        const started = Date.now();
        while (dep.readyState !== "READY" && dep.readyState !== "ERROR" && dep.readyState !== "CANCELED") {
          if (signal?.aborted) return fail("已取消");
          if (Date.now() - started > POLL_TIMEOUT_MS) {
            return fail(`部署超时（仍处于 ${dep.readyState ?? "未知"}）。id=${id}`);
          }
          await sleep(POLL_INTERVAL_MS, signal);
          const poll = await vercelFetch(`/v13/deployments/${encodeURIComponent(id)}`, { token }, signal);
          if (!poll.ok) {
            return fail(`查询部署状态失败：${await readError(poll)}`);
          }
          dep = (await poll.json()) as VercelDeployment;
        }

        const url = dep.url ? `https://${dep.url}` : "";
        if (dep.readyState !== "READY") {
          const logs = await fetchBuildLogs(token, id, signal);
          const reason = dep.errorMessage || dep.readyStateReason || dep.readyState || "ERROR";
          return {
            content: [
              {
                type: "text",
                text: [`部署失败（${reason}）`, url && `URL: ${url}`, logs && `构建日志：\n${logs}`]
                  .filter(Boolean)
                  .join("\n\n"),
              },
            ],
            details: { id, url, state: dep.readyState, project },
            isError: true,
          };
        }

        const skippedNote =
          collected.skipped.length > 0
            ? `\n已跳过 ${collected.skipped.length} 个文件（密钥 / 超大文件）：${collected.skipped.slice(0, 8).join(", ")}${collected.skipped.length > 8 ? "…" : ""}`
            : "";
        return {
          content: [
            {
              type: "text",
              text: `已部署到 Vercel（${prod ? "production" : "preview"}）\n项目：${project}\n框架：${framework ?? "static"}\n文件：${collected.files.length}（${formatBytes(totalBytes)}）\nURL：${url}${skippedNote}`,
            },
          ],
          details: { id, url, state: dep.readyState, project, framework: framework ?? "static", prod },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (signal?.aborted || msg === "已取消") return fail("已取消");
        return fail(`部署失败：${msg}`);
      }
    },
  };
}
