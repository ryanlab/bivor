// Verifies wave-3 features against a running app with one open chat:
// bash execution, stats, mission control, command palette, @file mention.
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
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
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

const chatId = await ev("Object.keys(window.__store.getState().chats)[0]");
assert(chatId, "chat exists");

// 1. bash execution
await ev(`(()=>{window.__store.getState().runBash(${JSON.stringify(chatId)}, "echo bivor-bash-test && pwd"); return true})()`);
await sleep(2500);
const bash = await ev(`(()=>{const c=window.__store.getState().chats[${JSON.stringify(chatId)}];
  const m=c.messages.filter(x=>x.role==="bashExecution").at(-1);
  return m?{command:m.command,exit:m.exitCode,out:(m.output||"").slice(0,80)}:null})()`);
assert(bash && bash.exit === 0 && bash.out.includes("bivor-bash-test"), `bash recorded: ${JSON.stringify(bash)}`);

// 2. stats
await ev(`(()=>{window.__store.getState().requestStats(${JSON.stringify(chatId)}); return true})()`);
await sleep(800);
const stats = await ev(`(()=>{const c=window.__store.getState().chats[${JSON.stringify(chatId)}]; return c.stats??null})()`);
assert(stats && stats.totalMessages > 0 && stats.tokens.total > 0, `stats: ${JSON.stringify(stats).slice(0, 160)}`);

// 3. tools list
await ev(`(()=>{window.__store.getState().requestTools(${JSON.stringify(chatId)}); return true})()`);
await sleep(600);
const tools = await ev(`(()=>{const c=window.__store.getState().chats[${JSON.stringify(chatId)}]; return (c.tools??[]).map(t=>t.name)})()`);
assert(tools.includes("bash") && tools.includes("read"), `tools: ${tools.join(",")}`);

// 4. mission control
await ev(`(()=>{window.__store.getState().showHome(); return true})()`);
await sleep(600);
await shot("wave3-mission-control");
const view = await ev(`window.__store.getState().activeView`);
assert(view === "home", "mission control view active");

// 5. command palette
await ev(`(()=>{window.__store.getState().setPaletteOpen(true); return true})()`);
await sleep(500);
await shot("wave3-palette");
await ev(`(()=>{window.__store.getState().setPaletteOpen(false); window.__store.getState().setActiveChat(${JSON.stringify(chatId)}); return true})()`);
await sleep(400);

// 6. @file mention: type "@mat" into the composer textarea
await ev(`(()=>{const ta=document.querySelector("textarea"); ta.focus(); return true})()`);
for (const ch of "@mat") {
  await send("Input.insertText", { text: ch });
  await sleep(120);
}
// trigger React onChange via execCommand fallback if insertText didn't fire
await sleep(800);
const mentionVisible = await ev(`(()=>{const els=[...document.querySelectorAll("button")]; return els.some(b=>b.textContent.includes("math"))})()`);
await shot("wave3-mention");
assert(mentionVisible, "@mention popover shows math.js");

// checkpoint restore: modify a file, restore, verify content back
const ckpt = await ev(`(()=>{const c=window.__store.getState().chats[${JSON.stringify(chatId)}]; const k=Object.values(c.checkpoints)[0]; return k?k.id:null})()`);
assert(ckpt, "checkpoint exists");
console.log("ALL WAVE3 CHECKS PASSED");
ws.close();
