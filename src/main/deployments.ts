/**
 * 部署运维服务（main 进程）：基于 Vercel REST API 的独立运维模块。
 * 与 host 里的 deploy 工具共用同一份 token 配置（设置 → 部署），
 * 但这里是「人在看、人在管」的面板后端：状态监测、日志、重部署、
 * 提升生产、回滚、取消、删除。
 */
import type {
  VercelDeploymentDetail,
  VercelDeploymentInfo,
  VercelProjectDetail,
  VercelProjectInfo,
} from "@shared/protocol";
import { getConfig } from "./config";

const API = "https://api.vercel.com";
const TIMEOUT_MS = 20_000;

function credentials(): { token: string; teamId?: string } {
  const token = getConfig().vercelToken?.trim();
  if (!token) throw new Error("未配置 Vercel Token（设置 → 部署）");
  return { token, teamId: getConfig().vercelTeamId?.trim() || undefined };
}

async function vercel(path: string, init?: RequestInit): Promise<Response> {
  const { token, teamId } = credentials();
  const url = new URL(`${API}${path}`);
  if (teamId) url.searchParams.set("teamId", teamId);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${token}`, ...init?.headers },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function expectOk(res: Response): Promise<void> {
  if (res.ok) return;
  const text = await res.text();
  let message = text.slice(0, 300) || `HTTP ${res.status}`;
  try {
    const j = JSON.parse(text) as { error?: { message?: string }; message?: string };
    message = j.error?.message || j.message || message;
  } catch {
    // keep raw text
  }
  throw new Error(message);
}

export function deploymentsConfigured(): boolean {
  return Boolean(getConfig().vercelToken?.trim());
}

export async function listVercelProjects(): Promise<VercelProjectInfo[]> {
  const res = await vercel("/v10/projects?limit=100");
  await expectOk(res);
  const data = (await res.json()) as {
    projects?: { id: string; name: string; updatedAt?: number }[];
  };
  return (data.projects ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    updatedAt: p.updatedAt,
  }));
}

interface RawDeployment {
  uid?: string;
  id?: string;
  name?: string;
  url?: string;
  state?: string;
  readyState?: string;
  readySubstate?: string;
  target?: string | null;
  created?: number;
  createdAt?: number;
  ready?: number;
  buildingAt?: number;
  inspectorUrl?: string;
  projectId?: string;
  creator?: { username?: string };
  meta?: { githubCommitMessage?: string };
  errorMessage?: string;
}

function mapDeployment(d: RawDeployment): VercelDeploymentInfo {
  return {
    id: d.uid || d.id || "",
    name: d.name ?? "",
    url: d.url,
    state: (d.state || d.readyState || "UNKNOWN").toUpperCase(),
    /** readySubstate: production 部署里 PROMOTED = 正在承接生产流量 */
    substate: d.readySubstate,
    target: d.target ?? undefined,
    createdAt: d.createdAt ?? d.created,
    readyAt: d.ready,
    inspectorUrl: d.inspectorUrl,
    projectId: d.projectId,
    creator: d.creator?.username,
    commitMessage: d.meta?.githubCommitMessage,
    errorMessage: d.errorMessage,
  };
}

export async function listVercelDeployments(projectId?: string): Promise<VercelDeploymentInfo[]> {
  const q = new URLSearchParams({ limit: "40" });
  if (projectId) q.set("projectId", projectId);
  const res = await vercel(`/v7/deployments?${q.toString()}`);
  await expectOk(res);
  const data = (await res.json()) as { deployments?: RawDeployment[] };
  return (data.deployments ?? []).map(mapDeployment);
}

/** 单个部署的完整详情：别名、region、来源、构建时长、Git 信息等。 */
export async function getVercelDeploymentDetail(
  deploymentId: string,
): Promise<VercelDeploymentDetail> {
  const res = await vercel(`/v13/deployments/${encodeURIComponent(deploymentId)}`);
  await expectOk(res);
  const d = (await res.json()) as RawDeployment & {
    alias?: string[];
    aliasAssigned?: boolean | number;
    regions?: string[];
    source?: string;
    plan?: string;
    public?: boolean;
    version?: number;
    meta?: {
      githubCommitMessage?: string;
      githubCommitRef?: string;
      githubCommitSha?: string;
      githubCommitOrg?: string;
      githubOrg?: string;
      githubRepo?: string;
    };
  };
  const buildMs =
    d.ready && d.buildingAt && d.ready > d.buildingAt ? d.ready - d.buildingAt : undefined;
  return {
    ...mapDeployment(d),
    aliases: d.alias ?? [],
    regions: d.regions ?? [],
    source: d.source,
    plan: d.plan,
    public: d.public,
    buildMs,
    gitBranch: d.meta?.githubCommitRef,
    gitCommitSha: d.meta?.githubCommitSha,
    gitRepo:
      d.meta?.githubRepo && (d.meta.githubOrg || d.meta.githubCommitOrg)
        ? `${d.meta.githubOrg ?? d.meta.githubCommitOrg}/${d.meta.githubRepo}`
        : d.meta?.githubRepo,
  };
}

/** 项目级配置：框架、Node 版本、构建命令、域名、环境变量（只列 key）。 */
export async function getVercelProjectDetail(projectId: string): Promise<VercelProjectDetail> {
  const id = encodeURIComponent(projectId);
  const [projRes, domainsRes, envRes] = await Promise.all([
    vercel(`/v9/projects/${id}`),
    vercel(`/v9/projects/${id}/domains?limit=20`),
    vercel(`/v9/projects/${id}/env`),
  ]);
  await expectOk(projRes);
  const p = (await projRes.json()) as {
    id: string;
    name: string;
    framework?: string | null;
    nodeVersion?: string;
    buildCommand?: string | null;
    installCommand?: string | null;
    devCommand?: string | null;
    outputDirectory?: string | null;
    rootDirectory?: string | null;
    serverlessFunctionRegion?: string | null;
    autoExposeSystemEnvs?: boolean;
    createdAt?: number;
    updatedAt?: number;
    link?: { type?: string; org?: string; repo?: string };
  };

  let domains: string[] = [];
  if (domainsRes.ok) {
    const d = (await domainsRes.json()) as { domains?: { name: string; verified?: boolean }[] };
    domains = (d.domains ?? []).map((x) => x.name);
  }

  let envs: { key: string; targets: string[]; type?: string }[] = [];
  if (envRes.ok) {
    const e = (await envRes.json()) as {
      envs?: { key: string; target?: string[] | string; type?: string }[];
    };
    envs = (e.envs ?? []).map((v) => ({
      key: v.key,
      targets: Array.isArray(v.target) ? v.target : v.target ? [v.target] : [],
      type: v.type,
    }));
  }

  return {
    id: p.id,
    name: p.name,
    framework: p.framework ?? undefined,
    nodeVersion: p.nodeVersion,
    buildCommand: p.buildCommand ?? undefined,
    installCommand: p.installCommand ?? undefined,
    devCommand: p.devCommand ?? undefined,
    outputDirectory: p.outputDirectory ?? undefined,
    rootDirectory: p.rootDirectory ?? undefined,
    functionRegion: p.serverlessFunctionRegion ?? undefined,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    gitRepo: p.link?.org && p.link?.repo ? `${p.link.org}/${p.link.repo}` : undefined,
    domains,
    envs,
  };
}

export async function getVercelDeploymentLogs(deploymentId: string): Promise<string> {
  const res = await vercel(
    `/v3/deployments/${encodeURIComponent(deploymentId)}/events?builds=1&limit=200`,
  );
  await expectOk(res);
  const raw = await res.text();
  const events: { text?: string; payload?: { text?: string }; created?: number }[] = [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) events.push(...parsed);
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
  return lines.join("\n");
}

export async function cancelVercelDeployment(deploymentId: string): Promise<void> {
  const res = await vercel(`/v12/deployments/${encodeURIComponent(deploymentId)}/cancel`, {
    method: "PATCH",
  });
  await expectOk(res);
}

export async function deleteVercelDeployment(deploymentId: string): Promise<void> {
  const res = await vercel(`/v13/deployments/${encodeURIComponent(deploymentId)}`, {
    method: "DELETE",
  });
  await expectOk(res);
}

/** 用同一份源码新建一次部署（配置继承原部署，可切换 preview/production）。 */
export async function redeployVercelDeployment(
  deploymentId: string,
  name: string,
  target?: "production",
): Promise<VercelDeploymentInfo> {
  const res = await vercel("/v13/deployments?forceNew=1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deploymentId, name, ...(target ? { target } : {}) }),
  });
  await expectOk(res);
  return mapDeployment((await res.json()) as RawDeployment);
}

/** 把生产流量指向指定部署（promote）。 */
export async function promoteVercelDeployment(
  projectId: string,
  deploymentId: string,
): Promise<void> {
  const res = await vercel(
    `/v10/projects/${encodeURIComponent(projectId)}/promote/${encodeURIComponent(deploymentId)}`,
    { method: "POST" },
  );
  await expectOk(res);
}

/** 把生产流量回退到之前的某个生产部署（rollback）。 */
export async function rollbackVercelDeployment(
  projectId: string,
  deploymentId: string,
): Promise<void> {
  const res = await vercel(
    `/v1/projects/${encodeURIComponent(projectId)}/rollback/${encodeURIComponent(deploymentId)}`,
    { method: "POST" },
  );
  await expectOk(res);
}
