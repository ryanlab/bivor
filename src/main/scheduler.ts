/**
 * 定时任务调度器：常驻 main 进程，不依赖窗口存活。
 * 任务持久化在 userData/bivor-tasks.json；单个 30s tick 检查到期任务。
 * 到期后一律走无头 host 后台执行。
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app, BrowserWindow, Notification } from "electron";
import type { IntervalUnit, ScheduledTask, ScheduledTaskRunResult, TaskSchedule } from "@shared/protocol";
import { IPC, normalizeInterval } from "@shared/protocol";
import { runHeadlessPrompt } from "./chats";
import { renameSession } from "./services";
import { mt } from "./i18n";
import { sendBarkPush } from "./bark";

/** 任务卡片可回看的后台运行条数；更早的会话仍在项目会话列表里。 */
const MAX_RUNS = 50;

const TICK_MS = 30_000;
const TICK_SECONDS_MS = 1_000;

let tasks: ScheduledTask[] = [];
let ticker: NodeJS.Timeout | undefined;
let tickerMs = TICK_MS;

function tasksPath(): string {
  return join(app.getPath("userData"), "bivor-tasks.json");
}

function persist(): void {
  mkdirSync(dirname(tasksPath()), { recursive: true });
  // running 是进程内状态，不落盘
  const serializable = tasks.map(({ running: _running, ...rest }) => rest);
  writeFileSync(tasksPath(), JSON.stringify(serializable, null, 2), "utf8");
}

function load(): void {
  try {
    tasks = existsSync(tasksPath())
      ? (JSON.parse(readFileSync(tasksPath(), "utf8")) as ScheduledTask[])
      : [];
  } catch {
    tasks = [];
  }
  for (const task of tasks) {
    task.running = false;
    task.runMode = "background";
    if (!task.runs?.length && task.lastRun) task.runs = [task.lastRun];
    if (task.schedule.type === "interval") {
      const spec = normalizeInterval(task.schedule);
      task.schedule = {
        type: "interval",
        every: spec.every,
        unit: spec.unit,
      };
    }
  }
}

// ---------- 调度计算 ----------

function parseTime(time: string): { hour: number; minute: number } {
  const [h, m] = time.split(":").map((part) => Number.parseInt(part, 10));
  return { hour: Number.isFinite(h) ? h : 0, minute: Number.isFinite(m) ? m : 0 };
}

/** 本地 "YYYY-MM-DDTHH:mm" → epoch ms。 */
function parseOnceAt(at: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(at);
  if (!m) return Number.NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0).getTime();
}

function lastDayOfMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

function addCalendarMonths(from: number, months: number): number {
  const d = new Date(from);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  d.setDate(Math.min(day, lastDayOfMonth(d.getFullYear(), d.getMonth())));
  return d.getTime();
}

function addInterval(from: number, every: number, unit: IntervalUnit): number {
  const n = Math.max(1, every);
  switch (unit) {
    case "seconds":
      return from + n * 1000;
    case "minutes":
      return from + n * 60_000;
    case "hours":
      return from + n * 3_600_000;
    case "weeks":
      return from + n * 7 * 24 * 3_600_000;
    case "months":
      return addCalendarMonths(from, n);
    case "quarters":
      return addCalendarMonths(from, n * 3);
    case "years":
      return addCalendarMonths(from, n * 12);
  }
}

function mondayOf(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.getTime();
}

function nextWeeklyLike(from: number, days: number[], time: string, maxOffset: number): number {
  const allowed = days.length > 0 ? days : [new Date(from).getDay()];
  const { hour, minute } = parseTime(time);
  for (let offset = 0; offset <= maxOffset; offset++) {
    const candidate = new Date(from);
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(hour, minute, 0, 0);
    if (candidate.getTime() > from && allowed.includes(candidate.getDay())) {
      return candidate.getTime();
    }
  }
  return from + maxOffset * 24 * 60 * 60_000;
}

function endOfEffectiveDay(ymd: string): number {
  return parseOnceAt(`${ymd}T23:59`);
}

function startOfEffectiveDay(ymd: string): number {
  return parseOnceAt(`${ymd}T00:00`);
}

function inEffectiveWindow(task: ScheduledTask, ts: number): boolean {
  if (task.effectiveFrom && ts < startOfEffectiveDay(task.effectiveFrom)) return false;
  if (task.effectiveTo && ts > endOfEffectiveDay(task.effectiveTo)) return false;
  return true;
}

/** 从 from 之后（不含 from 当刻）计算下一次触发时间。单次且已过期则返回 undefined。 */
export function computeNextRunAt(schedule: TaskSchedule, from: number): number | undefined {
  if (schedule.type === "once") {
    const at = parseOnceAt(schedule.at);
    return Number.isFinite(at) && at > from ? at : undefined;
  }
  if (schedule.type === "interval") {
    const spec = normalizeInterval(schedule);
    return addInterval(from, spec.every, spec.unit);
  }
  if (schedule.type === "daily") {
    const next = new Date(from);
    const { hour, minute } = parseTime(schedule.time);
    next.setHours(hour, minute, 0, 0);
    if (next.getTime() <= from) next.setDate(next.getDate() + 1);
    return next.getTime();
  }
  if (schedule.type === "weekly") {
    return nextWeeklyLike(from, schedule.days, schedule.time, 7);
  }
  if (schedule.type === "biweekly") {
    const allowed = schedule.days.length > 0 ? schedule.days : [new Date(from).getDay()];
    const { hour, minute } = parseTime(schedule.time);
    const anchorMon = mondayOf(
      Number.isFinite(parseOnceAt(`${schedule.anchor}T00:00`))
        ? parseOnceAt(`${schedule.anchor}T00:00`)
        : from,
    );
    for (let offset = 0; offset <= 28; offset++) {
      const candidate = new Date(from);
      candidate.setDate(candidate.getDate() + offset);
      candidate.setHours(hour, minute, 0, 0);
      if (candidate.getTime() <= from || !allowed.includes(candidate.getDay())) continue;
      const weeks = Math.round((mondayOf(candidate.getTime()) - anchorMon) / (7 * 24 * 60 * 60 * 1000));
      if (weeks >= 0 && weeks % 2 === 0) return candidate.getTime();
    }
    return from + 14 * 24 * 60 * 60_000;
  }
  if (schedule.type === "monthly") {
    const { hour, minute } = parseTime(schedule.time);
    const start = new Date(from);
    const day = Math.min(31, Math.max(1, schedule.day));
    for (let i = 0; i < 14; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      d.setDate(Math.min(day, lastDayOfMonth(d.getFullYear(), d.getMonth())));
      d.setHours(hour, minute, 0, 0);
      if (d.getTime() > from) return d.getTime();
    }
    return from + 32 * 24 * 60 * 60_000;
  }
  const { hour, minute } = parseTime(schedule.time);
  const month = Math.min(12, Math.max(1, schedule.month));
  const day = Math.min(31, Math.max(1, schedule.day));
  const y0 = new Date(from).getFullYear();
  for (let y = y0; y <= y0 + 2; y++) {
    const d = new Date(y, month - 1, Math.min(day, lastDayOfMonth(y, month - 1)), hour, minute, 0, 0);
    if (d.getTime() > from) return d.getTime();
  }
  return from + 366 * 24 * 60 * 60_000;
}

function applyNextRun(task: ScheduledTask, from: number): void {
  if (!task.enabled) {
    task.nextRunAt = undefined;
    return;
  }
  let origin = from;
  if (task.effectiveFrom) {
    const start = startOfEffectiveDay(task.effectiveFrom);
    if (Number.isFinite(start) && origin < start) origin = start - 1;
  }
  const next = computeNextRunAt(task.schedule, origin);
  if (next === undefined) {
    task.nextRunAt = undefined;
    if (task.schedule.type === "once") task.enabled = false;
    return;
  }
  if (task.effectiveTo && Number.isFinite(endOfEffectiveDay(task.effectiveTo)) && next > endOfEffectiveDay(task.effectiveTo)) {
    task.nextRunAt = undefined;
    task.enabled = false;
    return;
  }
  task.nextRunAt = next;
}

// ---------- 广播与通知 ----------

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) {
      win.webContents.send(IPC.scheduleChanged, listTasks());
    }
  }
}

function notify(title: string, body: string): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title, body });
  notification.on("click", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  notification.show();
}

function notifyTask(task: ScheduledTask, title: string, body: string): void {
  notify(title, body);
  if (task.barkPush) void sendBarkPush({ title, body });
}

function recordRun(task: ScheduledTask, run: ScheduledTaskRunResult): void {
  task.lastRun = run;
  const prev = task.runs ?? [];
  task.runs = [run, ...prev].slice(0, MAX_RUNS);
  if (run.sessionFile) {
    try {
      renameSession(run.sessionFile, task.name);
    } catch {
      // 命名失败不影响执行结果
    }
  }
}

// ---------- 执行 ----------

async function runBackground(task: ScheduledTask): Promise<void> {
  task.running = true;
  broadcast();
  const result = await runHeadlessPrompt({
    cwd: task.cwd,
    prompt: task.prompt,
    label: task.name,
    kind: task.kind,
    presetId: task.presetId,
    model: task.model,
  });
  task.running = false;
  recordRun(task, {
    status: result.status,
    finishedAt: Date.now(),
    sessionFile: result.sessionFile,
    error: result.error,
  });
  persist();
  broadcast();
  if (result.status === "ok") {
    notifyTask(task, mt("notify.scheduleDone", { name: task.name }), mt("notify.scheduleDoneBody"));
  } else {
    notifyTask(
      task,
      mt("notify.scheduleFail", { name: task.name }),
      result.error ?? mt("notify.unknownError"),
    );
  }
}

function triggerTask(task: ScheduledTask): void {
  if (task.running) return;
  void runBackground(task);
}

// ---------- 调度循环 ----------

function tick(): void {
  const now = Date.now();
  let dirty = false;
  for (const task of tasks) {
    if (!task.enabled || task.running) continue;
    if (task.nextRunAt === undefined) {
      applyNextRun(task, now);
      dirty = true;
      continue;
    }
    if (task.nextRunAt <= now) {
      if (!inEffectiveWindow(task, now)) {
        applyNextRun(task, now);
        dirty = true;
        continue;
      }
      if (task.schedule.type === "once") {
        task.enabled = false;
        task.nextRunAt = undefined;
      } else {
        task.nextRunAt = computeNextRunAt(task.schedule, now);
        if (task.nextRunAt !== undefined && !inEffectiveWindow(task, task.nextRunAt)) {
          task.nextRunAt = undefined;
          task.enabled = false;
        }
      }
      dirty = true;
      triggerTask(task);
    }
  }
  if (dirty) {
    persist();
    broadcast();
  }
}

function desiredTickMs(): number {
  for (const task of tasks) {
    if (!task.enabled || task.schedule.type !== "interval") continue;
    if (normalizeInterval(task.schedule).unit === "seconds") return TICK_SECONDS_MS;
  }
  return TICK_MS;
}

function ensureTicker(): void {
  const ms = desiredTickMs();
  if (ticker && tickerMs === ms) return;
  if (ticker) clearInterval(ticker);
  tickerMs = ms;
  ticker = setInterval(tick, ms);
}

export function startScheduler(): void {
  load();
  // 错过的不补跑：启动时以当前时间重算全部下次触发时间
  const now = Date.now();
  for (const task of tasks) applyNextRun(task, now);
  persist();
  ensureTicker();
}

export function stopScheduler(): void {
  if (ticker) clearInterval(ticker);
  ticker = undefined;
}

// ---------- IPC API ----------

export function listTasks(): ScheduledTask[] {
  return tasks.map((task) => ({ ...task }));
}

export function saveTask(input: ScheduledTask): ScheduledTask[] {
  const existing = input.id ? tasks.find((t) => t.id === input.id) : undefined;
  if (existing) {
    const running = existing.running;
    const lastRun = input.lastRun ?? existing.lastRun;
    const runs = input.runs ?? existing.runs;
    Object.assign(existing, input, { running, lastRun, runs, runMode: "background" as const });
    applyNextRun(existing, Date.now());
  } else {
    const task: ScheduledTask = {
      ...input,
      id: input.id || randomUUID(),
      running: false,
      runMode: "background",
    };
    applyNextRun(task, Date.now());
    tasks.push(task);
  }
  persist();
  broadcast();
  ensureTicker();
  return listTasks();
}

export function deleteTask(id: string): ScheduledTask[] {
  tasks = tasks.filter((t) => t.id !== id);
  persist();
  broadcast();
  ensureTicker();
  return listTasks();
}

/** 立即执行一次；不影响既定的下次触发时间。 */
export function runTaskNow(id: string): ScheduledTask[] {
  const task = tasks.find((t) => t.id === id);
  if (task && !task.running) triggerTask(task);
  return listTasks();
}
