/**
 * 部署运维面板：独立于会话的 Vercel 部署监控与运维模块。
 * 列出项目与部署、实时轮询状态（构建中加速轮询）、查看构建日志，
 * 并支持提升生产、回滚、取消构建、删除部署。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpCircle,
  Check,
  ExternalLink,
  GitBranch,
  Globe,
  History,
  Info,
  ListFilter,
  Loader2,
  RefreshCw,
  Rocket,
  RotateCcw,
  ScrollText,
  Settings,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import type { VercelDeploymentDetail, VercelDeploymentInfo } from "@shared/protocol";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelativeTime, ipcErrorMessage } from "@/lib/format";
import { menuItemClass, menuPanel } from "@/lib/menu";
import { useDismiss } from "@/lib/use-dismiss";
import { useT, type Translator } from "@/lib/i18n";

const ACTIVE_STATES = new Set(["BUILDING", "QUEUED", "INITIALIZING"]);

type StatusFilter = "all" | "ready" | "building" | "error" | "canceled";
type EnvFilter = "all" | "production" | "preview";

interface DeployListFilter {
  query: string;
  status: StatusFilter;
  env: EnvFilter;
}

const EMPTY_FILTER: DeployListFilter = {
  query: "",
  status: "all",
  env: "all",
};

function isFilterActive(f: DeployListFilter): boolean {
  return f.query.trim() !== "" || f.status !== "all" || f.env !== "all";
}

function deploymentMatchesFilter(dep: VercelDeploymentInfo, f: DeployListFilter): boolean {
  const q = f.query.trim().toLowerCase();
  if (q) {
    const hay = [dep.name, dep.url, dep.creator, dep.commitMessage, dep.errorMessage]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (f.status === "ready" && dep.state !== "READY") return false;
  if (f.status === "error" && dep.state !== "ERROR") return false;
  if (f.status === "canceled" && dep.state !== "CANCELED") return false;
  if (f.status === "building" && !ACTIVE_STATES.has(dep.state)) return false;
  if (f.env === "production" && dep.target !== "production") return false;
  if (f.env === "preview" && dep.target === "production") return false;
  return true;
}

function FilterChoice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}): React.JSX.Element {
  return (
    <>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={menuItemClass(o.id === value, "items-center gap-2 px-2.5 py-1.5")}
        >
          <span className="min-w-0 flex-1 truncate">{o.label}</span>
          {o.id === value && <Check size={14} strokeWidth={2.2} className="shrink-0 text-success" />}
        </button>
      ))}
    </>
  );
}

function DeployFilterButton({
  value,
  onChange,
}: {
  value: DeployListFilter;
  onChange: (next: DeployListFilter) => void;
}): React.JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, ref, () => setOpen(false));
  const active = isFilterActive(value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title={t("deploy.filter")}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-xl border px-3.5 text-xs font-medium transition-colors",
          active || open
            ? "border-border-strong bg-bg-hover text-fg"
            : "border-border bg-bg-input text-fg-secondary hover:text-fg",
        )}
      >
        <ListFilter size={13} />
        {t("deploy.filter")}
      </button>
      {open && (
        <div className={cn("dialog-in absolute right-0 top-full z-50 mt-1 w-56", menuPanel)}>
          <div className="px-1.5 pb-1 pt-0.5">
            <input
              autoFocus
              value={value.query}
              onChange={(e) => onChange({ ...value, query: e.target.value })}
              placeholder={t("deploy.filterSearch")}
              className="w-full bg-transparent px-1.5 py-1 text-xs text-fg outline-none placeholder:text-fg-muted"
            />
          </div>
          <div className="px-2.5 pb-0.5 pt-1 text-[11px] text-fg-muted">{t("deploy.filterStatus")}</div>
          <FilterChoice
            value={value.status}
            onChange={(status) => onChange({ ...value, status })}
            options={[
              { id: "all", label: t("common.all") },
              { id: "ready", label: t("deploy.ready") },
              { id: "building", label: t("deploy.building") },
              { id: "error", label: t("deploy.error") },
              { id: "canceled", label: t("deploy.canceled") },
            ]}
          />
          <div className="px-2.5 pb-0.5 pt-1.5 text-[11px] text-fg-muted">{t("deploy.filterEnv")}</div>
          <FilterChoice
            value={value.env}
            onChange={(env) => onChange({ ...value, env })}
            options={[
              { id: "all", label: t("common.all") },
              { id: "production", label: t("deploy.prod") },
              { id: "preview", label: t("deploy.preview") },
            ]}
          />
          {active && (
            <button
              type="button"
              onClick={() => onChange(EMPTY_FILTER)}
              className={menuItemClass(false, "justify-center text-fg-muted")}
            >
              {t("deploy.filterClear")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

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

function IconAction({
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
        "rounded-md p-1.5 transition-colors disabled:opacity-40",
        danger
          ? "text-fg-muted hover:bg-danger/10 hover:text-danger"
          : "text-fg-muted hover:bg-bg-hover hover:text-fg",
      )}
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : icon}
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const s = stateStyle(dep.state, t);
  const url = dep.url ? `https://${dep.url}` : undefined;
  const isProd = dep.target === "production";
  const isCurrent = isProd && dep.state === "READY" && dep.substate === "PROMOTED";
  const active = ACTIVE_STATES.has(dep.state);
  const envLabel = isCurrent ? t("deploy.prodCurrent") : isProd ? t("deploy.prod") : t("deploy.preview");
  const commit = dep.commitMessage?.split("\n")[0];

  useEffect(() => {
    if (!confirmDelete) return;
    const id = window.setTimeout(() => setConfirmDelete(false), 3000);
    return () => clearTimeout(id);
  }, [confirmDelete]);

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
    <div className="rounded-xl border border-border bg-bg px-3.5 pt-3.5 transition-colors hover:border-border-strong">
      <div className="flex items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium">{dep.name}</span>
            {active && (
              <span className="flex items-center gap-1 rounded-full bg-accent/12 px-1.5 py-0.5 text-[10px] text-accent">
                <Loader2 size={9} className="animate-spin" /> {s.label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 pt-0.5 text-[11px] text-fg-muted">
            <span className="flex shrink-0 items-center gap-1">
              <Globe size={11} />
              {envLabel}
            </span>
            {url && (
              <>
                <span>·</span>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 truncate font-mono text-accent hover:underline"
                >
                  {dep.url}
                </a>
              </>
            )}
            {commit && (
              <>
                <span>·</span>
                <span className="min-w-0 truncate">{commit}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {url && dep.state === "READY" && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              title={t("deploy.open")}
              className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
            >
              <ExternalLink size={13} />
            </a>
          )}
          <IconAction
            icon={<Info size={13} />}
            label={detailOpen ? t("common.hideDetails") : t("common.details")}
            onClick={() => setDetailOpen(!detailOpen)}
          />
          <IconAction
            icon={<ScrollText size={13} />}
            label={logsOpen ? t("deploy.hideLogs") : t("deploy.logs")}
            onClick={toggleLogs}
          />
          {dep.state === "READY" && !isCurrent && (
            <IconAction
              icon={isProd ? <History size={13} /> : <ArrowUpCircle size={13} />}
              label={isProd ? t("deploy.rollback") : t("deploy.promote")}
              busy={busyAction === (isProd ? "rollback" : "promote")}
              onClick={() => onAction(isProd ? "rollback" : "promote", dep)}
            />
          )}
          {active && (
            <IconAction
              icon={<XCircle size={13} />}
              label={t("deploy.cancelBuild")}
              danger
              busy={busyAction === "cancel"}
              onClick={() => onAction("cancel", dep)}
            />
          )}
          {confirmDelete ? (
            <>
              <button
                type="button"
                disabled={busyAction === "delete"}
                onClick={() => onAction("delete", dep)}
                className="rounded-md p-1.5 text-danger transition-colors hover:bg-danger/10 disabled:opacity-40"
                title={t("deploy.confirmDelete", { id: dep.url ?? dep.id })}
              >
                {busyAction === "delete" ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Check size={13} />
                )}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
                title={t("common.cancel")}
              >
                <X size={13} />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-bg-hover hover:text-danger"
              title={t("common.delete")}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="mt-2.5 border-t border-border/60">
        <div className="flex items-center gap-2 py-2.5 text-[11px] leading-none">
          {dep.state === "READY" ? (
            <span className="inline-flex h-4 items-center gap-0.5 text-success">
              <Check size={11} strokeWidth={2.2} className="shrink-0" />
              {s.label}
            </span>
          ) : dep.state === "ERROR" ? (
            <span className="inline-flex h-4 items-center gap-0.5 text-danger">
              <X size={11} strokeWidth={2.2} className="shrink-0" />
              {s.label}
            </span>
          ) : active ? (
            <span className="inline-flex h-4 items-center gap-0.5 text-warning">
              <Loader2 size={11} className="animate-spin" />
              {s.label}
            </span>
          ) : (
            <span className="inline-flex h-4 items-center text-fg-muted">{s.label}</span>
          )}
          {dep.createdAt && (
            <span className="inline-flex h-4 items-center text-fg-muted">
              {t("deploy.createdAt")}: {formatRelativeTime(dep.createdAt)}
            </span>
          )}
          {dep.errorMessage && (
            <span className="inline-flex h-4 min-w-0 items-center truncate text-danger/90">
              {dep.errorMessage}
            </span>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={toggleLogs}
            className="inline-flex h-4 items-center gap-1 text-[11px] leading-none text-accent transition-colors hover:text-accent-hover"
          >
            <ScrollText size={11} className="shrink-0" />
            {logsOpen ? t("deploy.hideLogs") : t("deploy.logs")}
          </button>
        </div>
      </div>

      {detailOpen && (
        <div className="-mx-3.5 border-t border-border/60">
          <DeploymentDetail dep={dep} />
        </div>
      )}

      {logsOpen && (
        <div className="-mx-3.5 border-t border-border/60">
          {logsError && <div className="px-3 py-2 text-[11px] text-danger">{logsError}</div>}
          {!logs && !logsError && (
            <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-fg-muted">
              <Loader2 size={12} className="animate-spin" />
              {t("deploy.loadingLogs")}
            </div>
          )}
          {logs && (
            <pre className="selectable max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-b-xl bg-bg-secondary px-3.5 py-2 font-mono text-[10.5px] leading-relaxed text-fg-secondary">
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
  const [filter, setFilter] = useState<DeployListFilter>(EMPTY_FILTER);
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
        const list = await window.pi.deployments.list();
        setDeployments(list);
        setError(null);
      } catch (e) {
        setError(ipcErrorMessage(e));
      } finally {
        if (!silent) setRefreshing(false);
      }
    },
    [],
  );

  // 进入页面或关掉设置后：检查配置 → 拉部署列表
  useEffect(() => {
    if (settingsOpen) return;
    setError(null);
    setNotice(null);
    void window.pi.deployments.configured().then(setConfigured);
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
  const visible = useMemo(
    () => (deployments ?? []).filter((d) => deploymentMatchesFilter(d, filter)),
    [deployments, filter],
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
      else if (action === "promote" && dep.projectId) {
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
      <div className="flex shrink-0 items-center justify-between gap-4 px-8 pt-8">
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
            <DeployFilterButton value={filter} onChange={setFilter} />
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
            {deployments && deployments.length > 0 && visible.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 pt-16 text-center">
                <p className="text-sm text-fg-muted">{t("deploy.filterEmpty")}</p>
                {isFilterActive(filter) && (
                  <button
                    type="button"
                    onClick={() => setFilter(EMPTY_FILTER)}
                    className="text-xs text-accent hover:text-accent-hover"
                  >
                    {t("deploy.filterClear")}
                  </button>
                )}
              </div>
            )}
            {visible.map((dep) => (
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
