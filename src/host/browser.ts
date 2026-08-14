/**
 * browser 工具：用 CDP（puppeteer-core）驱动本机 Chrome。
 * 有头模式 + 独立 profile 目录——用户能看见 agent 在浏览器里做什么，
 * 也可以随时接管；登录态保存在 profile 里可跨会话复用。
 * 每个 chat（host 进程）一个浏览器实例，懒启动，会话结束时关闭。
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

type Browser = import("puppeteer-core").Browser;
type Page = import("puppeteer-core").Page;

let browser: Browser | undefined;
let page: Page | undefined;

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];

function findChrome(): string {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const found = CHROME_PATHS.find((p) => existsSync(p));
  if (!found) {
    throw new Error("未找到本机 Chrome / Chromium / Edge。可用 CHROME_PATH 环境变量指定路径。");
  }
  return found;
}

async function ensurePage(): Promise<Page> {
  if (page && !page.isClosed()) return page;
  if (!browser?.connected) {
    const puppeteer = (await import("puppeteer-core")).default;
    browser = await puppeteer.launch({
      executablePath: findChrome(),
      headless: false,
      defaultViewport: null, // 跟随真实窗口大小
      // 独立 profile：不碰用户日常的 Chrome 数据，但 agent 的登录态可复用
      userDataDir: join(homedir(), ".pi", "chrome-profile"),
      args: ["--no-first-run", "--no-default-browser-check", "--window-size=1280,860"],
    });
    browser.on("disconnected", () => {
      browser = undefined;
      page = undefined;
    });
  }
  const pages = await browser.pages();
  page = pages[0] ?? (await browser.newPage());
  return page;
}

export async function closeBrowser(): Promise<void> {
  try {
    await browser?.close();
  } catch {
    // already gone
  }
  browser = undefined;
  page = undefined;
}

/** 页面正文提取：优先 main/article，避免整页导航噪音。 */
async function readPageText(p: Page): Promise<string> {
  // host 进程没有 DOM 类型，页面内代码以字符串下发到浏览器执行
  const text = await p.evaluate(
    "(document.querySelector('main') ?? document.querySelector('article') ?? document.body).innerText",
  );
  return String(text ?? "");
}

export function buildBrowserTool(): ToolDefinition {
  return {
    name: "browser",
    label: "浏览器",
    description:
      "驱动本机 Chrome 浏览器（有头窗口，用户可见可接管，独立 profile）。action：goto（打开 URL，支持 http/https 与 file:// 本地文件）、read（提取当前页正文文本）、click（CSS 选择器或 x/y 坐标）、type（向选择器输入文本）、press（按键，如 Enter）、scroll（滚动，amount 为像素、负数向上）、screenshot（截图当前视口）、back（后退）、eval（在页面执行 JS 表达式并返回结果）。适合需要登录、交互或 JS 渲染的页面；纯内容抓取优先用 web_fetch。",
    promptSnippet: "browser: 驱动本机 Chrome（打开 URL 或 file:// 本地文件/点击/输入/截图/读正文）",
    parameters: Type.Object({
      action: Type.Union(
        [
          Type.Literal("goto"),
          Type.Literal("read"),
          Type.Literal("click"),
          Type.Literal("type"),
          Type.Literal("press"),
          Type.Literal("scroll"),
          Type.Literal("screenshot"),
          Type.Literal("back"),
          Type.Literal("eval"),
        ],
        { description: "浏览器动作" },
      ),
      url: Type.Optional(
        Type.String({ description: "goto: 目标 URL（http/https，或 file:///绝对路径 打开本地文件）" }),
      ),
      selector: Type.Optional(Type.String({ description: "click/type: CSS 选择器" })),
      x: Type.Optional(Type.Number({ description: "click: 坐标 x（无选择器时）" })),
      y: Type.Optional(Type.Number({ description: "click: 坐标 y（无选择器时）" })),
      text: Type.Optional(Type.String({ description: "type: 要输入的文本" })),
      key: Type.Optional(Type.String({ description: "press: 按键名，如 Enter、Tab、ArrowDown" })),
      amount: Type.Optional(Type.Number({ description: "scroll: 像素数，默认 600，负数向上" })),
      code: Type.Optional(Type.String({ description: "eval: JS 表达式（在页面上下文执行）" })),
    }),
    execute: async (_id, params) => {
      const p = params as Record<string, unknown>;
      const action = String(p.action);
      const pg = await ensurePage();
      const textResult = (text: string): { content: [{ type: "text"; text: string }]; details: Record<string, never> } => ({
        content: [{ type: "text", text }],
        details: {},
      });

      switch (action) {
        case "goto": {
          const url = String(p.url ?? "");
          if (!/^(https?|file):\/\//i.test(url)) {
            throw new Error("URL 必须以 http://、https:// 或 file:// 开头");
          }
          await pg.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
          const title = await pg.title();
          return textResult(`已打开 ${url}\n标题: ${title}\n可用 read 提取正文，或 screenshot 查看渲染结果。`);
        }
        case "read": {
          const text = await readPageText(pg);
          const sliced =
            text.length > 16_000 ? `${text.slice(0, 16_000)}\n…（截断，共 ${text.length} 字符）` : text;
          return textResult(`[${await pg.title()}] ${pg.url()}\n\n${sliced}`);
        }
        case "click": {
          if (p.selector) {
            await pg.click(String(p.selector));
            return textResult(`已点击 ${String(p.selector)}`);
          }
          if (typeof p.x === "number" && typeof p.y === "number") {
            await pg.mouse.click(p.x, p.y);
            return textResult(`已点击坐标 (${p.x}, ${p.y})`);
          }
          throw new Error("click 需要 selector 或 x/y 坐标");
        }
        case "type": {
          if (!p.selector) throw new Error("type 需要 selector");
          await pg.type(String(p.selector), String(p.text ?? ""));
          return textResult("已输入文本");
        }
        case "press":
          await pg.keyboard.press(String(p.key ?? "Enter") as never);
          return textResult(`已按 ${String(p.key ?? "Enter")}`);
        case "scroll": {
          const amount = typeof p.amount === "number" ? p.amount : 600;
          await pg.evaluate(`window.scrollBy(0, ${Number(amount)})`);
          return textResult(`已滚动 ${amount}px`);
        }
        case "screenshot": {
          const data = (await pg.screenshot({ type: "png", encoding: "base64" })) as string;
          return {
            content: [{ type: "image", data, mimeType: "image/png" }],
            details: { image: data, mimeType: "image/png" },
          } as never;
        }
        case "back":
          await pg.goBack({ waitUntil: "domcontentloaded" });
          return textResult(`已后退到 ${pg.url()}`);
        case "eval": {
          const result = await pg.evaluate(String(p.code ?? ""));
          const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
          return textResult((text ?? "undefined").slice(0, 8000));
        }
        default:
          throw new Error(`未知 action: ${action}`);
      }
    },
  };
}
