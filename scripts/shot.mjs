// Quick CDP helper: evaluate an optional JS expression, then screenshot.
// Usage: node scripts/shot.mjs <outfile.png> ["js expression"] [delayMs]
import { writeFileSync } from "node:fs";
import WebSocket from "ws";

const [, , outfile = "/tmp/shot.png", expr, delayArg] = process.argv;
const delay = Number(delayArg ?? 600);

const targets = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = targets.find((t) => t.type === "page");
if (!page) throw new Error("no page target");

const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise((r) => ws.on("open", r));
let msgId = 0;
const pending = new Map();
ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

if (expr) {
  const res = await send("Runtime.evaluate", { expression: expr, returnByValue: false });
  if (res.exceptionDetails) {
    console.error("eval error:", JSON.stringify(res.exceptionDetails).slice(0, 400));
  }
}
await new Promise((r) => setTimeout(r, delay));
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(outfile, Buffer.from(shot.data, "base64"));
console.log("saved", outfile);
ws.close();
