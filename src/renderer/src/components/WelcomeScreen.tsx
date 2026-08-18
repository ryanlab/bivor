import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  FolderOpen,
  GitBranch,
  GitFork,
  KeyRound,
  Laptop,
} from "lucide-react";
import { thinkingLevelOf, useAppStore } from "@/stores/app-store";
import { ModelPicker } from "@/components/ModelPicker";
import { ComposerStack, PresetSwitch, ProjectListItem } from "@/components/ComposerStack";
import { basename, samePath, shortenPath } from "@/lib/format";
import { cn } from "@/lib/cn";
import { menuPanel } from "@/lib/menu";
import { useT, type Translator } from "@/lib/i18n";
import logo from "@/assets/logo.png";

/** 同一天同一时段固定一句，避免每次渲染跳来跳去。 */
function daySeed(d: Date, bucket: string): number {
  const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${bucket}`;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
  return h;
}

function pool(t: Translator, key: string): string[] {
  return t(key)
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

function greeting(t: Translator, now = new Date()): string {
  const h = now.getHours();
  const dow = now.getDay();
  const bucket = h < 5 ? "lateNight" : h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  const timeKey =
    bucket === "lateNight"
      ? "welcome.greetLateNight"
      : bucket === "morning"
        ? "welcome.greetMorning"
        : bucket === "afternoon"
          ? "welcome.greetAfternoon"
          : "welcome.greetEvening";
  const weekdayKey =
    dow === 1 ? "welcome.greetMonday" : dow === 5 ? "welcome.greetFriday" : dow === 0 || dow === 6 ? "welcome.greetWeekend" : undefined;
  const timePhrases = pool(t, timeKey);
  const weekdayPhrases = weekdayKey ? pool(t, weekdayKey) : [];
  const seed = daySeed(now, bucket);
  if (weekdayPhrases.length > 0 && seed % 2 === 0) {
    return weekdayPhrases[seed % weekdayPhrases.length] ?? weekdayPhrases[0];
  }
  return timePhrases[seed % timePhrases.length] ?? timePhrases[0] ?? "";
}

export type WorkLocation = "local" | "worktree";

/** Codex 风格的「工作位置」选择器：本地 / 新工作树（隔离分支）。 */
function WorkLocationPicker({
  location,
  onLocation,
}: {
  location: WorkLocation;
  onLocation: (loc: WorkLocation) => void;
}): React.JSX.Element {
  const t = useT();
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

  const options: { id: WorkLocation; label: string; hint: string; icon: React.JSX.Element }[] = [
    { id: "local", label: t("welcome.workLocal"), hint: t("welcome.workLocalHint"), icon: <Laptop size={13} /> },
    {
      id: "worktree",
      label: t("welcome.worktree"),
      hint: t("welcome.worktreeHint"),
      icon: <GitFork size={13} />,
    },
  ];
  const active = options.find((o) => o.id === location) ?? options[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title={t("welcome.workLocation")}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-fg-secondary transition-colors hover:bg-bg-hover"
      >
        {active.icon}
        <span>{active.label}</span>
        <ChevronDown size={12} className="text-fg-muted" />
      </button>
      {open && (
        <div className={cn("dialog-in absolute left-0 top-full z-50 mt-1 w-56", menuPanel)}>
          <div className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-medium text-fg-muted">{t("welcome.workLocation")}</div>
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                onLocation(o.id);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-bg-hover"
            >
              <span className="shrink-0 text-fg-muted">{o.icon}</span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block text-xs",
                    o.id === location ? "font-medium text-accent" : "text-fg",
                  )}
                >
                  {o.label}
                </span>
                <span className="block text-[10.5px] text-fg-muted">{o.hint}</span>
              </span>
              {o.id === location && <Check size={13} className="shrink-0 text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 基础分支选择器：工作树从这里出发；本地模式下只展示当前分支。 */
function BranchPicker({
  branches,
  value,
  interactive,
  onSelect,
}: {
  branches: string[];
  value: string;
  /** 本地模式下分支只作展示（agent 在当前检出分支上工作） */
  interactive: boolean;
  onSelect: (branch: string) => void;
}): React.JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setFilter("");
      return;
    }
    const onClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const matches = branches.filter((b) => b.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title={interactive ? t("welcome.baseBranch") : t("welcome.localBranch")}
        disabled={!interactive}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-fg-secondary transition-colors",
          interactive ? "hover:bg-bg-hover" : "cursor-default opacity-70",
        )}
      >
        <GitBranch size={13} />
        <span className="max-w-36 truncate">{value}</span>
        {interactive && <ChevronDown size={12} className="text-fg-muted" />}
      </button>
      {open && interactive && (
        <div className="dialog-in absolute left-0 top-full z-50 mt-1 w-60 overflow-hidden rounded-xl border border-border-strong bg-bg shadow-xl">
          <div className="border-b border-border px-3 py-2">
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("welcome.searchBranch")}
              className="w-full bg-transparent text-xs text-fg outline-none placeholder:text-fg-muted"
            />
          </div>
          <div className="max-h-52 overflow-y-auto p-1">
            {matches.length === 0 && (
              <div className="px-2.5 py-3 text-center text-xs text-fg-muted">{t("welcome.noBranch")}</div>
            )}
            {matches.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => {
                  onSelect(b);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left font-mono text-xs transition-colors hover:bg-bg-hover",
                  b === value ? "font-medium text-accent" : "text-fg-secondary",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{b}</span>
                {b === value && <Check size={13} className="shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function WelcomeScreen(): React.JSX.Element {
  const t = useT();
  const appMode = useAppStore((s) => s.appMode);
  const recentProjects = useAppStore((s) => s.recentProjects);
  const providers = useAppStore((s) => s.providers);
  const activeProjectPath = useAppStore((s) => s.activeProjectPath);
  const activeProjectIsGit = useAppStore((s) => s.activeProjectIsGit);
  const openProject = useAppStore((s) => s.openProject);
  const removeRecentProject = useAppStore((s) => s.removeRecentProject);
  const defaultProjectCwd = useAppStore((s) => s.defaultProjectCwd);
  const newChat = useAppStore((s) => s.newChat);
  const openWorktreeChat = useAppStore((s) => s.openWorktreeChat);
  const preferredModel = useAppStore((s) => s.preferredModel);
  const setPreferredModel = useAppStore((s) => s.setPreferredModel);
  const modelThinking = useAppStore((s) => s.modelThinking);
  const setModelThinking = useAppStore((s) => s.setModelThinking);
  const codingPresetId = useAppStore((s) => s.codingPresetId);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const setResourcesOpen = useAppStore((s) => s.setResourcesOpen);
  const [text, setText] = useState("");
  const [memoryCount, setMemoryCount] = useState(0);
  const [workLocation, setWorkLocation] = useState<WorkLocation>("local");
  const [branchInfo, setBranchInfo] = useState<{ current: string; branches: string[] }>();
  const [baseBranch, setBaseBranch] = useState<string>();
  const isDaily = appMode === "daily";
  const recents = recentProjects.filter((p) => !samePath(p.path, defaultProjectCwd));

  // 工作位置/分支选择只对 git 项目有意义
  useEffect(() => {
    setBranchInfo(undefined);
    setBaseBranch(undefined);
    if (isDaily || !activeProjectPath || !activeProjectIsGit) return;
    void window.pi.worktrees
      .branches(activeProjectPath)
      .then(setBranchInfo)
      .catch(() => {});
  }, [activeProjectPath, activeProjectIsGit, isDaily]);

  useEffect(() => {
    setMemoryCount(0);
    if (isDaily || !activeProjectPath) return;
    void window.pi.resources
      .readMemory(activeProjectPath)
      .then((r) =>
        setMemoryCount(r.content.split("\n").filter((l) => l.trimStart().startsWith("- ")).length),
      )
      .catch(() => {});
  }, [activeProjectPath, isDaily]);

  const hasAuth = providers.some((p) => p.authenticated);
  // 没有任何提交的空仓库无法创建工作树（unborn HEAD 不能作基础分支）
  const canWorktree = (branchInfo?.branches.length ?? 0) > 0;

  const start = (prompt?: string): void => {
    const initialPrompt = (prompt ?? text).trim() || undefined;
    if (!isDaily && workLocation === "worktree" && canWorktree) {
      void openWorktreeChat({
        baseBranch: baseBranch ?? branchInfo?.current,
        taskHint: initialPrompt,
        initialPrompt,
      });
    } else {
      void newChat({ initialPrompt });
    }
    setText("");
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable]">
      <div
        aria-hidden
        className="font-serif-display pointer-events-none absolute right-[6%] top-[8%] select-none text-[220px] leading-none text-fg opacity-[0.035]"
      >
        π
      </div>
      <div className="flex min-h-full flex-col items-center justify-center px-8 py-8">
      <div className="relative fade-up w-full max-w-xl">
        <h1 className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 font-serif-display text-[32px] font-normal leading-tight text-fg">
          <img src={logo} alt="" className="h-9 w-auto" />
          <span className="text-balance text-center">{greeting(t)}</span>
        </h1>
        {!isDaily && memoryCount > 0 && (
          <div className="mt-1.5 flex justify-center">
            <button
              type="button"
              onClick={() => setResourcesOpen(true, "memory")}
              title={t("welcome.memoryTitle")}
              className="flex items-center gap-1.5 rounded-full bg-accent-muted px-2.5 py-1 text-[11px] text-accent transition-colors hover:bg-accent/25"
            >
              <Brain size={11} />
              {t("welcome.memoryCount", { count: memoryCount })}
            </button>
          </div>
        )}

        <ComposerStack modeBar stacked={!isDaily} className="relative z-20 mt-4">
          <div className="composer-shadow rounded-[20px] border border-border bg-bg-input transition-colors focus-within:border-accent/50">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  start();
                }
              }}
              rows={2}
              placeholder={
                isDaily
                  ? t("welcome.phDaily")
                  : codingPresetId === "review"
                    ? t("welcome.phReview")
                    : codingPresetId === "minimal"
                      ? t("welcome.phMinimal")
                      : t("welcome.phCoding")
              }
              className="w-full resize-none bg-transparent px-4 pt-3.5 text-[14px] leading-relaxed text-fg outline-none placeholder:text-fg-muted"
            />
            <div className="flex items-center gap-1 px-2.5 pb-2.5">
              <ModelPicker
                model={preferredModel}
                onSelect={setPreferredModel}
                thinkingFor={(m) => thinkingLevelOf(modelThinking, m)}
                onThinkingLevel={(m, l) => setModelThinking(m, l)}
              />
              {!isDaily && <PresetSwitch />}
              {!isDaily && activeProjectPath && activeProjectIsGit && branchInfo && (
                <>
                  {canWorktree && (
                    <WorkLocationPicker location={workLocation} onLocation={setWorkLocation} />
                  )}
                  <BranchPicker
                    branches={branchInfo.branches}
                    value={
                      workLocation === "worktree" && canWorktree
                        ? (baseBranch ?? branchInfo.current)
                        : branchInfo.current
                    }
                    interactive={workLocation === "worktree" && canWorktree}
                    onSelect={setBaseBranch}
                  />
                </>
              )}
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => start()}
                title={isDaily ? t("welcome.startChat") : t("welcome.startTask")}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-accent-fg transition-all hover:scale-105 hover:bg-accent-hover"
              >
                <ArrowUp size={15} />
              </button>
            </div>
          </div>
        </ComposerStack>

        {!hasAuth && providers.length > 0 && (
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="mt-3 flex w-full items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-left transition-colors hover:bg-warning/15"
          >
            <KeyRound size={17} className="shrink-0 text-warning" />
            <div>
              <div className="text-[13px] font-medium">{t("welcome.noAuthTitle")}</div>
              <div className="text-xs text-fg-muted">{t("welcome.noAuthHint")}</div>
            </div>
          </button>
        )}

        {!isDaily && recents.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-5">
            <div className="pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              {t("welcome.recentProjects")}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {recents.slice(0, 6).map((p) => (
                <ProjectListItem
                  key={p.path}
                  name={basename(p.path)}
                  hint={shortenPath(p.path)}
                  selected={samePath(p.path, activeProjectPath)}
                  onSelect={() => openProject(p.path)}
                  onRemove={() => removeRecentProject(p.path)}
                  leading={<FolderOpen size={14} className="shrink-0 text-fg-muted" />}
                  className={cn(
                    "rounded-xl border transition-all hover:shadow-sm",
                    samePath(p.path, activeProjectPath)
                      ? "border-accent/40 bg-accent-muted"
                      : "border-border bg-bg-secondary hover:border-border-strong",
                  )}
                />
              ))}
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
