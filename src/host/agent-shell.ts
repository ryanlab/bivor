/**
 * 常驻 agent shell：一个真实的交互式 zsh（PTY），agent 的本机命令像
 * 用户敲键盘一样打进去执行——终端里能看到真实提示符与命令回显，
 * 空闲时用户也可以直接在这个 shell 里操作（cd/export 会保留给后续
 * agent 命令，与 Cursor 的共享终端一致）。
 *
 * 输出捕获用 shell 集成钩子（VS Code shell integration 思路）：
 * 通过 ZDOTDIR 垫片给 zsh 注入 preexec/precmd，命令开始/结束时打出
 * 不可见的 OSC 标记（xterm 会忽略未知 OSC），host 解析标记界定
 * 每条命令的输出区间与退出码。任何一步失败都会把 shell 标记为
 * broken，调用方降级到每命令 PTY 模式。
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type PtyModule = typeof import("node-pty");
type IPty = import("node-pty").IPty;

/** OSC 标记：B = 命令开始（preexec），E;<code> = 命令结束（precmd） */
const MARK_PREFIX = "\x1b]6969;";
const MARK_BEGIN = `${MARK_PREFIX}B\x07`;
const MARK_END_PREFIX = `${MARK_PREFIX}E;`;
const BEL = "\x07";
/** 运行中输出的留尾长度：防止标记序列被 chunk 边界劈开 */
const TAIL_GUARD = 48;

const ZSHRC_SHIM = `
[ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc"
preexec() { printf '\\033]6969;B\\007' }
precmd() { printf '\\033]6969;E;%s\\007' $? }
`;

interface PendingCommand {
  phase: "sent" | "running";
  onData?: (data: Buffer) => void;
  resolve: (exitCode: number | null) => void;
  cleanup: () => void;
}

let pty: IPty | undefined;
let broken = false;
let readyPromise: Promise<void> | undefined;
let pending: PendingCommand | undefined;
/** 命令串行队列（bash 工具与 ! 直跑共用一个 shell） */
let chain: Promise<unknown> = Promise.resolve();
/** 标记扫描缓冲（只在等待标记时积累） */
let scan = "";
let waitingReady: (() => void) | undefined;
let onRaw: (data: string) => void = () => {};
let cleanFn: (data: string) => string = (d) => d;
let size = { cols: 100, rows: 30 };

export function isAgentShellBroken(): boolean {
  return broken;
}

/** 用户键入 / 空闲操作都直接写进常驻 shell。 */
export function writeAgentShell(data: string): boolean {
  if (!pty || broken) return false;
  pty.write(data);
  return true;
}

export function resizeAgentShell(cols: number, rows: number): void {
  size = { cols, rows };
  try {
    pty?.resize(cols, rows);
  } catch {
    // ignore
  }
}

function markBroken(): void {
  broken = true;
  const p = pending;
  pending = undefined;
  p?.cleanup();
  p?.resolve(null);
  try {
    pty?.kill();
  } catch {
    // already dead
  }
  pty = undefined;
}

function handleData(raw: string): void {
  onRaw(raw);
  if (!pending && !waitingReady) return;
  scan += raw;

  if (waitingReady) {
    const idx = scan.indexOf(MARK_END_PREFIX);
    if (idx >= 0) {
      const bel = scan.indexOf(BEL, idx);
      if (bel >= 0) {
        scan = scan.slice(bel + 1);
        const done = waitingReady;
        waitingReady = undefined;
        done();
      }
    }
    return;
  }

  const p = pending;
  if (!p) return;

  if (p.phase === "sent") {
    const idx = scan.indexOf(MARK_BEGIN);
    if (idx < 0) return;
    scan = scan.slice(idx + MARK_BEGIN.length);
    p.phase = "running";
  }

  if (p.phase === "running") {
    const idx = scan.indexOf(MARK_END_PREFIX);
    if (idx >= 0) {
      const bel = scan.indexOf(BEL, idx);
      if (bel < 0) return; // 结束标记还没到齐，等下一个 chunk
      const body = scan.slice(0, idx);
      const codeStr = scan.slice(idx + MARK_END_PREFIX.length, bel);
      scan = scan.slice(bel + 1);
      const cleaned = cleanFn(body);
      if (cleaned) p.onData?.(Buffer.from(cleaned));
      const exitCode = Number.parseInt(codeStr, 10);
      pending = undefined;
      p.cleanup();
      p.resolve(Number.isFinite(exitCode) ? exitCode : null);
      return;
    }
    // 流式转发已确定不含标记的部分，留尾防劈
    if (scan.length > TAIL_GUARD) {
      const emit = scan.slice(0, -TAIL_GUARD);
      scan = scan.slice(-TAIL_GUARD);
      const cleaned = cleanFn(emit);
      if (cleaned) p.onData?.(Buffer.from(cleaned));
    }
  }
}

/** 首次使用时启动 shell 并等第一个提示符（precmd 标记）出现。 */
function ensureShell(
  ptyModule: PtyModule,
  cwd: string,
  hooks: { onRaw: (data: string) => void; clean: (data: string) => string },
): Promise<void> {
  onRaw = hooks.onRaw;
  cleanFn = hooks.clean;
  if (broken) return Promise.reject(new Error("agent shell broken"));
  if (readyPromise) return readyPromise;

  readyPromise = new Promise<void>((resolve, reject) => {
    let settled = false;
    const shimDir = mkdtempSync(join(tmpdir(), "pi-agent-shell-"));
    writeFileSync(join(shimDir, ".zshrc"), ZSHRC_SHIM);
    writeFileSync(join(shimDir, ".zshenv"), '[ -f "$HOME/.zshenv" ] && source "$HOME/.zshenv"\n');
    writeFileSync(
      join(shimDir, ".zprofile"),
      '[ -f "$HOME/.zprofile" ] && source "$HOME/.zprofile"\n',
    );

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      markBroken();
      reject(new Error("agent shell start timeout"));
    }, 15_000);

    try {
      pty = ptyModule.spawn("/bin/zsh", ["-i"], {
        name: "xterm-256color",
        cwd,
        cols: size.cols,
        rows: size.rows,
        env: {
          ...process.env,
          TERM: "xterm-256color",
          ZDOTDIR: shimDir,
        } as Record<string, string>,
      });
    } catch (err) {
      clearTimeout(timer);
      settled = true;
      broken = true;
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    waitingReady = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    pty.onData(handleData);
    pty.onExit(() => {
      // shell 意外退出：正在跑的命令按失败结算，后续调用降级
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        markBroken();
        reject(new Error("agent shell exited"));
        return;
      }
      markBroken();
    });
  });
  return readyPromise;
}

/** 预热：会话启动就拉起 shell，让用户在 agent 跑命令之前就能使用。 */
export function warmAgentShell(
  ptyModule: PtyModule,
  cwd: string,
  hooks: { onRaw: (data: string) => void; clean: (data: string) => string },
): void {
  void ensureShell(ptyModule, cwd, hooks).catch(() => undefined);
}

/** 含换行的命令没法当一行敲进 shell，base64 包一层。 */
function asTypeable(command: string): string {
  if (!command.includes("\n")) return command;
  const b64 = Buffer.from(command, "utf8").toString("base64");
  return `eval "$(printf %s ${b64} | base64 -D)"`;
}

/**
 * 在常驻 shell 里执行一条命令。输出（B/E 标记之间、经 clean 清洗）
 * 流式回调给工具结果；返回退出码。超时或中止先发 Ctrl+C，命令仍
 * 不结束则杀掉 shell（标记 broken，后续降级）。
 */
export function agentShellExec(
  ptyModule: PtyModule,
  command: string,
  cwd: string,
  options: { onData?: (data: Buffer) => void; signal?: AbortSignal; timeout?: number },
  hooks: { onRaw: (data: string) => void; clean: (data: string) => string },
): Promise<{ exitCode: number | null }> {
  const run = async (): Promise<{ exitCode: number | null }> => {
    await ensureShell(ptyModule, cwd, hooks);
    const shell = pty;
    if (!shell || broken) throw new Error("agent shell unavailable");

    return new Promise<{ exitCode: number | null }>((resolve) => {
      let interruptTimer: ReturnType<typeof setTimeout> | undefined;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const interrupt = (): void => {
        shell.write("\x03");
        // Ctrl+C 后命令仍不退出：整个 shell 报废，避免卡死工具调用
        killTimer = setTimeout(() => markBroken(), 5_000);
      };
      const cleanup = (): void => {
        if (interruptTimer) clearTimeout(interruptTimer);
        if (killTimer) clearTimeout(killTimer);
        options.signal?.removeEventListener("abort", interrupt);
      };
      if (options.timeout) interruptTimer = setTimeout(interrupt, options.timeout);
      options.signal?.addEventListener("abort", interrupt, { once: true });

      scan = "";
      pending = {
        phase: "sent",
        onData: options.onData,
        resolve: (code) => resolve({ exitCode: code }),
        cleanup,
      };
      shell.write(`${asTypeable(command)}\r`);
    });
  };
  const result = chain.then(run, run);
  chain = result.catch(() => undefined);
  return result;
}
