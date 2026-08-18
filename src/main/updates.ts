/**
 * 新版本检测：查询 GitHub Releases 最新版本并与当前版本比较。
 * mac 包未签名（electron-builder identity: null），无法走 Squirrel 自动更新，
 * 因此更新方式为引导用户打开 release 页面下载新包。
 */
import { app, net } from "electron";
import type { UpdateCheckPayload } from "@shared/protocol";

const REPO = "ryanlab/bivor";
const FALLBACK_URL = `https://github.com/${REPO}/releases/latest`;
const CACHE_TTL_MS = 30 * 60_000;

let cached: UpdateCheckPayload | undefined;

/** 语义化版本比较：a > b 返回 1，相等 0，小于 -1。忽略前导 v 与预发布后缀。 */
function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v
      .replace(/^v/, "")
      .split("-")[0]
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export async function checkForUpdates(force = false): Promise<UpdateCheckPayload> {
  if (!force && cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) return cached;
  const current = app.getVersion();
  try {
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as {
      tag_name?: string;
      html_url?: string;
      body?: string;
    };
    const latest = json.tag_name?.replace(/^v/, "");
    cached = {
      current,
      latest,
      hasUpdate: Boolean(latest && compareVersions(latest, current) > 0),
      url: json.html_url ?? FALLBACK_URL,
      notes: json.body?.slice(0, 2000),
      checkedAt: Date.now(),
    };
    return cached;
  } catch (error) {
    // 失败结果不缓存，下次调用重试
    return {
      current,
      hasUpdate: false,
      url: FALLBACK_URL,
      checkedAt: Date.now(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
