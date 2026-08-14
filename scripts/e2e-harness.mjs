// Verifies wave-4: resources (packages/skills/mcp IPC) and harness studio
// (get_harness, set_harness hot-reload with skill toggle + extra system prompt).
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
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
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

// ---- 0. clean leftovers from previous (crashed) runs ----
await ev(`(async()=>{
  const all = await window.pi.resources.listSkills(${JSON.stringify(CWD)});
  const stale = all.find((s) => s.name === "e2e-demo-skill");
  if (stale) await window.pi.resources.deleteSkill(${JSON.stringify(CWD)}, stale.filePath);
  return true;})()`);

// ---- 1. resources IPC: skills create/list/read/delete ----
const created = await ev(`window.pi.resources.createSkill("project", ${JSON.stringify(CWD)}, "e2e-demo-skill", "e2e 测试技能：永远不要真的用")`);
assert(created.includes("e2e-demo-skill"), `skill created: ${created}`);
const skills = await ev(`window.pi.resources.listSkills(${JSON.stringify(CWD)})`);
assert(skills.some((s) => s.name === "e2e-demo-skill"), `skills list contains new skill (${skills.length} total)`);
const content = await ev(`window.pi.resources.readSkill(${JSON.stringify(CWD)}, ${JSON.stringify(created)})`);
assert(content.includes("e2e-demo-skill"), "skill content readable");

// ---- 2. packages IPC ----
const pkgs = await ev(`window.pi.resources.listPackages(${JSON.stringify(CWD)})`);
assert(Array.isArray(pkgs), `packages list ok (${pkgs.length} configured)`);

// ---- 3. mcp IPC ----
const mcp = await ev(`window.pi.resources.readMcp(${JSON.stringify(CWD)})`);
assert(typeof mcp.adapterInstalled === "boolean" && mcp.globalPath.endsWith("mcp.json"), `mcp info: adapter=${mcp.adapterInstalled}`);

// ---- 4. open a chat and fetch harness ----
await ev(`(()=>{const s=window.__store.getState(); if(s.activeProjectPath!==${JSON.stringify(CWD)}) return s.openProject?.(${JSON.stringify(CWD)}); return true})()`).catch(() => {});
// Always open a FRESH chat: reused chats may predate the skill created above,
// and their harness snapshot would not include it.
const chatId = await ev(`(async()=>{const s=window.__store.getState();
  const before=new Set(Object.keys(s.chats));
  await s.openChat({cwd:${JSON.stringify(CWD)}});
  return Object.keys(window.__store.getState().chats).find((k)=>!before.has(k));})()`);
assert(chatId, `chat open: ${chatId}`);
// wait ready
for (let i = 0; i < 30; i++) {
  const st = await ev(`window.__store.getState().chats[${JSON.stringify(chatId)}]?.status`);
  if (st === "ready") break;
  await sleep(500);
}
await ev(`(()=>{window.__store.getState().setHarnessOpen(${JSON.stringify(chatId)}, true); return true})()`);
await sleep(1200);
let harness = await ev(`window.__store.getState().chats[${JSON.stringify(chatId)}].harness ?? null`);
assert(harness && harness.systemPrompt.chars > 100, `harness loaded: sysprompt ${harness.systemPrompt.chars} chars, ${harness.skills.length} skills, ${harness.tools.length} tools`);
assert(harness.skills.some((s) => s.name === "e2e-demo-skill"), "harness sees project skill");
await shot("wave4-harness");

// ---- 5. orchestrate: disable the skill + add extra system prompt, hot reload ----
await ev(`(()=>{window.__store.getState().applyHarness(${JSON.stringify(chatId)}, {
  disabledSkills: ["e2e-demo-skill"],
  disabledExtensions: [],
  extraSystemPrompt: "E2E_EXTRA_PROMPT_MARKER: 所有回复以中文书写。",
}); return true})()`);
for (let i = 0; i < 20; i++) {
  const busy = await ev(`window.__store.getState().chats[${JSON.stringify(chatId)}].harnessBusy`);
  if (!busy) break;
  await sleep(500);
}
harness = await ev(`window.__store.getState().chats[${JSON.stringify(chatId)}].harness`);
const skillEntry = harness.skills.find((s) => s.name === "e2e-demo-skill");
assert(skillEntry && skillEntry.disabled, "skill toggled off after reload");
assert(harness.extraSystemPrompt.includes("E2E_EXTRA_PROMPT_MARKER"), "extra prompt persisted");
assert(harness.systemPrompt.text.includes("E2E_EXTRA_PROMPT_MARKER"), "extra prompt live in system prompt");
assert(!harness.systemPrompt.text.includes("e2e-demo-skill"), "disabled skill removed from system prompt");
await shot("wave4-harness-applied");

// ---- 6. re-enable, cleanup skill ----
await ev(`(()=>{window.__store.getState().applyHarness(${JSON.stringify(chatId)}, {disabledSkills:[],disabledExtensions:[],extraSystemPrompt:""}); return true})()`);
await sleep(2500);
harness = await ev(`window.__store.getState().chats[${JSON.stringify(chatId)}].harness`);
assert(harness.systemPrompt.text.includes("e2e-demo-skill"), "skill back in system prompt after re-enable");
await ev(`window.pi.resources.deleteSkill(${JSON.stringify(CWD)}, ${JSON.stringify(created)})`);
const after = await ev(`window.pi.resources.listSkills(${JSON.stringify(CWD)})`);
assert(!after.some((s) => s.name === "e2e-demo-skill"), "skill deleted");

// ---- 7. resources dialog screenshot ----
await ev(`(()=>{window.__store.getState().setResourcesOpen(true); return true})()`);
await sleep(700);
await shot("wave4-resources");
await ev(`(()=>{window.__store.getState().setResourcesOpen(false); return true})()`);

console.log("ALL WAVE4 CHECKS PASSED");
ws.close();
