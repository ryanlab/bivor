// Verifies wave-7: expanded VM tools (vm_gui/vm_file registered), harness
// self-tune tool (harness_propose registered), model node switch + preset
// library in canvas, and session HTML export.
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

// enable sandbox key so vm tools register (provide via env: E2B_API_KEY=... node scripts/e2e-wave7.mjs)
const E2B_KEY = process.env.E2B_API_KEY;
if (!E2B_KEY) throw new Error("E2B_API_KEY env var is required for this test");
await ev(`window.pi.config.set({ e2bApiKey: ${JSON.stringify(E2B_KEY)} })`);

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

// ---- 1. expanded tools registered ----
await ev(`(()=>{window.__store.getState().requestTools(${JSON.stringify(chatId)}); return true})()`);
await sleep(800);
const tools = await ev(`(${C(chatId)}.tools??[]).map(t=>t.name)`);
for (const t of ["vm_bash", "vm_gui", "vm_file", "vm_screenshot", "harness_propose"]) {
  assert(tools.includes(t), `tool registered: ${t}`);
}

// ---- 2. harness canvas: preset save/apply + model node clickable ----
await ev(`(()=>{window.__store.getState().setHarnessOpen(${JSON.stringify(chatId)}, true); return true})()`);
await sleep(1400);
// model node is a clickable button
const modelClickable = await ev(`(()=>{const n=[...document.querySelectorAll(".react-flow__node")].find(n=>n.textContent.includes("点击切换")); return !!n})()`);
assert(modelClickable, "model node shows switch affordance");
await ev(`(()=>{const n=[...document.querySelectorAll(".react-flow__node")].find(n=>n.textContent.includes("点击切换")); n.querySelector("button").click(); return true})()`);
await sleep(500);
const pickerOpen = await ev(`!!document.querySelector('input[placeholder="搜索模型…"]')`);
assert(pickerOpen, "model picker opens from node");
await ev(`(()=>{document.body.click(); return true})()`);
await sleep(200);

// disable a skill, save as preset, clear, re-apply
const firstSkill = await ev(`${C(chatId)}.harness.skills[0]?.name ?? null`);
if (firstSkill) {
  await ev(`(()=>{window.__store.getState().applyHarness(${JSON.stringify(chatId)}, {disabledSkills:[${JSON.stringify(firstSkill)}], disabledExtensions:[], extraSystemPrompt:"PRESET_MARKER"}); return true})()`);
  for (let i = 0; i < 20; i++) { if (!(await ev(`${C(chatId)}.harnessBusy`))) break; await sleep(500); }
  await ev(`(()=>{return window.__store.getState().saveHarnessPreset(${JSON.stringify(chatId)}, "e2e-preset")})()`);
  let presets = await ev(`window.__store.getState().harnessPresets.map(p=>p.name)`);
  assert(presets.includes("e2e-preset"), "preset saved to config");
  // reset harness
  await ev(`(()=>{window.__store.getState().applyHarness(${JSON.stringify(chatId)}, {disabledSkills:[], disabledExtensions:[], extraSystemPrompt:""}); return true})()`);
  for (let i = 0; i < 20; i++) { if (!(await ev(`${C(chatId)}.harnessBusy`))) break; await sleep(500); }
  // apply preset back
  await ev(`(()=>{const s=window.__store.getState(); const p=s.harnessPresets.find(x=>x.name==="e2e-preset"); s.applyHarnessPreset(${JSON.stringify(chatId)}, p); return true})()`);
  for (let i = 0; i < 20; i++) { if (!(await ev(`${C(chatId)}.harnessBusy`))) break; await sleep(500); }
  const h = await ev(`${C(chatId)}.harness`);
  assert(h.extraSystemPrompt === "PRESET_MARKER" && h.skills.find(s=>s.name===firstSkill)?.disabled, "preset re-applied (skill off + extra prompt)");
  await shot("wave7-canvas-presets");
  // cleanup preset + reset
  await ev(`(()=>{return window.__store.getState().deleteHarnessPreset("e2e-preset")})()`);
  await ev(`(()=>{window.__store.getState().applyHarness(${JSON.stringify(chatId)}, {disabledSkills:[], disabledExtensions:[], extraSystemPrompt:""}); return true})()`);
  await sleep(2000);
}
await ev(`(()=>{window.__store.getState().setHarnessOpen(${JSON.stringify(chatId)}, false); return true})()`);

// ---- 3. session HTML export ----
await ev(`(()=>{window.__store.getState().sendPrompt(${JSON.stringify(chatId)}, "只回复「导出测试」四个字。"); return true})()`);
for (let i = 0; i < 60; i++) { if (!(await ev(`${C(chatId)}.isStreaming`))) break; await sleep(1000); }
let exportedPath = null;
await ev(`(()=>{window.pi.chat.command(${JSON.stringify(chatId)}, {type:"export_html"}); return true})()`);
for (let i = 0; i < 20; i++) {
  exportedPath = await ev(`${C(chatId)}.lastExportPath ?? null`);
  if (exportedPath) break;
  await sleep(500);
}
assert(exportedPath && exportedPath.endsWith(".html"), `session exported to HTML: ${exportedPath}`);

await ev(`(()=>{window.__store.getState().closeChat(${JSON.stringify(chatId)}); return true})()`);
console.log("ALL WAVE7 CHECKS PASSED");
ws.close();
