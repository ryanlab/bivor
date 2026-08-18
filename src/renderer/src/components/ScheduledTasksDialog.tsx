/**
 * 定时任务管理：任务列表 + 创建/编辑表单。
 * 调度与执行都在 main 进程（scheduler.ts），这里只是 CRUD 与状态展示。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlarmClock,
  Calendar,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  Eye,
  Info,
  ListFilter,
  Loader2,
  MessageSquare,
  Minus,
  Pencil,
  Play,
  Plus,
  Smartphone,
  Trash2,
  X,
} from "lucide-react";
import {
  INTERVAL_UNITS,
  normalizeInterval,
  type IntervalUnit,
  type ModelInfo,
  type ScheduledTask,
  type ScheduledTaskRunResult,
  type SessionListItem,
  type TaskSchedule,
} from "@shared/protocol";
import { RUNTIME_PRESETS, getRuntimePreset } from "@shared/runtime-presets";
import { thinkingLevelOf, useAppStore } from "@/stores/app-store";
import { ModelPicker } from "@/components/ModelPicker";
import { ProjectPickerField } from "@/components/ComposerStack";
import { Switch } from "@/components/Switch";
import { cn } from "@/lib/cn";
import { menuItemClass, menuPanel } from "@/lib/menu";
import { formatDateTime, formatRelativeTime, samePath } from "@/lib/format";
import { useDismiss } from "@/lib/use-dismiss";
import { useLocale, useT, type Translator } from "@/lib/i18n";
import type { Locale } from "@shared/i18n";

function weekdayLabels(t: Translator): string[] {
  return t("schedule.weekday").split(",");
}

const PERIOD_TYPES = ["daily", "weekly", "biweekly", "monthly", "yearly"] as const;
type PeriodId = (typeof PERIOD_TYPES)[number];
const WEEKDAY_MON_FIRST = [1, 2, 3, 4, 5, 6, 0];

function isPeriod(type: TaskSchedule["type"]): type is PeriodId {
  return (PERIOD_TYPES as readonly string[]).includes(type);
}

function intervalUnitLabel(unit: IntervalUnit, t: Translator): string {
  const keys: Record<IntervalUnit, string> = {
    seconds: "schedule.unitSeconds",
    minutes: "schedule.unitMinutes",
    hours: "schedule.unitHours",
    weeks: "schedule.unitWeeks",
    months: "schedule.unitMonths",
    quarters: "schedule.unitQuarters",
    years: "schedule.unitYears",
  };
  return t(keys[unit]);
}

function describeSchedule(schedule: TaskSchedule, t: Translator, locale: Locale): string {
  if (schedule.type === "interval") {
    const spec = normalizeInterval(schedule);
    return t("schedule.intervalEvery", {
      n: spec.every,
      unit: intervalUnitLabel(spec.unit, t),
    });
  }
  if (schedule.type === "daily") return t("schedule.daily", { time: schedule.time });
  if (schedule.type === "once") {
    const ts = parseOnceAt(schedule.at);
    const time = Number.isFinite(ts)
      ? formatDateTime(ts, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : schedule.at;
    return t("schedule.onceAt", { time });
  }
  const labels = weekdayLabels(t);
  const sep = locale === "zh" ? "、" : ", ";
  if (schedule.type === "monthly") {
    return t("schedule.monthly", { day: schedule.day, time: schedule.time });
  }
  if (schedule.type === "yearly") {
    return t("schedule.yearly", { month: schedule.month, day: schedule.day, time: schedule.time });
  }
  const days = [...schedule.days].sort().map((d) => labels[d] ?? String(d));
  if (schedule.type === "biweekly") {
    return t("schedule.biweekly", { days: days.join(sep), time: schedule.time });
  }
  return t("schedule.weekly", { days: days.join(sep), time: schedule.time });
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseOnceAt(at: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(at);
  if (!m) return Number.NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0).getTime();
}

function defaultOnceDate(time: string): string {
  const today = formatYmd(new Date());
  const at = parseOnceAt(`${today}T${time}`);
  if (Number.isFinite(at) && at > Date.now()) return today;
  const tmr = new Date();
  tmr.setDate(tmr.getDate() + 1);
  return formatYmd(tmr);
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
  model?: { provider: string; modelId: string };
  scheduleType: TaskSchedule["type"];
  everyAmount: string;
  intervalUnit: IntervalUnit;
  time: string;
  onceDate: string;
  days: number[];
  monthDay: string;
  yearMonth: string;
  effectiveFrom: string;
  effectiveTo: string;
  barkPush: boolean;
}

function emptyDraft(activeProjectPath?: string): TaskDraft {
  const time = "09:00";
  return {
    id: "",
    name: "",
    prompt: "",
    target: activeProjectPath ? "project" : "daily",
    projectPath: activeProjectPath ?? "",
    presetId: activeProjectPath ? "coding" : "daily",
    scheduleType: "daily",
    everyAmount: "1",
    intervalUnit: "hours",
    time,
    onceDate: defaultOnceDate(time),
    days: [1, 2, 3, 4, 5],
    monthDay: "1",
    yearMonth: "1",
    effectiveFrom: "",
    effectiveTo: "",
    barkPush: false,
  };
}

function draftFromTask(task: ScheduledTask, dailyCwd?: string): TaskDraft {
  const isDaily = task.kind === "daily" || task.cwd === dailyCwd;
  const time =
    task.schedule.type === "interval"
      ? "09:00"
      : task.schedule.type === "once"
        ? (task.schedule.at.split("T")[1]?.slice(0, 5) ?? "09:00")
        : task.schedule.time;
  const days =
    task.schedule.type === "weekly" || task.schedule.type === "biweekly"
      ? task.schedule.days && task.schedule.days.length > 0
        ? task.schedule.days
        : [1, 2, 3, 4, 5]
      : [1, 2, 3, 4, 5];
  return {
    id: task.id,
    name: task.name,
    prompt: task.prompt,
    target: isDaily ? "daily" : "project",
    projectPath: isDaily ? "" : task.cwd,
    presetId: task.presetId ?? (isDaily ? "daily" : "coding"),
    model: task.model,
    scheduleType: task.schedule.type,
    everyAmount:
      task.schedule.type === "interval" ? String(normalizeInterval(task.schedule).every) : "1",
    intervalUnit:
      task.schedule.type === "interval" ? normalizeInterval(task.schedule).unit : "hours",
    time,
    onceDate:
      task.schedule.type === "once" ? task.schedule.at.slice(0, 10) : defaultOnceDate(time),
    days,
    monthDay: String(
      task.schedule.type === "monthly" || task.schedule.type === "yearly" ? task.schedule.day : 1,
    ),
    yearMonth: String(task.schedule.type === "yearly" ? task.schedule.month : 1),
    effectiveFrom: task.effectiveFrom ?? "",
    effectiveTo: task.effectiveTo ?? "",
    barkPush: Boolean(task.barkPush),
  };
}

const PROJECT_PRESETS = RUNTIME_PRESETS.filter((p) => p.workspace === "project");

const PRESET_META: Record<string, { icon: typeof Code2; hint: string }> = {
  coding: { icon: Code2, hint: "composer.presetCoding" },
  review: { icon: Eye, hint: "composer.presetReview" },
  minimal: { icon: Minus, hint: "composer.presetMinimal" },
};

const fieldInput =
  "h-9 rounded-md border border-border bg-bg-input px-3 text-[13px] text-fg outline-none placeholder:text-fg-muted focus:border-border-strong";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      <div className="text-[13px] leading-snug">
        <span className="text-fg">{label}</span>
        {hint && <span className="text-fg-muted"> {hint}</span>}
      </div>
      {children}
    </div>
  );
}

function HintIcon({ text }: { text: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, ref, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={text}
        onClick={() => setOpen((v) => !v)}
        className="rounded-full p-0.5 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
      >
        <Info size={13} />
      </button>
      {open && (
        <div className="dialog-in absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-border-strong bg-bg px-2.5 py-2 text-[12px] leading-relaxed text-fg-secondary shadow-xl">
          {text}
        </div>
      )}
    </div>
  );
}

function Seg({
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
        "inline-flex h-8 items-center gap-1.5 rounded-md px-3.5 text-[13px] transition-colors",
        active ? "bg-fg text-bg" : "bg-bg-tertiary text-fg-secondary hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function PeriodSelect({
  value,
  onChange,
  className,
}: {
  value: PeriodId;
  onChange: (v: PeriodId) => void;
  className?: string;
}): React.JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, ref, () => setOpen(false));
  const options: { id: PeriodId; label: string }[] = [
    { id: "daily", label: t("schedule.everyDay") },
    { id: "weekly", label: t("schedule.everyWeek") },
    { id: "biweekly", label: t("schedule.everyTwoWeeks") },
    { id: "monthly", label: t("schedule.everyMonth") },
    { id: "yearly", label: t("schedule.everyYear") },
  ];
  const current = options.find((o) => o.id === value) ?? options[0];

  return (
    <div ref={ref} className={cn("relative min-w-0", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-full items-center justify-between gap-1.5 rounded-md border border-border bg-bg-input px-3 text-[13px] text-fg"
      >
        {current.label}
        <ChevronDown size={13} className="text-fg-muted" />
      </button>
      {open && (
        <div className={cn("dialog-in absolute left-0 top-full z-50 mt-1 min-w-[7.5rem]", menuPanel)}>
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
              className={menuItemClass(o.id === value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function IntervalUnitSelect({
  value,
  onChange,
  className,
}: {
  value: IntervalUnit;
  onChange: (v: IntervalUnit) => void;
  className?: string;
}): React.JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, ref, () => setOpen(false));
  const current = intervalUnitLabel(value, t);

  return (
    <div ref={ref} className={cn("relative min-w-0", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-full items-center justify-between gap-1.5 rounded-md border border-border bg-bg-input px-3 text-[13px] text-fg"
      >
        {current}
        <ChevronDown size={13} className="text-fg-muted" />
      </button>
      {open && (
        <div className={cn("dialog-in absolute left-0 top-full z-50 mt-1 w-full min-w-[7.5rem]", menuPanel)}>
          {INTERVAL_UNITS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                onChange(id);
                setOpen(false);
              }}
              className={menuItemClass(id === value)}
            >
              {intervalUnitLabel(id, t)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function WeekdayBar({
  days,
  onChange,
}: {
  days: number[];
  onChange: (days: number[]) => void;
}): React.JSX.Element {
  const t = useT();
  const labels = weekdayLabels(t);
  return (
    <div className="flex min-w-0 gap-1.5">
      {WEEKDAY_MON_FIRST.map((day) => {
        const on = days.includes(day);
        return (
          <button
            key={day}
            type="button"
            title={labels[day]}
            aria-pressed={on}
            onClick={() =>
              onChange(on ? days.filter((d) => d !== day) : [...days, day])
            }
            className={cn(
              "flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-md border px-1 text-[11px] font-medium transition-colors",
              on
                ? "border-fg bg-fg text-bg"
                : "border-border bg-bg-input text-fg-muted hover:border-border-strong hover:text-fg",
            )}
          >
            <span
              className={cn(
                "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border",
                on ? "border-bg/40 bg-bg text-fg" : "border-border bg-bg",
              )}
            >
              {on && <Check size={10} strokeWidth={3} />}
            </span>
            <span className="truncate">{labels[day]}</span>
          </button>
        );
      })}
    </div>
  );
}

function DateRangePicker({
  from,
  to,
  onChange,
  mode = "range",
  placeholder,
  className,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  mode?: "range" | "single";
  placeholder?: string;
  className?: string;
}): React.JSX.Element {
  const t = useT();
  const locale = useLocale();
  const single = mode === "single";
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState(() => {
    const p = parseYmd(from) ?? parseYmd(formatYmd(new Date()));
    return { y: p?.y ?? new Date().getFullYear(), m0: p?.m0 ?? new Date().getMonth() };
  });
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, ref, () => setOpen(false));

  const emptyLabel = placeholder ?? t("schedule.effectiveRangePh");
  const label = single
    ? from
      ? formatYmdDisplay(from, locale)
      : emptyLabel
    : from && to
      ? `${formatYmdDisplay(from, locale)} – ${formatYmdDisplay(to, locale)}`
      : from
        ? `${formatYmdDisplay(from, locale)} – …`
        : emptyLabel;

  const shorts = t("schedule.weekdayShort").split(",");
  const dim = lastDayOfMonth(view.y, view.m0);
  const startOffset = (new Date(view.y, view.m0, 1).getDay() + 6) % 7;
  const cells: (number | null)[] = Array.from({ length: 42 }, (_, i) => {
    const day = i - startOffset + 1;
    return day >= 1 && day <= dim ? day : null;
  });
  const trailingEmpty = cells.slice(35).every((d) => d == null);
  const visible = trailingEmpty ? cells.slice(0, 35) : cells;

  const rangeStart = from;
  const rangeEnd = single ? from : to || (from && hover ? hover : "");
  const lo = rangeStart && rangeEnd && rangeStart > rangeEnd ? rangeEnd : rangeStart;
  const hi = rangeStart && rangeEnd && rangeStart > rangeEnd ? rangeStart : rangeEnd;

  const pick = (ymd: string): void => {
    if (single) {
      onChange(ymd, ymd);
      setOpen(false);
      return;
    }
    if (!from || (from && to)) {
      onChange(ymd, "");
      return;
    }
    if (ymd < from) onChange(ymd, from);
    else onChange(from, ymd);
    setOpen(false);
  };

  const shiftMonth = (delta: number): void => {
    const d = new Date(view.y, view.m0 + delta, 1);
    setView({ y: d.getFullYear(), m0: d.getMonth() });
  };

  return (
    <div ref={ref} className={cn("relative w-full min-w-0", className)}>
      <div className={cn(fieldInput, "flex w-full items-center gap-1.5 pr-2")}>
        <button
          type="button"
          title={
            single
              ? emptyLabel
              : `${t("schedule.effectiveRange")} (${t("schedule.effectiveRangeHint")})`
          }
          onClick={() => {
            const p = parseYmd(from);
            if (p) setView({ y: p.y, m0: p.m0 });
            setOpen((v) => !v);
          }}
          className={cn(
            "flex min-w-0 flex-1 items-center text-left",
            from ? "text-fg" : "text-fg-muted",
          )}
        >
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {!from && <Calendar size={13} className="shrink-0 text-fg-muted" />}
        </button>
        {from && (
          <button
            type="button"
            title={t("common.clear")}
            onClick={() => onChange("", "")}
            className="rounded p-0.5 text-fg-muted hover:text-fg"
          >
            <X size={12} />
          </button>
        )}
      </div>
      {open && (
        <div className="dialog-in absolute right-0 top-full z-50 mt-1 w-[252px] rounded-xl border border-border-strong bg-bg p-2 shadow-xl">
          <div className="flex items-center justify-between px-1 pb-1.5">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="rounded-md p-1 text-fg-muted hover:bg-bg-hover hover:text-fg"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-[13px] font-medium">
              {locale === "zh"
                ? `${view.y}年${view.m0 + 1}月`
                : new Date(view.y, view.m0, 1).toLocaleString("en-US", {
                    month: "short",
                    year: "numeric",
                  })}
            </span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="rounded-md p-1 text-fg-muted hover:bg-bg-hover hover:text-fg"
            >
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-px text-center text-[10px] text-fg-muted">
            {WEEKDAY_MON_FIRST.map((d) => (
              <div key={d} className="py-1">
                {shorts[d]}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px">
            {visible.map((day, i) => {
              if (day == null) return <div key={`e${i}`} />;
              const ymd = formatYmdParts(view.y, view.m0, day);
              const inRange = Boolean(lo && hi && ymd >= lo && ymd <= hi);
              const isEdge = ymd === from || ymd === to;
              const isToday = ymd === formatYmd(new Date());
              return (
                <button
                  key={ymd}
                  type="button"
                  onMouseEnter={() => setHover(ymd)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => pick(ymd)}
                  className={cn(
                    "h-7 rounded-md text-[12px] tabular-nums transition-colors",
                    isEdge
                      ? "bg-fg text-bg"
                      : inRange
                        ? "bg-bg-hover text-fg"
                        : "text-fg hover:bg-bg-hover",
                    isToday && !isEdge && "font-medium text-accent",
                  )}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function parseYmd(s: string): { y: number; m0: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return { y: +m[1], m0: +m[2] - 1, d: +m[3] };
}

function formatYmdParts(y: number, m0: number, d: number): string {
  return `${y}-${pad2(m0 + 1)}-${pad2(d)}`;
}

function lastDayOfMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

function formatYmdDisplay(ymd: string, locale: Locale): string {
  const p = parseYmd(ymd);
  if (!p) return ymd;
  if (locale === "zh") return `${p.y}/${p.m0 + 1}/${p.d}`;
  return `${p.m0 + 1}/${p.d}/${p.y}`;
}

function DraftPresetPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}): React.JSX.Element {
  const t = useT();
  const current = PROJECT_PRESETS.find((p) => p.id === value) ?? PROJECT_PRESETS[0];
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
        <div className={cn("dialog-in absolute bottom-full left-0 z-50 mb-1 w-56", menuPanel)}>
          {PROJECT_PRESETS.map((p) => {
            const Icon = PRESET_META[p.id]?.icon ?? Code2;
            const hint = PRESET_META[p.id] ? t(PRESET_META[p.id].hint) : p.description;
            const selected = p.id === value;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onChange(p.id);
                  setOpen(false);
                }}
                className={menuItemClass(selected, "items-start gap-2")}
              >
                <Icon size={14} strokeWidth={1.8} className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className={cn("text-xs", selected && "font-medium text-accent")}>
                    {t(`preset.${p.id}`)}
                  </div>
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
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const models = useAppStore((s) => s.models);
  const preferredModel = useAppStore((s) => s.preferredModel);
  const modelThinking = useAppStore((s) => s.modelThinking);
  const setModelThinking = useAppStore((s) => s.setModelThinking);
  const activeProjectPath = useAppStore((s) => s.activeProjectPath);

  const selectedModel: ModelInfo | undefined = draft.model
    ? (models.find((m) => m.provider === draft.model!.provider && m.id === draft.model!.modelId) ??
      preferredModel)
    : preferredModel;

  const setTarget = (target: "daily" | "project"): void => {
    if (target === "daily") {
      patch({ target: "daily", presetId: "daily" });
      return;
    }
    patch({
      target: "project",
      presetId: draft.presetId === "daily" ? "coding" : draft.presetId,
      projectPath: draft.projectPath.trim() || activeProjectPath || "",
    });
  };

  const canSave =
    draft.name.trim() !== "" &&
    draft.prompt.trim() !== "" &&
    (draft.target === "daily" || draft.projectPath.trim() !== "") &&
    (draft.scheduleType !== "interval" ||
      (Number.parseInt(draft.everyAmount, 10) || 0) >= 1) &&
    ((draft.scheduleType !== "weekly" && draft.scheduleType !== "biweekly") ||
      draft.days.length > 0) &&
    (draft.scheduleType !== "once" ||
      (Boolean(draft.onceDate) &&
        Boolean(draft.time) &&
        parseOnceAt(`${draft.onceDate}T${draft.time.slice(0, 5)}`) > Date.now()));

  const freqKind =
    draft.scheduleType === "interval"
      ? "interval"
      : draft.scheduleType === "once"
        ? "once"
        : "periodic";

  return (
    <div className="mx-auto w-full max-w-[640px]">
      <div className="space-y-5">
        <Field label={t("schedule.name")}>
          <input
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder={t("schedule.namePh")}
            className={cn(fieldInput, "w-full")}
          />
        </Field>

        <Field
          label={t("schedule.mode")}
          hint={
            draft.target === "daily"
              ? `(${t("schedule.dailyModeHint")})`
              : `(${t("schedule.codingModeHint")})`
          }
        >
          <div className="flex flex-wrap gap-1.5">
            <Seg active={draft.target === "daily"} onClick={() => setTarget("daily")}>
              <MessageSquare size={13} strokeWidth={1.8} />
              {t("welcome.dailyMode")}
            </Seg>
            <Seg active={draft.target === "project"} onClick={() => setTarget("project")}>
              <Code2 size={13} strokeWidth={1.8} />
              {t("welcome.codingMode")}
            </Seg>
          </div>
        </Field>

        {draft.target === "project" && (
          <Field label={t("schedule.project")}>
            <ProjectPickerField
              value={draft.projectPath}
              onChange={(path) => patch({ projectPath: path, target: "project" })}
            />
          </Field>
        )}

        <Field label={t("schedule.prompt")}>
          <div className="rounded-md border border-border bg-bg-input transition-colors focus-within:border-border-strong">
            <textarea
              value={draft.prompt}
              onChange={(e) => patch({ prompt: e.target.value })}
              placeholder={t("schedule.promptPh")}
              rows={5}
              className="w-full resize-none bg-transparent px-3 pt-2.5 text-[13px] leading-relaxed text-fg outline-none placeholder:text-fg-muted"
            />
            <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
              <ModelPicker
                model={selectedModel}
                align="top"
                onSelect={(m) => patch({ model: { provider: m.provider, modelId: m.id } })}
                thinkingFor={(m) => thinkingLevelOf(modelThinking, m)}
                onThinkingLevel={(m, l) => setModelThinking(m, l)}
              />
              {draft.target === "project" && (
                <DraftPresetPicker
                  value={draft.presetId}
                  onChange={(id) => patch({ presetId: id })}
                />
              )}
            </div>
          </div>
        </Field>

        <Field label={t("schedule.freq")}>
          <div>
            <div className="flex flex-wrap gap-1.5">
              <Seg
                active={freqKind === "periodic"}
                onClick={() =>
                  patch({
                    scheduleType: isPeriod(draft.scheduleType) ? draft.scheduleType : "daily",
                  })
                }
              >
                {t("schedule.periodic")}
              </Seg>
              <Seg
                active={freqKind === "interval"}
                onClick={() => patch({ scheduleType: "interval" })}
              >
                {t("schedule.intervalType")}
              </Seg>
              <Seg
                active={freqKind === "once"}
                onClick={() =>
                  patch({
                    scheduleType: "once",
                    onceDate: draft.onceDate || defaultOnceDate(draft.time),
                  })
                }
              >
                {t("schedule.onceType")}
              </Seg>
            </div>
            <div className="pt-2.5">
              {draft.scheduleType === "interval" ? (
                <div className="flex w-full items-center gap-2 text-[13px] text-fg-secondary">
                  <span className="shrink-0">{t("schedule.every")}</span>
                  <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
                    <input
                      className={cn(fieldInput, "min-w-0 w-full px-2 text-center")}
                      type="number"
                      min={1}
                      value={draft.everyAmount}
                      onChange={(e) => patch({ everyAmount: e.target.value })}
                    />
                    <IntervalUnitSelect
                      className="min-w-0 w-full"
                      value={draft.intervalUnit}
                      onChange={(intervalUnit) => patch({ intervalUnit })}
                    />
                  </div>
                </div>
              ) : draft.scheduleType === "once" ? (
                <div className="grid w-full grid-cols-3 gap-2">
                  <div className={cn(fieldInput, "flex min-w-0 w-full items-center")}>
                    {t("schedule.everyOnce")}
                  </div>
                  <input
                    className={cn(fieldInput, "min-w-0 w-full")}
                    type="time"
                    value={draft.time}
                    onChange={(e) => patch({ time: e.target.value })}
                  />
                  <DateRangePicker
                    mode="single"
                    className="min-w-0 w-full"
                    from={draft.onceDate}
                    to={draft.onceDate}
                    placeholder={t("schedule.onceDatePh")}
                    onChange={(onceDate) => patch({ onceDate })}
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid w-full grid-cols-3 gap-2">
                    <div className="flex min-w-0 w-full items-center gap-1">
                      <PeriodSelect
                        className="min-w-0 flex-1"
                        value={isPeriod(draft.scheduleType) ? draft.scheduleType : "daily"}
                        onChange={(v) => patch({ scheduleType: v })}
                      />
                      {(draft.scheduleType === "monthly" || draft.scheduleType === "yearly") && (
                        <>
                          {draft.scheduleType === "yearly" && (
                            <input
                              className={cn(fieldInput, "w-12 shrink-0 px-1.5 text-center")}
                              type="number"
                              min={1}
                              max={12}
                              value={draft.yearMonth}
                              onChange={(e) => patch({ yearMonth: e.target.value })}
                              title={t("schedule.everyMonth")}
                            />
                          )}
                          <input
                            className={cn(fieldInput, "w-12 shrink-0 px-1.5 text-center")}
                            type="number"
                            min={1}
                            max={31}
                            value={draft.monthDay}
                            onChange={(e) => patch({ monthDay: e.target.value })}
                          />
                        </>
                      )}
                    </div>
                    <input
                      className={cn(fieldInput, "min-w-0 w-full")}
                      type="time"
                      value={draft.time}
                      onChange={(e) => patch({ time: e.target.value })}
                    />
                    <DateRangePicker
                      className="min-w-0 w-full"
                      from={draft.effectiveFrom}
                      to={draft.effectiveTo}
                      onChange={(effectiveFrom, effectiveTo) =>
                        patch({ effectiveFrom, effectiveTo })
                      }
                    />
                  </div>
                  {(draft.scheduleType === "weekly" || draft.scheduleType === "biweekly") && (
                    <WeekdayBar days={draft.days} onChange={(days) => patch({ days })} />
                  )}
                </div>
              )}
            </div>
          </div>
        </Field>

        <div className="flex items-center gap-2">
          <span className="text-[13px] text-fg">{t("schedule.barkPushRow")}</span>
          <HintIcon text={t("schedule.barkPushRowHint")} />
          <div className="flex-1" />
          <Switch
            on={draft.barkPush}
            title={t("schedule.barkPushRowHint")}
            onClick={() => {
              if (draft.barkPush) {
                patch({ barkPush: false });
                return;
              }
              void window.pi.config.get().then((c) => {
                if (!c.barkDeviceUrl?.trim()) setSettingsOpen(true, "bark");
                patch({ barkPush: true });
              });
            }}
          />
        </div>
      </div>

      <div className="mt-8 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-9 rounded-md px-3.5 text-[13px] text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
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
          className="h-9 rounded-md bg-fg px-4 text-[13px] font-medium text-bg transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
        >
          {draft.id ? t("schedule.saveEdit") : t("schedule.create")}
        </button>
      </div>
    </div>
  );
}

// ---------- 任务行 ----------

function taskRunHistory(task: ScheduledTask): ScheduledTaskRunResult[] {
  if (task.runs?.length) return task.runs;
  return task.lastRun ? [task.lastRun] : [];
}

function sessionMatchesTask(session: SessionListItem, task: ScheduledTask): boolean {
  if (!samePath(session.cwd, task.cwd)) return false;
  if (session.name && session.name === task.name) return true;
  const first = session.firstUserMessage?.trim() ?? "";
  if (!first) return false;
  const prompt = task.prompt.trim();
  return prompt.startsWith(first) || first.startsWith(prompt.slice(0, first.length));
}

const RUN_MENU_W = 200;
const RUN_MENU_MAX_H = 280;
const RUN_MENU_GAP = 4;
const RUN_MENU_PAD = 8;

function measureRunMenu(anchor: HTMLElement): { top: number; left: number; maxHeight: number } {
  const rect = anchor.getBoundingClientRect();
  const width = Math.max(RUN_MENU_W, rect.width);
  const left = Math.min(
    Math.max(RUN_MENU_PAD, rect.right - width),
    window.innerWidth - width - RUN_MENU_PAD,
  );
  const spaceBelow = window.innerHeight - rect.bottom - RUN_MENU_GAP - RUN_MENU_PAD;
  const spaceAbove = rect.top - RUN_MENU_GAP - RUN_MENU_PAD;
  const placeBelow = spaceBelow >= 120 || spaceBelow >= spaceAbove;
  const available = placeBelow ? spaceBelow : spaceAbove;
  const maxHeight = Math.max(120, Math.min(RUN_MENU_MAX_H, available));
  const top = placeBelow ? rect.bottom + RUN_MENU_GAP : rect.top - RUN_MENU_GAP - maxHeight;
  return { top, left, maxHeight };
}

function RunHistoryButton({ task }: { task: ScheduledTask }): React.JSX.Element | null {
  const t = useT();
  const openChat = useAppStore((s) => s.openChat);
  const [open, setOpen] = useState(false);
  const [diskSessions, setDiskSessions] = useState<SessionListItem[]>([]);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void window.pi.sessions.list(task.cwd).then((sessions) => {
      if (!cancelled) setDiskSessions(sessions.filter((s) => sessionMatchesTask(s, task)));
    });
    return () => {
      cancelled = true;
    };
  }, [task.cwd, task.name, task.prompt, task.lastRun?.sessionFile]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const update = (): void => {
      const anchor = triggerRef.current;
      if (!anchor) return;
      setPos(measureRunMenu(anchor));
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent): void => {
      const node = e.target as Node;
      if (triggerRef.current?.contains(node) || menuRef.current?.contains(node)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const recorded = taskRunHistory(task);
  const byPath = new Map<string, ScheduledTaskRunResult>();
  for (const session of diskSessions) {
    byPath.set(session.path, {
      status: "ok",
      finishedAt: session.modifiedAt ?? session.createdAt ?? 0,
      sessionFile: session.path,
    });
  }
  for (const run of recorded) {
    if (run.sessionFile) byPath.set(run.sessionFile, run);
  }
  const history = [...byPath.values()]
    .filter((r) => r.sessionFile)
    .sort((a, b) => b.finishedAt - a.finishedAt);

  if (history.length === 0) return null;

  const openRun = (run: ScheduledTaskRunResult): void => {
    if (!run.sessionFile) return;
    setOpen(false);
    void openChat({
      cwd: task.cwd,
      kind: task.kind,
      presetId: task.presetId,
      sessionFile: run.sessionFile,
    });
  };

  const label =
    history.length > 1
      ? t("schedule.viewSessions", { n: history.length })
      : t("schedule.viewSession");

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-4 items-center gap-1 text-[11px] leading-none text-accent transition-colors hover:text-accent-hover"
      >
        <MessageSquare size={11} className="shrink-0" /> {label}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            style={{ top: pos.top, left: pos.left, width: RUN_MENU_W, maxHeight: pos.maxHeight }}
            className={cn("dialog-in fixed z-50 overflow-y-auto", menuPanel)}
          >
            {history.map((run, i) => (
              <button
                key={run.sessionFile ?? i}
                type="button"
                onClick={() => openRun(run)}
                className={menuItemClass(false, "text-[13px] text-fg-secondary")}
              >
                {formatDateTime(run.finishedAt, {
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

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
  const preset = getRuntimePreset(task.presetId, task.kind);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!confirmDelete) return;
    const id = window.setTimeout(() => setConfirmDelete(false), 3000);
    return () => clearTimeout(id);
  }, [confirmDelete]);

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-bg px-3.5 pt-3.5 transition-colors hover:border-border-strong",
        task.lastRun ? "pb-0" : "pb-3.5",
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
            {task.barkPush && (
              <>
                <span>·</span>
                <span className="flex items-center gap-1" title={t("schedule.barkPushRow")}>
                  <Smartphone size={11} />
                  {t("schedule.barkPushRow")}
                </span>
              </>
            )}
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
          {confirmDelete ? (
            <>
              <button
                type="button"
                onClick={() => void deleteTask(task.id)}
                className="rounded-md p-1.5 text-danger transition-colors hover:bg-danger/10"
                title={t("schedule.confirmDelete")}
              >
                <Check size={13} />
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
                title={t("common.cancel")}
              >
                <X size={13} />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-bg-hover hover:text-danger"
              title={t("common.delete")}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {task.lastRun && (
        <div className="mt-2.5 border-t border-border/60">
          <div className="flex items-center gap-2 py-2.5 text-[11px] leading-none">
            {task.lastRun.status === "ok" ? (
              <span className="inline-flex h-4 items-center gap-0.5 text-success">
                <Check size={11} strokeWidth={2.2} className="shrink-0" />
                {t("common.success")}
              </span>
            ) : (
              <span className="inline-flex h-4 items-center gap-0.5 text-danger">
                <X size={11} strokeWidth={2.2} className="shrink-0" />
                {t("common.failed")}
              </span>
            )}
            <span className="inline-flex h-4 items-center text-fg-muted">
              {t("schedule.lastRunAt", { time: formatRelativeTime(task.lastRun.finishedAt) })}
            </span>
            {task.lastRun.error && (
              <span className="inline-flex h-4 min-w-0 items-center truncate text-danger/90">
                {task.lastRun.error}
              </span>
            )}
            <div className="flex-1" />
            <RunHistoryButton task={task} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- 对话框 ----------

type StatusFilter = "all" | "enabled" | "paused" | "running";
type KindFilter = "all" | "daily" | "coding";

interface TaskListFilter {
  query: string;
  status: StatusFilter;
  kind: KindFilter;
}

const EMPTY_FILTER: TaskListFilter = {
  query: "",
  status: "all",
  kind: "all",
};

function isFilterActive(f: TaskListFilter): boolean {
  return f.query.trim() !== "" || f.status !== "all" || f.kind !== "all";
}

function taskMatchesFilter(task: ScheduledTask, f: TaskListFilter): boolean {
  const q = f.query.trim().toLowerCase();
  if (q && !task.name.toLowerCase().includes(q) && !task.prompt.toLowerCase().includes(q)) {
    return false;
  }
  if (f.status === "enabled" && !task.enabled) return false;
  if (f.status === "paused" && task.enabled) return false;
  if (f.status === "running" && !task.running) return false;
  if (f.kind !== "all" && task.kind !== f.kind) return false;
  return true;
}

function FilterChoice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}): React.JSX.Element {
  return (
    <>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={menuItemClass(o.id === value, "items-center gap-2 px-2.5 py-1.5")}
        >
          <span className="min-w-0 flex-1">{o.label}</span>
          {o.id === value && <Check size={14} strokeWidth={2.2} className="shrink-0 text-success" />}
        </button>
      ))}
    </>
  );
}

function TaskFilterButton({
  value,
  onChange,
}: {
  value: TaskListFilter;
  onChange: (next: TaskListFilter) => void;
}): React.JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, ref, () => setOpen(false));
  const active = isFilterActive(value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title={t("schedule.filter")}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-xl border px-3.5 text-xs font-medium transition-colors",
          active || open
            ? "border-border-strong bg-bg-hover text-fg"
            : "border-border bg-bg-input text-fg-secondary hover:text-fg",
        )}
      >
        <ListFilter size={13} />
        {t("schedule.filter")}
      </button>
      {open && (
        <div className={cn("dialog-in absolute right-0 top-full z-50 mt-1 w-56", menuPanel)}>
          <div className="px-1.5 pb-1 pt-0.5">
            <input
              autoFocus
              value={value.query}
              onChange={(e) => onChange({ ...value, query: e.target.value })}
              placeholder={t("schedule.filterSearch")}
              className="w-full bg-transparent px-1.5 py-1 text-xs text-fg outline-none placeholder:text-fg-muted"
            />
          </div>
          <div className="px-2.5 pb-0.5 pt-1 text-[11px] text-fg-muted">{t("schedule.filterStatus")}</div>
          <FilterChoice
            value={value.status}
            onChange={(status) => onChange({ ...value, status })}
            options={[
              { id: "all", label: t("common.all") },
              { id: "enabled", label: t("schedule.filterEnabled") },
              { id: "paused", label: t("schedule.filterPaused") },
              { id: "running", label: t("common.running") },
            ]}
          />
          <div className="px-2.5 pb-0.5 pt-1.5 text-[11px] text-fg-muted">{t("schedule.mode")}</div>
          <FilterChoice
            value={value.kind}
            onChange={(kind) => onChange({ ...value, kind })}
            options={[
              { id: "all", label: t("common.all") },
              { id: "daily", label: t("welcome.dailyMode") },
              { id: "coding", label: t("welcome.codingMode") },
            ]}
          />
          {active && (
            <button
              type="button"
              onClick={() => onChange(EMPTY_FILTER)}
              className={menuItemClass(false, "justify-center text-fg-muted")}
            >
              {t("schedule.filterClear")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ScheduledTasksDialog(): React.JSX.Element {
  const t = useT();
  const tasks = useAppStore((s) => s.scheduledTasks);
  const saveTask = useAppStore((s) => s.saveScheduledTask);
  const activeProjectPath = useAppStore((s) => s.activeProjectPath);
  const dailyCwd = useAppStore((s) => s.dailyCwd);
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [filter, setFilter] = useState<TaskListFilter>(EMPTY_FILTER);

  const submit = async (d: TaskDraft): Promise<void> => {
    const cwd = d.target === "daily" ? (dailyCwd ?? (await window.pi.system.dailyCwd())) : d.projectPath;
    const every = Math.max(1, Number.parseInt(d.everyAmount, 10) || 1);
    const monthDay = Math.min(31, Math.max(1, Number.parseInt(d.monthDay, 10) || 1));
    const yearMonth = Math.min(12, Math.max(1, Number.parseInt(d.yearMonth, 10) || 1));
    const schedule: TaskSchedule =
      d.scheduleType === "interval"
        ? {
            type: "interval",
            every,
            unit: d.intervalUnit,
          }
        : d.scheduleType === "once"
          ? { type: "once", at: `${d.onceDate}T${d.time.slice(0, 5)}` }
          : d.scheduleType === "daily"
            ? { type: "daily", time: d.time }
            : d.scheduleType === "biweekly"
              ? {
                  type: "biweekly",
                  days: d.days,
                  time: d.time,
                  anchor: formatYmd(new Date()),
                }
              : d.scheduleType === "monthly"
                ? { type: "monthly", day: monthDay, time: d.time }
                : d.scheduleType === "yearly"
                  ? { type: "yearly", month: yearMonth, day: monthDay, time: d.time }
                  : { type: "weekly", days: d.days, time: d.time };
    const existing = tasks.find((t) => t.id === d.id);
    const biweeklyAnchor =
      d.scheduleType === "biweekly" && existing?.schedule.type === "biweekly"
        ? existing.schedule.anchor
        : undefined;
    if (schedule.type === "biweekly" && biweeklyAnchor) schedule.anchor = biweeklyAnchor;
    await saveTask({
      ...(existing ?? {}),
      id: d.id,
      name: d.name.trim(),
      prompt: d.prompt.trim(),
      cwd,
      kind: d.target === "daily" ? "daily" : "coding",
      presetId: d.presetId,
      model: d.model,
      schedule,
      runMode: "background",
      barkPush: d.barkPush,
      enabled: existing?.enabled ?? true,
      effectiveFrom:
        d.scheduleType === "interval" ? undefined : d.effectiveFrom.trim() || undefined,
      effectiveTo: d.scheduleType === "interval" ? undefined : d.effectiveTo.trim() || undefined,
    });
    setDraft(null);
  };

  const empty = tasks.length === 0 && !draft;
  const visible = tasks.filter((task) => taskMatchesFilter(task, filter));

  if (draft) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-4 px-8 pt-8">
          <div>
            <h1 className="font-serif-display text-[26px] leading-tight">
              {draft.id ? t("schedule.edit") : t("schedule.create")}
            </h1>
            <p className="pt-0.5 text-xs text-fg-muted">{t("schedule.subtitle")}</p>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex min-h-full w-full items-center justify-center px-8 py-8">
            <TaskForm
              draft={draft}
              onChange={setDraft}
              onCancel={() => setDraft(null)}
              onSave={() => void submit(draft)}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-4 px-8 pt-8">
        <div>
          <h1 className="font-serif-display text-[26px] leading-tight">{t("sidebar.schedule")}</h1>
          <p className="pt-0.5 text-xs text-fg-muted">{t("schedule.subtitle")}</p>
        </div>
        {!empty && (
          <div className="flex items-center gap-2">
            <TaskFilterButton value={filter} onChange={setFilter} />
            <button
              type="button"
              onClick={() => setDraft(emptyDraft(activeProjectPath))}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover"
            >
              <Plus size={13} /> {t("common.create")}
            </button>
          </div>
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
          {visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 pt-16 text-center">
              <p className="text-sm text-fg-muted">{t("schedule.filterEmpty")}</p>
              {isFilterActive(filter) && (
                <button
                  type="button"
                  onClick={() => setFilter(EMPTY_FILTER)}
                  className="text-xs text-accent hover:text-accent-hover"
                >
                  {t("schedule.filterClear")}
                </button>
              )}
            </div>
          ) : (
            visible.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onEdit={() => setDraft(draftFromTask(task, dailyCwd))}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
