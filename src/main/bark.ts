/** Bark 推送：把通知发到用户的 iPhone（https://github.com/Finb/Bark）。 */
import { getConfig } from "./config";

const DEFAULT_HOST = "https://api.day.app";
const TIMEOUT_MS = 12_000;

export type BarkPushResult = { ok: true } | { ok: false; error: string };

/** 接受完整测试 URL 或设备 Key，得到 `origin/key`。 */
export function resolveBarkEndpoint(raw?: string): string | undefined {
  const s = (raw ?? "").trim();
  if (!s) return undefined;
  try {
    const url = s.includes("://") ? new URL(s) : new URL(`${DEFAULT_HOST}/${s}`);
    const key = url.pathname.split("/").filter(Boolean)[0];
    if (!key) return undefined;
    return `${url.origin}/${encodeURIComponent(key)}`;
  } catch {
    return undefined;
  }
}

export async function sendBarkPush(opts: {
  title: string;
  body: string;
  deviceUrl?: string;
  group?: string;
}): Promise<BarkPushResult> {
  const endpoint = resolveBarkEndpoint(opts.deviceUrl ?? getConfig().barkDeviceUrl);
  if (!endpoint) return { ok: false, error: "missing" };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        title: opts.title,
        body: opts.body,
        group: opts.group ?? "Bivor",
      }),
      signal: ctrl.signal,
    });
    const data = (await res.json().catch(() => null)) as
      | { code?: number; message?: string }
      | null;
    if (!res.ok || (typeof data?.code === "number" && data.code !== 200)) {
      return { ok: false, error: data?.message || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}
