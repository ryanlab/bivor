/**
 * 部署运维面板：独立于会话的 Vercel 部署监控与运维模块。
 * 列出项目与部署、实时轮询状态（构建中加速轮询）、查看构建日志，
 * 并支持重新部署、提升生产、回滚、取消构建、删除部署。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpCircle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitBranch,
  Globe,
  History,
  Info,
  KeyRound,
  Loader2,
  RefreshCw,
  Rocket,
  RotateCcw,
  ScrollText,
  Settings,
  Trash2,
  Wrench,
  XCircle,
} from "lucide-react";
import type {
  VercelDeploymentDetail,
  VercelDeploymentInfo,
  VercelProjectDetail,
  VercelProjectInfo,
} from "@shared/protocol";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime, formatRelativeTime, ipcErrorMessage } from "@/lib/format";
import { useT, type Translator } from "@/lib/i18n";

const ACTIVE_STATES = new Set(["BUILDING", "QUEUED", "INITIALIZING"]);

const STATE_STYLE: Record<string, { dot: string; key: string; text: string }> = {
  READY: { dot: "bg-success", key: "deploy.ready", text: "text-success" },
  ERROR: { dot: "bg-danger", key: "deploy.error", text: "text-danger" },
  BUILDING: { dot: "bg-warning animate-pulse", key: "deploy.building", text: "text-warning" },
  INITIALIZING: { dot: "bg-warning animate-pulse", key: "deploy.initializing", text: "text-warning" },
  QUEUED: { dot: "bg-fg-muted animate-pulse", key: "deploy.queued", text: "text-fg-muted" },
  CANCELED: { dot: "bg-fg-muted", key: "deploy.canceled", text: "text-fg-muted" },
};

function stateStyle(state: string, t: Translator): { dot: string; label: string; text: string } {
  const s = STATE_STYLE[state];
  if (!s) return { dot: "bg-fg-muted", label: state, text: "text-fg-muted" };
  return { dot: s.dot, label: t(s.key), text: s.text };
}

function ActionButton({
  icon,
  label,
  danger,
  busy,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  busy?: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      title={label}
      className={cn(
        "flex items-center gap-1 rounded-md px-1.5 py-1 text-[10.5px] transition-colors disabled:opacity-40",
        danger
          ? "text-fg-muted hover:bg-danger/10 hover:text-danger"
          : "text-fg-muted hover:bg-bg-hover hover:text-fg",
      )}
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}

function formatDuration(ms?: number, dash = "—"): string {
  if (!ms) return dash;
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function DetailField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="min-w-0">
      <div className="text-[9.5px] uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="selectable truncate pt-0.5 text-[11px] text-fg-secondary">{children}</div>
    </div>
  );
}

/** 部署详情：按需拉取完整参数（别名 / region / 来源 / 构建时长 / Git）。 */
function DeploymentDetail({ dep }: { dep: VercelDeploymentInfo }): React.JSX.Element {
  const t = useT();
  const [detail, setDetail] = useState<VercelDeploymentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.pi.deployments
      .detail(dep.id)
      .then(setDetail)
      .catch((e: unknown) => setError(ipcErrorMessage(e)));
  }, [dep.id]);

  if (error) return <div className="px-3 py-2 text-[11px] text-danger">{error}</div>;
  if (!detail) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-fg-muted">
        <Loader2 size={12} className="animate-spin" />
        {t("deploy.loadingDetail")}
      </div>
    );
  }

  return (
    <div className="space-y-2.5 bg-bg-secondary/60 px-3 py-2.5">
      <div className="grid grid-cols-3 gap-x-4 gap-y-2">
        <DetailField label={t("deploy.id")}>{detail.id}</DetailField>
        <DetailField label={t("deploy.source")}>{detail.source ?? t("common.dash")}</DetailField>
        <DetailField label={t("deploy.buildTime")}>{formatDuration(detail.buildMs, t("common.dash"))}</DetailField>
        <DetailField label={t("deploy.region")}>
          {detail.regions.length > 0 ? detail.regions.join(", ") : t("common.dash")}
        </DetailField>
        <DetailField label={t("deploy.env")}>
          {detail.target === "production" ? "production" : "preview"}
          {detail.substate ? ` · ${detail.substate.toLowerCase()}` : ""}
        </DetailField>
        <DetailField label={t("deploy.createdAt")}>
          {detail.createdAt ? formatDateTime(detail.createdAt) : t("common.dash")}
        </DetailField>
        {detail.gitRepo && <DetailField label={t("deploy.repo")}>{detail.gitRepo}</DetailField>}
        {detail.gitBranch && (
          <DetailField label={t("deploy.branch")}>
            <span className="inline-flex items-center gap-1">
              <GitBranch size={10} />
              {detail.gitBranch}
            </span>
          </DetailField>
        )}
        {detail.gitCommitSha && (
          <DetailField label={t("deploy.commit")}>{detail.gitCommitSha.slice(0, 7)}</DetailField>
        )}
      </div>

      {detail.aliases.length > 0 && (
        <div>
          <div className="pb-1 text-[9.5px] uppercase tracking-wide text-fg-muted">
            {t("deploy.aliases", { n: detail.aliases.length })}
          </div>
          <div className="flex flex-wrap gap-1">
            {detail.aliases.map((a) => (
              <a
                key={a}
                href={`https://${a}`}
                target="_blank"
                rel="noreferrer"
                className="rounded bg-bg px-1.5 py-0.5 font-mono text-[10px] text-accent hover:underline"
              >
                {a}
              </a>
            ))}
          </div>
        </div>
      )}

      {detail.inspectorUrl && (
        <a
          href={detail.inspectorUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[10.5px] text-accent hover:underline"
        >
          <ExternalLink size={10} />
          {t("deploy.console")}
        </a>
      )}
    </div>
  );
}

/** 项目配置卡：框架、Node、构建命令、域名、环境变量（只列 key）。 */
function ProjectInfoCard({ projectId }: { projectId: string }): React.JSX.Element {
  const t = useT();
  const [detail, setDetail] = useState<VercelProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    setDetail(null);
    setError(null);
    window.pi.deployments
      .projectDetail(projectId)
      .then(setDetail)
      .catch((e: unknown) => setError(ipcErrorMessage(e)));
  }, [projectId]);

  return (
    <div className="rounded-xl border border-accent/25 bg-accent-muted/30">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {expanded ? (
          <ChevronDown size={12} className="text-fg-muted" />
        ) : (
          <ChevronRight size={12} className="text-fg-muted" />
        )}
        <Wrench size={12} className="text-accent" />
        <span className="text-[11.5px] font-medium">{t("deploy.projectConfig")}</span>
        {detail && (
          <span className="text-[10.5px] text-fg-muted">
            {detail.framework ?? "static"} · Node {detail.nodeVersion ?? t("common.default")}
          </span>
        )}
        {!detail && !error && <Loader2 size={11} className="animate-spin text-fg-muted" />}
      </button>

      {expanded && error && <div className="px-3 pb-2 text-[11px] text-danger">{error}</div>}
      {expanded && detail && (
        <div className="space-y-2.5 border-t border-accent/15 px-3 py-2.5">
          <div className="grid grid-cols-3 gap-x-4 gap-y-2">
            <DetailField label={t("deploy.framework")}>{detail.framework ?? "static"}</DetailField>
            <DetailField label={t("deploy.node")}>{detail.nodeVersion ?? t("common.default")}</DetailField>
            <DetailField label={t("deploy.region")}>{detail.functionRegion ?? t("common.default")}</DetailField>
            <DetailField label={t("deploy.buildCmd")}>{detail.buildCommand ?? t("common.autoDetect")}</DetailField>
            <DetailField label={t("deploy.installCmd")}>{detail.installCommand ?? t("common.autoDetect")}</DetailField>
            <DetailField label={t("deploy.outputDir")}>{detail.outputDirectory ?? t("common.autoDetect")}</DetailField>
            {detail.rootDirectory && (
              <DetailField label={t("deploy.rootDir")}>{detail.rootDirectory}</DetailField>
            )}
            {detail.gitRepo && <DetailField label={t("deploy.linkedRepo")}>{detail.gitRepo}</DetailField>}
            {detail.createdAt && (
              <DetailField label={t("deploy.createdOn")}>
                {formatDate(detail.createdAt)}
              </DetailField>
            )}
          </div>

          {detail.domains.length > 0 && (
            <div>
              <div className="flex items-center gap-1 pb-1 text-[9.5px] uppercase tracking-wide text-fg-muted">
                <Globe size={9} />
                {t("deploy.domains", { n: detail.domains.length })}
              </div>
              <div className="flex flex-wrap gap-1">
                {detail.domains.map((d) => (
                  <a
                    key={d}
                    href={`https://${d}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded bg-bg px-1.5 py-0.5 font-mono text-[10px] text-accent hover:underline"
                  >
                    {d}
                  </a>
                ))}
              </div>
            </div>
          )}

          {detail.envs.length > 0 && (
            <div>
              <div className="flex items-center gap-1 pb-1 text-[9.5px] uppercase tracking-wide text-fg-muted">
                <KeyRound size={9} />
                {t("deploy.envVars", { n: detail.envs.length })}
              </div>
              <div className="flex flex-wrap gap-1">
                {detail.envs.map((v) => (
                  <span
                    key={v.key}
                    title={t("deploy.targets", { targets: v.targets.join(", ") || t("common.all") })}
                    className="rounded bg-bg px-1.5 py-0.5 font-mono text-[10px] text-fg-secondary"
                  >
                    {v.key}
                    {v.targets.length > 0 && v.targets.length < 3 && (
                      <span className="pl-1 text-fg-muted">({v.targets.join(",")})</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DeploymentRow({
  dep,
  onAction,
  busyAction,
}: {
  dep: VercelDeploymentInfo;
  onAction: (action: string, dep: VercelDeploymentInfo) => void;
  busyAction?: string;
}): React.JSX.Element {
  const t = useT();
  const [logsOpen, setLogsOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [logs, setLogs] = useState<string | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);
  const s = stateStyle(dep.state, t);
  const url = dep.url ? `https://${dep.url}` : undefined;
  const isProd = dep.target === "production";
  const isCurrent = isProd && dep.state === "READY" && dep.substate === "PROMOTED";
  const active = ACTIVE_STATES.has(dep.state);

  const toggleLogs = (): void => {
    const next = !logsOpen;
    setLogsOpen(next);
    if (next && logs === null) {
      window.pi.deployments
        .logs(dep.id)
        .then((text) => setLogs(text || t("deploy.noLogs")))
        .catch((e: unknown) => setLogsError(ipcErrorMessage(e)));
    }
  };

  return (
    <div className="rounded-xl border border-border bg-bg transition-colors hover:border-border-strong">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", s.dot)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-xs font-medium">{dep.name}</span>
            <span className={cn("shrink-0 text-[10.5px]", s.text)}>{s.label}</span>
            {isProd && (
              <span
                className={cn(
                  "shrink-0 rounded px-1 py-px text-[9.5px] font-medium",
                  isCurrent ? "bg-accent/15 text-accent" : "bg-bg-tertiary text-fg-muted",
                )}
              >
                {isCurrent ? t("deploy.prodCurrent") : t("deploy.prod")}
              </span>
            )}
            {!isProd && (
              <span className="shrink-0 rounded bg-bg-tertiary px-1 py-px text-[9.5px] text-fg-muted">
                {t("deploy.preview")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 pt-0.5 text-[10.5px] text-fg-muted">
            {dep.url && <span className="truncate font-mono">{dep.url}</span>}
            {dep.createdAt && <span className="shrink-0">{formatRelativeTime(dep.createdAt)}</span>}
            {dep.creator && <span className="shrink-0">{t("deploy.by", { name: dep.creator })}</span>}
            {dep.commitMessage && (
              <span className="truncate">· {dep.commitMessage.split("\n")[0]}</span>
            )}
            {dep.errorMessage && (
              <span className="truncate text-danger">· {dep.errorMessage}</span>
            )}
          </div>
        </div>
        {url && dep.state === "READY" && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[10.5px] text-accent transition-colors hover:bg-accent/10"
          >
            <ExternalLink size={12} />
            {t("deploy.open")}
          </a>
        )}
      </div>

      {/* 运维操作行 */}
      <div className="flex flex-wrap items-center gap-0.5 border-t border-border/60 px-2 py-1">
        <ActionButton
          icon={<Info size={12} />}
          label={detailOpen ? t("common.hideDetails") : t("common.details")}
          onClick={() => setDetailOpen(!detailOpen)}
        />
        <ActionButton
          icon={<ScrollText size={12} />}
          label={logsOpen ? t("deploy.hideLogs") : t("deploy.logs")}
          onClick={toggleLogs}
        />
        <ActionButton
          icon={<RefreshCw size={12} />}
          label={t("deploy.redeploy")}
          busy={busyAction === "redeploy"}
          onClick={() => onAction("redeploy", dep)}
        />
        {dep.state === "READY" && !isCurrent && (
          <ActionButton
            icon={isProd ? <History size={12} /> : <ArrowUpCircle size={12} />}
            label={isProd ? t("deploy.rollback") : t("deploy.promote")}
            busy={busyAction === (isProd ? "rollback" : "promote")}
            onClick={() => onAction(isProd ? "rollback" : "promote", dep)}
          />
        )}
        {active && (
          <ActionButton
            icon={<XCircle size={12} />}
            label={t("deploy.cancelBuild")}
            danger
            busy={busyAction === "cancel"}
            onClick={() => onAction("cancel", dep)}
          />
        )}
        <div className="flex-1" />
        <ActionButton
          icon={<Trash2 size={12} />}
          label={t("common.delete")}
          danger
          busy={busyAction === "delete"}
          onClick={() => onAction("delete", dep)}
        />
      </div>

      {detailOpen && (
        <div className="border-t border-border/60">
          <DeploymentDetail dep={dep} />
        </div>
      )}

      {logsOpen && (
        <div className="border-t border-border/60">
          {logsError && <div className="px-3 py-2 text-[11px] text-danger">{logsError}</div>}
          {!logs && !logsError && (
            <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-fg-muted">
              <Loader2 size={12} className="animate-spin" />
              {t("deploy.loadingLogs")}
            </div>
          )}
          {logs && (
            <pre className="selectable max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-b-xl bg-bg-secondary px-3 py-2 font-mono text-[10.5px] leading-relaxed text-fg-secondary">
              {logs}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function DeploymentsPanel(): React.JSX.Element {
  const t = useT();
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const settingsOpen = useAppStore((s) => s.settingsOpen);

  const [configured, setConfigured] = useState<boolean | null>(null);
  const [projects, setProjects] = useState<VercelProjectInfo[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [deployments, setDeployments] = useState<VercelDeploymentInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  /** `${deploymentId}:${action}` 正在执行的运维操作 */
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refresh = useCallback(
    async (silent = false): Promise<void> => {
      if (!silent) setRefreshing(true);
      try {
        const list = await window.pi.deployments.list(projectId || undefined);
        setDeployments(list);
        setError(null);
      } catch (e) {
        setError(ipcErrorMessage(e));
      } finally {
        if (!silent) setRefreshing(false);
      }
    },
    [projectId],
  );

  // 进入页面或关掉设置后：检查配置 → 拉项目列表 + 部署列表
  useEffect(() => {
    if (settingsOpen) return;
    setError(null);
    setNotice(null);
    void window.pi.deployments.configured().then((ok) => {
      setConfigured(ok);
      if (!ok) return;
      void window.pi.deployments.projects().then(setProjects).catch(() => setProjects([]));
    });
  }, [settingsOpen]);

  useEffect(() => {
    if (!configured) return;
    setDeployments(null);
    void refresh(true);
  }, [configured, refresh]);

  // 自动轮询：有构建中的部署时 4s，否则 15s
  const hasActive = useMemo(
    () => (deployments ?? []).some((d) => ACTIVE_STATES.has(d.state)),
    [deployments],
  );
  useEffect(() => {
    if (!configured) return;
    const interval = hasActive ? 4000 : 15000;
    pollRef.current = setTimeout(() => void refresh(true), interval);
    return () => clearTimeout(pollRef.current);
  }, [configured, hasActive, deployments, refresh]);

  const runAction = async (action: string, dep: VercelDeploymentInfo): Promise<void> => {
    const id = dep.url ?? dep.id;
    const confirmText: Record<string, string> = {
      delete: t("deploy.confirmDelete", { id }),
      rollback: t("deploy.confirmRollback", { id }),
      promote: t("deploy.confirmPromote", { id }),
      cancel: t("deploy.confirmCancel", { id }),
    };
    if (confirmText[action] && !window.confirm(confirmText[action])) return;

    setBusy(`${dep.id}:${action}`);
    setNotice(null);
    try {
      if (action === "cancel") await window.pi.deployments.cancel(dep.id);
      else if (action === "delete") await window.pi.deployments.delete(dep.id);
      else if (action === "redeploy") {
        await window.pi.deployments.redeploy(
          dep.id,
          dep.name,
          dep.target === "production" ? "production" : undefined,
        );
        setNotice(t("deploy.noticeRedeploy"));
      } else if (action === "promote" && dep.projectId) {
        await window.pi.deployments.promote(dep.projectId, dep.id);
        setNotice(t("deploy.noticePromote"));
      } else if (action === "rollback" && dep.projectId) {
        await window.pi.deployments.rollback(dep.projectId, dep.id);
        setNotice(t("deploy.noticeRollback"));
      }
      await refresh(true);
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-end justify-between gap-4 px-8 pt-8">
        <div>
          <h1 className="font-serif-display text-[26px] leading-tight">{t("sidebar.deployments")}</h1>
          <p className="flex items-center gap-2 pt-0.5 text-xs text-fg-muted">
            {t("deploy.subtitle")}
            {hasActive && (
              <span className="flex items-center gap-1 text-warning">
                <Loader2 size={11} className="animate-spin" />
                {t("deploy.buildingRefresh")}
              </span>
            )}
          </p>
        </div>
        {configured && (
          <div className="flex shrink-0 items-center gap-2">
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="max-w-44 rounded-lg border border-border bg-bg px-2 py-1.5 text-[11px] text-fg outline-none focus:border-accent/60"
            >
              <option value="">{t("deploy.allProjects")}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void refresh()}
              title={t("common.refresh")}
              className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
            >
              <RefreshCw size={13} className={cn(refreshing && "animate-spin")} />
            </button>
          </div>
        )}
      </div>

      {configured === false && (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 pb-8 text-center">
          <Rocket size={28} className="text-fg-muted" />
          <div className="text-sm font-medium">{t("deploy.noToken")}</div>
          <p className="max-w-sm text-xs leading-relaxed text-fg-muted">
            {t("deploy.noTokenIntro")}
          </p>
          <button
            type="button"
            onClick={() => setSettingsOpen(true, "deploy")}
            className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover"
          >
            <Settings size={13} />
            {t("deploy.goSettings")}
          </button>
        </div>
      )}

      {configured && (
        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-8 pb-10 pt-6">
            {projectId && <ProjectInfoCard projectId={projectId} />}
            {error && (
              <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[11px] text-danger">
                {error}
              </div>
            )}
            {notice && (
              <div className="rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-[11px] text-success">
                {notice}
              </div>
            )}
            {deployments === null && !error && (
              <div className="flex items-center justify-center py-16">
                <Loader2 size={18} className="animate-spin text-fg-muted" />
              </div>
            )}
            {deployments?.length === 0 && (
              <div className="flex min-h-[40vh] items-center justify-center text-center text-xs text-fg-muted">
                {t("deploy.empty")}
              </div>
            )}
            {deployments?.map((dep) => (
              <DeploymentRow
                key={dep.id}
                dep={dep}
                onAction={(action, d) => void runAction(action, d)}
                busyAction={busy?.startsWith(`${dep.id}:`) ? busy.split(":")[1] : undefined}
              />
            ))}
          <div className="flex items-center justify-center gap-1.5 pt-1 text-[10px] text-fg-muted">
            <RotateCcw size={10} />
            {hasActive ? t("deploy.pollFast") : t("deploy.pollSlow")} · {t("deploy.recent")}
          </div>
        </div>
      )}
    </div>
  );
}
