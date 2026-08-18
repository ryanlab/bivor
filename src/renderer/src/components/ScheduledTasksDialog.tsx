/**
 * 定时任务管理：任务列表 + 创建/编辑表单。
 * 调度与执行都在 main 进程（scheduler.ts），这里只是 CRUD 与状态展示。
 */
import { useState } from "react";
import {
  AlarmClock,
  CalendarClock,
  FolderOpen,
  Loader2,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import type { ScheduledTask, TaskSchedule } from "@shared/protocol";
import { RUNTIME_PRESETS, getRuntimePreset } from "@shared/runtime-presets";
import { useAppStore } from "@/stores/app-store";
import { Switch } from "@/components/Switch";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelativeTime, shortenPath } from "@/lib/format";
import { useLocale, useT, type Translator } from "@/lib/i18n";
import type { Locale } from "@shared/i18n";

function weekdayLabels(t: Translator): string[] {
  return t("schedule.weekday").split(",");
}

function weekdayShortLabels(t: Translator): string[] {
  return t("schedule.weekdayShort").split(",");
}

function describeSchedule(schedule: TaskSchedule, t: Translator, locale: Locale): string {
  if (schedule.type === "interval") return t("schedule.interval", { n: schedule.everyMinutes });
  if (schedule.type === "daily") return t("schedule.daily", { time: schedule.time });
  const labels = weekdayLabels(t);
  const days = [...schedule.days].sort().map((d) => labels[d] ?? String(d));
  const sep = locale === "zh" ? "、" : ", ";
  return t("schedule.weekly", { days: days.join(sep), time: schedule.time });
}

function formatNextRun(ts: number | undefined, dash: string): string {
  if (!ts) return dash;
  return formatDateTime(ts, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------- 表单 ----------

interface TaskDraft {
  id: string;
  name: string;
  prompt: string;
  target: "daily" | "project";
  projectPath: string;
  presetId: string;
  scheduleType: TaskSchedule["type"];
  everyMinutes: string;
  time: string;
  days: number[];
  runMode: ScheduledTask["runMode"];
}

function emptyDraft(activeProjectPath?: string): TaskDraft {
  return {
    id: "",
    name: "",
    prompt: "",
    target: activeProjectPath ? "project" : "daily",
    projectPath: activeProjectPath ?? "",
    presetId: activeProjectPath ? "coding" : "daily",
    scheduleType: "daily",
    everyMinutes: "60",
    time: "09:00",
    days: [1, 2, 3, 4, 5],
    runMode: "background",
  };
}

function draftFromTask(task: ScheduledTask, dailyCwd?: string): TaskDraft {
  const isDaily = task.kind === "daily" || task.cwd === dailyCwd;
  return {
    id: task.id,
    name: task.name,
    prompt: task.prompt,
    target: isDaily ? "daily" : "project",
    projectPath: isDaily ? "" : task.cwd,
    presetId: task.presetId ?? (isDaily ? "daily" : "coding"),
    scheduleType: task.schedule.type,
    everyMinutes:
      task.schedule.type === "interval" ? String(task.schedule.everyMinutes) : "60",
    time: task.schedule.type === "interval" ? "09:00" : task.schedule.time,
    days: task.schedule.type === "weekly" ? task.schedule.days : [1, 2, 3, 4, 5],
    runMode: task.runMode,
  };
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-8 rounded-full px-3 text-[12px] transition-colors",
        active
          ? "bg-accent text-accent-fg"
          : "bg-bg-tertiary text-fg-muted hover:bg-bg-hover hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function TaskForm({
  draft,
  onChange,
  onCancel,
  onSave,
}: {
  draft: TaskDraft;
  onChange: (draft: TaskDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}): React.JSX.Element {
  const t = useT();
  const [saving, setSaving] = useState(false);
  const patch = (p: Partial<TaskDraft>): void => onChange({ ...draft, ...p });
  const weekdays = weekdayShortLabels(t);
  const projectPresets = RUNTIME_PRESETS.filter((p) => p.workspace === "project");

  const canSave =
    draft.name.trim() !== "" &&
    draft.prompt.trim() !== "" &&
    (draft.target === "daily" || draft.projectPath !== "") &&
    (draft.scheduleType !== "interval" ||
      (Number.parseInt(draft.everyMinutes, 10) || 0) >= 1) &&
    (draft.scheduleType !== "weekly" || draft.days.length > 0);

  const pickProject = async (): Promise<void> => {
    const { path } = await window.pi.system.pickFolder();
    if (path) patch({ projectPath: path });
  };

  const control =
    "h-8 rounded-full bg-bg-tertiary px-3 text-[12px] text-fg outline-none focus:ring-1 focus:ring-accent/40";

  return (
    <div className="mx-auto w-full max-w-lg">
      <h2 className="font-serif-display text-[26px] leading-tight">
        {draft.id ? t("schedule.edit") : t("schedule.create")}
      </h2>
      <p className="pt-1 text-xs text-fg-muted">{t("schedule.subtitle")}</p>

      <input
        value={draft.name}
        onChange={(e) => patch({ name: e.target.value })}
        placeholder={t("schedule.namePh")}
        className="mt-6 w-full bg-transparent text-[15px] font-medium text-fg outline-none placeholder:font-normal placeholder:text-fg-muted"
      />
      <div className="composer-shadow mt-3 rounded-[20px] border border-border bg-bg-input transition-colors focus-within:border-accent/50">
        <textarea
          value={draft.prompt}
          onChange={(e) => patch({ prompt: e.target.value })}
          placeholder={t("schedule.promptPh")}
          rows={3}
          className="w-full resize-none bg-transparent px-4 py-3 text-[13px] leading-relaxed text-fg outline-none placeholder:text-fg-muted"
        />
      </div>

      <div className="mt-5 grid grid-cols-[2.5rem_1fr] items-center gap-x-3 gap-y-2.5">
        <div className="text-[12px] text-fg-muted">{t("schedule.timing")}</div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill
            active={draft.scheduleType === "interval"}
            onClick={() => patch({ scheduleType: "interval" })}
          >
            {t("schedule.intervalType")}
          </Pill>
          <Pill
            active={draft.scheduleType === "daily"}
            onClick={() => patch({ scheduleType: "daily" })}
          >
            {t("schedule.dailyType")}
          </Pill>
          <Pill
            active={draft.scheduleType === "weekly"}
            onClick={() => patch({ scheduleType: "weekly" })}
          >
            {t("schedule.weeklyType")}
          </Pill>
          {draft.scheduleType === "interval" ? (
            <div className="flex items-center gap-1.5 text-[12px] text-fg-secondary">
              {t("schedule.every")}
              <input
                className={cn(control, "w-14 px-2 text-center")}
                type="number"
                min={1}
                value={draft.everyMinutes}
                onChange={(e) => patch({ everyMinutes: e.target.value })}
              />
              {t("schedule.minutes")}
            </div>
          ) : (
            <input
              className={cn(control, "w-[5.5rem]")}
              type="time"
              value={draft.time}
              onChange={(e) => patch({ time: e.target.value })}
            />
          )}
        </div>

        {draft.scheduleType === "weekly" && (
          <>
            <div />
            <div className="flex gap-1">
              {weekdays.map((label, day) => (
                <button
                  key={day}
                  type="button"
                  title={weekdayLabels(t)[day]}
                  onClick={() =>
                    patch({
                      days: draft.days.includes(day)
                        ? draft.days.filter((d) => d !== day)
                        : [...draft.days, day],
                    })
                  }
                  className={cn(
                    "h-8 min-w-8 rounded-full px-1.5 text-[12px] transition-colors",
                    draft.days.includes(day)
                      ? "bg-accent text-accent-fg"
                      : "bg-bg-tertiary text-fg-muted hover:text-fg",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="text-[12px] text-fg-muted">{t("schedule.where")}</div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill
            active={draft.target === "daily"}
            onClick={() => patch({ target: "daily", presetId: "daily" })}
          >
            {t("preset.daily")}
          </Pill>
          <Pill
            active={draft.target === "project"}
            onClick={() => patch({ target: "project", presetId: "coding" })}
          >
            {t("schedule.project")}
          </Pill>
          {draft.target === "project" && (
            <button
              type="button"
              onClick={() => void pickProject()}
              className={cn(control, "flex max-w-[200px] items-center gap-1.5 text-fg-muted hover:text-fg")}
            >
              <FolderOpen size={12} className="shrink-0" />
              <span className="truncate">
                {draft.projectPath ? shortenPath(draft.projectPath) : t("schedule.pickProject")}
              </span>
            </button>
          )}
        </div>

        {draft.target === "project" && (
          <>
            <div className="text-[12px] text-fg-muted">{t("schedule.mode")}</div>
            <div className="flex flex-wrap gap-1.5">
              {projectPresets.map((p) => (
                <Pill
                  key={p.id}
                  active={draft.presetId === p.id}
                  onClick={() => patch({ presetId: p.id })}
                >
                  {t(`preset.${p.id}`)}
                </Pill>
              ))}
            </div>
          </>
        )}

        <div className="text-[12px] text-fg-muted">{t("schedule.how")}</div>
        <div className="flex flex-wrap gap-1.5">
          <Pill
            active={draft.runMode === "background"}
            onClick={() => patch({ runMode: "background" })}
          >
            {t("schedule.background")}
          </Pill>
          <Pill
            active={draft.runMode === "open-chat"}
            onClick={() => patch({ runMode: "open-chat" })}
          >
            {t("schedule.openChat")}
          </Pill>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-8 rounded-full px-3.5 text-[13px] text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          disabled={!canSave || saving}
          onClick={() => {
            setSaving(true);
            onSave();
          }}
          className="h-8 rounded-full bg-accent px-4 text-[13px] font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-35"
        >
          {draft.id ? t("schedule.saveEdit") : t("schedule.create")}
        </button>
      </div>
    </div>
  );
}

// ---------- 任务行 ----------

function TaskRow({
  task,
  onEdit,
}: {
  task: ScheduledTask;
  onEdit: () => void;
}): React.JSX.Element {
  const t = useT();
  const locale = useLocale();
  const runNow = useAppStore((s) => s.runScheduledTaskNow);
  const deleteTask = useAppStore((s) => s.deleteScheduledTask);
  const saveTask = useAppStore((s) => s.saveScheduledTask);
  const openChat = useAppStore((s) => s.openChat);
  const preset = getRuntimePreset(task.presetId, task.kind);

  const openResult = (): void => {
    if (!task.lastRun?.sessionFile) return;
    void openChat({
      cwd: task.cwd,
      kind: task.kind,
      presetId: task.presetId,
      sessionFile: task.lastRun.sessionFile,
    });
  };

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-bg p-3.5 transition-colors hover:border-border-strong",
        !task.enabled && "opacity-55",
      )}
    >
      <div className="flex items-center gap-2.5">
        {/* 启用开关 */}
        <Switch
          on={task.enabled}
          title={task.enabled ? t("schedule.enabled") : t("schedule.paused")}
          onClick={() => void saveTask({ ...task, enabled: !task.enabled })}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium">{task.name}</span>
            {task.running && (
              <span className="flex items-center gap-1 rounded-full bg-accent/12 px-1.5 py-0.5 text-[10px] text-accent">
                <Loader2 size={9} className="animate-spin" /> {t("common.running")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 pt-0.5 text-[11px] text-fg-muted">
            <span className="flex items-center gap-1">
              <CalendarClock size={11} /> {describeSchedule(task.schedule, t, locale)}
            </span>
            <span>·</span>
            <span>{task.runMode === "background" ? t("schedule.background") : t("schedule.openChat")}</span>
            <span>·</span>
            <span>{t(`preset.${preset.id}`)}</span>
            {task.enabled && (
              <>
                <span>·</span>
                <span>{t("schedule.next", { time: formatNextRun(task.nextRunAt, t("common.dash")) })}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => void runNow(task.id)}
            disabled={task.running}
            className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg disabled:opacity-40"
            title={t("schedule.runNow")}
          >
            <Play size={13} />
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
            title={t("common.edit")}
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            onClick={() => void deleteTask(task.id)}
            className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-bg-hover hover:text-danger"
            title={t("common.delete")}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {task.lastRun && (
        <div className="mt-2 flex items-center gap-2 border-t border-border/60 pt-2 text-[11px]">
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px]",
              task.lastRun.status === "ok"
                ? "bg-success/12 text-success"
                : "bg-danger/12 text-danger",
            )}
          >
            {task.lastRun.status === "ok" ? t("common.success") : t("common.failed")}
          </span>
          <span className="text-fg-muted">{formatRelativeTime(task.lastRun.finishedAt)}</span>
          {task.lastRun.degradedToBackground && (
            <span className="text-fg-muted">{t("schedule.degraded")}</span>
          )}
          {task.lastRun.error && (
            <span className="truncate text-danger/90">{task.lastRun.error}</span>
          )}
          <div className="flex-1" />
          {task.lastRun.sessionFile && (
            <button
              type="button"
              onClick={openResult}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-accent transition-colors hover:bg-accent/10"
            >
              <MessageSquare size={11} /> {t("schedule.viewSession")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- 对话框 ----------

export function ScheduledTasksDialog(): React.JSX.Element {
  const t = useT();
  const tasks = useAppStore((s) => s.scheduledTasks);
  const saveTask = useAppStore((s) => s.saveScheduledTask);
  const activeProjectPath = useAppStore((s) => s.activeProjectPath);
  const dailyCwd = useAppStore((s) => s.dailyCwd);
  const [draft, setDraft] = useState<TaskDraft | null>(null);

  const submit = async (d: TaskDraft): Promise<void> => {
    const cwd = d.target === "daily" ? (dailyCwd ?? (await window.pi.system.dailyCwd())) : d.projectPath;
    const schedule: TaskSchedule =
      d.scheduleType === "interval"
        ? { type: "interval", everyMinutes: Math.max(1, Number.parseInt(d.everyMinutes, 10) || 60) }
        : d.scheduleType === "daily"
          ? { type: "daily", time: d.time }
          : { type: "weekly", days: d.days, time: d.time };
    const existing = tasks.find((t) => t.id === d.id);
    await saveTask({
      ...(existing ?? {}),
      id: d.id,
      name: d.name.trim(),
      prompt: d.prompt.trim(),
      cwd,
      kind: d.target === "daily" ? "daily" : "coding",
      presetId: d.presetId,
      schedule,
      runMode: d.runMode,
      enabled: existing?.enabled ?? true,
    });
    setDraft(null);
  };

  const empty = tasks.length === 0 && !draft;

  if (draft) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex min-h-full flex-col justify-center px-8 py-8">
          <TaskForm
            draft={draft}
            onChange={setDraft}
            onCancel={() => setDraft(null)}
            onSave={() => void submit(draft)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-end justify-between gap-4 px-8 pt-8">
        <div>
          <h1 className="font-serif-display text-[26px] leading-tight">{t("sidebar.schedule")}</h1>
          <p className="pt-0.5 text-xs text-fg-muted">{t("schedule.subtitle")}</p>
        </div>
        {!empty && (
          <button
            type="button"
            onClick={() => setDraft(emptyDraft(activeProjectPath))}
            className="flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-1.5 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover"
          >
            <Plus size={13} /> {t("common.create")}
          </button>
        )}
      </div>

      {empty ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 pb-8 text-center">
          <AlarmClock size={28} className="text-fg-muted" />
          <div className="text-sm font-medium">{t("schedule.empty")}</div>
          <p className="max-w-sm text-xs leading-relaxed text-fg-muted">
            {t("schedule.emptyHint")}
          </p>
          <button
            type="button"
            onClick={() => setDraft(emptyDraft(activeProjectPath))}
            className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover"
          >
            <Plus size={13} />
            {t("schedule.create")}
          </button>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-8 pb-10 pt-6">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onEdit={() => setDraft(draftFromTask(task, dailyCwd))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
