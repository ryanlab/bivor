import { PanelLeft, Search } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";

/**
 * Claude-style window chrome: traffic-light inset, then a thin PanelLeft
 * toggle and a search (⌘K) icon. Must be a descendant of `.drag-region`;
 * buttons are `.no-drag` so Electron doesn't steal the click for window-drag.
 */
export function WindowChrome({
  trafficLights = false,
  align = "start",
}: {
  /** Leave room for hiddenInset traffic lights (x:16, ~54px wide). */
  trafficLights?: boolean;
  /** Put the sidebar/search buttons on the right of the flex row. */
  align?: "start" | "end";
}): React.JSX.Element {
  const t = useT();
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setPaletteOpen = useAppStore((s) => s.setPaletteOpen);
  const pending = useAppStore((s) =>
    Object.values(s.chats).reduce((n, c) => n + c.pendingApprovals.length, 0),
  );

  return (
    <>
      {trafficLights && <div className="w-[72px] shrink-0" aria-hidden />}
      {align === "end" && <div className="min-w-0 flex-1" aria-hidden />}
      <button
        type="button"
        title={collapsed ? t("window.expandSidebar", { mod: "⌘" }) : t("window.collapseSidebar", { mod: "⌘" })}
        onClick={toggleSidebar}
        className={cn(
          "no-drag relative rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-secondary",
        )}
      >
        <PanelLeft size={16} strokeWidth={1.7} />
        {collapsed && pending > 0 && (
          <span
            title={t("sidebar.pendingApprovals", { n: pending })}
            className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-info"
          />
        )}
      </button>
      <button
        type="button"
        title={t("window.search", { mod: "⌘" })}
        onClick={() => setPaletteOpen(true)}
        className={cn(
          "no-drag rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-secondary",
          align === "end" && "mr-1.5",
        )}
      >
        <Search size={16} strokeWidth={1.7} />
      </button>
    </>
  );
}

/** Full-width drag titlebar used when the sidebar is collapsed and the view has no own header. */
export function CollapsedTitlebar(): React.JSX.Element | null {
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  if (!collapsed) return null;
  return (
    <div className="drag-region flex h-12 shrink-0 items-center gap-0.5">
      <WindowChrome trafficLights align="end" />
    </div>
  );
}
