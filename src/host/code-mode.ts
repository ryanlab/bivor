/**
 * Code Mode（dsh Code runtime 思路）：模型写一段 JavaScript，在受控
 * 环境里一次性完成多步工具工作，省掉逐次 tool call 的模型往返。
 *
 * 沙箱边界：node:vm 隔离全局；唯一的外界通道是 pi.bash——它走与
 * unified bash 工具相同的执行世界（本机 / 云端 VM）和相同的护栏
 * 命令规则（deny / ask 审批照常生效）。
 */
import { createContext, runInContext } from "node:vm";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { enforceBashPolicy } from "./guardrails";
import { execBash } from "./execution-world";

const MAX_OUTPUT = 24_000;

export function buildCodeRunTool(): ToolDefinition {
  return {
    name: "code_run",
    label: "Code Mode",
    description:
      "运行一段 JavaScript 来批处理多步工作，避免逐次工具调用的往返。支持顶层 await。可用 API：await pi.bash(command, timeoutS?) 执行 shell（返回 { stdout, exitCode }，经护栏与当前执行世界）；pi.log(...) 记录输出。代码的返回值与 pi.log 输出会一并返回。适合：批量文件处理、多命令流水线、需要循环/条件的采集统计。",
    promptSnippet:
      "code_run: 写 JS 批处理多步 shell 工作（pi.bash / pi.log，顶层 await）",
    parameters: Type.Object({
      code: Type.String({ description: "JavaScript 代码（支持顶层 await）" }),
      timeout_s: Type.Optional(
        Type.Number({ description: "整体超时秒数，默认 120，最大 300" }),
      ),
    }),
    execute: async (_id, params, signal) => {
      const p = params as { code: string; timeout_s?: number };
      const timeoutMs = Math.min(Math.max(p.timeout_s ?? 120, 1), 300) * 1000;
      const logs: string[] = [];
      let outputSize = 0;
      const abort = new AbortController();
      if (signal) signal.addEventListener("abort", () => abort.abort(), { once: true });

      const record = (text: string): void => {
        if (outputSize >= MAX_OUTPUT) return;
        const chunk = text.slice(0, MAX_OUTPUT - outputSize);
        outputSize += chunk.length;
        logs.push(chunk);
      };

      const pi = {
        log: (...args: unknown[]): void => {
          record(
            args
              .map((a) => (typeof a === "string" ? a : JSON.stringify(a, null, 2)))
              .join(" "),
          );
        },
        bash: async (
          command: string,
          timeoutS?: number,
        ): Promise<{ stdout: string; exitCode: number | null }> => {
          if (typeof command !== "string" || !command.trim()) {
            throw new Error("pi.bash 需要非空命令字符串");
          }
          const policy = await enforceBashPolicy(command);
          if (!policy.ok) throw new Error(policy.reason);
          let stdout = "";
          const { exitCode } = await execBash(command, {
            onData: (data) => {
              if (stdout.length < MAX_OUTPUT) stdout += data.toString();
            },
            signal: abort.signal,
            timeout: Math.min(Math.max(timeoutS ?? 60, 1), 300) * 1000,
          });
          return { stdout, exitCode };
        },
      };

      const context = createContext({ pi, JSON, Math, Date, RegExp, Promise });
      const run = (async () => {
        // 包成 async IIFE 以支持顶层 await；返回值作为结果的一部分。
        return (await runInContext(`(async () => {\n${p.code}\n})()`, context, {
          timeout: 10_000, // 同步段超时；异步整体由外层 race 管
        })) as unknown;
      })();

      let result: unknown;
      let errorText: string | undefined;
      try {
        result = await Promise.race([
          run,
          new Promise((_, reject) => {
            const timer = setTimeout(() => {
              abort.abort();
              reject(new Error(`code_run 超时（${timeoutMs / 1000}s）`));
            }, timeoutMs);
            void run.finally(() => clearTimeout(timer)).catch(() => {});
          }),
        ]);
      } catch (err) {
        errorText = err instanceof Error ? err.message : String(err);
      }

      const parts = [
        logs.length > 0 && `[log]\n${logs.join("\n")}`,
        result !== undefined &&
          `[return]\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)?.slice(0, 8000)}`,
        errorText && `[error] ${errorText}`,
      ].filter(Boolean);
      return {
        content: [{ type: "text", text: parts.join("\n\n") || "（无输出）" }],
        details: {},
        ...(errorText ? { isError: true } : {}),
      } as never;
    },
  };
}
