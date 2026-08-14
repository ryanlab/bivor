// Verifies the project long-term memory system: memory_save tool registered,
// memory read/write IPC, memory injected into a fresh session's system prompt,
// and the 项目记忆 tab in the resources dialog.
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
const MARK = `E2E_MEMORY_${Date.now()}`;

// ---- 1. memory IPC write + read roundtrip ----
await ev(
  `window.pi.resources.saveMemory(${JSON.stringify(CWD)}, ${JSON.stringify(`# 项目记忆\n\n- 【约定】${MARK}\n`)})`,
);
const read = await ev(`window.pi.resources.readMemory(${JSON.stringify(CWD)})`);
assert(read.content.includes(MARK), "memory IPC write/read roundtrip");
assert(read.path.endsWith(".pi/memory.md"), "memory stored at .pi/memory.md");

// ---- 2. fresh session: memory_save tool registered + memory in system prompt ----
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

await ev(`(()=>{window.__store.getState().requestTools(${JSON.stringify(chatId)}); return true})()`);
await sleep(800);
const tools = await ev(`(${C(chatId)}.tools??[]).map(t=>t.name)`);
assert(tools.includes("memory_save"), "memory_save tool registered");

await ev(`(()=>{window.__store.getState().requestHarness(${JSON.stringify(chatId)}); return true})()`);
await sleep(1200);
const sys = await ev(`${C(chatId)}.harness?.systemPrompt?.text ?? ""`);
assert(sys.includes(MARK), "memory injected into system prompt");
assert(sys.includes("项目长期记忆"), "memory section header present");

// ---- 3. resources dialog memory tab (reads the active project's memory) ----
const prevProject = await ev(`window.__store.getState().activeProjectPath`);
// Force a fresh mount in case a previous (failed) run left the dialog open.
await ev(`(()=>{window.__store.getState().setResourcesOpen(false); return true})()`);
await sleep(300);
await ev(`(()=>{window.__store.setState({activeProjectPath:${JSON.stringify(CWD)}}); return true})()`);
await ev(`(()=>{window.__store.getState().setResourcesOpen(true); return true})()`);
await sleep(500);
await ev(`(()=>{[...document.querySelectorAll("button")].find(b=>b.textContent.includes("项目记忆"))?.click(); return true})()`);
await sleep(700);
const tabShows = await ev(`[...document.querySelectorAll("textarea")].some(t=>t.value.includes(${JSON.stringify(MARK)}))`);
assert(tabShows, "memory tab shows saved content");
await shot("memory-tab");
await ev(`(()=>{window.__store.getState().setResourcesOpen(false); return true})()`);
await ev(`(()=>{window.__store.setState({activeProjectPath:${JSON.stringify(prevProject)}}); return true})()`);

// ---- 4. clearing memory deletes the file ----
await ev(`window.pi.resources.saveMemory(${JSON.stringify(CWD)}, "")`);
const read2 = await ev(`window.pi.resources.readMemory(${JSON.stringify(CWD)})`);
assert(read2.content === "", "clearing memory removes file");

await ev(`(()=>{window.__store.getState().closeChat(${JSON.stringify(chatId)}); return true})()`);
console.log("ALL MEMORY CHECKS PASSED");
process.exit(0);
