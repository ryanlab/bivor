/**
 * 本机命令沙箱：用 macOS sandbox-exec（seatbelt）包装 agent 在本机
 * 执行的 shell 命令。
 *
 * - workspace：文件写入只允许工作区与临时目录（读不限制，网络放行）
 * - strict：在 workspace 基础上再禁全部网络
 *
 * 只包命令执行这一层：read/write/edit 工具的文件 IO 走 host 进程内
 * 实现，由护栏（工具策略 / 审批）治理，不经过这里。
 */
import { realpathSync } from "node:fs";

export type { LocalSandboxMode } from "@shared/protocol";
import type { LocalSandboxMode } from "@shared/protocol";

let mode: LocalSandboxMode = "off";
let notify: (mode: LocalSandboxMode) => void = () => {};

export function localSandboxSupported(): boolean {
  return process.platform === "darwin";
}

export function currentLocalSandboxMode(): LocalSandboxMode {
  return mode;
}

export function setLocalSandboxMode(next: LocalSandboxMode): void {
  if (!localSandboxSupported()) next = "off";
  if (mode === next) return;
  mode = next;
  notify(mode);
}

export function onLocalSandboxChange(fn: (mode: LocalSandboxMode) => void): void {
  notify = fn;
}

/** POSIX shell 单引号转义 */
function shq(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

/** seatbelt profile 里的字符串字面量（路径不应含引号，防御性转义） */
function sbq(s: string): string {
  return `"${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** 生成 seatbelt profile：默认放行，写入白名单制，strict 再禁网络。 */
function buildProfile(cwd: string, denyNetwork: boolean): string {
  const writable = new Set<string>([real(cwd), "/tmp", "/private/tmp", "/dev"]);
  const tmpdir = process.env.TMPDIR;
  if (tmpdir) writable.add(real(tmpdir.replace(/\/$/, "")));
  // macOS 的进程临时目录都在 /var/folders 下（TMPDIR 只是其中一个子目录）
  writable.add("/private/var/folders");

  const lines = [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* ${[...writable].map((p) => `(subpath ${sbq(p)})`).join(" ")})`,
  ];
  if (denyNetwork) lines.push("(deny network*)");
  return lines.join(" ");
}

/**
 * 按当前模式包装命令。off（或非 macOS）原样返回；
 * 否则整条命令交给 sandbox-exec 下的 /bin/sh -c 执行。
 */
export function wrapLocalSandbox(command: string, cwd: string): string {
  if (mode === "off" || !localSandboxSupported()) return command;
  const profile = buildProfile(cwd, mode === "strict");
  return `sandbox-exec -p ${shq(profile)} /bin/sh -c ${shq(command)}`;
}
