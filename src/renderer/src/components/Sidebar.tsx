import { useEffect, useState } from "react";
import {
  Activity,
  AlarmClock,
  ArrowUpCircle,
  BarChart3,
  Check,
  GitBranch,
  GitFork,
  Loader2,
  MessageSquare,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import type { AppVersions, SessionListItem } from "@shared/protocol";
import { useAppStore } from "@/stores/app-store";
import { Titlebar, WindowChrome } from "@/components/WindowChrome";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { ColSash, useDragWidth } from "@/lib/use-drag-width";
import { filterSessionsByTime } from "@/lib/session-time";

const SIDEBAR_W_KEY = "bivor:sidebar-width";
const SIDEBAR_W = { fallback: 272, min: 200, max: 480 };
const NAV_ITEM =
  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-fg transition-colors hover:bg-bg-hover";
const NAV_ITEM_ON = "bg-bg-hover";

function SessionRow({
  session,
  isOpen,
  onOpen,
}: {
  session: SessionListItem;
  isOpen: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  const t = useT();
  const renameSession = useAppStore((s) => s.renameSession);
  const deleteSession = useAppStore((s) => s.deleteSession);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const label = session.name || session.firstUserMessage || t("sidebar.emptyChat");

  if (editing) {
    return (
      <div className="px-2 py-1">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) {
              void renameSession(session.path, name.trim());
              setEditing(false);
            }
            if (e.key === "Escape") setEditing(false);
          }}
          onBlur={() => setEditing(false)}
          placeholder={label}
          className="w-full rounded-md border border-accent/50 bg-bg-input px-2 py-1 text-xs text-fg outline-none"
        />
      </div>
    );
  }

  return (
    <div
      className="group relative flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-bg-hover"
      onClick={onOpen}
    >
      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-fg-muted">
        <MessageSquare size={11} strokeWidth={1.7} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {isOpen && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
          <span className="min-w-0 flex-1 truncate text-[13px] text-fg-secondary group-hover:text-fg">
            {label}
          </span>
        </div>
        <div className="text-[11px] text-fg-muted">
          {formatRelativeTime(session.modifiedAt)}
          {session.messageCount ? ` · ${t("sidebar.messages", { n: session.messageCount })}` : ""}
        </div>
      </div>
      <div className="absolute right-1.5 top-1.5 hidden items-center gap-0.5 rounded-md bg-bg-hover group-hover:flex">
        {confirmDelete ? (
          <>
            <button
              type="button"
              title={t("sidebar.confirmDelete")}
              onClick={(e) => {
                e.stopPropagation();
                void deleteSession(session.path);
              }}
              className="rounded p-1 text-danger hover:bg-bg-tertiary"
            >
              <Check size={12} />
            </button>
            <button
              type="button"
              title={t("common.cancel")}
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDelete(false);
              }}
              className="rounded p-1 text-fg-muted hover:bg-bg-tertiary"
            >
              <X size={12} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              title={t("sidebar.rename")}
              onClick={(e) => {
                e.stopPropagation();
                setName(session.name ?? "");
                setEditing(true);
              }}
              className="rounded p-1 text-fg-muted hover:bg-bg-tertiary hover:text-fg"
            >
              <Pencil size={12} />
            </button>
            <button
              type="button"
              title={t("sidebar.deleteTrash")}
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDelete(true);
                setTimeout(() => setConfirmDelete(false), 3000);
              }}
              className="rounded p-1 text-fg-muted hover:bg-bg-tertiary hover:text-danger"
            >
              <Trash2 size={12} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function Sidebar(): React.JSX.Element {
  const t = useT();
  const appMode = useAppStore((s) => s.appMode);
  const dailyCwd = useAppStore((s) => s.dailyCwd);
  const activeProjectPath = useAppStore((s) => s.activeProjectPath);
  const activeProjectIsGit = useAppStore((s) => s.activeProjectIsGit);
  const openWorktreeChat = useAppStore((s) => s.openWorktreeChat);
  const [worktreeBusy, setWorktreeBusy] = useState(false);
  const [versions, setVersions] = useState<AppVersions>();
  const updateInfo = useAppStore((s) => s.updateInfo);
  const updateChecking = useAppStore((s) => s.updateChecking);
  const checkForUpdates = useAppStore((s) => s.checkForUpdates);
  const [checkedNoUpdate, setCheckedNoUpdate] = useState(false);

  const manualCheck = async (): Promise<void> => {
    setCheckedNoUpdate(false);
    await checkForUpdates(true);
    setCheckedNoUpdate(true);
    setTimeout(() => setCheckedNoUpdate(false), 4000);
  };
  const sessions = useAppStore((s) => s.sessions);
  const sessionTimeFilter = useAppStore((s) => s.sessionTimeFilter);
  const sessionsLoading = useAppStore((s) => s.sessionsLoading);
  const chats = useAppStore((s) => s.chats);
  const chatOrder = useAppStore((s) => s.chatOrder);
  const activeChatId = useAppStore((s) => s.activeChatId);
  const openChat = useAppStore((s) => s.openChat);
  const closeChat = useAppStore((s) => s.closeChat);
  const setActiveChat = useAppStore((s) => s.setActiveChat);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const refreshSessions = useAppStore((s) => s.refreshSessions);
  const showWelcome = useAppStore((s) => s.showWelcome);
  const activeView = useAppStore((s) => s.activeView);
  const setResourcesOpen = useAppStore((s) => s.setResourcesOpen);
  const isDaily = appMode === "daily";
  const sessionCwd = isDaily ? dailyCwd : activeProjectPath;
  const visibleChatIds = chatOrder.filter((id) => chats[id]?.kind === appMode);
  const canWorktree = !isDaily && activeProjectIsGit;
  const [width, onDrag] = useDragWidth(
    SIDEBAR_W_KEY,
    SIDEBAR_W.fallback,
    SIDEBAR_W.min,
    SIDEBAR_W.max,
    "right",
  );

  useEffect(() => {
    void refreshSessions();
  }, [activeProjectPath, dailyCwd, appMode, refreshSessions]);

  useEffect(() => {
    void window.pi.system.versions().then(setVersions);
  }, []);

  const visibleSessions = filterSessionsByTime(sessions, sessionTimeFilter);

  const openSessionFiles = new Map(
    Object.values(chats)
      .filter((c) => c.sessionFile)
      .map((c) => [c.sessionFile!, c.chatId]),
  );

  return (
    <div className="flex h-full min-h-0 shrink-0">
      <aside className="flex min-h-0 shrink-0 flex-col bg-bg-secondary" style={{ width }}>
      <Titlebar>
        <WindowChrome trafficLights />
      </Titlebar>

      <div className="px-2 pt-1">
        {versions && (
          <div className="flex items-center gap-1.5 px-2.5 pb-1.5 pt-0.5">
            <span className="flex items-baseline gap-1 font-serif-display text-[13px] font-semibold text-fg">
              <button
                type="button"
                title={t("settings.tabs.about")}
                onClick={() => setSettingsOpen(true, "about")}
                className="transition-colors hover:text-accent"
              >
                {t("sidebar.brand")}
              </button>
              {versions.appVersion}
            </span>
            <button
              type="button"
              title={t("updates.checkTitle")}
              disabled={updateChecking}
              onClick={() => void manualCheck()}
              className="rounded p-0.5 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg disabled:opacity-60"
            >
              <RefreshCw size={11} strokeWidth={2} className={cn(updateChecking && "animate-spin")} />
            </button>
            {!updateChecking && updateInfo?.hasUpdate && (
              <button
                type="button"
                title={t("updates.availableTitle", { latest: updateInfo.latest! })}
                onClick={() => window.open(updateInfo.url)}
                className="flex items-center gap-1 rounded-full bg-accent-muted px-1.5 py-0.5 text-[10.5px] text-accent transition-colors hover:bg-accent hover:text-white"
              >
                <ArrowUpCircle size={11} strokeWidth={2} />
                {updateInfo.latest}
              </button>
            )}
            {!updateChecking && checkedNoUpdate && !updateInfo?.hasUpdate && (
              <span className="text-[10.5px] text-fg-muted">
                {updateInfo?.error ? t("updates.checkFailed") : t("updates.upToDate")}
              </span>
            )}
          </div>
        )}
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={showWelcome}
            className={cn(NAV_ITEM, activeView === "welcome" && NAV_ITEM_ON)}
          >
            <Plus size={15} strokeWidth={1.7} />
            {isDaily ? t("sidebar.newChat") : t("sidebar.newTask")}
          </button>
          <button
            type="button"
            onClick={() => useAppStore.getState().setScheduledTasksOpen(true)}
            className={cn(NAV_ITEM, activeView === "schedule" && NAV_ITEM_ON)}
          >
            <AlarmClock size={15} strokeWidth={1.7} />
            {t("sidebar.schedule")}
          </button>
          <button
            type="button"
            onClick={() => useAppStore.getState().setDeploymentsOpen(true)}
            className={cn(NAV_ITEM, activeView === "deployments" && NAV_ITEM_ON)}
          >
            <Rocket size={15} strokeWidth={1.7} />
            {t("sidebar.deployments")}
          </button>
        </div>
      </div>

      {/* Open chats */}
      {visibleChatIds.length > 0 && (
        <div className="px-2 pt-3">
          <div className="px-2.5 pb-1 text-[12px] text-fg-muted">{t("sidebar.inProgress")}</div>
          {visibleChatIds.map((chatId) => {
            const chat = chats[chatId];
            if (!chat) return null;
            const label =
              chat.sessionName ||
              (() => {
                const firstUser = chat.messages.find((m) => m.role === "user");
                const text =
                  firstUser && typeof (firstUser as { content?: unknown }).content === "string"
                    ? ((firstUser as { content: string }).content as string)
                    : undefined;
                return text?.slice(0, 40) || t("sidebar.newSession");
              })();
            return (
              <div
                key={chatId}
                className={cn(
                  "group flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors",
                  activeView === "chat" && chatId === activeChatId
                    ? "bg-bg-hover text-fg"
                    : "text-fg-secondary hover:bg-bg-hover",
                )}
                onClick={() => setActiveChat(chatId)}
              >
                {chat.isStreaming ? (
                  <Loader2 size={13} className="shrink-0 animate-spin text-accent" />
                ) : chat.worktree ? (
                  <GitBranch size={13} className="shrink-0 text-fg-muted" />
                ) : (
                  <MessageSquare size={13} className="shrink-0 text-fg-muted" />
                )}
                <span className="min-w-0 flex-1 truncate text-[13px]">{label}</span>
                {chat.pendingApprovals.length > 0 && (
                  <span
                    title={t("sidebar.pendingApprovals", { n: chat.pendingApprovals.length })}
                    className="flex h-4 min-w-4 shrink-0 animate-pulse items-center justify-center rounded-full bg-warning px-1 text-[9.5px] font-bold text-white"
                  >
                    {chat.pendingApprovals.length}
                  </span>
                )}
                {(chat.subagents ? Object.values(chat.subagents).some((s) => s.state === "running") : false) && (
                  <GitFork size={11} className="shrink-0 text-accent" />
                )}
                {canWorktree && !chat.worktree && (
                  <button
                    type="button"
                    title={t("sidebar.worktreeTitle")}
                    disabled={worktreeBusy}
                    onClick={(e) => {
                      e.stopPropagation();
                      setWorktreeBusy(true);
                      void openWorktreeChat({ taskHint: label }).finally(() => setWorktreeBusy(false));
                    }}
                    className="hidden shrink-0 rounded p-0.5 text-fg-muted hover:bg-bg-tertiary hover:text-fg group-hover:block disabled:opacity-40"
                  >
                    {worktreeBusy ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <GitBranch size={12} />
                    )}
                  </button>
                )}
                <button
                  type="button"
                  title={t("common.close")}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeChat(chatId);
                  }}
                  className="hidden shrink-0 rounded p-0.5 text-fg-muted hover:bg-bg-tertiary hover:text-fg group-hover:block"
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Session history */}
      <div className="mt-3 flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-4 pb-1">
          <span className="text-[12px] text-fg-muted">{t("sidebar.recent")}</span>
          {sessionsLoading && (
            <Loader2 size={11} className="animate-spin text-fg-muted" />
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {visibleSessions.length === 0 && !sessionsLoading && (
            <div className="px-2 py-3 text-xs text-fg-muted">
              {sessions.length > 0
                ? t("sidebar.noInRange")
                : isDaily
                  ? t("sidebar.noChats")
                  : activeProjectPath
                    ? t("sidebar.noSessions")
                    : t("sidebar.pickProject")}
            </div>
          )}
          {visibleSessions.map((session) => (
            <SessionRow
              key={session.path}
              session={session}
              isOpen={openSessionFiles.has(session.path)}
              onOpen={() => {
                const openChatId = openSessionFiles.get(session.path);
                if (openChatId) {
                  setActiveChat(openChatId);
                } else {
                  void openChat({
                    cwd: session.cwd || sessionCwd!,
                    sessionFile: session.path,
                    kind: appMode,
                  });
                }
              }}
            />
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="p-2">
        <button
          type="button"
          onClick={() => setResourcesOpen(true)}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-fg-secondary transition-colors hover:bg-bg-hover"
        >
          <Package size={14} />
          {t("sidebar.resources")}
        </button>
        <button
          type="button"
          onClick={() => useAppStore.getState().setUsageOpen(true)}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-fg-secondary transition-colors hover:bg-bg-hover"
        >
          <BarChart3 size={14} />
          {t("sidebar.usage")}
        </button>
        <button
          type="button"
          onClick={() => useAppStore.getState().setMonitorOpen(true)}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-fg-secondary transition-colors hover:bg-bg-hover"
        >
          <Activity size={14} />
          {t("sidebar.monitor")}
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-fg-secondary transition-colors hover:bg-bg-hover"
        >
          <Settings size={14} />
          {t("common.settings")}
        </button>
      </div>
      </aside>
      <ColSash onDrag={onDrag} />
    </div>
  );
}
