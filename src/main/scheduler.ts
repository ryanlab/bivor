/**
 * 定时任务调度器：常驻 main 进程，不依赖窗口存活。
 * 任务持久化在 userData/bivor-tasks.json；单个 30s tick 检查到期任务。
 * background 任务走无头 host 执行；open-chat 任务推送给渲染进程打开聊天，
 * 无窗口时降级为后台执行。
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app, BrowserWindow, Notification } from "electron";
import type { ScheduledTask, ScheduledTaskRunResult, TaskSchedule } from "@shared/protocol";
import { IPC } from "@shared/protocol";
import { runHeadlessPrompt } from "./chats";
import { mt } from "./i18n";

const TICK_MS = 30_000;

let tasks: ScheduledTask[] = [];
let ticker: NodeJS.Timeout | undefined;

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
  for (const task of tasks) task.running = false;
}

// ---------- 调度计算 ----------

function parseTime(time: string): { hour: number; minute: number } {
  const [h, m] = time.split(":").map((part) => Number.parseInt(part, 10));
  return { hour: Number.isFinite(h) ? h : 0, minute: Number.isFinite(m) ? m : 0 };
}

/** 从 from 之后（不含 from 当刻）计算下一次触发时间。 */
export function computeNextRunAt(schedule: TaskSchedule, from: number): number {
  if (schedule.type === "interval") {
    const minutes = Math.max(1, schedule.everyMinutes);
    return from + minutes * 60_000;
  }
  const { hour, minute } = parseTime(schedule.time);
  const next = new Date(from);
  next.setHours(hour, minute, 0, 0);
  if (schedule.type === "daily") {
    if (next.getTime() <= from) next.setDate(next.getDate() + 1);
    return next.getTime();
  }
  // weekly：找最近一个匹配的星期几
  const days = schedule.days.length > 0 ? schedule.days : [next.getDay()];
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(from);
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(hour, minute, 0, 0);
    if (candidate.getTime() > from && days.includes(candidate.getDay())) {
      return candidate.getTime();
    }
  }
  return from + 7 * 24 * 60 * 60_000;
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

// ---------- 执行 ----------

async function runBackground(task: ScheduledTask, degraded: boolean): Promise<void> {
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
  const lastRun: ScheduledTaskRunResult = {
    status: result.status,
    finishedAt: Date.now(),
    sessionFile: result.sessionFile,
    error: result.error,
    ...(degraded ? { degradedToBackground: true } : {}),
  };
  task.lastRun = lastRun;
  persist();
  broadcast();
  if (result.status === "ok") {
    notify(mt("notify.scheduleDone", { name: task.name }), mt("notify.scheduleDoneBody"));
  } else {
    notify(mt("notify.scheduleFail", { name: task.name }), result.error ?? mt("notify.unknownError"));
  }
}

function triggerTask(task: ScheduledTask): void {
  if (task.running) return;
  if (task.runMode === "open-chat") {
    const win = BrowserWindow.getAllWindows().find((w) => !w.webContents.isDestroyed());
    if (win) {
      task.lastRun = { status: "ok", finishedAt: Date.now() };
      persist();
      win.webContents.send(IPC.scheduleTrigger, { ...task });
      if (win.isMinimized()) win.restore();
      win.show();
      broadcast();
      return;
    }
    // 无窗口可用，降级为后台执行
    void runBackground(task, true);
    return;
  }
  void runBackground(task, false);
}

// ---------- 调度循环 ----------

function tick(): void {
  const now = Date.now();
  let dirty = false;
  for (const task of tasks) {
    if (!task.enabled || task.running) continue;
    if (task.nextRunAt === undefined) {
      task.nextRunAt = computeNextRunAt(task.schedule, now);
      dirty = true;
      continue;
    }
    if (task.nextRunAt <= now) {
      task.nextRunAt = computeNextRunAt(task.schedule, now);
      dirty = true;
      triggerTask(task);
    }
  }
  if (dirty) {
    persist();
    broadcast();
  }
}

export function startScheduler(): void {
  load();
  // 错过的不补跑：启动时以当前时间重算全部下次触发时间
  const now = Date.now();
  for (const task of tasks) {
    task.nextRunAt = task.enabled ? computeNextRunAt(task.schedule, now) : undefined;
  }
  persist();
  ticker = setInterval(tick, TICK_MS);
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
    Object.assign(existing, input, { running });
    existing.nextRunAt = existing.enabled
      ? computeNextRunAt(existing.schedule, Date.now())
      : undefined;
  } else {
    const task: ScheduledTask = { ...input, id: input.id || randomUUID(), running: false };
    task.nextRunAt = task.enabled ? computeNextRunAt(task.schedule, Date.now()) : undefined;
    tasks.push(task);
  }
  persist();
  broadcast();
  return listTasks();
}

export function deleteTask(id: string): ScheduledTask[] {
  tasks = tasks.filter((t) => t.id !== id);
  persist();
  broadcast();
  return listTasks();
}

/** 立即执行一次；不影响既定的下次触发时间。 */
export function runTaskNow(id: string): ScheduledTask[] {
  const task = tasks.find((t) => t.id === id);
  if (task && !task.running) triggerTask(task);
  return listTasks();
}
