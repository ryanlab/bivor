/**
 * 交互终端：用户可开任意多个常驻 PTY shell（node-pty），跑在 main
 * 进程，按 termId 索引、按 chatId 归组。与 agent 的命令终端相互
 * 独立——这是用户自己的 shell，输入输出经 IPC 直连 renderer 的
 * xterm。输出保留环形缓冲，面板关闭重开时回放。
 */
import { spawn, type IPty } from "node-pty";
import type { WebContents } from "electron";
import { IPC } from "@shared/protocol";

interface TermEntry {
  chatId: string;
  pty: IPty;
  webContents: WebContents;
  /** 回放缓冲（约 200KB） */
  backlog: string;
  exited: boolean;
}

const BACKLOG_LIMIT = 200_000;
const terms = new Map<string, TermEntry>();

function defaultShell(): string {
  if (process.platform === "win32") return "powershell.exe";
  return process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
}

/** POSIX 用 login shell 读齐用户配置；PowerShell 无对应参数。 */
function defaultShellArgs(): string[] {
  return process.platform === "win32" ? [] : ["-l"];
}

/** xterm 在容器未完成布局时可能给出 NaN/0；PTY 要求正整数。 */
function clampSize(cols: number, rows: number): { cols: number; rows: number } {
  return {
    cols: Number.isFinite(cols) && cols >= 2 ? Math.floor(cols) : 80,
    rows: Number.isFinite(rows) && rows >= 2 ? Math.floor(rows) : 24,
  };
}

/**
 * 创建（或重连）一个用户终端。已存在且存活时只更新 webContents
 * 并返回缓冲，让重新挂载的 xterm 恢复现场。
 */
export function createTerminal(
  webContents: WebContents,
  chatId: string,
  termId: string,
  cwd: string,
  cols: number,
  rows: number,
): { backlog: string } {
  const size = clampSize(cols, rows);
  const existing = terms.get(termId);
  if (existing && !existing.exited) {
    existing.webContents = webContents;
    existing.pty.resize(size.cols, size.rows);
    return { backlog: existing.backlog };
  }
  existing?.pty.kill();

  const pty = spawn(defaultShell(), defaultShellArgs(), {
    name: "xterm-256color",
    cwd,
    cols: size.cols,
    rows: size.rows,
    env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
  });
  const entry: TermEntry = { chatId, pty, webContents, backlog: "", exited: false };
  terms.set(termId, entry);

  pty.onData((data) => {
    entry.backlog = (entry.backlog + data).slice(-BACKLOG_LIMIT);
    if (!entry.webContents.isDestroyed()) {
      entry.webContents.send(IPC.termData, termId, data);
    }
  });
  pty.onExit(({ exitCode }) => {
    entry.exited = true;
    if (!entry.webContents.isDestroyed()) {
      entry.webContents.send(IPC.termExit, termId, exitCode);
    }
  });
  return { backlog: "" };
}

export function writeTerminal(termId: string, data: string): void {
  const entry = terms.get(termId);
  if (entry && !entry.exited) entry.pty.write(data);
}

export function resizeTerminal(termId: string, cols: number, rows: number): void {
  const entry = terms.get(termId);
  if (!entry || entry.exited) return;
  const size = clampSize(cols, rows);
  entry.pty.resize(size.cols, size.rows);
}

export function disposeTerminal(termId: string): void {
  const entry = terms.get(termId);
  if (!entry) return;
  terms.delete(termId);
  try {
    entry.pty.kill();
  } catch {
    // already dead
  }
}

/** chat 关闭时回收它名下的全部用户终端。 */
export function disposeChatTerminals(chatId: string): void {
  for (const [id, entry] of [...terms]) {
    if (entry.chatId === chatId) disposeTerminal(id);
  }
}

export function disposeAllTerminals(): void {
  for (const id of [...terms.keys()]) disposeTerminal(id);
}
