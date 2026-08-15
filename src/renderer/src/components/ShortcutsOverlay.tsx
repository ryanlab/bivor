import { Keyboard, X } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useT } from "@/lib/i18n";

const isMac = navigator.platform.startsWith("Mac");
const MOD = isMac ? "⌘" : "Ctrl";

export function ShortcutsOverlay({ onClose }: { onClose: () => void }): React.JSX.Element {
  const t = useT();
  const appMode = useAppStore((s) => s.appMode);
  const isDaily = appMode === "daily";

  const groups: { title: string; items: [string, string][] }[] = [
    {
      title: t("shortcuts.global"),
      items: [
        [`${MOD} K`, t("shortcuts.commandPalette")],
        [`${MOD} N`, isDaily ? t("sidebar.newChat") : t("sidebar.newTask")],
        [`${MOD} O`, isDaily ? t("sidebar.overviewChat") : t("sidebar.overviewTask")],
        [`${MOD} B`, t("shortcuts.toggleSidebar")],
        [`${MOD} ⇧ M`, t("sidebar.monitor")],
        [`${MOD} W`, isDaily ? t("shortcuts.closeChat") : t("shortcuts.closeTask")],
        [`${MOD} ,`, t("common.settings")],
        [`${MOD} /`, t("palette.shortcuts")],
      ],
    },
    {
      title: t("shortcuts.session"),
      items: [
        [`${MOD} F`, t("shortcuts.searchInSession")],
        ["Enter", t("shortcuts.send")],
        ["Shift Enter", t("shortcuts.newline")],
      ],
    },
    ...(isDaily
      ? []
      : [
          {
            title: t("shortcuts.composer"),
            items: [
              ["/", t("shortcuts.slash")],
              ["@", t("shortcuts.mention")],
              ["!", t("shortcuts.bang")],
            ] as [string, string][],
          },
        ]),
  ];

  return (
    <div
      className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="dialog-in w-[460px] overflow-hidden rounded-2xl border border-border-strong bg-bg-secondary shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
          <Keyboard size={15} className="text-accent" />
          <span className="text-sm font-medium">{t("shortcuts.title")}</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
          >
            <X size={15} />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 p-5">
          {groups.map((g) => (
            <div key={g.title}>
              <div className="pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                {g.title}
              </div>
              <div className="overflow-hidden rounded-xl border border-border bg-bg">
                {g.items.map(([keys, desc], i) => (
                  <div
                    key={keys}
                    className={
                      "flex items-center justify-between px-3.5 py-2 text-xs" +
                      (i > 0 ? " border-t border-border/50" : "")
                    }
                  >
                    <span className="text-fg-secondary">{desc}</span>
                    <span className="flex gap-1">
                      {keys.split(" ").map((k) => (
                        <kbd
                          key={k}
                          className="rounded-md border border-border bg-bg-tertiary px-1.5 py-0.5 font-mono text-[10.5px] text-fg-secondary shadow-sm"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
