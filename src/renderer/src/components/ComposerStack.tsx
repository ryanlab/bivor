import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Code2, Eye, Folder, FolderPlus, MessageSquare, Minus, Plus, X } from "lucide-react";
import { RUNTIME_PRESETS } from "@shared/runtime-presets";
import { useAppStore } from "@/stores/app-store";
import { basename, projectName, samePath, shortenPath } from "@/lib/format";
import { useDismiss } from "@/lib/use-dismiss";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { menuPanel } from "@/lib/menu";

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
  useDismiss(open, ref, () => setOpen(false));

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
        <div className={cn("dialog-in absolute left-0 top-full z-50 mt-1 w-56", menuPanel)}>
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

export function ProjectListItem({
  name,
  hint,
  selected,
  onSelect,
  onRemove,
  leading,
  compact,
  className,
}: {
  name: string;
  hint: string;
  selected?: boolean;
  onSelect: () => void;
  onRemove?: () => void;
  leading?: React.ReactNode;
  /** Match ModelPicker row density (search dropdown). */
  compact?: boolean;
  className?: string;
}): React.JSX.Element {
  const t = useT();
  return (
    <div
      className={cn(
        "group flex w-full items-center gap-2",
        compact && "rounded-md px-2 text-xs transition-colors hover:bg-bg-hover",
        compact && (selected ? "text-accent" : "text-fg-secondary"),
        className,
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex min-w-0 flex-1 items-center text-left",
          compact ? "gap-1.5 py-1.5" : "gap-2 px-2.5 py-2",
        )}
      >
        {leading}
        <div className="min-w-0 flex-1">
          <div className={cn("truncate", !compact && "text-[13px]")}>{name}</div>
          <div
            className={cn(
              "truncate",
              compact ? (selected ? "text-accent/70" : "text-fg-muted") : "text-[11px] text-fg-muted",
            )}
          >
            {hint}
          </div>
        </div>
        {selected && <Check size={13} className="shrink-0" />}
      </button>
      {onRemove && (
        <button
          type="button"
          title={t("composer.removeProject")}
          onClick={onRemove}
          className={cn(
            "flex shrink-0 items-center justify-center text-fg-muted",
            compact
              ? "h-5 w-5 rounded-md opacity-0 transition-opacity hover:text-fg group-hover:opacity-100"
              : "mr-1 h-6 w-6 rounded-md text-fg-muted/60 hover:bg-bg-tertiary hover:text-fg",
          )}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

/** 最近项目 + 默认项目选择面板（搜索 / 列表 / 新建或打开文件夹）。 */
export function ProjectPickerPanel({
  selectedPath,
  onSelectDefault,
  onSelectPath,
  onCreateFolder,
  onOpenFolder,
}: {
  selectedPath?: string;
  onSelectDefault: () => void;
  onSelectPath: (path: string) => void;
  onCreateFolder: () => void;
  onOpenFolder: () => void;
}): React.JSX.Element {
  const t = useT();
  const recentProjects = useAppStore((s) => s.recentProjects);
  const defaultProjectCwd = useAppStore((s) => s.defaultProjectCwd);
  const removeRecentProject = useAppStore((s) => s.removeRecentProject);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => searchRef.current?.focus());
  }, []);

  const q = query.trim().toLowerCase();
  const recents = recentProjects.filter((p) => !samePath(p.path, defaultProjectCwd));
  const defaultLabel = t("composer.defaultProject");
  const defaultHint = t("composer.defaultProjectHint");
  const defaultMatches =
    !q ||
    defaultLabel.toLowerCase().includes(q) ||
    defaultHint.toLowerCase().includes(q) ||
    (defaultProjectCwd
      ? defaultProjectCwd.toLowerCase().includes(q) ||
        shortenPath(defaultProjectCwd).toLowerCase().includes(q)
      : false);
  const filtered = q
    ? recents.filter((p) => {
        const name = basename(p.path).toLowerCase();
        return (
          name.includes(q) ||
          p.path.toLowerCase().includes(q) ||
          shortenPath(p.path).toLowerCase().includes(q)
        );
      })
    : recents;

  return (
    <div className="flex max-h-96 flex-col overflow-hidden rounded-xl border border-border-strong bg-bg shadow-2xl">
      <div className="shrink-0 px-3 py-2">
        <input
          ref={searchRef}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("composer.searchProjects")}
          className="w-full bg-transparent py-0.5 text-xs text-fg outline-none placeholder:text-fg-muted"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {defaultMatches && (
          <ProjectListItem
            compact
            name={defaultLabel}
            hint={defaultProjectCwd ? shortenPath(defaultProjectCwd) : defaultHint}
            selected={samePath(selectedPath, defaultProjectCwd)}
            onSelect={onSelectDefault}
          />
        )}
        {filtered.length > 0 && (
          <div className="px-2 pb-0.5 pt-1.5 text-[11px] font-medium text-fg-muted">
            {t("composer.recent")}
          </div>
        )}
        {filtered.length === 0 && !defaultMatches && (
          <div className="px-3 py-4 text-center text-xs text-fg-muted">
            {q ? t("composer.noMatchProject") : t("composer.noRecentProject")}
          </div>
        )}
        {filtered.map((p) => (
          <ProjectListItem
            key={p.path}
            compact
            name={basename(p.path)}
            hint={shortenPath(p.path)}
            selected={samePath(p.path, selectedPath)}
            onSelect={() => onSelectPath(p.path)}
            onRemove={() => removeRecentProject(p.path)}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-0.5 p-1">
        <button
          type="button"
          onClick={onCreateFolder}
          className="flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-fg-secondary transition-colors hover:bg-bg-hover"
        >
          <FolderPlus size={13} />
          {t("composer.newFolder")}
        </button>
        <button
          type="button"
          onClick={onOpenFolder}
          className="flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-fg-secondary transition-colors hover:bg-bg-hover"
        >
          <Plus size={13} />
          {t("composer.openFolder")}
        </button>
      </div>
    </div>
  );
}

/** 表单里的只读项目选择：点击弹出与新建对话相同的项目面板。 */
export function ProjectPickerField({
  value,
  onChange,
}: {
  value: string;
  onChange: (path: string) => void;
}): React.JSX.Element {
  const t = useT();
  const defaultProjectCwd = useAppStore((s) => s.defaultProjectCwd);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, ref, () => setOpen(false));

  const choose = (path: string): void => {
    if (path) onChange(path);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-md border bg-bg-input px-3 pr-2 text-left text-[13px] outline-none transition-colors",
          open ? "border-border-strong" : "border-border hover:border-border-strong",
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate", value ? "text-fg" : "text-fg-muted")}>
          {value ? shortenPath(value) : t("schedule.pickProject")}
        </span>
        <Folder size={14} strokeWidth={1.7} className="shrink-0 text-fg-muted" />
      </button>
      {open && (
        <div className="dialog-in absolute left-0 right-0 top-full z-50 mt-1">
          <ProjectPickerPanel
            selectedPath={value || undefined}
            onSelectDefault={() => {
              if (defaultProjectCwd) {
                choose(defaultProjectCwd);
                return;
              }
              setOpen(false);
              void window.pi.system.defaultProjectCwd().then((cwd) => {
                if (cwd) onChange(cwd);
              });
            }}
            onSelectPath={choose}
            onCreateFolder={() => {
              setOpen(false);
              void window.pi.system.createFolder().then(({ path }) => {
                if (path) onChange(path);
              });
            }}
            onOpenFolder={() => {
              setOpen(false);
              void window.pi.system.pickFolder().then(({ path }) => {
                if (path) onChange(path);
              });
            }}
          />
        </div>
      )}
    </div>
  );
}

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
  const activeProjectPath = useAppStore((s) => s.activeProjectPath);
  const defaultProjectCwd = useAppStore((s) => s.defaultProjectCwd);
  const openProject = useAppStore((s) => s.openProject);
  const selectDefaultProject = useAppStore((s) => s.selectDefaultProject);
  const pickAndOpenProject = useAppStore((s) => s.pickAndOpenProject);
  const appMode = useAppStore((s) => s.appMode);
  const setAppMode = useAppStore((s) => s.setAppMode);
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  useDismiss(open, pickerRef, () => setOpen(false));

  useEffect(() => {
    if (!stacked) setOpen(false);
  }, [stacked]);

  if (!stacked && !modeBar) return <div className={className}>{children}</div>;

  return (
    <div className={cn("relative", className)}>
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
      <div ref={pickerRef} className="relative">
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
            {activeProjectPath || defaultProjectCwd
              ? t("composer.currentProject", {
                  name: projectName(activeProjectPath ?? defaultProjectCwd, defaultProjectCwd),
                })
              : t("composer.selectProject")}
          </span>
        </button>
      </div>
      {open && (
        <div className="dialog-in absolute left-0 right-0 top-full z-50 mt-2">
          <ProjectPickerPanel
            selectedPath={activeProjectPath}
            onSelectDefault={() => {
              void selectDefaultProject();
              setOpen(false);
            }}
            onSelectPath={(path) => {
              openProject(path);
              setOpen(false);
            }}
            onCreateFolder={() => {
              setOpen(false);
              void window.pi.system.createFolder().then(({ path }) => {
                if (path) openProject(path);
              });
            }}
            onOpenFolder={() => {
              setOpen(false);
              void pickAndOpenProject();
            }}
          />
        </div>
      )}
      </div>
      ) : modeBar ? (
        <div className="h-8" aria-hidden />
      ) : null}
    </div>
  );
}
