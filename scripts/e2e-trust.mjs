// Verifies the project trust gate: opening a project with .pi resources and no
// stored decision blocks init on a TrustCard; answering resumes the session.
// Also persists "trust & remember" for /tmp/pi-e2e-project through the real UI
// flow so other e2e suites are not gated.
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
const C = (chatId) => `window.__store.getState().chats[${JSON.stringify(chatId)}]`;

async function openAndWaitTrust(cwd) {
  const chatId = await ev(`(async()=>{const s=window.__store.getState();
    await s.openChat({cwd:${JSON.stringify(cwd)}});
    const ids=Object.keys(window.__store.getState().chats);
    return ids[ids.length-1];})()`);
  for (let i = 0; i < 30; i++) {
    const st = await ev(
      `(()=>{const c=${C(chatId)}; return {status:c?.status, trust:!!c?.trustRequest}})()`,
    );
    if (st.trust || st.status === "ready") return { chatId, ...st };
    await sleep(400);
  }
  return { chatId, status: "timeout", trust: false };
}

async function waitReady(chatId) {
  for (let i = 0; i < 30; i++) {
    const st = await ev(`${C(chatId)}?.status`);
    if (st === "ready") return true;
    await sleep(400);
  }
  return false;
}

// ---- 1. fresh dir with .pi skill: trust card blocks init ----
const t1 = await openAndWaitTrust("/tmp/pi-trust-test");
assert(t1.trust, "trust request blocks init for untrusted project");
await sleep(400);
const cardVisible = await ev(`document.body.textContent.includes("是否信任这个项目")`);
assert(cardVisible, "trust card rendered");
await shot("trust-card");

// ---- 2. "仅本次信任" resumes init ----
await ev(`(()=>{window.__store.getState().respondTrust(${JSON.stringify(t1.chatId)}, true, false); return true})()`);
assert(await waitReady(t1.chatId), "session ready after session-only trust");
// skill actually loaded
await ev(`(()=>{window.__store.getState().requestHarness(${JSON.stringify(t1.chatId)}); return true})()`);
await sleep(1200);
const skills = await ev(`(${C(t1.chatId)}.harness?.skills??[]).map(s=>s.name)`);
assert(skills.includes("demo"), "project skill loaded after trust");
await ev(`(()=>{window.__store.getState().closeChat(${JSON.stringify(t1.chatId)}); return true})()`);
await sleep(600);

// ---- 3. session-only: a NEW chat prompts again ----
const t2 = await openAndWaitTrust("/tmp/pi-trust-test");
assert(t2.trust, "session-only trust does not persist");
await ev(`(()=>{window.__store.getState().respondTrust(${JSON.stringify(t2.chatId)}, false, false); return true})()`);
assert(await waitReady(t2.chatId), "session ready after declining trust");
await ev(`(()=>{window.__store.getState().requestHarness(${JSON.stringify(t2.chatId)}); return true})()`);
await sleep(1200);
const skills2 = await ev(`(${C(t2.chatId)}.harness?.skills??[]).map(s=>s.name)`);
assert(!skills2.includes("demo"), "declined trust: project skill NOT loaded");
await ev(`(()=>{window.__store.getState().closeChat(${JSON.stringify(t2.chatId)}); return true})()`);
await sleep(600);

// ---- 4. persist trust for the shared e2e project via the real UI flow ----
const t3 = await openAndWaitTrust("/tmp/pi-e2e-project");
if (t3.trust) {
  await ev(`(()=>{window.__store.getState().respondTrust(${JSON.stringify(t3.chatId)}, true, true); return true})()`);
  assert(await waitReady(t3.chatId), "e2e project trusted & remembered");
} else {
  console.log("skip: e2e project already trusted/ready");
}
await ev(`(()=>{window.__store.getState().closeChat(${JSON.stringify(t3.chatId)}); return true})()`);
await sleep(400);

// ---- 5. remembered: reopening does not prompt ----
const t4 = await openAndWaitTrust("/tmp/pi-e2e-project");
assert(!t4.trust && t4.status === "ready", "remembered trust skips prompt");
await ev(`(()=>{window.__store.getState().closeChat(${JSON.stringify(t4.chatId)}); return true})()`);

console.log("ALL TRUST CHECKS PASSED");
process.exit(0);
