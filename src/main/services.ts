/**
 * Global services in the main process: model catalog, provider auth,
 * session listing. Uses the pi SDK directly.
 */
import { readFileSync } from "node:fs";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import type {
  ModelInfo,
  ProviderInfo,
  SessionListItem,
  SessionSearchHit,
  UsageDayStat,
  UsageModelStat,
  UsageStats,
} from "@shared/protocol";

let runtimePromise: Promise<ModelRuntime> | undefined;

export function getRuntime(): Promise<ModelRuntime> {
  if (!runtimePromise) {
    // Don't cache a rejected promise — otherwise a transient failure at first
    // call would permanently break model/provider listing until app restart.
    runtimePromise = ModelRuntime.create().catch((err) => {
      runtimePromise = undefined;
      throw err;
    });
  }
  return runtimePromise;
}

export async function listModels(): Promise<ModelInfo[]> {
  const runtime = await getRuntime();
  return runtime.getModels().map((m) => ({
    provider: m.provider,
    id: m.id,
    name: (m as { name?: string }).name ?? m.id,
    contextWindow: (m as { contextWindow?: number }).contextWindow,
    reasoning: (m as { reasoning?: boolean }).reasoning,
    input: (m as { input?: string[] }).input,
  }));
}

export async function listProviders(): Promise<ProviderInfo[]> {
  const runtime = await getRuntime();
  const providers = runtime.getProviders();
  const result: ProviderInfo[] = [];
  for (const p of providers) {
    let authenticated = false;
    let authSource: string | undefined;
    try {
      const check = await runtime.checkAuth(p.id, { signal: AbortSignal.timeout(3000) });
      if (check) {
        authenticated = true;
        authSource = check.source ?? check.type;
      }
    } catch {
      authenticated = runtime.hasConfiguredAuth(p.id);
    }
    const auth = p.auth as unknown;
    const authMethods: string[] = [];
    if (auth && typeof auth === "object") {
      const a = auth as Record<string, unknown>;
      if (a.apiKey || a.api_key) authMethods.push("api_key");
      if (a.oauth) authMethods.push("oauth");
    }
    result.push({
      id: p.id,
      name: (p as { name?: string }).name ?? p.id,
      auth: authMethods.length > 0 ? authMethods : ["api_key"],
      authenticated,
      authSource,
      envVar: (p as { env?: { apiKey?: string } }).env?.apiKey,
    });
  }
  return result;
}

export async function setApiKey(providerId: string, apiKey: string): Promise<void> {
  const runtime = await getRuntime();
  await runtime.login(providerId, "api_key", {
    prompt: async (p) => {
      if (p.type === "secret" || p.type === "text") return apiKey;
      if (p.type === "select") return p.options[0]?.id ?? "";
      throw new Error(`不支持的认证交互: ${p.type}`);
    },
    notify: () => {},
  });
  try {
    await verifyProvider(runtime, providerId);
  } catch (err) {
    await runtime.logout(providerId).catch(() => {});
    throw err;
  }
}

/** Lightweight reachability check: GET /models with the just-saved credential. */
async function verifyProvider(runtime: ModelRuntime, providerId: string): Promise<void> {
  const provider = runtime.getProvider(providerId);
  if (!provider) throw new Error("未知提供商");
  const signal = AbortSignal.timeout(10000);
  const resolved = await runtime.getAuth(providerId, { signal });
  if (!resolved) throw new Error("未能读取刚保存的凭证");

  const baseUrl = (resolved.auth.baseUrl ?? provider.baseUrl ?? "").replace(/\/+$/, "");
  if (!baseUrl) return;

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(resolved.auth.headers ?? {}),
  };
  const key = resolved.auth.apiKey;
  let url = `${baseUrl}/models`;

  if (providerId === "google" || providerId.startsWith("google-")) {
    if (key) url += `${url.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}`;
  } else if (providerId === "anthropic" || providerId.startsWith("anthropic")) {
    if (key) headers["x-api-key"] ??= key;
    headers["anthropic-version"] ??= "2023-06-01";
    if (!baseUrl.endsWith("/v1")) url = `${baseUrl}/v1/models`;
  } else if (key && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${key}`;
  }

  let res: Response;
  try {
    res = await fetch(url, { headers, signal });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/abort|timeout/i.test(msg)) throw new Error("连通超时，请检查网络后重试");
    throw new Error(`无法连接：${msg}`);
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error("API key 无效或没有访问权限");
  }
  if (res.status >= 500) {
    throw new Error(`服务暂时不可用（HTTP ${res.status}）`);
  }
}

export async function removeApiKey(providerId: string): Promise<void> {
  const runtime = await getRuntime();
  await runtime.logout(providerId);
}

export function renameSession(path: string, name: string): void {
  const sm = SessionManager.open(path);
  sm.appendSessionInfo(name);
}

/** Extract user/assistant text from one session JSONL line, or "" if none. */
function lineText(line: string): string {
  try {
    const obj = JSON.parse(line) as {
      type?: string;
      message?: { role?: string; content?: unknown };
    };
    const msg = obj.message;
    if (!msg || (msg.role !== "user" && msg.role !== "assistant")) return "";
    const c = msg.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      return c
        .filter((b): b is { type: string; text: string } => (b as { type?: string }).type === "text")
        .map((b) => b.text)
        .join(" ");
    }
    return "";
  } catch {
    return "";
  }
}

/** Full-text search across a project's session files (message text only). */
/** Aggregate token/cost usage across a project's session files. */
export async function usageStats(cwd: string): Promise<UsageStats> {
  const infos = (await SessionManager.list(cwd))
    .sort((a, b) => (b.modified?.getTime() ?? 0) - (a.modified?.getTime() ?? 0))
    .slice(0, 500);
  const totals = { messages: 0, input: 0, output: 0, cacheRead: 0, cost: 0 };
  const perModel = new Map<string, UsageModelStat>();
  const perDay = new Map<string, UsageDayStat>();
  let sessions = 0;
  for (const info of infos) {
    let raw: string;
    try {
      raw = readFileSync(info.path, "utf8");
    } catch {
      continue;
    }
    let counted = false;
    for (const line of raw.split("\n")) {
      if (!line.includes('"usage"')) continue;
      let obj: {
        timestamp?: string;
        message?: {
          role?: string;
          model?: string;
          usage?: {
            input?: number;
            output?: number;
            cacheRead?: number;
            cost?: { total?: number };
          };
        };
      };
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      const msg = obj.message;
      const u = msg?.usage;
      if (!u || msg?.role !== "assistant") continue;
      counted = true;
      totals.messages += 1;
      totals.input += u.input ?? 0;
      totals.output += u.output ?? 0;
      totals.cacheRead += u.cacheRead ?? 0;
      totals.cost += u.cost?.total ?? 0;
      const model = msg.model ?? "unknown";
      const m = perModel.get(model) ?? {
        model,
        messages: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cost: 0,
      };
      m.messages += 1;
      m.inputTokens += u.input ?? 0;
      m.outputTokens += u.output ?? 0;
      m.cacheReadTokens += u.cacheRead ?? 0;
      m.cost += u.cost?.total ?? 0;
      perModel.set(model, m);
      const ts = obj.timestamp ? new Date(obj.timestamp) : undefined;
      if (ts && !Number.isNaN(ts.getTime())) {
        const date = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, "0")}-${String(ts.getDate()).padStart(2, "0")}`;
        const d = perDay.get(date) ?? { date, messages: 0, tokens: 0, cost: 0 };
        d.messages += 1;
        d.tokens += (u.input ?? 0) + (u.output ?? 0);
        d.cost += u.cost?.total ?? 0;
        perDay.set(date, d);
      }
    }
    if (counted) sessions += 1;
  }
  return {
    sessions,
    messages: totals.messages,
    inputTokens: totals.input,
    outputTokens: totals.output,
    cacheReadTokens: totals.cacheRead,
    cost: totals.cost,
    perModel: [...perModel.values()].sort((a, b) => b.messages - a.messages),
    perDay: [...perDay.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-14),
  };
}

export async function searchSessions(cwd: string, query: string): Promise<SessionSearchHit[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const infos = (await SessionManager.list(cwd))
    .sort((a, b) => (b.modified?.getTime() ?? 0) - (a.modified?.getTime() ?? 0))
    .slice(0, 300);
  const hits: SessionSearchHit[] = [];
  for (const info of infos) {
    if (hits.length >= 30) break;
    let raw: string;
    try {
      raw = readFileSync(info.path, "utf8");
    } catch {
      continue;
    }
    // Cheap pre-filter before per-line JSON parsing.
    if (!raw.toLowerCase().includes(q)) continue;
    let snippet: string | undefined;
    for (const line of raw.split("\n")) {
      const text = lineText(line);
      const at = text.toLowerCase().indexOf(q);
      if (at >= 0) {
        const start = Math.max(0, at - 40);
        snippet =
          (start > 0 ? "…" : "") +
          text.slice(start, at + q.length + 60).replace(/\s+/g, " ") +
          (at + q.length + 60 < text.length ? "…" : "");
        break;
      }
    }
    if (!snippet) continue;
    hits.push({
      path: info.path,
      name: info.name ?? info.firstMessage?.slice(0, 60),
      snippet,
      modifiedAt: info.modified?.getTime(),
    });
  }
  return hits;
}

export async function listSessions(cwd?: string): Promise<SessionListItem[]> {
  const infos = cwd ? await SessionManager.list(cwd) : await SessionManager.listAll();
  return infos
    .map((s) => ({
      path: s.path,
      id: s.id,
      name: s.name,
      cwd: s.cwd,
      createdAt: s.created?.getTime(),
      modifiedAt: s.modified?.getTime(),
      messageCount: s.messageCount,
      firstUserMessage: s.firstMessage?.slice(0, 200),
    }))
    .sort((a, b) => (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0));
}
