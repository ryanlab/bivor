import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Code2, Eye, Folder, FolderPlus, MessageSquare, Minus, Plus, Search } from "lucide-react";
import { RUNTIME_PRESETS } from "@shared/runtime-presets";
import { useAppStore } from "@/stores/app-store";
import { basename, shortenPath } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";

const PROJECT_PRESETS = RUNTIME_PRESETS.filter((p) => p.workspace === "project");

const PRESET_META: Record<string, { icon: typeof Code2; hint: string }> = {
  coding: { icon: Code2, hint: "composer.presetCoding" },
  review: { icon: Eye, hint: "composer.presetReview" },
  minimal: { icon: Minus, hint: "composer.presetMinimal" },
};

export function PresetSwitch(): React.JSX.Element {
  const t = useT();
  const codingPresetId = useAppStore((s) => s.codingPresetId);
  const setCodingPreset = useAppStore((s) => s.setCodingPreset);
  const current = PROJECT_PRESETS.find((p) => p.id === codingPresetId) ?? PROJECT_PRESETS[0];
  const CurrentIcon = PRESET_META[current.id]?.icon ?? Code2;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title={PRESET_META[current.id] ? t(PRESET_META[current.id].hint) : current.description}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-fg-secondary transition-colors hover:bg-bg-hover"
      >
        <CurrentIcon size={13} strokeWidth={1.8} />
        <span>{t(`preset.${current.id}`)}</span>
        <ChevronDown size={12} className="text-fg-muted" />
      </button>
      {open && (
        <div className="dialog-in absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-border-strong bg-bg p-1 shadow-xl">
          {PROJECT_PRESETS.map((p) => {
            const Icon = PRESET_META[p.id]?.icon ?? Code2;
            const hint = PRESET_META[p.id] ? t(PRESET_META[p.id].hint) : p.description;
            const selected = p.id === codingPresetId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setCodingPreset(p.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-bg-hover",
                  selected ? "text-fg" : "text-fg-secondary",
                )}
              >
                <Icon size={14} strokeWidth={1.8} className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className={cn("text-xs", selected && "font-medium text-accent")}>{t(`preset.${p.id}`)}</div>
                  <div className="pt-0.5 text-[11px] leading-snug text-fg-muted">{hint}</div>
                </div>
                {selected && <Check size={13} className="mt-0.5 shrink-0 text-accent" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const MODES = [
  { id: "daily" as const, label: "welcome.dailyMode", hint: "preset.dailyHint", icon: MessageSquare },
  { id: "coding" as const, label: "welcome.codingMode", hint: "preset.codingHint", icon: Code2 },
];

export function ComposerStack({
  stacked,
  modeBar = false,
  className,
  children,
}: {
  stacked: boolean;
  /** 把日常/编程模式挂在输入框上方，样式与下方项目条对称。 */
  modeBar?: boolean;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const t = useT();
  const recentProjects = useAppStore((s) => s.recentProjects);
  const activeProjectPath = useAppStore((s) => s.activeProjectPath);
  const openProject = useAppStore((s) => s.openProject);
  const pickAndOpenProject = useAppStore((s) => s.pickAndOpenProject);
  const appMode = useAppStore((s) => s.appMode);
  const setAppMode = useAppStore((s) => s.setAppMode);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!stacked) setOpen(false);
  }, [stacked]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    requestAnimationFrame(() => searchRef.current?.focus());
    const onClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? recentProjects.filter(
        (p) =>
          basename(p.path).toLowerCase().includes(q) ||
          shortenPath(p.path).toLowerCase().includes(q) ||
          p.path.toLowerCase().includes(q),
      )
    : recentProjects;

  if (!stacked && !modeBar) return <div className={className}>{children}</div>;

  return (
    <div ref={ref} className={cn("relative", className)}>
      {modeBar && (
        <div className="relative z-0 mx-6 -mb-8 flex h-16 items-start gap-1 rounded-[20px] bg-bg-secondary px-2.5 pt-1.5">
          {MODES.map((m) => {
            const selected = m.id === appMode;
            return (
              <button
                key={m.id}
                type="button"
                title={t(m.hint)}
                onClick={() => setAppMode(m.id)}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-lg px-1.5 py-0.5 text-[13px] font-normal outline-none transition-colors",
                  selected ? "text-fg" : "text-fg-muted hover:text-fg-secondary",
                )}
              >
                <m.icon size={15} strokeWidth={1.7} className="shrink-0" />
                <span className="min-w-0 truncate">{t(m.label)}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="relative z-10">{children}</div>

      {stacked ? (
      <div
        className={cn(
          "relative z-0 mx-6 -mt-8 flex h-16 items-end gap-2 rounded-[20px] px-2.5 pb-1.5 transition-colors",
          open ? "bg-bg-tertiary" : "bg-bg-secondary",
        )}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-0.5 text-[13px] outline-none transition-colors",
            open ? "text-fg" : "text-fg-muted hover:text-fg-secondary",
          )}
        >
          <Folder size={15} strokeWidth={1.7} className="shrink-0" />
          <span className="min-w-0 truncate">
            {activeProjectPath
              ? t("composer.currentProject", { name: basename(activeProjectPath) })
              : t("composer.selectProject")}
          </span>
        </button>
      </div>
      ) : modeBar ? (
        <div className="h-8" aria-hidden />
      ) : null}

      {stacked && open && (
        <div className="dialog-in absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-border bg-bg shadow-xl">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search size={13} className="shrink-0 text-fg-muted" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("composer.searchProjects")}
              className="w-full bg-transparent text-xs text-fg outline-none placeholder:text-fg-muted"
            />
          </div>
          <div className="max-h-40 overflow-y-auto p-1">
            {filtered.length === 0 && (
              <div className="px-2.5 py-3 text-center text-xs text-fg-muted">
                {q ? t("composer.noMatchProject") : t("composer.noRecentProject")}
              </div>
            )}
            {filtered.map((p) => (
              <button
                key={p.path}
                type="button"
                onClick={() => {
                  openProject(p.path);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-bg-hover"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">{basename(p.path)}</div>
                  <div className="truncate text-[11px] text-fg-muted">{shortenPath(p.path)}</div>
                </div>
                {p.path === activeProjectPath && <Check size={13} className="text-accent" />}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 border-t border-border">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                void window.pi.system.createFolder().then(({ path }) => {
                  if (path) openProject(path);
                });
              }}
              className="flex items-center justify-center gap-2 px-3 py-2.5 text-xs text-fg-secondary transition-colors hover:bg-bg-hover"
            >
              <FolderPlus size={13} />
              {t("composer.newFolder")}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                void pickAndOpenProject();
              }}
              className="flex items-center justify-center gap-2 border-l border-border px-3 py-2.5 text-xs text-fg-secondary transition-colors hover:bg-bg-hover"
            >
              <Plus size={13} />
              {t("composer.openFolder")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
