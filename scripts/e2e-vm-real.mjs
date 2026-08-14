// Real E2B key in-app test: agent invokes vm_bash for real, panel streams desktop.
import { writeFileSync } from "node:fs";
import WebSocket from "ws";

const KEY = process.env.E2B_TEST_KEY;
if (!KEY) throw new Error("E2B_TEST_KEY required");

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

await ev(`window.pi.config.set({ e2bApiKey: ${JSON.stringify(KEY)} })`);
const chatId = await ev(`(async()=>{const s=window.__store.getState();
  await s.openChat({cwd:${JSON.stringify(CWD)}});
  const ids=Object.keys(window.__store.getState().chats);
  return ids[ids.length-1];})()`);
for (let i = 0; i < 40; i++) {
  const st = await ev(`window.__store.getState().chats[${JSON.stringify(chatId)}]?.status`);
  if (st === "ready") break;
  await sleep(500);
}
console.log("chat ready:", chatId);

// open sandbox panel + manual create
await ev(`(()=>{const s=window.__store.getState(); s.setSandboxOpen(${JSON.stringify(chatId)}, true); s.createSandbox(${JSON.stringify(chatId)}); return true})()`);
let sb = null;
for (let i = 0; i < 60; i++) {
  sb = await ev(`window.__store.getState().chats[${JSON.stringify(chatId)}].sandbox ?? null`);
  if (sb && (sb.status === "running" || sb.status === "error")) break;
  await sleep(1000);
}
assert(sb?.status === "running", `sandbox running: ${JSON.stringify(sb).slice(0, 120)}`);
assert(sb.streamUrl?.includes("e2b.app"), `stream url: ${sb.streamUrl.slice(0, 60)}...`);
await sleep(3500); // let noVNC iframe connect
await shot("vm-real-panel");

// agent actually uses vm_bash
await ev(`(()=>{window.__store.getState().sendPrompt(${JSON.stringify(chatId)}, "用 vm_bash 工具在虚拟机里执行: echo VM_AGENT_$(hostname) && cat /etc/os-release | head -2。只报告输出，不要做别的。"); return true})()`);
let done = false;
for (let i = 0; i < 90; i++) {
  const st = await ev(`(()=>{const c=window.__store.getState().chats[${JSON.stringify(chatId)}]; return {streaming:c.isStreaming, n:c.messages.length}})()`);
  if (!st.streaming && st.n >= 2) { done = true; break; }
  await sleep(1000);
}
assert(done, "agent turn finished");
const usedVm = await ev(`(()=>{const c=window.__store.getState().chats[${JSON.stringify(chatId)}];
  return JSON.stringify(c.messages).includes("vm_bash") && JSON.stringify(c.messages).includes("VM_AGENT_");})()`);
assert(usedVm, "agent called vm_bash and got VM output");
await shot("vm-real-agent");

// cleanup VM (keep key for user testing)
await ev(`(()=>{window.__store.getState().destroySandbox(${JSON.stringify(chatId)}); return true})()`);
await sleep(2000);
console.log("ALL REAL-VM CHECKS PASSED");
ws.close();
