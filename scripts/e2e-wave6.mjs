// Verifies wave-6: Harness governance layer (policy gate inline extension):
// deny blocks tool, ask pauses for human approval, budget stops execution,
// canvas gate node + guardrails drawer render.
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

const waitIdle = async (maxS = 90) => {
  for (let i = 0; i < maxS; i++) {
    const st = await ev(`(()=>{const c=${C(chatId)}; return c.isStreaming})()`);
    if (!st) return;
    await sleep(1000);
  }
  throw new Error("agent did not finish");
};

// ---- 1. deny: bash 完全禁止 ----
await ev(`(()=>{window.__store.getState().applyGuardrails(${JSON.stringify(chatId)}, {
  toolPolicies: { bash: "deny" }, commandRules: [] }); return true})()`);
await sleep(500);
const g1 = await ev(`${C(chatId)}.guardrails`);
assert(g1?.toolPolicies?.bash === "deny", "guardrails set: bash=deny");
await ev(`(()=>{window.__store.getState().sendPrompt(${JSON.stringify(chatId)}, "用 bash 工具运行 echo DENY_TEST。如果工具被拒绝，直接回复「已被策略拦截」四个字并停止。"); return true})()`);
await waitIdle();
let evts = await ev(`${C(chatId)}.policyEvents`);
assert(evts.some((e) => e.kind === "blocked" && e.toolName === "bash"), `deny blocked bash (${evts.length} events)`);

// ---- 2. ask: 命令规则触发人工审批，批准后放行 ----
await ev(`(()=>{window.__store.getState().applyGuardrails(${JSON.stringify(chatId)}, {
  toolPolicies: {}, commandRules: [{ pattern: "ASK_MARKER", action: "ask", note: "e2e 审批测试" }] }); return true})()`);
await sleep(500);
await ev(`(()=>{window.__store.getState().sendPrompt(${JSON.stringify(chatId)}, "用 bash 工具运行 echo ASK_MARKER_ok，然后报告输出。"); return true})()`);
let approval = null;
for (let i = 0; i < 60; i++) {
  const arr = await ev(`${C(chatId)}.pendingApprovals`);
  if (arr.length > 0) { approval = arr[0]; break; }
  await sleep(1000);
}
assert(approval && approval.toolName === "bash", `approval requested: ${JSON.stringify(approval?.input).slice(0, 80)}`);
await sleep(400);
await shot("wave6-approval");
await ev(`(()=>{window.__store.getState().respondApproval(${JSON.stringify(chatId)}, ${JSON.stringify(approval.id)}, true); return true})()`);
await waitIdle();
const msgs = await ev(`JSON.stringify(${C(chatId)}.messages)`);
assert(msgs.includes("ASK_MARKER_ok"), "approved command actually executed");
evts = await ev(`${C(chatId)}.policyEvents`);
assert(evts.some((e) => e.kind === "approved"), "approved event recorded");

// ---- 3. budget: 每次任务最多 1 次工具调用 ----
await ev(`(()=>{window.__store.getState().applyGuardrails(${JSON.stringify(chatId)}, {
  toolPolicies: {}, commandRules: [], maxToolCallsPerPrompt: 1 }); return true})()`);
await sleep(500);
await ev(`(()=>{window.__store.getState().sendPrompt(${JSON.stringify(chatId)}, "请依次执行两个独立的 bash 调用：第一次 echo BUDGET_A，第二次 echo BUDGET_B。必须分开两次调用。"); return true})()`);
await waitIdle(120);
evts = await ev(`${C(chatId)}.policyEvents`);
assert(evts.some((e) => e.kind === "budget_stop"), `budget stop triggered (${evts.map((e) => e.kind).join(",")})`);

// ---- 4. 画布治理门 + 抽屉 ----
await ev(`(()=>{window.__store.getState().setHarnessOpen(${JSON.stringify(chatId)}, true); return true})()`);
await sleep(1500);
const gateExists = await ev(`[...document.querySelectorAll(".react-flow__node")].some(n=>n.textContent.includes("治理门"))`);
assert(gateExists, "gate node rendered on canvas");
await ev(`(()=>{const n=[...document.querySelectorAll(".react-flow__node")].find(n=>n.textContent.includes("治理门")); n.querySelector("button").click(); return true})()`);
await sleep(600);
const drawerOk = await ev(`document.body.textContent.includes("Harness 治理") && document.body.textContent.includes("预算约束")`);
assert(drawerOk, "guardrails drawer opens from gate node");
await shot("wave6-canvas-gate");
await ev(`(()=>{window.__store.getState().setHarnessOpen(${JSON.stringify(chatId)}, false); return true})()`);

// ---- cleanup ----
await ev(`(()=>{window.__store.getState().applyGuardrails(${JSON.stringify(chatId)}, { toolPolicies: {}, commandRules: [] }); return true})()`);
await sleep(300);
await ev(`(()=>{window.__store.getState().closeChat(${JSON.stringify(chatId)}); return true})()`);

console.log("ALL WAVE6 CHECKS PASSED");
ws.close();
