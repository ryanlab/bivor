// Real-model test of the self-tune loop: agent calls harness_propose,
// user approves, change hot-applies after the run ends.
import { writeFileSync } from "node:fs";
import WebSocket from "ws";

const targets = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise((r) => ws.on("open", r));
let id = 0;
const pend = new Map();
ws.on("message", (d) => {
  const m = JSON.parse(d);
  if (m.id && pend.has(m.id)) {
    const { resolve, reject } = pend.get(m.id);
    pend.delete(m.id);
    m.error ? reject(new Error(m.error.message)) : resolve(m.result);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    pend.set(++id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  const s = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`/tmp/${name}.png`, Buffer.from(s.data, "base64"));
  console.log("shot:", `/tmp/${name}.png`);
};
const assert = (cond, label) => {
  if (!cond) throw new Error(`ASSERT FAILED: ${label}`);
  console.log("ok:", label);
};

const CWD = "/tmp/pi-e2e-project";
const C = (chatId) => `window.__store.getState().chats[${JSON.stringify(chatId)}]`;

const chatId = await ev(`(async()=>{const s=window.__store.getState();
  await s.openChat({cwd:${JSON.stringify(CWD)}});
  const ids=Object.keys(window.__store.getState().chats);
  return ids[ids.length-1];})()`);
for (let i = 0; i < 40; i++) {
  const st = await ev(`${C(chatId)}?.status`);
  if (st === "ready") break;
  await sleep(500);
}
console.log("chat ready:", chatId);

await ev(`(()=>{window.__store.getState().sendPrompt(${JSON.stringify(chatId)}, "调用 harness_propose 工具，参数：reason 填「端到端测试自调优」，extra_system_prompt 填「SELF_TUNE_OK」。得到结果后简短复述工具的返回内容。"); return true})()`);

// wait approval card
let approval = null;
for (let i = 0; i < 60; i++) {
  const arr = await ev(`${C(chatId)}.pendingApprovals`);
  if (arr.length > 0) { approval = arr[0]; break; }
  await sleep(1000);
}
assert(approval && approval.toolName === "harness_propose", `self-tune approval requested: ${JSON.stringify(approval?.input).slice(0, 100)}`);
await sleep(400);
await shot("selftune-approval");
await ev(`(()=>{window.__store.getState().respondApproval(${JSON.stringify(chatId)}, ${JSON.stringify(approval.id)}, true); return true})()`);

// wait run end + hot apply
for (let i = 0; i < 90; i++) { if (!(await ev(`${C(chatId)}.isStreaming`))) break; await sleep(1000); }
await sleep(3000); // reload after agent_end
await ev(`(()=>{window.__store.getState().requestHarness(${JSON.stringify(chatId)}); return true})()`);
await sleep(1500);
const h = await ev(`${C(chatId)}.harness`);
assert(h.extraSystemPrompt === "SELF_TUNE_OK", `self-tune applied after run: extra="${h.extraSystemPrompt}"`);
assert(h.systemPrompt.text.includes("SELF_TUNE_OK"), "live system prompt contains self-tuned instruction");

// reset
await ev(`(()=>{window.__store.getState().applyHarness(${JSON.stringify(chatId)}, {disabledSkills:[], disabledExtensions:[], extraSystemPrompt:""}); return true})()`);
await sleep(2000);
await ev(`(()=>{window.__store.getState().closeChat(${JSON.stringify(chatId)}); return true})()`);
console.log("SELF-TUNE LOOP VERIFIED");
ws.close();
