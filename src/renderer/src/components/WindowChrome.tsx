import { TITLEBAR_HEIGHT } from "@shared/titlebar";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";

const ICON = 16;
const STROKE = 1.3;
const MOD = navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl";

export function Titlebar({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={cn("drag-region flex shrink-0 items-center", className)}
      style={{ height: TITLEBAR_HEIGHT }}
    >
      {children}
    </div>
  );
}

const chromeBtn =
  "no-drag relative inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-secondary";

function Glyph({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      width={ICON}
      height={ICON}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      stroke="currentColor"
      strokeWidth={STROKE}
    >
      {children}
    </svg>
  );
}

function SidebarGlyph({ rail }: { rail: boolean }): React.JSX.Element {
  return (
    <Glyph>
      <rect x="1.4" y="1.4" width="13.2" height="13.2" rx="3.4" />
      <path d={rail ? "M5.4 1.4v13.2" : "M5.4 4.6v6.8"} strokeLinecap="round" />
    </Glyph>
  );
}

function ComposeGlyph(): React.JSX.Element {
  return (
    <Glyph>
      <path
        d="M8.6 1.4H4.8A3.4 3.4 0 0 0 1.4 4.8v6.4A3.4 3.4 0 0 0 4.8 14.6h6.4A3.4 3.4 0 0 0 14.6 11.2V8.2"
        strokeLinecap="round"
      />
      <path
        d="M8 10.6 13.55 5.05a1.1 1.1 0 0 0 0-1.56L12.51 2.45a1.1 1.1 0 0 0-1.56 0L5.4 8l-.5 2.2a.35.35 0 0 0 .42.42z"
        strokeLinejoin="round"
      />
    </Glyph>
  );
}

function SearchGlyph(): React.JSX.Element {
  return (
    <Glyph>
      <path
        d="M8.4 14.6H4.8A3.4 3.4 0 0 1 1.4 11.2V4.8A3.4 3.4 0 0 1 4.8 1.4h6.4A3.4 3.4 0 0 1 14.6 4.8V8.2"
        strokeLinecap="round"
      />
      <circle cx="7.3" cy="7.3" r="2.55" />
      <path d="M9.2 9.2 13.8 13.8" strokeLinecap="round" />
    </Glyph>
  );
}

function ChromeButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button type="button" title={title} onClick={onClick} className={chromeBtn}>
      {children}
    </button>
  );
}

/**
 * Codex-style window chrome: traffic-light inset, then sidebar / compose /
 * search on the same baseline. No back/forward. Buttons are `.no-drag`.
 */
export function WindowChrome({
  trafficLights = false,
}: {
  trafficLights?: boolean;
}): React.JSX.Element {
  const t = useT();
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const showWelcome = useAppStore((s) => s.showWelcome);
  const setPaletteOpen = useAppStore((s) => s.setPaletteOpen);
  const isDaily = useAppStore((s) => s.appMode === "daily");
  const pending = useAppStore((s) => {
    if (!s.sidebarCollapsed) return 0;
    return Object.values(s.chats).reduce((n, c) => n + c.pendingApprovals.length, 0);
  });

  return (
    <div className="flex items-center gap-1.5">
      {trafficLights && <div className="w-[88px] shrink-0" aria-hidden />}
      <ChromeButton
        title={collapsed ? t("window.expandSidebar", { mod: MOD }) : t("window.collapseSidebar", { mod: MOD })}
        onClick={toggleSidebar}
      >
        <SidebarGlyph rail={!collapsed} />
        {pending > 0 && (
          <span
            title={t("sidebar.pendingApprovals", { n: pending })}
            className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-info"
          />
        )}
      </ChromeButton>
      {collapsed && (
        <ChromeButton
          title={isDaily ? t("window.newChat", { mod: MOD }) : t("window.newTask", { mod: MOD })}
          onClick={showWelcome}
        >
          <ComposeGlyph />
        </ChromeButton>
      )}
      <ChromeButton title={t("window.search", { mod: MOD })} onClick={() => setPaletteOpen(true)}>
        <SearchGlyph />
      </ChromeButton>
    </div>
  );
}

/** Full-width drag titlebar used when the sidebar is collapsed and the view has no own header. */
export function CollapsedTitlebar(): React.JSX.Element | null {
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  if (!collapsed) return null;
  return (
    <Titlebar>
      <WindowChrome trafficLights />
    </Titlebar>
  );
}
