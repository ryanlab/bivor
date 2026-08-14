/* One-shot SDK smoke test: verifies the same code path the app's host uses. */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";

// Load API keys from ~/.env.local without printing them
const envLocal = readFileSync(join(homedir(), ".env.local"), "utf8");
const providerArg = process.argv[2] ?? "openai";
const ENV_NAMES = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  groq: "GROQ_API_KEY",
  xai: "XAI_API_KEY",
  mistral: "MISTRAL_API_KEY",
};
const envName = ENV_NAMES[providerArg];
if (envName) {
  const match = envLocal.match(new RegExp(`^${envName}=(.+)$`, "m"));
  if (!match) {
    console.error(`no ${envName} in ~/.env.local`);
    process.exit(1);
  }
  process.env[envName] = match[1].trim().replace(/^["']|["']$/g, "");
}

const modelRuntime = await ModelRuntime.create();
const models = modelRuntime.getModels(providerArg);
const preferred = ["mini", "haiku", "flash", "chat"];
const model =
  models.find((m) => preferred.some((p) => m.id.includes(p))) ?? models[0];
console.log("using model:", model?.provider, model?.id);

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  modelRuntime,
  model,
  tools: ["read", "ls"],
});

let text = "";
session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    text += event.assistantMessageEvent.delta;
  }
  if (event.type === "tool_execution_start") {
    console.log("tool:", event.toolName, JSON.stringify(event.args).slice(0, 120));
  }
  if (event.type === "message_end") {
    const m = event.message;
    if (m.role === "assistant") {
      console.log("[message_end]", m.stopReason, m.errorMessage ?? "");
    }
  }
  if (event.type === "agent_end") {
    console.log("[agent_end] willRetry=", event.willRetry, "messages=", event.messages.length);
  }
});

await session.prompt("列出当前目录的文件，然后用一句话告诉我这是什么项目。");
console.log("\n--- assistant ---\n" + text.trim());
session.dispose();
process.exit(0);
