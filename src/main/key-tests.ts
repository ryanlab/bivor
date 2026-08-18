/**
 * Settings credential probes for E2B / Tavily.
 * Same UX as Vercel / Bark: test the current input before saving.
 */
import type { ApiKeyTestResult } from "@shared/protocol";
import { getConfig } from "./config";

const TIMEOUT_MS = 15_000;

async function probe(
  url: string,
  headers: Record<string, string>,
): Promise<{ ok: boolean; status: number; text: string; json: unknown }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { ok: res.ok, status: res.status, text, json };
  } finally {
    clearTimeout(timer);
  }
}

function readError(status: number, json: unknown, text: string): string {
  if (json && typeof json === "object") {
    const obj = json as {
      message?: string;
      error?: string | { message?: string };
      detail?: string | { error?: string };
    };
    if (typeof obj.message === "string" && obj.message) return obj.message;
    if (typeof obj.error === "string" && obj.error) return obj.error;
    if (obj.error && typeof obj.error === "object" && obj.error.message) return obj.error.message;
    if (typeof obj.detail === "string" && obj.detail) return obj.detail;
    if (obj.detail && typeof obj.detail === "object" && obj.detail.error) return obj.detail.error;
  }
  if (status === 401 || status === 403) return "API key 无效或没有访问权限";
  return text.slice(0, 300) || `HTTP ${status}`;
}

function catchError(err: unknown): ApiKeyTestResult {
  const message = err instanceof Error ? err.message : String(err);
  if (/abort|timeout/i.test(message)) return { ok: false, error: "连通超时，请检查网络后重试" };
  return { ok: false, error: message };
}

export async function testE2bApiKey(opts?: { apiKey?: string }): Promise<ApiKeyTestResult> {
  const apiKey = (opts?.apiKey ?? getConfig().e2bApiKey)?.trim();
  if (!apiKey) return { ok: false, error: "missing" };

  try {
    const r = await probe("https://api.e2b.app/v2/sandboxes?limit=1", {
      Accept: "application/json",
      "X-API-KEY": apiKey,
    });
    if (!r.ok) return { ok: false, error: readError(r.status, r.json, r.text) };
    return { ok: true };
  } catch (err) {
    return catchError(err);
  }
}

export async function testTavilyApiKey(opts?: { apiKey?: string }): Promise<ApiKeyTestResult> {
  const apiKey = (opts?.apiKey ?? getConfig().tavilyApiKey)?.trim();
  if (!apiKey) return { ok: false, error: "missing" };

  try {
    const r = await probe("https://api.tavily.com/usage", {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    });
    if (!r.ok) return { ok: false, error: readError(r.status, r.json, r.text) };
    const data = r.json as {
      key?: { usage?: number; limit?: number | null };
      account?: { current_plan?: string; plan?: string };
    };
    const used = data.key?.usage;
    const limit = data.key?.limit;
    const plan = data.account?.current_plan || data.account?.plan;
    const detail =
      typeof used === "number" && typeof limit === "number"
        ? `${used}/${limit}`
        : plan || undefined;
    return { ok: true, detail };
  } catch (err) {
    return catchError(err);
  }
}
