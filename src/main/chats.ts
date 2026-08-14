/**
 * Chat process management: one utilityProcess per chat, hosting a pi
 * AgentSession. Routes commands in and events out.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { utilityProcess, type UtilityProcess, type WebContents } from "electron";
import type {
  ChatCreateOptions,
  ChatKind,
  HostCommand,
  HostEvent,
  HostEventEnvelope,
} from "@shared/protocol";
import { IPC } from "@shared/protocol";
import { getConfig } from "./config";
import { mt } from "./i18n";

interface ChatProcess {
  chatId: string;
  proc: UtilityProcess;
  webContents: WebContents;
}

const chats = new Map<string, ChatProcess>();

function forkHost(chatId: string, cwd: string, servicePrefix: string): UtilityProcess {
  const hostPath = join(import.meta.dirname, "host.js");
  return utilityProcess.fork(hostPath, [], {
    serviceName: `${servicePrefix}-${chatId.slice(0, 8)}`,
    cwd,
    env: {
      ...process.env,
      ...(getConfig().e2bApiKey ? { E2B_API_KEY: getConfig().e2bApiKey } : {}),
      ...(getConfig().tavilyApiKey ? { TAVILY_API_KEY: getConfig().tavilyApiKey } : {}),
      ...(getConfig().vercelToken ? { VERCEL_TOKEN: getConfig().vercelToken } : {}),
      ...(getConfig().vercelTeamId ? { VERCEL_TEAM_ID: getConfig().vercelTeamId } : {}),
    },
  });
}

export function createChat(webContents: WebContents, options: ChatCreateOptions): string {
  const chatId = randomUUID();
  const proc = forkHost(chatId, options.cwd, "pi-chat");

  const entry: ChatProcess = { chatId, proc, webContents };
  chats.set(chatId, entry);

  proc.on("message", (event: HostEvent) => {
    forward(entry, event);
  });

  proc.on("exit", (code) => {
    if (chats.has(chatId)) {
      forward(entry, { type: "fatal", message: mt("host.processExit", { code: String(code) }) });
      chats.delete(chatId);
    }
  });

  // If the renderer goes away (window closed on macOS, or a main-frame reload
  // such as HMR), its chats would otherwise keep running forever — and any
  // cloud VM with them. Do NOT treat iframe navigations (the VM desktop stream)
  // as a reload: that was killing every chat and freezing the app.
  const onGone = (): void => {
    for (const [id, e] of chats) {
      if (e.webContents === webContents) void disposeChat(id);
    }
  };
  webContents.once("destroyed", onGone);
  webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame) onGone();
  });

  proc.postMessage({
    type: "init",
    chatId,
    cwd: options.cwd,
    sessionFile: options.sessionFile,
    model: options.model,
    thinkingLevel: options.thinkingLevel,
    kind: options.kind,
    presetId: options.presetId,
    locale: options.locale ?? getConfig().locale,
  });

  return chatId;
}

function forward(entry: ChatProcess, event: HostEvent): void {
  if (entry.webContents.isDestroyed()) return;
  const envelope: HostEventEnvelope = { chatId: entry.chatId, event };
  entry.webContents.send(IPC.chatEvent, envelope);
}

export function sendChatCommand(chatId: string, command: HostCommand): void {
  const entry = chats.get(chatId);
  if (!entry) return;
  entry.proc.postMessage(command);
}

/** Ask the host to clean up (destroy its VM) then exit; force-kill as backstop. */
function gracefulKill(proc: UtilityProcess): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    proc.once("exit", finish);
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // already gone
      }
      finish();
    }, 4000);
    try {
      proc.postMessage({ type: "shutdown" });
    } catch {
      try {
        proc.kill();
      } catch {
        // already gone
      }
      finish();
    }
  });
}

export function disposeChat(chatId: string): Promise<void> {
  const entry = chats.get(chatId);
  if (!entry) return Promise.resolve();
  chats.delete(chatId);
  return gracefulKill(entry.proc);
}

export async function disposeAllChats(): Promise<void> {
  await Promise.all([
    ...[...chats.keys()].map((chatId) => disposeChat(chatId)),
    ...[...headlessProcs].map((proc) => {
      headlessProcs.delete(proc);
      return gracefulKill(proc);
    }),
  ]);
}

// ---------- 无头执行（定时任务后台模式）----------

/** 在跑的无头 host 进程；退出时随 disposeAllChats 一并清理。 */
const headlessProcs = new Set<UtilityProcess>();

export interface HeadlessRunOptions {
  cwd: string;
  prompt: string;
  kind?: ChatKind;
  presetId?: string;
  model?: { provider: string; modelId: string };
  /** 整体超时（默认 30 分钟），超时强杀并按失败处理 */
  timeoutMs?: number;
}

export interface HeadlessRunResult {
  status: "ok" | "error";
  sessionFile?: string;
  error?: string;
}

/**
 * 不依赖任何窗口跑完一次 prompt：fork host → init → ready → prompt →
 * prompt_done / prompt_error → graceful shutdown。会话由 host 内的
 * SessionManager 正常落盘，事后可从会话列表打开查看。
 */
export function runHeadlessPrompt(options: HeadlessRunOptions): Promise<HeadlessRunResult> {
  const chatId = randomUUID();
  const proc = forkHost(chatId, options.cwd, "pi-task");
  headlessProcs.add(proc);

  return new Promise<HeadlessRunResult>((resolve) => {
    let sessionFile: string | undefined;
    let settled = false;

    const finish = (result: HeadlessRunResult, alreadyExited = false): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      headlessProcs.delete(proc);
      if (alreadyExited) {
        resolve({ sessionFile, ...result });
        return;
      }
      void gracefulKill(proc).then(() => resolve({ sessionFile, ...result }));
    };

    const timer = setTimeout(
      () => finish({ status: "error", error: mt("notify.unknownError") }),
      options.timeoutMs ?? 30 * 60 * 1000,
    );

    proc.on("message", (event: HostEvent) => {
      switch (event.type) {
        case "ready":
          sessionFile = event.snapshot.sessionFile;
          proc.postMessage({ type: "prompt", text: options.prompt } satisfies HostCommand);
          break;
        case "state":
          sessionFile = event.snapshot.sessionFile ?? sessionFile;
          break;
        // 无人值守：不加载项目本地扩展/技能，避免 init 卡在信任确认上
        case "trust_request":
          proc.postMessage({
            type: "trust_response",
            trusted: false,
            remember: false,
          } satisfies HostCommand);
          break;
        case "prompt_done":
          finish({ status: "ok" });
          break;
        case "prompt_error":
          finish({ status: "error", error: event.message });
          break;
        case "init_error":
        case "fatal":
          finish({ status: "error", error: event.message });
          break;
      }
    });

    proc.on("exit", (code) => {
      finish({ status: "error", error: mt("host.processExit", { code: String(code) }) }, true);
    });

    proc.postMessage({
      type: "init",
      chatId,
      cwd: options.cwd,
      kind: options.kind,
      presetId: options.presetId,
      model: options.model,
      locale: getConfig().locale,
    });
  });
}
