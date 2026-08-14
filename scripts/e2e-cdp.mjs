/* CDP driver for real-UI E2E testing of the running dev app. */
import { writeFileSync } from "node:fs";
import WebSocket from "ws";

const PORT = 9223;

async function getPageWs() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const pages = await res.json();
  const page = pages.find((p) => p.type === "page");
  if (!page) throw new Error("no page target");
  return page.webSocketDebuggerUrl;
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout: ${method}`));
        }
      }, 30000);
    });
  }
  async eval(expression, awaitPromise = true) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error("eval failed: " + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    }
    return r.result?.value;
  }
  async screenshot(path) {
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path, Buffer.from(r.data, "base64"));
    console.log("screenshot:", path);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const wsUrl = await getPageWs();
  const ws = new WebSocket(wsUrl, { maxPayload: 256 * 1024 * 1024 });
  await new Promise((resolve) => ws.on("open", resolve));
  const cdp = new Cdp(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  const step = process.argv[2] ?? "full";

  if (step === "full") {
    // 1. Open the test project via store action
    console.log("step: open project");
    await cdp.eval(`window.__store.getState().openProject("/tmp/pi-e2e-project")`);
    await sleep(500);

    // 2. Start a new chat
    console.log("step: open chat");
    await cdp.eval(`void window.__store.getState().openChat({ cwd: "/tmp/pi-e2e-project" }); true`, false);
    await sleep(1000);
    // wait until ready
    for (let i = 0; i < 40; i++) {
      const status = await cdp.eval(
        `(() => { const s = window.__store.getState(); const c = s.chats[s.activeChatId]; return c ? c.status + ":" + (c.model ? c.model.id : "no-model") : "none"; })()`,
      );
      console.log("chat status:", status);
      if (status.startsWith("ready")) break;
      if (status.startsWith("error")) {
        const err = await cdp.eval(
          `(() => { const s = window.__store.getState(); return s.chats[s.activeChatId].error; })()`,
        );
        throw new Error("chat init failed: " + err);
      }
      await sleep(500);
    }
    await cdp.screenshot("/tmp/e2e-1-ready.png");

    // 3. Send a prompt that exercises tools
    console.log("step: send prompt");
    const prompt = process.argv[3] ?? "读取 math.js，然后在文件末尾加一个 subtract 函数。";
    await cdp.eval(
      `(() => { const s = window.__store.getState(); s.sendPrompt(s.activeChatId, ${JSON.stringify(prompt)}); })()`,
      false,
    );

    // 4. Poll until streaming completes
    for (let i = 0; i < 240; i++) {
      const state = await cdp.eval(
        `(() => { const s = window.__store.getState(); const c = s.chats[s.activeChatId]; return JSON.stringify({ streaming: c.isStreaming, msgs: c.messages.length, err: c.lastError }); })()`,
      );
      const parsed = JSON.parse(state);
      if (i % 10 === 0) console.log("poll:", state);
      if (parsed.err) throw new Error("prompt error: " + parsed.err);
      if (!parsed.streaming && parsed.msgs > 1) break;
      await sleep(1000);
    }
    await sleep(500);
    await cdp.screenshot("/tmp/e2e-2-done.png");

    // 5. Dump final state summary
    const summary = await cdp.eval(
      `(() => {
        const s = window.__store.getState();
        const c = s.chats[s.activeChatId];
        return JSON.stringify({
          model: c.model?.id,
          messages: c.messages.map((m) => ({
            role: m.role,
            kinds: Array.isArray(m.content) ? m.content.map((b) => b.type) : typeof m.content,
            tool: m.toolName,
          })),
        }, null, 2);
      })()`,
    );
    console.log("summary:", summary);

    // 6. Open the changes panel and screenshot it
    await cdp.eval(
      `(() => { const btn = document.querySelector('button[title="文件变更"]'); if (btn) btn.click(); return !!btn; })()`,
      false,
    );
    await sleep(500);
    await cdp.screenshot("/tmp/e2e-3-changes.png");
  }

  if (step === "shot") {
    await cdp.screenshot(process.argv[3] ?? "/tmp/e2e-shot.png");
  }

  ws.close();
}

main().catch((err) => {
  console.error("E2E FAILED:", err.message);
  process.exit(1);
});
