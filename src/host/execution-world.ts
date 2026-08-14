/**
 * 执行世界：bash / read / write / edit 是同一套工具名，IO 后端按会话的
 * 当前世界路由——local（本机文件系统与 shell）或 vm（E2B 云端沙箱）。
 *
 * 用 pi 官方的 Operations seam 实现（dsh 称为 capability seam）：
 * 工具的 schema、渲染、截断逻辑全部复用内建实现，只有最底层的
 * 文件读写与命令执行被替换。模型词表不变，护栏规则（按 bash 名字
 * 匹配的命令规则）在两个世界同样生效。
 */
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createLocalBashOperations,
  createReadToolDefinition,
  createWriteToolDefinition,
  type BashOperations,
  type EditOperations,
  type ReadOperations,
  type ToolDefinition,
  type WriteOperations,
} from "@earendil-works/pi-coding-agent";
import { ensureSandbox } from "./sandbox";
import { currentLocalSandboxMode, wrapLocalSandbox } from "./local-sandbox";
import {
  agentShellExec,
  isAgentShellBroken,
  resizeAgentShell,
  warmAgentShell,
  writeAgentShell,
} from "./agent-shell";

export type ExecutionWorld = "local" | "vm";

/** VM 内的工作目录：本机 cwd 下的相对路径映射到这里。 */
const VM_WORKSPACE = "/home/user/workspace";

let world: ExecutionWorld = "local";
let localCwd = process.cwd();
let notify: (world: ExecutionWorld) => void = () => {};
/** 每个沙箱只建一次 workspace 目录。 */
let workspaceReady: string | undefined;
/** 本机命令输出的旁路订阅（供 UI 终端视图实时展示，含 ANSI）。 */
let termNotify: (data: string) => void = () => {};

export function onLocalTermData(fn: (data: string) => void): void {
  termNotify = (data) => {
    try {
      fn(data);
    } catch {
      // 终端视图只是旁观者，绝不影响命令执行
    }
  };
}

// ---------- agent 命令 PTY（用户可接管交互） ----------

type PtyModule = typeof import("node-pty");
let ptyModule: PtyModule | null | undefined;
/** 正在跑的 agent 命令 PTY（用户键入路由到这里） */
let currentAgentPty: import("node-pty").IPty | undefined;
let agentTermSize = { cols: 100, rows: 30 };

async function loadPty(): Promise<PtyModule | null> {
  if (ptyModule === undefined) {
    try {
      ptyModule = await import("node-pty");
    } catch {
      ptyModule = null; // 原生模块不可用时降级为管道执行
    }
  }
  return ptyModule;
}

/**
 * 用户向 agent 终端键入：优先进常驻 agent shell（空闲时也能直接用
 * 这个 shell），降级模式下进正在跑的单命令 PTY。
 */
export function writeAgentTerm(data: string): void {
  if (writeAgentShell(data)) return;
  currentAgentPty?.write(data);
}

export function resizeAgentTerm(cols: number, rows: number): void {
  // xterm 在容器未完成布局时可能给出 NaN/0；PTY 要求正整数
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 2 || rows < 2) return;
  agentTermSize = { cols: Math.floor(cols), rows: Math.floor(rows) };
  resizeAgentShell(agentTermSize.cols, agentTermSize.rows);
  currentAgentPty?.resize(agentTermSize.cols, agentTermSize.rows);
}

/** 剥掉 ANSI 序列、归一回车——模型上下文只要纯文本，不要终端控制码。 */
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;
function cleanForModel(data: string): string {
  return data.replace(ANSI_RE, "").replaceAll("\r\n", "\n").replace(/\r+/g, "\n");
}

/** 在 PTY 里跑一条命令：输出原样进终端视图，清洗后进工具结果。 */
function execInPty(
  pty: PtyModule,
  command: string,
  cwd: string,
  options: { onData?: (data: Buffer) => void; signal?: AbortSignal; timeout?: number },
): Promise<{ exitCode: number | null }> {
  return new Promise((resolve) => {
    const proc = pty.spawn("/bin/sh", ["-c", command], {
      name: "xterm-256color",
      cwd,
      cols: agentTermSize.cols,
      rows: agentTermSize.rows,
      env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
    });
    currentAgentPty = proc;
    let settled = false;
    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      if (currentAgentPty === proc) currentAgentPty = undefined;
      if (timer) clearTimeout(timer);
      resolve({ exitCode });
    };
    const timer = options.timeout
      ? setTimeout(() => {
          proc.kill();
        }, options.timeout)
      : undefined;
    options.signal?.addEventListener("abort", () => proc.kill(), { once: true });
    proc.onData((data) => {
      termNotify(data);
      const cleaned = cleanForModel(data);
      if (cleaned) options.onData?.(Buffer.from(cleaned));
    });
    proc.onExit(({ exitCode }) => finish(exitCode ?? null));
  });
}

const agentShellHooks = {
  onRaw: (data: string) => termNotify(data),
  clean: cleanForModel,
};

/** 会话初始化时预热常驻 agent shell（提示符立即可见、用户可直接键入）。 */
export function warmLocalAgentShell(): void {
  if (process.platform !== "darwin") return;
  void loadPty().then((pty) => {
    if (pty && !isAgentShellBroken()) warmAgentShell(pty, localCwd, agentShellHooks);
  });
}

/**
 * 本机执行：首选把命令“敲”进常驻 agent shell（真实 zsh，终端里能看
 * 到提示符与回显，用户随时可接管/直接使用）。沙箱模式开启或 shell
 * 不可用时降级为每命令 PTY（带合成的 $ 命令头 / 退出码标注），
 * node-pty 也不可用时再降级为管道执行。
 */
async function execLocalTee(
  command: string,
  cwd: string,
  options: { onData?: (data: Buffer) => void; signal?: AbortSignal; timeout?: number },
): Promise<{ exitCode: number | null }> {
  const sandboxMode = currentLocalSandboxMode();
  const pty = await loadPty();

  // 常驻 shell 模式：沙箱关闭时的默认路径。命令回显由 shell 自己呈现。
  if (pty && process.platform === "darwin" && sandboxMode === "off" && !isAgentShellBroken()) {
    try {
      return await agentShellExec(pty, command, cwd, options, agentShellHooks);
    } catch {
      // shell 启动失败或中途报废：落回每命令 PTY
    }
  }

  const badge = sandboxMode === "off" ? "" : `\x1b[33m[sandbox:${sandboxMode}]\x1b[0m `;
  termNotify(`${badge}\x1b[2m$\x1b[0m \x1b[1m${command}\x1b[0m\r\n`);
  const wrapped = wrapLocalSandbox(command, cwd);
  const result = pty
    ? await execInPty(pty, wrapped, cwd, options)
    : await createLocalBashOperations().exec(wrapped, cwd, {
        ...options,
        onData: (data: Buffer) => {
          termNotify(data.toString("utf8"));
          options.onData?.(data);
        },
      });
  const code = result.exitCode;
  termNotify(code === 0 || code === null ? "\r\n" : `\x1b[31m[exit ${code}]\x1b[0m\r\n\r\n`);
  return result;
}

export function currentWorld(): ExecutionWorld {
  return world;
}

export function setWorld(next: ExecutionWorld): void {
  if (world === next) return;
  world = next;
  notify(world);
}

export function onWorldChange(fn: (world: ExecutionWorld) => void): void {
  notify = fn;
}

/** 本机绝对路径 → VM 路径：cwd 内的文件映射进 VM workspace，其余原样。 */
function mapToVmPath(absolutePath: string): string {
  if (absolutePath === localCwd) return VM_WORKSPACE;
  if (absolutePath.startsWith(`${localCwd}/`)) {
    return `${VM_WORKSPACE}/${absolutePath.slice(localCwd.length + 1)}`;
  }
  return absolutePath;
}

async function vmSandbox(): Promise<Awaited<ReturnType<typeof ensureSandbox>>> {
  const sb = await ensureSandbox();
  if (workspaceReady !== sb.sandboxId) {
    await sb.commands.run(`mkdir -p ${VM_WORKSPACE}`);
    workspaceReady = sb.sandboxId;
  }
  return sb;
}

/** 统一的 bash 执行入口：unified bash 工具与 code_run 共用。 */
export async function execBash(
  command: string,
  options: {
    onData?: (data: Buffer) => void;
    signal?: AbortSignal;
    timeout?: number;
  } = {},
): Promise<{ exitCode: number | null }> {
  if (world === "local") {
    return execLocalTee(command, localCwd, options);
  }
  const sb = await vmSandbox();
  try {
    const result = await sb.commands.run(command, {
      cwd: VM_WORKSPACE,
      timeoutMs: options.timeout ?? 120_000,
      onStdout: (data: string) => options.onData?.(Buffer.from(data)),
      onStderr: (data: string) => options.onData?.(Buffer.from(data)),
    });
    return { exitCode: result.exitCode };
  } catch (err) {
    // E2B 在非零退出码时抛错并携带输出；还原成 bash 工具期望的形式。
    const e = err as { stdout?: string; stderr?: string; exitCode?: number; message?: string };
    if (e.stdout) options.onData?.(Buffer.from(e.stdout));
    if (e.stderr) options.onData?.(Buffer.from(e.stderr));
    if (typeof e.exitCode === "number") return { exitCode: e.exitCode };
    options.onData?.(Buffer.from(`[error] ${e.message ?? String(err)}`));
    return { exitCode: 1 };
  }
}

/**
 * 世界路由的 bash 后端。除了 bash 工具本身，也供 host 的 `!命令`
 * 直跑复用——保证用户命令同样进终端视图、受沙箱管控、跟随执行世界。
 */
export const worldBashOperations: BashOperations = {
  exec: (command, cwd, options) => {
    if (world === "local") {
      return execLocalTee(command, cwd, options);
    }
    return execBash(command, options);
  },
};

async function vmReadFile(absolutePath: string): Promise<Buffer> {
  const sb = await vmSandbox();
  const bytes = await sb.files.read(mapToVmPath(absolutePath), { format: "bytes" });
  return Buffer.from(bytes);
}

async function vmWriteFile(absolutePath: string, content: string): Promise<void> {
  const sb = await vmSandbox();
  await sb.files.write(mapToVmPath(absolutePath), content);
}

async function vmAccess(absolutePath: string): Promise<void> {
  const sb = await vmSandbox();
  const p = mapToVmPath(absolutePath);
  const result = await sb.commands.run(`test -e ${JSON.stringify(p)} && echo ok || echo missing`);
  if (!result.stdout.includes("ok")) throw new Error(`VM 中不存在文件: ${p}`);
}

function localReadOps(): ReadOperations {
  return {
    readFile: async (p) => (await import("node:fs/promises")).readFile(p),
    access: async (p) => {
      const { access } = await import("node:fs/promises");
      await access(p);
    },
  };
}

const readOps: ReadOperations = {
  readFile: (p) => (world === "local" ? localReadOps().readFile(p) : vmReadFile(p)),
  access: (p) => (world === "local" ? localReadOps().access(p) : vmAccess(p)),
};

const writeOps: WriteOperations = {
  writeFile: async (p, content) => {
    if (world === "local") {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(p, content, "utf8");
      return;
    }
    await vmWriteFile(p, content);
  },
  mkdir: async (dir) => {
    if (world === "local") {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(dir, { recursive: true });
      return;
    }
    const sb = await vmSandbox();
    await sb.commands.run(`mkdir -p ${JSON.stringify(mapToVmPath(dir))}`);
  },
};

const editOps: EditOperations = {
  readFile: readOps.readFile,
  writeFile: writeOps.writeFile,
  access: readOps.access,
};

/**
 * 世界路由版 bash/read/write/edit。以 customTools 注册后按名覆盖内建
 * 工具（pi 的注册表后写者胜），schema 与渲染保持内建原样。
 */
export function buildWorldToolDefinitions(cwd: string): ToolDefinition[] {
  localCwd = cwd;
  return [
    createBashToolDefinition(cwd, { operations: worldBashOperations }) as unknown as ToolDefinition,
    createReadToolDefinition(cwd, { operations: readOps }) as unknown as ToolDefinition,
    createWriteToolDefinition(cwd, { operations: writeOps }) as unknown as ToolDefinition,
    createEditToolDefinition(cwd, { operations: editOps }) as unknown as ToolDefinition,
  ];
}
