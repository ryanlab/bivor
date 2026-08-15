import { useEffect } from "react";
import { useAppStore } from "@/stores/app-store";
import { Sidebar } from "@/components/Sidebar";
import { WindowChrome } from "@/components/WindowChrome";
import { ChatView } from "@/components/ChatView";
import { MissionControl } from "@/components/MissionControl";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { SettingsDialog } from "@/components/SettingsDialog";
import { CommandPalette } from "@/components/CommandPalette";
import { ResourcesDialog } from "@/components/ResourcesDialog";
import { UsageDialog } from "@/components/UsageDialog";
import { ScheduledTasksDialog } from "@/components/ScheduledTasksDialog";
import { DeploymentsPanel } from "@/components/DeploymentsPanel";
import { ShortcutsOverlay } from "@/components/ShortcutsOverlay";

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

  useEffect(() => {
    const unsubscribe = window.pi.chat.onEvent(handleEnvelope);
    void loadCatalog();
    void window.pi.config.set({ locale: useAppStore.getState().locale });
    void useAppStore.getState().refreshScheduledTasks();
    const unsubScheduleChanged = window.pi.schedule.onChanged((tasks) => {
      useAppStore.setState({ scheduledTasks: tasks });
    });
    const unsubScheduleTrigger = window.pi.schedule.onTrigger((task) => {
      useAppStore.getState().handleScheduleTrigger(task);
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
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      unsubscribe();
      unsubScheduleChanged();
      unsubScheduleTrigger();
      unsubMenu();
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
        {!activeChat && sidebarCollapsed && (
          <div className="drag-region flex h-12 shrink-0 items-center gap-0.5">
            <WindowChrome trafficLights align="end" winControlsGap />
          </div>
        )}
        {activeChat ? (
          <ChatView chat={activeChat} />
        ) : activeView === "welcome" ? (
          <WelcomeScreen />
        ) : (
          <MissionControl />
        )}
      </main>
      <SettingsDialog />
      <ResourcesDialog />
      <UsageDialog />
      <ScheduledTasksDialog />
      <DeploymentsPanel />
      {shortcutsOpen && <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />}
      <CommandPalette />
    </div>
  );
}
