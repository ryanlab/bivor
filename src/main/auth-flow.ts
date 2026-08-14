/**
 * Desktop OAuth login flows. Bridges pi's AuthInteraction (prompt/notify
 * callbacks) to the renderer over IPC, and opens auth URLs in the system
 * browser.
 */
import { randomUUID } from "node:crypto";
import { shell, type WebContents } from "electron";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { IPC, type AuthFlowEvent } from "@shared/protocol";

interface ActiveFlow {
  abort: AbortController;
  pendingPrompts: Map<string, { resolve: (value: string) => void; reject: (err: Error) => void }>;
  sender: WebContents;
}

const flows = new Map<string, ActiveFlow>();

function emit(flow: ActiveFlow, event: AuthFlowEvent): void {
  if (!flow.sender.isDestroyed()) {
    flow.sender.send(IPC.authFlowEvent, event);
  }
}

export function startLogin(
  sender: WebContents,
  getRuntime: () => Promise<ModelRuntime>,
  providerId: string,
): string {
  const flowId = randomUUID();
  const flow: ActiveFlow = {
    abort: new AbortController(),
    pendingPrompts: new Map(),
    sender,
  };
  flows.set(flowId, flow);

  void (async () => {
    try {
      const runtime = await getRuntime();
      await runtime.login(providerId, "oauth", {
        signal: flow.abort.signal,
        prompt: (p) => {
          const promptId = randomUUID();
          return new Promise<string>((resolve, reject) => {
            flow.pendingPrompts.set(promptId, { resolve, reject });
            p.signal?.addEventListener("abort", () => {
              if (flow.pendingPrompts.delete(promptId)) {
                reject(new Error("prompt cancelled"));
              }
            });
            emit(flow, {
              flowId,
              kind: "prompt",
              promptId,
              prompt: {
                type: p.type,
                message: p.message,
                placeholder: "placeholder" in p ? p.placeholder : undefined,
                options:
                  p.type === "select"
                    ? p.options.map((o) => ({
                        id: o.id,
                        label: o.label,
                        description: o.description,
                      }))
                    : undefined,
              },
            });
          });
        },
        notify: (event) => {
          if (event.type === "auth_url") {
            void shell.openExternal(event.url);
            emit(flow, { flowId, kind: "auth_url", url: event.url, instructions: event.instructions });
          } else if (event.type === "device_code") {
            emit(flow, {
              flowId,
              kind: "device_code",
              userCode: event.userCode,
              verificationUri: event.verificationUri,
            });
          } else if (event.type === "info") {
            emit(flow, {
              flowId,
              kind: "info",
              message: event.message,
              links: event.links?.map((l) => ({ url: l.url, label: l.label })),
            });
          } else if (event.type === "progress") {
            emit(flow, { flowId, kind: "progress", message: event.message });
          }
        },
      });
      emit(flow, { flowId, kind: "done" });
    } catch (err) {
      emit(flow, {
        flowId,
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      // Settle any prompts still awaiting user input so nothing hangs forever
      // if login failed (or completed) while a prompt was outstanding.
      for (const [, pending] of flow.pendingPrompts) {
        pending.reject(new Error("login flow ended"));
      }
      flow.pendingPrompts.clear();
      flows.delete(flowId);
    }
  })();

  return flowId;
}

export function respondToPrompt(flowId: string, promptId: string, value: string): void {
  const flow = flows.get(flowId);
  const pending = flow?.pendingPrompts.get(promptId);
  if (flow && pending) {
    flow.pendingPrompts.delete(promptId);
    pending.resolve(value);
  }
}

export function cancelLogin(flowId: string): void {
  const flow = flows.get(flowId);
  if (!flow) return;
  for (const [, pending] of flow.pendingPrompts) {
    pending.reject(new Error("login cancelled"));
  }
  flow.pendingPrompts.clear();
  flow.abort.abort();
}
