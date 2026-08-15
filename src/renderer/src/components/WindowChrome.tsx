import { PanelLeft, Search } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { IS_MAC, IS_WINDOWS, MOD_LABEL } from "@/lib/platform";

/**
 * Windows 的窗口控件（WCO overlay）盖在窗口右上角；贴着窗口右缘的
 * 标题栏行需要用这个间隙避开它。宽度由 CSS env(titlebar-area-width)
 * 推出，非 Windows 平台上为 0（渲染 null）。
 */
export function WinControlsGap(): React.JSX.Element | null {
  if (!IS_WINDOWS) return null;
  return <div className="wco-gap h-full shrink-0" aria-hidden />;
}

/**
 * Claude-style window chrome: traffic-light inset, then a thin PanelLeft
 * toggle and a search (⌘K) icon. Must be a descendant of `.drag-region`;
 * buttons are `.no-drag` so Electron doesn't steal the click for window-drag.
 */
export function WindowChrome({
  trafficLights = false,
  align = "start",
  winControlsGap = false,
}: {
  /** Leave room for hiddenInset traffic lights (x:16, ~54px wide). macOS only. */
  trafficLights?: boolean;
  /** Put the sidebar/search buttons on the right of the flex row. */
  align?: "start" | "end";
  /** 该行贴着窗口右缘时置 true，Windows 上为系统窗口控件留出空隙。 */
  winControlsGap?: boolean;
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
      {trafficLights && IS_MAC && <div className="w-[72px] shrink-0" aria-hidden />}
      {align === "end" && <div className="min-w-0 flex-1" aria-hidden />}
      <button
        type="button"
        title={
          collapsed
            ? t("window.expandSidebar", { mod: MOD_LABEL })
            : t("window.collapseSidebar", { mod: MOD_LABEL })
        }
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
        title={t("window.search", { mod: MOD_LABEL })}
        onClick={() => setPaletteOpen(true)}
        className={cn(
          "no-drag rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-secondary",
          align === "end" && "mr-1.5",
        )}
      >
        <Search size={16} strokeWidth={1.7} />
      </button>
      {winControlsGap && <WinControlsGap />}
    </>
  );
}

/** Full-width drag titlebar used when the sidebar is collapsed and the view has no own header. */
export function CollapsedTitlebar(): React.JSX.Element | null {
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  if (!collapsed) return null;
  return (
    <div className="drag-region flex h-12 shrink-0 items-center gap-0.5">
      <WindowChrome trafficLights align="end" winControlsGap />
    </div>
  );
}
