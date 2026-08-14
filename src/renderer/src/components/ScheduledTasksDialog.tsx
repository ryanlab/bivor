/**
 * 定时任务管理：任务列表 + 创建/编辑表单。
 * 调度与执行都在 main 进程（scheduler.ts），这里只是 CRUD 与状态展示。
 */
import { useState } from "react";
import {
  AlarmClock,
  CalendarClock,
  Loader2,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
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

const inputCls =
  "w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-accent";
const labelCls = "pb-1.5 text-[11px] font-medium text-fg-muted";

function SegButton({
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
        "rounded-md px-2.5 py-1 text-[11px] transition-colors",
        active ? "bg-accent/15 text-accent" : "text-fg-muted hover:bg-bg-hover hover:text-fg",
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
  const weekdays = weekdayLabels(t);

  const presetChoices = RUNTIME_PRESETS.filter((p) =>
    draft.target === "daily" ? p.workspace === "daily" : p.workspace === "project",
  );

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

  return (
    <div className="space-y-4 rounded-xl border border-border bg-bg p-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className={labelCls}>{t("schedule.name")}</div>
          <input
            className={inputCls}
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder={t("schedule.namePh")}
          />
        </div>
        <div>
          <div className={labelCls}>{t("schedule.runMode")}</div>
          <div className="flex gap-1 rounded-lg border border-border bg-bg p-0.5">
            <SegButton
              active={draft.runMode === "background"}
              onClick={() => patch({ runMode: "background" })}
            >
              {t("schedule.silent")}
            </SegButton>
            <SegButton
              active={draft.runMode === "open-chat"}
              onClick={() => patch({ runMode: "open-chat" })}
            >
              {t("schedule.autoOpen")}
            </SegButton>
          </div>
        </div>
      </div>

      <div>
        <div className={labelCls}>{t("schedule.prompt")}</div>
        <textarea
          className={cn(inputCls, "min-h-[72px] resize-y font-mono text-[11px] leading-relaxed")}
          value={draft.prompt}
          onChange={(e) => patch({ prompt: e.target.value })}
          placeholder={t("schedule.promptPh")}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className={labelCls}>{t("schedule.env")}</div>
          <div className="flex gap-1 rounded-lg border border-border bg-bg p-0.5">
            <SegButton
              active={draft.target === "daily"}
              onClick={() => patch({ target: "daily", presetId: "daily" })}
            >
              {t("preset.daily")}
            </SegButton>
            <SegButton
              active={draft.target === "project"}
              onClick={() => patch({ target: "project", presetId: "coding" })}
            >
              {t("schedule.project")}
            </SegButton>
          </div>
          {draft.target === "project" && (
            <button
              type="button"
              onClick={() => void pickProject()}
              className="mt-1.5 w-full truncate rounded-lg border border-dashed border-border px-2.5 py-1.5 text-left text-[11px] text-fg-muted transition-colors hover:border-accent hover:text-fg"
            >
              {draft.projectPath ? shortenPath(draft.projectPath) : t("schedule.pickProject")}
            </button>
          )}
        </div>
        <div>
          <div className={labelCls}>{t("schedule.preset")}</div>
          <select
            className={inputCls}
            value={draft.presetId}
            onChange={(e) => patch({ presetId: e.target.value })}
          >
            {presetChoices.map((p) => (
              <option key={p.id} value={p.id}>
                {t(`preset.${p.id}`)} — {t(`preset.${p.id}Desc`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <div className={labelCls}>{t("schedule.timing")}</div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-lg border border-border bg-bg p-0.5">
            <SegButton
              active={draft.scheduleType === "interval"}
              onClick={() => patch({ scheduleType: "interval" })}
            >
              {t("schedule.intervalType")}
            </SegButton>
            <SegButton
              active={draft.scheduleType === "daily"}
              onClick={() => patch({ scheduleType: "daily" })}
            >
              {t("schedule.dailyType")}
            </SegButton>
            <SegButton
              active={draft.scheduleType === "weekly"}
              onClick={() => patch({ scheduleType: "weekly" })}
            >
              {t("schedule.weeklyType")}
            </SegButton>
          </div>
          {draft.scheduleType === "interval" && (
            <div className="flex items-center gap-1.5 text-xs text-fg-secondary">
              {t("schedule.every")}
              <input
                className={cn(inputCls, "w-16 text-center")}
                type="number"
                min={1}
                value={draft.everyMinutes}
                onChange={(e) => patch({ everyMinutes: e.target.value })}
              />
              {t("schedule.minutes")}
            </div>
          )}
          {draft.scheduleType !== "interval" && (
            <input
              className={cn(inputCls, "w-28")}
              type="time"
              value={draft.time}
              onChange={(e) => patch({ time: e.target.value })}
            />
          )}
        </div>
        {draft.scheduleType === "weekly" && (
          <div className="mt-2 flex gap-1">
            {weekdays.map((label, day) => (
              <button
                key={day}
                type="button"
                onClick={() =>
                  patch({
                    days: draft.days.includes(day)
                      ? draft.days.filter((d) => d !== day)
                      : [...draft.days, day],
                  })
                }
                className={cn(
                  "h-7 w-7 rounded-md border text-[11px] transition-colors",
                  draft.days.includes(day)
                    ? "border-accent/40 bg-accent/15 text-accent"
                    : "border-border text-fg-muted hover:bg-bg-hover",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-xs text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
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
          className="rounded-lg bg-accent px-3.5 py-1.5 text-xs font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-40"
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
  const setOpen = useAppStore((s) => s.setScheduledTasksOpen);
  const preset = getRuntimePreset(task.presetId, task.kind);

  const openResult = (): void => {
    if (!task.lastRun?.sessionFile) return;
    void openChat({
      cwd: task.cwd,
      kind: task.kind,
      presetId: task.presetId,
      sessionFile: task.lastRun.sessionFile,
    });
    setOpen(false);
  };

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-bg p-3.5 transition-opacity",
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

export function ScheduledTasksDialog(): React.JSX.Element | null {
  const t = useT();
  const open = useAppStore((s) => s.scheduledTasksOpen);
  const setOpen = useAppStore((s) => s.setScheduledTasksOpen);
  const tasks = useAppStore((s) => s.scheduledTasks);
  const saveTask = useAppStore((s) => s.saveScheduledTask);
  const activeProjectPath = useAppStore((s) => s.activeProjectPath);
  const dailyCwd = useAppStore((s) => s.dailyCwd);
  const [draft, setDraft] = useState<TaskDraft | null>(null);

  if (!open) return null;

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

  return (
    <div
      className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={() => setOpen(false)}
    >
      <div
        className="dialog-in flex max-h-[82vh] w-[640px] flex-col overflow-hidden rounded-2xl border border-border-strong bg-bg-secondary shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-3.5">
          <AlarmClock size={15} className="text-accent" />
          <span className="text-sm font-medium">{t("sidebar.schedule")}</span>
          <span className="text-[11px] text-fg-muted">{t("schedule.subtitle")}</span>
          <div className="flex-1" />
          {!draft && (
            <button
              type="button"
              onClick={() => setDraft(emptyDraft(activeProjectPath))}
              className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-fg transition-opacity hover:opacity-90"
            >
              <Plus size={12} /> {t("common.create")}
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md p-1 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
          >
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          {draft && (
            <TaskForm
              draft={draft}
              onChange={setDraft}
              onCancel={() => setDraft(null)}
              onSave={() => void submit(draft)}
            />
          )}
          {tasks.length === 0 && !draft && (
            <div className="flex flex-col items-center gap-2 py-14 text-fg-muted">
              <AlarmClock size={22} className="opacity-50" />
              <div className="text-xs">{t("schedule.empty")}</div>
              <div className="text-[11px]">{t("schedule.emptyHint")}</div>
            </div>
          )}
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onEdit={() => setDraft(draftFromTask(task, dailyCwd))}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
