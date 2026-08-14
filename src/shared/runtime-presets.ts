/**
 * 运行时 Preset：具名的 agent 装配（对标 dsh 的 profile / agent preset）。
 * 一份 preset 声明四件事：提示词叠层、工具策略、UI 表面、护栏叠层。
 * host 与 renderer 读同一张表，行为与界面永远一致——不再在代码里
 * 散落 if (daily) 的特判。
 */
import type { ChatKind, HarnessGuardrails } from "./protocol";
import type { Locale } from "./i18n";

export type PresetToolPolicy =
  | { mode: "all" }
  | { mode: "deny"; names: string[] }
  | { mode: "allow"; names: string[] };

/** Renderer 功能门：preset 决定聊天界面露出哪些编排面板与输入能力。 */
export interface RuntimePresetUi {
  /** 文件变更面板 */
  changes: boolean;
  /** 会话树 / 分支 */
  tree: boolean;
  /** 云端沙箱 VM */
  sandbox: boolean;
  /** Harness 画布 */
  harness: boolean;
  /** @ 文件引用 */
  fileMention: boolean;
  /** !command 直跑 shell */
  bashBang: boolean;
  /** /斜杠命令（模板 / 技能） */
  slash: boolean;
  /** Composer 工具开关浮层 */
  toolsPopover: boolean;
}

export interface RuntimePresetDef {
  id: string;
  name: string;
  /** 一句话说明（Welcome 选择器提示） */
  description: string;
  /** daily = 无需项目目录；project = 需要工作区 */
  workspace: "daily" | "project";
  /** 追加到系统提示末尾的 preset 指令段 */
  appendSystemPrompt?: string;
  /** 对全部工具（内建 + 自带 + 扩展）的启用策略 */
  tools: PresetToolPolicy;
  /** 桌面自带 custom tools 的注册白名单；"all" = 全部注册 */
  customTools: "all" | string[];
  ui: RuntimePresetUi;
  /** 初始化时叠加的护栏（用户之后仍可修改） */
  guardrails?: HarnessGuardrails;
  /**
   * 工具渐进披露：在册工具超过阈值时收起长尾（扩展 / MCP）工具，
   * 模型用 tool_search / tool_activate 按需取用。
   */
  toolDisclosure?: { threshold: number };
  /** Composer 底部的提示语 */
  composerHint: string;
}

export const DAILY_SYSTEM_PROMPT = `你是日常助手，不是编程 agent。

你的职责是对话、写作、翻译、总结、问答、头脑风暴和轻量规划。
用简洁自然的中文回复，除非用户使用其他语言。

不要主动读写项目文件、运行终端、操作 git 或修改代码。
如果用户明确要求写代码，给出代码片段即可，不要假设有项目工作区，也不要声称正在执行文件操作或命令。
需要实时信息（新闻、文档、价格、天气等）时，用 web_search 搜索、web_fetch 阅读页面。`;

const DAILY_SYSTEM_PROMPT_EN = `You are a daily assistant, not a coding agent.

Your job is conversation, writing, translation, summaries, Q&A, brainstorming, and light planning.
Reply in concise natural English unless the user writes in another language.

Do not read or write project files, run a terminal, use git, or change code on your own.
If the user explicitly asks for code, give a snippet — do not assume a project workspace, and do not claim you are running file operations or commands.
When you need live information (news, docs, prices, weather), use web_search and web_fetch.`;

const REVIEW_SYSTEM_PROMPT = `当前是只读审查模式。

你只能阅读、检索和分析代码，绝不能修改文件、执行 shell 命令或产生任何副作用。
你的产出是分析、审查意见和建议——发现问题时给出精确的文件与行号引用，
并说明修复思路，但不要尝试实施修复。如果用户要求改代码，提醒他们切换到编程模式。`;

const REVIEW_SYSTEM_PROMPT_EN = `This is read-only review mode.

You may only read, search, and analyze code. Never modify files, run shell commands, or cause side effects.
Your output is analysis, review comments, and suggestions — cite exact files and line numbers when you find issues,
and explain how to fix them, but do not attempt the fix. If the user asks you to change code, tell them to switch to coding mode.`;

const MINIMAL_SYSTEM_PROMPT = `当前是最小装配模式：只有 bash、read 和 edit 三个工具。

优先用最直接的命令完成任务，不要假设有其他工具可用。保持输出简短。`;

const MINIMAL_SYSTEM_PROMPT_EN = `This is the minimal setup: only bash, read, and edit.

Prefer the most direct commands. Do not assume other tools exist. Keep output short.`;

const PRESET_I18N: Record<string, { en: { name: string; description: string; composerHint: string; appendSystemPrompt?: string } }> = {
  daily: {
    en: {
      name: "Daily",
      description: "Chat, writing, translation, summaries — no side effects",
      composerHint: "The daily assistant will not read project files or run commands",
      appendSystemPrompt: DAILY_SYSTEM_PROMPT_EN,
    },
  },
  coding: {
    en: {
      name: "Coding",
      description: "Full coding agent: files, terminal, subagents, sandbox, deploy",
      composerHint: "The pi agent can run commands and edit files — use it in trusted projects",
    },
  },
  review: {
    en: {
      name: "Review",
      description: "Read and search only — good for code review and security analysis",
      composerHint: "Read-only review: can read and search, cannot edit files or run commands",
      appendSystemPrompt: REVIEW_SYSTEM_PROMPT_EN,
    },
  },
  minimal: {
    en: {
      name: "Minimal",
      description: "Only bash + read + edit — good for benchmarks and light tasks",
      composerHint: "Minimal setup: bash and file read/edit only, no skills or extensions",
      appendSystemPrompt: MINIMAL_SYSTEM_PROMPT_EN,
    },
  },
};

/** 编程 agent 的全部内建 + 桌面工具（日常模式的黑名单） */
const CODING_TOOL_NAMES = [
  "read",
  "write",
  "edit",
  "bash",
  "grep",
  "find",
  "ls",
  "vm_gui",
  "vm_file",
  "vm_screenshot",
  "subagent_run",
  "harness_propose",
  "code_run",
  "tool_search",
  "tool_activate",
  // 驱动本机 Chrome 属于有副作用的操作，日常模式不开放（web_search/web_fetch 开放）
  "browser",
  "deploy",
];

const FULL_UI: RuntimePresetUi = {
  changes: true,
  tree: true,
  sandbox: true,
  harness: true,
  fileMention: true,
  bashBang: true,
  slash: true,
  toolsPopover: true,
};

export const RUNTIME_PRESETS: RuntimePresetDef[] = [
  {
    id: "daily",
    name: "日常",
    description: "聊天、写作、翻译、总结，无工具副作用",
    workspace: "daily",
    appendSystemPrompt: DAILY_SYSTEM_PROMPT,
    tools: { mode: "deny", names: CODING_TOOL_NAMES },
    customTools: ["memory_save", "web_search", "web_fetch"],
    ui: {
      changes: false,
      tree: false,
      sandbox: false,
      harness: false,
      fileMention: false,
      bashBang: false,
      slash: false,
      toolsPopover: false,
    },
    composerHint: "日常助手不会读写项目文件或执行命令",
  },
  {
    id: "coding",
    name: "编程",
    description: "完整编程 agent：文件、终端、子 agent、沙箱、部署",
    workspace: "project",
    tools: { mode: "all" },
    customTools: "all",
    ui: FULL_UI,
    toolDisclosure: { threshold: 24 },
    composerHint: "pi agent 可以执行命令与修改文件，请在可信任的项目中使用",
  },
  {
    id: "review",
    name: "只读审查",
    description: "只能读取与检索，适合代码审查与安全分析",
    workspace: "project",
    appendSystemPrompt: REVIEW_SYSTEM_PROMPT,
    tools: {
      mode: "allow",
      names: ["read", "grep", "find", "ls", "memory_save", "web_search", "web_fetch"],
    },
    customTools: ["memory_save", "web_search", "web_fetch"],
    ui: {
      ...FULL_UI,
      changes: false,
      sandbox: false,
      bashBang: false,
    },
    guardrails: {
      // 双保险：即使工具被重新启用，写入与执行仍被策略门拦下
      toolPolicies: { write: "deny", edit: "deny", bash: "deny", code_run: "deny" },
      commandRules: [],
    },
    composerHint: "只读审查：只能读取与检索，不能修改文件或执行命令",
  },
  {
    id: "minimal",
    name: "最小",
    description: "仅 bash + read + edit，适合基准测试与轻量任务",
    workspace: "project",
    appendSystemPrompt: MINIMAL_SYSTEM_PROMPT,
    tools: { mode: "allow", names: ["bash", "read", "edit"] },
    customTools: [],
    ui: {
      ...FULL_UI,
      sandbox: false,
      slash: false,
    },
    composerHint: "最小装配：仅 bash 与文件读改，无技能与扩展工具",
  },
];

/** 按 id 解析 preset；未知 id 按 kind 回落（旧会话 / 旧配置兼容）。 */
export function getRuntimePreset(id?: string, kind?: ChatKind): RuntimePresetDef {
  const found = id ? RUNTIME_PRESETS.find((p) => p.id === id) : undefined;
  if (found) return found;
  return kind === "daily" ? RUNTIME_PRESETS[0] : RUNTIME_PRESETS[1];
}

export function presetKind(preset: RuntimePresetDef): ChatKind {
  return preset.workspace === "daily" ? "daily" : "coding";
}

/** Overlay English copy / system prompts when the UI locale is English. */
export function localizePreset(preset: RuntimePresetDef, locale?: Locale): RuntimePresetDef {
  if (locale !== "en") return preset;
  const extra = PRESET_I18N[preset.id]?.en;
  if (!extra) return preset;
  return { ...preset, ...extra };
}
