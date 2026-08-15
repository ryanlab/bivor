/**
 * Agent 运行状况监控：登记每个 agent 宿主进程（utilityProcess）的生命周期，
 * 快照时用 app.getAppMetrics() 按 pid 匹配 CPU / 内存指标。
 */
import { app, BrowserWindow } from "electron";
import type { UtilityProcess } from "electron";
import { VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";
import { IPC } from "@shared/protocol";
import type {
  AgentCrashPayload,
  AgentMonitorSnapshot,
  AgentProcessInfo,
  AppSelfInfo,
} from "@shared/protocol";

interface TrackedAgent {
  chatId: string;
  kind: "chat" | "headless";
  cwd: string;
  serviceName: string;
  label?: string;
  startedAt: number;
  proc: UtilityProcess;
  /** 已发出关闭指令，等待进程退出 */
  exiting: boolean;
  /** 面板轮询期间累积的采样历史（旧→新） */
  cpuHistory: number[];
  memoryHistory: number[];
}

const HISTORY_MAX = 30;

const live = new Map<UtilityProcess, TrackedAgent>();

/** 应用整体退出期间进程被批量回收，不算异常退出 */
let appQuitting = false;
app.on("before-quit", () => {
  appQuitting = true;
});

/** Bivor 自身（非 agent 进程）的采样历史，面板轮询期间累积 */
const selfCpuHistory: number[] = [];
const selfMemoryHistory: number[] = [];

export function trackAgentProcess(
  proc: UtilityProcess,
  info: { chatId: string; kind: "chat" | "headless"; cwd: string; serviceName: string; label?: string },
): void {
  const tracked: TrackedAgent = {
    ...info,
    startedAt: Date.now(),
    proc,
    exiting: false,
    cpuHistory: [],
    memoryHistory: [],
  };
  live.set(proc, tracked);
  proc.once("exit", (code) => {
    live.delete(proc);
    // 没有收到过关闭指令却退出了 → 异常退出，通知渲染进程提醒用户
    if (!tracked.exiting && !appQuitting) {
      const payload: AgentCrashPayload = {
        chatId: tracked.chatId,
        kind: tracked.kind,
        label: tracked.label,
        serviceName: tracked.serviceName,
        code,
      };
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.webContents.isDestroyed()) win.webContents.send(IPC.monitorAgentCrash, payload);
      }
    }
  });
}

/** Bivor 自身开销：主进程 + 渲染 + GPU 等，排除 agent 宿主进程 */
function collectSelf(all: Electron.ProcessMetric[], agentPids: Set<number>): AppSelfInfo {
  const own = all.filter((m) => !agentPids.has(m.pid));
  let cpuPercent = 0;
  let memoryBytes = 0;
  for (const m of own) {
    cpuPercent += m.cpu.percentCPUUsage;
    memoryBytes += m.memory.workingSetSize * 1024;
  }
  selfCpuHistory.push(cpuPercent);
  if (selfCpuHistory.length > HISTORY_MAX) selfCpuHistory.shift();
  selfMemoryHistory.push(memoryBytes);
  if (selfMemoryHistory.length > HISTORY_MAX) selfMemoryHistory.shift();
  let startedAt: number | undefined;
  try {
    startedAt = process.getCreationTime() ?? undefined;
  } catch {
    startedAt = undefined;
  }
  return {
    pid: process.pid,
    startedAt,
    cpuPercent,
    memoryBytes,
    cpuHistory: [...selfCpuHistory],
    memoryHistory: [...selfMemoryHistory],
  };
}

export function getMonitorSnapshot(): AgentMonitorSnapshot {
  // getAppMetrics 覆盖 Electron 的所有子进程；utilityProcess 按 pid 匹配。
  // CPU 百分比是相对上一次调用的增量，首次调用会是 0。
  const all = app.getAppMetrics();
  const metrics = new Map(all.map((m) => [m.pid, m]));
  const processes: AgentProcessInfo[] = [...live.values()].map((t) => {
    const m = t.proc.pid !== undefined ? metrics.get(t.proc.pid) : undefined;
    const cpuPercent = m?.cpu.percentCPUUsage;
    // workingSetSize 单位是 KB
    const memoryBytes = m ? m.memory.workingSetSize * 1024 : undefined;
    if (cpuPercent !== undefined) {
      t.cpuHistory.push(cpuPercent);
      if (t.cpuHistory.length > HISTORY_MAX) t.cpuHistory.shift();
    }
    if (memoryBytes !== undefined) {
      t.memoryHistory.push(memoryBytes);
      if (t.memoryHistory.length > HISTORY_MAX) t.memoryHistory.shift();
    }
    return {
      chatId: t.chatId,
      kind: t.kind,
      cwd: t.cwd,
      serviceName: t.serviceName,
      label: t.label,
      startedAt: t.startedAt,
      pid: t.proc.pid,
      cpuPercent,
      memoryBytes,
      cpuHistory: [...t.cpuHistory],
      memoryHistory: [...t.memoryHistory],
      exiting: t.exiting,
    };
  });
  processes.sort((a, b) => a.startedAt - b.startedAt);
  const agentPids = new Set(
    [...live.values()].map((t) => t.proc.pid).filter((pid): pid is number => pid !== undefined),
  );
  return {
    piVersion: PI_VERSION,
    appVersion: app.getVersion(),
    self: collectSelf(all, agentPids),
    processes,
  };
}

/** 标记进程已收到关闭指令（正在优雅退出），监控面板据此显示"退出中"。 */
export function markAgentExiting(proc: UtilityProcess): void {
  const tracked = live.get(proc);
  if (tracked) tracked.exiting = true;
}

/**
 * 从监控面板强制结束一个 agent 进程：先请求优雅退出（host 会销毁云 VM），
 * 超时后强杀。对跑飞的无头定时任务尤其有用——否则只能等整体超时。
 */
export function killAgentProcess(chatId: string): void {
  const tracked = [...live.values()].find((t) => t.chatId === chatId);
  if (!tracked) return;
  tracked.exiting = true;
  const forceKill = (): void => {
    try {
      tracked.proc.kill();
    } catch {
      // already gone
    }
  };
  const timer = setTimeout(forceKill, 4000);
  tracked.proc.once("exit", () => clearTimeout(timer));
  try {
    tracked.proc.postMessage({ type: "shutdown" });
  } catch {
    clearTimeout(timer);
    forceKill();
  }
}
