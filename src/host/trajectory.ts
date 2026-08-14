/**
 * Trajectory 记录器：每一次模型请求（= 一步）在发出前快照装配——
 * 提示词片段来源、启用工具、注入技能、上下文用量——并跟踪该步触发的
 * 工具调用与最终用量。dsh 的核心不变量是"模型可见即已记录"；
 * 这里以步为粒度落到 UI 可回放的数据结构上。
 */
import type { TrajectoryStepPayload } from "@shared/protocol";

/** 步骤上限：只保留最近的这么多步，防止长会话内存与 IPC 膨胀。 */
const MAX_STEPS = 100;

type Assembly = Omit<
  TrajectoryStepPayload,
  "index" | "run" | "time" | "toolCalls" | "usage" | "status"
>;

export interface TrajectoryRecorder {
  readonly steps: TrajectoryStepPayload[];
  onSessionEvent(event: Record<string, unknown>): void;
}

export function createTrajectoryRecorder(deps: {
  /** 在模型请求发出时快照当前装配 */
  capture(): Assembly;
  emit(steps: TrajectoryStepPayload[]): void;
}): TrajectoryRecorder {
  const steps: TrajectoryStepPayload[] = [];
  let run = 0;
  let stepIndex = 0;
  let current: TrajectoryStepPayload | undefined;

  const finishCurrent = (): void => {
    if (!current) return;
    current.status = "done";
    current = undefined;
  };

  return {
    steps,

    onSessionEvent(event) {
      switch (event.type) {
        case "agent_start":
          run += 1;
          break;

        case "message_start": {
          const msg = event.message as { role?: string } | undefined;
          if (msg?.role !== "assistant") break;
          // 上一步在下一次请求开始时才算终结（工具结果在其后返回）。
          finishCurrent();
          current = {
            index: stepIndex++,
            run,
            time: Date.now(),
            toolCalls: [],
            status: "running",
            ...deps.capture(),
          };
          steps.push(current);
          if (steps.length > MAX_STEPS) steps.splice(0, steps.length - MAX_STEPS);
          deps.emit(steps);
          break;
        }

        case "message_end": {
          const msg = event.message as
            | {
                role?: string;
                usage?: { input?: number; output?: number; cost?: { total?: number } };
              }
            | undefined;
          if (msg?.role !== "assistant" || !current) break;
          if (msg.usage) {
            current.usage = {
              input: msg.usage.input ?? 0,
              output: msg.usage.output ?? 0,
              cost: msg.usage.cost?.total ?? 0,
            };
          }
          deps.emit(steps);
          break;
        }

        case "tool_execution_end": {
          if (!current) break;
          current.toolCalls.push({
            name: String(event.toolName ?? ""),
            isError: Boolean(event.isError),
          });
          deps.emit(steps);
          break;
        }

        case "agent_end":
          if (current) {
            finishCurrent();
            deps.emit(steps);
          }
          break;
      }
    },
  };
}
