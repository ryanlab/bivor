/**
 * E2B cloud VM per chat: the agent gets vm_gui / vm_screenshot tools and the
 * user gets a live desktop stream. Requires E2B_API_KEY (set in 设置 → 云端虚拟机（E2B）).
 */
import { appendFileSync } from "node:fs";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { SandboxStatusPayload } from "@shared/protocol";

const dlog = (msg: string): void => {
  try {
    appendFileSync("/tmp/pi-sandbox.log", `${new Date().toISOString()} [${process.pid}] ${msg}\n`);
  } catch {
    // ignore
  }
};

type DesktopSandbox = import("@e2b/desktop").Sandbox;

let sandbox: DesktopSandbox | undefined;
let creating: Promise<DesktopSandbox> | undefined;
let streamUrl: string | undefined;
/** Set while a destroy is requested, so an in-flight create kills itself. */
let destroyRequested = false;
let notify: (status: SandboxStatusPayload) => void = () => {};

export function onSandboxStatus(fn: (status: SandboxStatusPayload) => void): void {
  notify = (status) => {
    try {
      fn(status);
    } catch {
      // never let a renderer/IPC failure poison sandbox lifecycle
    }
  };
}

export function sandboxAvailable(): boolean {
  return Boolean(process.env.E2B_API_KEY);
}

function status(): SandboxStatusPayload {
  if (sandbox) return { status: "running", sandboxId: sandbox.sandboxId, streamUrl };
  if (creating) return { status: "creating" };
  return { status: "none" };
}

export function currentSandboxStatus(): SandboxStatusPayload {
  return status();
}

async function startStream(sb: DesktopSandbox): Promise<void> {
  if (streamUrl) return;
  try {
    dlog("startStream: starting VNC");
    await sb.stream.start();
    const url = sb.stream.getUrl({ autoConnect: true, viewOnly: false });
    streamUrl = typeof url === "string" ? url : String(url);
    dlog("startStream: ready");
    if (sandbox === sb) notify(status());
  } catch (err) {
    dlog(`startStream failed: ${err instanceof Error ? err.message : String(err)}`);
    streamUrl = undefined;
  }
}

export async function ensureSandbox(): Promise<DesktopSandbox> {
  if (sandbox) {
    if (!streamUrl) void startStream(sandbox);
    return sandbox;
  }
  if (sandbox) return sandbox;
  if (creating) return creating;
  destroyRequested = false;
  notify({ status: "creating" });
  creating = (async () => {
    dlog(`ensureSandbox: importing @e2b/desktop (key=${(process.env.E2B_API_KEY ?? "").slice(0, 8)}…)`);
    const { Sandbox } = await import("@e2b/desktop");
    dlog("ensureSandbox: imported, creating sandbox");
    const sb = await Sandbox.create({
      apiKey: process.env.E2B_API_KEY,
      timeoutMs: 20 * 60 * 1000, // auto-kill after 20min idle-ish lifetime
    });
    dlog(`ensureSandbox: created ${sb.sandboxId}`);
    return sb;
  })();
  try {
    const created = await creating;
    // A destroy arrived while we were still creating: kill immediately so the
    // cloud VM doesn't leak (and keep billing) after the user asked to stop.
    if (destroyRequested) {
      destroyRequested = false;
      try {
        await created.kill();
      } catch {
        // already gone
      }
      notify({ status: "none" });
      throw new Error("sandbox creation cancelled");
    }
    sandbox = created;
    notify(status());
    // VNC stream is optional (browser viewer). Don't block VM commands on it —
    // a hung stream.start() used to stall the whole host.
    void startStream(created);
    return sandbox;
  } catch (err) {
    if (!destroyRequested) {
      notify({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  } finally {
    creating = undefined;
  }
}

export async function destroySandbox(): Promise<void> {
  // If a create is still in-flight, flag it so ensureSandbox kills the result.
  if (creating && !sandbox) {
    destroyRequested = true;
    streamUrl = undefined;
    try {
      await creating;
    } catch {
      // ensureSandbox handled the kill
    }
    notify({ status: "none" });
    return;
  }
  const sb = sandbox;
  sandbox = undefined;
  streamUrl = undefined;
  if (sb) {
    try {
      await sb.kill();
    } catch {
      // already dead
    }
  }
  notify({ status: "none" });
}

/**
 * VM 专属能力工具（GUI 操作 / 截图 / 文件传输）。
 * 命令执行不再有独立的 vm_bash——统一的 bash 工具按执行世界路由
 * （见 execution-world.ts），模型词表里只有一个 bash。
 */
export function buildSandboxTools(): ToolDefinition[] {
  if (!sandboxAvailable()) return [];
  const vmGui: ToolDefinition = {
    name: "vm_gui",
    label: "VM GUI",
    description:
      "操作云端虚拟机的图形界面（computer use）。支持 action：open（打开 URL/文件，如启动浏览器）、click / double_click / right_click（坐标点击）、move（移动鼠标）、drag（拖拽）、type（输入文本）、key（按键或组合键，如 ctrl+l、Return）、scroll（滚动）。屏幕分辨率约 1024x768。操作后建议用 vm_screenshot 查看结果。",
    promptSnippet: "vm_gui: 操作云端 VM 的图形界面（点击/输入/按键/打开 URL）",
    parameters: Type.Object({
      action: Type.Union(
        [
          Type.Literal("open"),
          Type.Literal("click"),
          Type.Literal("double_click"),
          Type.Literal("right_click"),
          Type.Literal("move"),
          Type.Literal("drag"),
          Type.Literal("type"),
          Type.Literal("key"),
          Type.Literal("scroll"),
        ],
        { description: "GUI 动作类型" },
      ),
      target: Type.Optional(Type.String({ description: "open: URL 或文件路径" })),
      x: Type.Optional(Type.Number({ description: "click/move/drag 起点 x" })),
      y: Type.Optional(Type.Number({ description: "click/move/drag 起点 y" })),
      x2: Type.Optional(Type.Number({ description: "drag 终点 x" })),
      y2: Type.Optional(Type.Number({ description: "drag 终点 y" })),
      text: Type.Optional(Type.String({ description: "type: 要输入的文本" })),
      key: Type.Optional(
        Type.String({ description: "key: 按键名或组合键（+ 连接），如 Return、ctrl+l" }),
      ),
      direction: Type.Optional(
        Type.Union([Type.Literal("up"), Type.Literal("down")], { description: "scroll 方向" }),
      ),
      amount: Type.Optional(Type.Number({ description: "scroll 幅度，默认 3" })),
    }),
    execute: async (_id, params) => {
      const sb = await ensureSandbox();
      const p = params as Record<string, unknown>;
      const action = String(p.action);
      const x = typeof p.x === "number" ? p.x : undefined;
      const y = typeof p.y === "number" ? p.y : undefined;
      switch (action) {
        case "open":
          await sb.open(String(p.target ?? ""));
          break;
        case "click":
          await sb.leftClick(x, y);
          break;
        case "double_click":
          await sb.doubleClick(x, y);
          break;
        case "right_click":
          await sb.rightClick(x, y);
          break;
        case "move":
          await sb.moveMouse(x ?? 0, y ?? 0);
          break;
        case "drag":
          await sb.drag([x ?? 0, y ?? 0], [Number(p.x2 ?? 0), Number(p.y2 ?? 0)]);
          break;
        case "type":
          await sb.write(String(p.text ?? ""));
          break;
        case "key": {
          const raw = String(p.key ?? "");
          await sb.press(raw.includes("+") ? raw.split("+").map((s) => s.trim()) : raw);
          break;
        }
        case "scroll":
          await sb.scroll(
            (p.direction as "up" | "down") ?? "down",
            typeof p.amount === "number" ? p.amount : 3,
          );
          break;
        default:
          return {
            content: [{ type: "text", text: `未知 action: ${action}` }],
            details: {},
            isError: true,
          } as never;
      }
      return {
        content: [{ type: "text", text: `${action} 完成。可用 vm_screenshot 验证界面状态。` }],
        details: { action },
      };
    },
  };

  const vmFile: ToolDefinition = {
    name: "vm_file",
    label: "VM File",
    description:
      "在本机工作目录与云端虚拟机之间传输文件。action=upload 把本机文件传入 VM；action=download 把 VM 文件取回本机。本机路径相对当前工作目录解析。",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("upload"), Type.Literal("download")]),
      local_path: Type.String({ description: "本机文件路径（相对 cwd 或绝对路径）" }),
      vm_path: Type.String({ description: "VM 内文件路径，如 /home/user/data.csv" }),
    }),
    execute: async (_id, params) => {
      const sb = await ensureSandbox();
      const p = params as { action: string; local_path: string; vm_path: string };
      const { readFile, writeFile } = await import("node:fs/promises");
      const { resolve } = await import("node:path");
      const local = resolve(process.cwd(), p.local_path);
      if (p.action === "upload") {
        const data = await readFile(local);
        await sb.files.write(p.vm_path, new Uint8Array(data).buffer as ArrayBuffer);
        return {
          content: [{ type: "text", text: `已上传 ${local} → VM:${p.vm_path}（${data.length} 字节）` }],
          details: {},
        };
      }
      const bytes = await sb.files.read(p.vm_path, { format: "bytes" });
      await writeFile(local, Buffer.from(bytes));
      return {
        content: [{ type: "text", text: `已下载 VM:${p.vm_path} → ${local}（${bytes.length} 字节）` }],
        details: {},
      };
    },
  };

  const vmScreenshot: ToolDefinition = {
    name: "vm_screenshot",
    label: "VM Screenshot",
    description:
      "对云端虚拟机的桌面截图并返回图像。用于查看 GUI 程序的当前状态（如浏览器页面渲染结果）。",
    parameters: Type.Object({}),
    execute: async () => {
      const sb = await ensureSandbox();
      const bytes = await sb.screenshot();
      const data = Buffer.from(bytes).toString("base64");
      return {
        content: [
          {
            type: "image",
            data,
            mimeType: "image/png",
          },
        ],
        details: { image: data, mimeType: "image/png" },
      };
    },
  };

  return [vmGui, vmFile, vmScreenshot];
}
