import { useEffect } from "react";
import { useAppStore, WORKSPACE_TERM_ID } from "@/stores/app-store";
import { Sidebar } from "@/components/Sidebar";
import { IdleTitlebar } from "@/components/WindowChrome";
import { ChatView } from "@/components/ChatView";
import { MissionControl } from "@/components/MissionControl";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { TerminalDrawer } from "@/components/TerminalDrawer";
import { SandboxPanel } from "@/components/SandboxPanel";
import { FileTreePanel } from "@/components/FileTreePanel";
import { SettingsDialog } from "@/components/SettingsDialog";
import { CommandPalette } from "@/components/CommandPalette";
import { ResourcesDialog } from "@/components/ResourcesDialog";
import { UsageDialog } from "@/components/UsageDialog";
import { AgentMonitorDialog } from "@/components/AgentMonitorDialog";
import { ScheduledTasksDialog } from "@/components/ScheduledTasksDialog";
import { DeploymentsPanel } from "@/components/DeploymentsPanel";
import { ShortcutsOverlay } from "@/components/ShortcutsOverlay";
import { tt } from "@/lib/i18n";

export default function App(): React.JSX.Element {
  const activeChatId = useAppStore((s) => s.activeChatId);
  const activeView = useAppStore((s) => s.activeView);
  const appMode = useAppStore((s) => s.appMode);
  const chats = useAppStore((s) => s.chats);
  const handleEnvelope = useAppStore((s) => s.handleEnvelope);
  const loadCatalog = useAppStore((s) => s.loadCatalog);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const shortcutsOpen = useAppStore((s) => s.shortcutsOpen);
  const setShortcutsOpen = useAppStore((s) => s.setShortcutsOpen);
  const workspaceCwd = useAppStore((s) => s.activeProjectPath ?? s.defaultProjectCwd);
  const workspaceTerm = useAppStore((s) => s.workspaceTerm);
  const workspaceSandboxOpen = useAppStore((s) => s.workspaceSandboxOpen);
  const workspaceFilesOpen = useAppStore((s) => s.workspaceFilesOpen);
  const setWorkspaceFilesOpen = useAppStore((s) => s.setWorkspaceFilesOpen);

  useEffect(() => {
    const unsubscribe = window.pi.chat.onEvent(handleEnvelope);
    void loadCatalog();
    void useAppStore.getState().checkForUpdates();
    const updateTimer = setInterval(
      () => void useAppStore.getState().checkForUpdates(),
      4 * 60 * 60_000,
    );
    void window.pi.config.set({ locale: useAppStore.getState().locale });
    void useAppStore.getState().refreshScheduledTasks();
    const unsubScheduleChanged = window.pi.schedule.onChanged((tasks) => {
      useAppStore.setState({ scheduledTasks: tasks });
    });
    const unsubAgentCrash = window.pi.monitor.onAgentCrash((payload) => {
      if (Notification.permission === "denied") return;
      const name =
        payload.label ??
        useAppStore.getState().chats[payload.chatId]?.sessionName ??
        (payload.kind === "headless" ? tt("monitor.headlessTask") : payload.serviceName);
      new Notification(tt("notify.agentCrashTitle"), {
        body: tt("notify.agentCrashBody", { name, code: payload.code }),
      });
    });
    const unsubWorkspaceSandbox = window.pi.workspaceSandbox.onStatus((status) => {
      useAppStore.getState().setWorkspaceSandboxStatus(status, true);
    });
    const unsubMenu = window.pi.system.onMenuAction((action) => {
      const s = useAppStore.getState();
      if (action === "new-task") {
        s.showWelcome();
      } else if (action === "open-settings") {
        s.setSettingsOpen(true);
      } else if (action === "open-project") {
        void s.pickAndOpenProject();
      }
    });
    const onKeyDown = (e: KeyboardEvent): void => {
      const s = useAppStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "k") {
        e.preventDefault();
        s.setPaletteOpen(!s.paletteOpen);
      } else if (e.key === "n") {
        e.preventDefault();
        s.showWelcome();
      } else if (e.key === "o" && !e.shiftKey) {
        e.preventDefault();
        s.showHome();
      } else if (e.key === "b") {
        e.preventDefault();
        s.toggleSidebar();
      } else if (e.key === ",") {
        e.preventDefault();
        s.setSettingsOpen(true);
      } else if (e.key === "w" && s.activeView === "chat" && s.activeChatId) {
        e.preventDefault();
        s.closeChat(s.activeChatId);
      } else if (e.key === "/") {
        e.preventDefault();
        s.setShortcutsOpen(!s.shortcutsOpen);
      } else if (e.key.toLowerCase() === "m" && e.shiftKey) {
        e.preventDefault();
        s.setMonitorOpen(!s.monitorOpen);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      unsubscribe();
      unsubScheduleChanged();
      unsubAgentCrash();
      unsubWorkspaceSandbox();
      unsubMenu();
      clearInterval(updateTimer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [handleEnvelope, loadCatalog]);

  const activeChat =
    activeView === "chat" && activeChatId && chats[activeChatId]?.kind === appMode
      ? chats[activeChatId]
      : undefined;

  return (
    <div className="flex h-full">
      {!sidebarCollapsed && <Sidebar />}
      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {!activeChat && <IdleTitlebar />}
            {activeChat ? (
              <ChatView chat={activeChat} />
            ) : activeView === "welcome" ? (
              <WelcomeScreen />
            ) : activeView === "schedule" ? (
              <ScheduledTasksDialog />
            ) : activeView === "deployments" ? (
              <DeploymentsPanel />
            ) : (
              <MissionControl />
            )}
          </div>
          {!activeChat &&
            activeView !== "schedule" &&
            activeView !== "deployments" &&
            (workspaceFilesOpen || workspaceSandboxOpen) && (
            <div className="flex min-h-0 shrink-0 bg-bg-secondary">
              {workspaceFilesOpen && workspaceCwd && (
                <FileTreePanel cwd={workspaceCwd} onClose={() => setWorkspaceFilesOpen(false)} />
              )}
              {workspaceSandboxOpen && <SandboxPanel workspace />}
            </div>
          )}
        </div>
        {!activeChat &&
          activeView !== "schedule" &&
          activeView !== "deployments" &&
          workspaceTerm.open &&
          workspaceCwd && (
          <TerminalDrawer
            sandbox={false}
            chat={{
              chatId: WORKSPACE_TERM_ID,
              cwd: workspaceCwd,
              userTerms: workspaceTerm.userTerms,
              localTab: workspaceTerm.localTab,
              termCwds: workspaceTerm.termCwds,
            }}
          />
        )}
      </main>
      <SettingsDialog />
      <ResourcesDialog />
      <UsageDialog />
      <AgentMonitorDialog />
      {shortcutsOpen && <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />}
      <CommandPalette />
    </div>
  );
}
