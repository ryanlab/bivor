/**
 * 欢迎页工作区云端 VM：不依赖会话 host，用户可以在开对话之前
 * 启动 / 预览 / 销毁 E2B 桌面。开始对话时由 renderer 主动销毁，
 * 避免和会话 host 各开一台重复计费。
 */
import type { WebContents } from "electron";
import { IPC, type SandboxStatusPayload } from "@shared/protocol";
import { getConfig } from "./config";

type DesktopSandbox = import("@e2b/desktop").Sandbox;

let sandbox: DesktopSandbox | undefined;
let creating: Promise<DesktopSandbox> | undefined;
let streamUrl: string | undefined;
let destroyRequested = false;
let sender: WebContents | undefined;

function available(): boolean {
  return Boolean(getConfig().e2bApiKey);
}

function status(): SandboxStatusPayload {
  if (sandbox) return { status: "running", sandboxId: sandbox.sandboxId, streamUrl };
  if (creating) return { status: "creating" };
  return { status: "none" };
}

function emit(next: SandboxStatusPayload): void {
  if (sender && !sender.isDestroyed()) {
    sender.send(IPC.workspaceSandboxEvent, next);
  }
}

function bind(wc: WebContents): void {
  sender = wc;
}

export function getWorkspaceSandbox(wc: WebContents): {
  configured: boolean;
  sandbox?: SandboxStatusPayload;
} {
  bind(wc);
  if (!available()) return { configured: false };
  return { configured: true, sandbox: status() };
}

async function startStream(sb: DesktopSandbox): Promise<void> {
  if (streamUrl) return;
  try {
    await sb.stream.start();
    const url = sb.stream.getUrl({ autoConnect: true, viewOnly: false });
    streamUrl = typeof url === "string" ? url : String(url);
    if (sandbox === sb) emit(status());
  } catch {
    streamUrl = undefined;
  }
}

export async function createWorkspaceSandbox(wc: WebContents): Promise<SandboxStatusPayload> {
  bind(wc);
  if (!available()) {
    const next = { status: "error" as const, message: "E2B API key missing" };
    emit(next);
    return next;
  }
  if (sandbox) {
    if (!streamUrl) void startStream(sandbox);
    return status();
  }
  if (creating) {
    try {
      await creating;
    } catch {
      // status already emitted
    }
    return status();
  }
  destroyRequested = false;
  emit({ status: "creating" });
  creating = (async () => {
    const { Sandbox } = await import("@e2b/desktop");
    return Sandbox.create({
      apiKey: getConfig().e2bApiKey,
      timeoutMs: 20 * 60 * 1000,
    });
  })();
  try {
    const created = await creating;
    if (destroyRequested) {
      destroyRequested = false;
      try {
        await created.kill();
      } catch {
        // already gone
      }
      emit({ status: "none" });
      return { status: "none" };
    }
    sandbox = created;
    emit(status());
    void startStream(created);
    return status();
  } catch (err) {
    const next: SandboxStatusPayload = {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
    if (!destroyRequested) emit(next);
    return next;
  } finally {
    creating = undefined;
  }
}

export async function destroyWorkspaceSandbox(): Promise<void> {
  if (creating && !sandbox) {
    destroyRequested = true;
    streamUrl = undefined;
    try {
      await creating;
    } catch {
      // create handler already killed
    }
    emit({ status: "none" });
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
  emit({ status: "none" });
}
