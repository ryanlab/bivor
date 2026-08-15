/**
 * Typed protocol shared across renderer <-> main <-> agent host.
 * All payloads must be structured-clone serializable.
 */

// ---------- Serializable domain snapshots ----------

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** Daily = LLM chat + light tasks. Coding = project agent with file/terminal tools. */
export type ChatKind = "daily" | "coding";

export interface ModelInfo {
  provider: string;
  id: string;
  name: string;
  contextWindow?: number;
  reasoning?: boolean;
  input?: string[];
}

export interface ProviderInfo {
  id: string;
  name: string;
  /** Auth methods the provider supports, e.g. ["api-key", "oauth"] */
  auth: string[];
  /** Whether valid credentials currently exist */
  authenticated: boolean;
  /** Source of credentials if authenticated: "env" | "stored" | "runtime" | undefined */
  authSource?: string;
  envVar?: string;
}

export interface UsageSnapshot {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: number;
}

export interface ChatStateSnapshot {
  chatId: string;
  cwd: string;
  sessionId: string;
  sessionFile?: string;
  sessionName?: string;
  model?: ModelInfo;
  thinkingLevel: ThinkingLevel;
  isStreaming: boolean;
  kind?: ChatKind;
  /** Runtime preset id (see shared/runtime-presets.ts) */
  presetId?: string;
  /** 当前执行世界：bash/read/write/edit 的后端（本机 / 云端 VM） */
  executionWorld?: "local" | "vm";
  /** 本机命令沙箱模式（macOS seatbelt） */
  localSandbox?: LocalSandboxMode;
  /** Full message list (AgentMessage[] from pi, serialized as-is) */
  messages: unknown[];
}

/**
 * 本机命令沙箱（macOS sandbox-exec / seatbelt）：
 * off = 不限制；workspace = 只允许写工作区与临时目录；
 * strict = workspace 基础上再禁网络。
 */
export type LocalSandboxMode = "off" | "workspace" | "strict";

export interface SessionListItem {
  path: string;
  id: string;
  name?: string;
  cwd: string;
  createdAt?: number;
  modifiedAt?: number;
  messageCount?: number;
  firstUserMessage?: string;
}

// ---------- Renderer -> Host commands ----------

export interface ImagePayload {
  /** base64 data, no data: prefix */
  data: string;
  mimeType: string;
}

export type HostCommand =
  | { type: "prompt"; text: string; images?: ImagePayload[]; streamingBehavior?: "steer" | "followUp" }
  | { type: "steer"; text: string; images?: ImagePayload[] }
  | { type: "followUp"; text: string; images?: ImagePayload[] }
  | { type: "abort" }
  | { type: "set_model"; provider: string; modelId: string }
  | { type: "set_thinking_level"; level: ThinkingLevel }
  | { type: "compact" }
  | { type: "get_context" }
  | { type: "set_auto_compaction"; enabled: boolean }
  | { type: "list_commands" }
  | { type: "set_name"; name: string }
  | { type: "get_tree" }
  | { type: "fork"; entryId: string; summarize?: boolean }
  /** Branch at the Nth user message (0-based) and prefill its text for re-editing. */
  | { type: "fork_user_message"; userIndex: number }
  /** Answer to a trust_request: whether to load project-local extensions/skills. */
  | { type: "trust_response"; trusted: boolean; remember: boolean }
  | { type: "bash"; command: string }
  | { type: "abort_bash" }
  | { type: "get_stats" }
  | { type: "list_tools" }
  | { type: "set_tools"; names: string[] }
  | { type: "sandbox_create" }
  | { type: "sandbox_destroy" }
  | { type: "sandbox_status" }
  | { type: "export_html" }
  | { type: "export_jsonl" }
  | { type: "get_guardrails" }
  | { type: "set_guardrails"; guardrails: HarnessGuardrails }
  | { type: "approval_response"; id: string; approved: boolean }
  | { type: "get_harness" }
  | {
      type: "set_harness";
      disabledSkills: string[];
      disabledExtensions: string[];
      extraSystemPrompt: string;
    }
  | { type: "get_state" }
  | { type: "get_trajectory" }
  /** 切换执行世界：bash/read/write/edit 的后端在本机与云端 VM 间热切换 */
  | { type: "set_execution_world"; world: "local" | "vm" }
  /** 设置本机命令沙箱模式（agent 在本机执行的 shell 命令） */
  | { type: "set_local_sandbox"; mode: LocalSandboxMode }
  /** 用户向 agent 当前正在跑的本机命令（PTY）键入数据（接管交互） */
  | { type: "agent_term_input"; data: string }
  /** agent 命令终端视图的尺寸（新建 PTY 按此尺寸，运行中的同步 resize） */
  | { type: "agent_term_resize"; cols: number; rows: number }
  | { type: "clear_queue" }
  | { type: "abort_retry" };

/** Sent once by main to the host right after fork */
export interface HostInit {
  type: "init";
  chatId: string;
  cwd: string;
  /** open an existing session file; when absent, create a fresh session */
  sessionFile?: string;
  /** model to start with (optional; falls back to pi defaults) */
  model?: { provider: string; modelId: string };
  thinkingLevel?: ThinkingLevel;
  kind?: ChatKind;
  /** Runtime preset id; falls back to kind-derived default when absent. */
  presetId?: string;
  /** UI / agent language for this session. */
  locale?: "zh" | "en";
}

export type HostInbound = HostInit | HostCommand;

// ---------- Host -> Renderer events ----------

// ---------- OAuth login flow ----------

export interface AuthPromptPayload {
  type: "text" | "secret" | "select" | "manual_code";
  message: string;
  placeholder?: string;
  options?: { id: string; label: string; description?: string }[];
}

export type AuthFlowEvent =
  | { flowId: string; kind: "prompt"; promptId: string; prompt: AuthPromptPayload }
  | { flowId: string; kind: "info"; message: string; links?: { url: string; label?: string }[] }
  | { flowId: string; kind: "auth_url"; url: string; instructions?: string }
  | {
      flowId: string;
      kind: "device_code";
      userCode: string;
      verificationUri: string;
    }
  | { flowId: string; kind: "progress"; message: string }
  | { flowId: string; kind: "done" }
  | { flowId: string; kind: "error"; message: string };

export interface SessionStatsPayload {
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  totalMessages: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  cost: number;
  contextTokens?: number;
  contextWindow?: number;
}

export interface ToolInfoPayload {
  name: string;
  description?: string;
  active: boolean;
}

// ---------- Harness 治理层（Guardrails：约束整个执行过程的框架） ----------

export type ToolPolicyMode = "allow" | "ask" | "deny";

export interface CommandRule {
  /** 匹配 bash/vm_bash 命令的正则（JS 语法，不带斜杠） */
  pattern: string;
  action: "deny" | "ask";
  note?: string;
}

export interface HarnessGuardrails {
  /** 按工具名的策略，缺省 allow */
  toolPolicies: Record<string, ToolPolicyMode>;
  /** 命令级规则（作用于 bash / vm_bash 的 command 参数） */
  commandRules: CommandRule[];
  /** 每次 prompt 允许的最大轮次（0/undefined = 不限） */
  maxTurnsPerPrompt?: number;
  /** 每次 prompt 允许的最大工具调用数（0/undefined = 不限） */
  maxToolCallsPerPrompt?: number;
  /** 会话累计成本上限 USD（0/undefined = 不限），含子 agent 成本 */
  maxSessionCostUsd?: number;
  /** 子 agent 最大并发数（默认 4） */
  subagentMaxConcurrent?: number;
  /** 子 agent 单次运行的回合上限（默认 24，覆盖工具参数） */
  subagentMaxTurns?: number;
  /**
   * 循环卫生：同一 工具+参数 允许的最大连续重复次数（默认 3，0 = 关闭）。
   * 超过即熔断该调用并提示模型换路。
   */
  maxRepeatedToolCalls?: number;
}

export interface PolicyEventPayload {
  id: string;
  time: number;
  kind: "blocked" | "asked" | "approved" | "denied" | "budget_stop";
  toolName: string;
  detail: string;
}

export interface ApprovalRequestPayload {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  /** 触发审批的规则说明（若来自命令规则） */
  rule?: string;
}

/** 命名的 Harness 预设：一键切换整套编排 + 治理配置 */
export interface HarnessPreset {
  name: string;
  disabledSkills: string[];
  disabledExtensions: string[];
  extraSystemPrompt: string;
  guardrails?: HarnessGuardrails;
}

export interface AppConfigPayload {
  e2bApiKey?: string;
  /** Tavily 搜索 API key（web_search 工具） */
  tavilyApiKey?: string;
  /** Vercel token（deploy 工具）。在 vercel.com/account/tokens 生成。 */
  vercelToken?: string;
  /** 可选。Team 账号部署时需要，来自 Vercel Team Settings。 */
  vercelTeamId?: string;
  harnessPresets?: HarnessPreset[];
  /** Last selected workspace: daily chat vs coding agent. */
  appMode?: ChatKind;
  /** UI + agent reply language. */
  locale?: "zh" | "en";
}

// ---------- 部署运维（Vercel） ----------

export interface VercelProjectInfo {
  id: string;
  name: string;
  updatedAt?: number;
}

export interface VercelDeploymentInfo {
  id: string;
  /** 项目名（部署 URL 前缀） */
  name: string;
  /** 主机名，不含协议，如 my-app-abc123.vercel.app */
  url?: string;
  /** READY | ERROR | BUILDING | QUEUED | INITIALIZING | CANCELED */
  state: string;
  /** production 部署里 PROMOTED = 正在承接生产流量 */
  substate?: string;
  /** "production"；预览部署为空 */
  target?: string;
  createdAt?: number;
  readyAt?: number;
  inspectorUrl?: string;
  projectId?: string;
  creator?: string;
  commitMessage?: string;
  errorMessage?: string;
}

/** 单个部署的完整详情（面板展开时按需拉取） */
export interface VercelDeploymentDetail extends VercelDeploymentInfo {
  /** 指向该部署的所有别名域名 */
  aliases: string[];
  regions: string[];
  /** 部署来源：cli | git | api | import 等 */
  source?: string;
  plan?: string;
  public?: boolean;
  /** 构建耗时（毫秒） */
  buildMs?: number;
  gitBranch?: string;
  gitCommitSha?: string;
  gitRepo?: string;
}

/** 项目级配置（选中项目时显示） */
export interface VercelProjectDetail {
  id: string;
  name: string;
  framework?: string;
  nodeVersion?: string;
  buildCommand?: string;
  installCommand?: string;
  devCommand?: string;
  outputDirectory?: string;
  rootDirectory?: string;
  functionRegion?: string;
  createdAt?: number;
  updatedAt?: number;
  gitRepo?: string;
  domains: string[];
  /** 环境变量只列 key 与作用环境，不含值 */
  envs: { key: string; targets: string[]; type?: string }[];
}

// ---------- 定时任务 ----------

export type TaskSchedule =
  | { type: "interval"; everyMinutes: number }
  | { type: "daily"; time: string } // "HH:mm"
  | { type: "weekly"; days: number[]; time: string }; // days: 0(周日)-6(周六)

export interface ScheduledTaskRunResult {
  status: "ok" | "error";
  finishedAt: number;
  sessionFile?: string;
  error?: string;
  /** open-chat 任务在无窗口时降级为后台执行 */
  degradedToBackground?: boolean;
}

export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  /** 项目路径或 daily 目录 */
  cwd: string;
  kind: ChatKind;
  presetId?: string;
  model?: { provider: string; modelId: string };
  schedule: TaskSchedule;
  /** background = 静默后台跑完并通知；open-chat = 到点自动打开聊天 */
  runMode: "background" | "open-chat";
  enabled: boolean;
  /** 下次触发时间（epoch ms），由调度器计算 */
  nextRunAt?: number;
  /** 当前是否有一次 run 在执行 */
  running?: boolean;
  lastRun?: ScheduledTaskRunResult;
}

// ---------- Agent 运行状况监控 ----------

/** 一个正在运行的 agent 宿主进程（utilityProcess）的进程级信息 */
export interface AgentProcessInfo {
  chatId: string;
  /** chat = 窗口内会话；headless = 定时任务的无头执行 */
  kind: "chat" | "headless";
  cwd: string;
  serviceName: string;
  /** 无头任务的名称（来自定时任务） */
  label?: string;
  startedAt: number;
  pid?: number;
  /** 该进程的 CPU 占用百分比（来自 app.getAppMetrics） */
  cpuPercent?: number;
  /** 常驻内存（bytes） */
  memoryBytes?: number;
  /** 最近的 CPU 采样（旧→新，最多 30 个点；面板打开轮询期间累积） */
  cpuHistory: number[];
  /** 最近的内存采样（bytes，旧→新，最多 30 个点） */
  memoryHistory: number[];
  /** 已收到关闭指令、正在优雅退出（清理云 VM 等，最多几秒后消失） */
  exiting?: boolean;
}

/** Bivor 应用自身（主进程 + 渲染 + GPU 等，不含 agent 宿主进程）的聚合开销 */
export interface AppSelfInfo {
  /** 主进程 pid */
  pid: number;
  /** 主进程启动时间（epoch ms） */
  startedAt?: number;
  cpuPercent: number;
  memoryBytes: number;
  cpuHistory: number[];
  memoryHistory: number[];
}

export interface AgentMonitorSnapshot {
  /** 内嵌 pi SDK（@earendil-works/pi-coding-agent）的版本 */
  piVersion: string;
  /** Bivor 应用版本 */
  appVersion: string;
  self: AppSelfInfo;
  processes: AgentProcessInfo[];
}

/** agent 宿主进程在未收到关闭指令的情况下退出（崩溃 / 被系统杀掉） */
export interface AgentCrashPayload {
  chatId: string;
  kind: "chat" | "headless";
  label?: string;
  serviceName: string;
  /** 进程退出码 */
  code: number;
}

// ---------- 云端沙箱 VM ----------

export interface SandboxStatusPayload {
  status: "none" | "creating" | "running" | "error";
  sandboxId?: string;
  streamUrl?: string;
  message?: string;
}

// ---------- Harness（agent 装配可视化与编排） ----------

export interface HarnessSkill {
  name: string;
  description: string;
  filePath: string;
  source: string;
  disabled: boolean;
}

export interface HarnessExtension {
  path: string;
  name: string;
  source: string;
  tools: string[];
  commands: string[];
  disabled: boolean;
}

export interface HarnessPayload {
  /** 当前会话的运行时 preset（具名装配） */
  preset?: { id: string; name: string };
  systemPrompt: { chars: number; text: string };
  systemPromptSource?: string;
  agentsFiles: { path: string; chars: number }[];
  appendSystemPromptSources: string[];
  extraSystemPrompt: string;
  skills: HarnessSkill[];
  extensions: HarnessExtension[];
  extensionErrors: { path: string; error: string }[];
  prompts: { name: string; description?: string; source: string }[];
  tools: ToolInfoPayload[];
}

// ---------- Trajectory（每一步模型实际所见，可回放） ----------

/** 组装进模型请求的一段提示词来源 */
export interface TrajectorySection {
  label: string;
  source?: string;
  chars?: number;
}

export interface TrajectoryToolCall {
  name: string;
  isError: boolean;
}

/**
 * 一步 = 一次模型请求 + 它触发的工具调用。
 * 在请求发出前快照装配（prompt 段、启用工具、技能），保证
 * "模型可见即已记录"——事后能精确回答"这一步模型看见了什么"。
 */
export interface TrajectoryStepPayload {
  /** 会话内步骤序号 */
  index: number;
  /** 所属 prompt 轮次（每次 agent_start 递增） */
  run: number;
  time: number;
  model?: string;
  thinkingLevel?: string;
  systemPromptChars: number;
  sections: TrajectorySection[];
  activeTools: string[];
  skills: string[];
  extraPromptChars: number;
  /** 请求前的上下文用量（token），刚压缩完为 null */
  contextTokens?: number | null;
  /** 本步的执行世界：bash/read/write/edit 落在本机还是云端 VM */
  world?: "local" | "vm";
  toolCalls: TrajectoryToolCall[];
  usage?: { input: number; output: number; cost: number };
  status: "running" | "done";
}

// ---------- 资源中心（packages / skills / mcp） ----------

export interface PackageItem {
  source: string;
  scope: "user" | "project";
  installedPath?: string;
  filtered: boolean;
}

export interface SkillItem {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  source: string;
}

export interface PromptItem {
  /** template name = filename without .md, used as /name */
  name: string;
  description: string;
  argumentHint?: string;
  filePath: string;
  scope: "user" | "project";
}

export interface McpConfigInfo {
  adapterInstalled: boolean;
  globalPath: string;
  projectPath: string;
  globalContent?: string;
  projectContent?: string;
}

export interface PackageProgressPayload {
  type: "start" | "progress" | "complete" | "error";
  action: string;
  source: string;
  message?: string;
}

export interface SessionTreeNode {
  id: string;
  parentId?: string;
  type: string;
  /** short preview text for user/assistant messages */
  preview?: string;
  role?: string;
  label?: string;
  onActivePath: boolean;
  timestamp?: number;
  children: SessionTreeNode[];
}

/** One full-text search hit across session files. */
export interface WorktreeStatusInfo {
  mainBranch: string;
  dirtyFiles: number;
  ahead: number;
  changedFiles: string[];
}

export interface WorktreeMergeResult {
  merged: boolean;
  mainBranch: string;
  mergedCommits: number;
  error?: string;
}

export interface CheckpointFileDiff {
  path: string;
  additions: number;
  deletions: number;
  patch: string;
}

export interface UsageModelStat {
  model: string;
  messages: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cost: number;
}

export interface UsageDayStat {
  /** YYYY-MM-DD (local) */
  date: string;
  messages: number;
  tokens: number;
  cost: number;
}

export interface UsageStats {
  sessions: number;
  messages: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cost: number;
  perModel: UsageModelStat[];
  /** oldest → newest, last 14 days with activity */
  perDay: UsageDayStat[];
}

export interface SessionSearchHit {
  path: string;
  name?: string;
  snippet: string;
  modifiedAt?: number;
}

/** A slash-command the composer can autocomplete: /name expands host-side. */
export interface SlashCommandPayload {
  /** inserted after "/", e.g. "review" or "skill:web-perf" */
  name: string;
  description?: string;
  argumentHint?: string;
  kind: "template" | "skill" | "extension";
}

/** Live status of a spawned subagent (parallel child AgentSession). */
export interface SubagentUpdatePayload {
  id: string;
  name: string;
  state: "running" | "done" | "error" | "aborted";
  turns: number;
  toolCalls: number;
  /** current tool name / final summary / error message */
  activity?: string;
  /** 派生时的任务描述（截断，用于 UI 展开查看） */
  task?: string;
  /** 本次运行的回合上限（护栏封顶后） */
  maxTurns?: number;
  /** 实时花费（USD，来自子会话统计） */
  cost?: number;
  startedAt?: number;
  /** 只读模式（仅 read/grep/find/ls） */
  readonly?: boolean;
  /** 持有云端 VM 工具 */
  vm?: boolean;
}

/** Precise context usage from the SDK (accurate across compactions). */
export interface ContextUsagePayload {
  /** Estimated context tokens; null right after compaction until next response. */
  tokens: number | null;
  contextWindow: number;
  /** Percent of context window used; null when tokens is unknown. */
  percent: number | null;
}

export type HostEvent =
  | { type: "ready"; snapshot: ChatStateSnapshot }
  | { type: "init_error"; message: string }
  /** Raw pi AgentSessionEvent (deltas stripped of redundant partial payloads) */
  | { type: "session_event"; event: unknown }
  | { type: "state"; snapshot: ChatStateSnapshot }
  | { type: "tree"; nodes: SessionTreeNode[] }
  | { type: "navigated"; editorText?: string }
  | { type: "bash_chunk"; data: string }
  | { type: "bash_done"; exitCode?: number; error?: string }
  | { type: "stats"; stats: SessionStatsPayload }
  | { type: "context"; usage: ContextUsagePayload | null; autoCompaction: boolean }
  | { type: "commands"; commands: SlashCommandPayload[] }
  | { type: "subagent"; update: SubagentUpdatePayload }
  | { type: "tools"; tools: ToolInfoPayload[] }
  | { type: "harness"; harness: HarnessPayload }
  | { type: "harness_error"; message: string }
  | { type: "trajectory"; steps: TrajectoryStepPayload[] }
  | { type: "sandbox"; sandbox: SandboxStatusPayload }
  /** 当前执行世界（bash/read/write/edit 的后端） */
  | { type: "execution_world"; world: "local" | "vm" }
  /** agent 在本机执行命令的实时输出流（含 ANSI），供本机终端视图渲染 */
  | { type: "local_term"; data: string }
  /** 当前本机命令沙箱模式 */
  | { type: "local_sandbox"; mode: LocalSandboxMode }
  /** Agent saved a long-term memory; content is the updated memory file. */
  | { type: "memory"; content: string }
  /**
   * Project contains trust-requiring local resources (.pi extensions/skills).
   * Session init blocks until the renderer answers with trust_response.
   */
  | { type: "trust_request"; cwd: string; resources: string[] }
  | { type: "exported"; path: string }
  | { type: "guardrails"; guardrails: HarnessGuardrails }
  | { type: "approval_request"; request: ApprovalRequestPayload }
  | { type: "approval_resolved"; id: string }
  | { type: "policy_event"; event: PolicyEventPayload }
  | { type: "prompt_done" }
  | { type: "prompt_error"; message: string }
  | { type: "fatal"; message: string };

export interface HostEventEnvelope {
  chatId: string;
  event: HostEvent;
}

// ---------- Renderer -> Main (global services) ----------

export interface OpenProjectResult {
  path: string | null;
}

export interface AuthStatus {
  providers: ProviderInfo[];
}

export const IPC = {
  // chat lifecycle
  chatCreate: "chat:create",
  chatCommand: "chat:command",
  chatDispose: "chat:dispose",
  chatEvent: "chat:event", // main -> renderer push
  // global services
  listModels: "models:list",
  listProviders: "providers:list",
  setApiKey: "providers:setApiKey",
  removeApiKey: "providers:removeApiKey",
  listSessions: "sessions:list",
  renameSession: "sessions:rename",
  deleteSession: "sessions:delete",
  pickFolder: "dialog:pickFolder",
  createFolder: "dialog:createFolder",
  dailyCwd: "system:dailyCwd",
  defaultProjectCwd: "system:defaultProjectCwd",
  configGet: "config:get",
  configSet: "config:set",
  packagesList: "resources:packagesList",
  packagesInstall: "resources:packagesInstall",
  packagesRemove: "resources:packagesRemove",
  packagesUpdate: "resources:packagesUpdate",
  packagesProgress: "resources:packagesProgress",
  skillsList: "resources:skillsList",
  skillsRead: "resources:skillsRead",
  skillsSave: "resources:skillsSave",
  skillsCreate: "resources:skillsCreate",
  skillsDelete: "resources:skillsDelete",
  mcpRead: "resources:mcpRead",
  mcpSave: "resources:mcpSave",
  memoryRead: "resources:memoryRead",
  memorySave: "resources:memorySave",
  promptsList: "resources:promptsList",
  promptsRead: "resources:promptsRead",
  promptsSave: "resources:promptsSave",
  promptsCreate: "resources:promptsCreate",
  promptsDelete: "resources:promptsDelete",
  checkpointCreate: "checkpoint:create",
  checkpointRestore: "checkpoint:restore",
  checkpointDiff: "checkpoint:diff",
  checkpointRestoreFile: "checkpoint:restoreFile",
  listProjectFiles: "files:list",
  isGitRepo: "worktree:isGitRepo",
  createWorktree: "worktree:create",
  listWorktrees: "worktree:list",
  listBranches: "worktree:branches",
  removeWorktree: "worktree:remove",
  worktreeStatus: "worktree:status",
  worktreeMerge: "worktree:merge",
  authStartLogin: "auth:startLogin",
  authPromptResponse: "auth:promptResponse",
  authCancelLogin: "auth:cancelLogin",
  authFlowEvent: "auth:flowEvent",
  revealPath: "shell:revealPath",
  setBadge: "app:setBadge",
  searchSessions: "sessions:search",
  usageStats: "sessions:usage",
  readTextFile: "fs:readTextFile",
  windowControl: "window:control",
  // 交互终端（main 进程 node-pty，一个 chat 一个用户 shell）
  termCreate: "term:create",
  termInput: "term:input",
  termResize: "term:resize",
  termDispose: "term:dispose",
  termData: "term:data", // main -> renderer push
  termExit: "term:exit", // main -> renderer push
  // deployments (Vercel ops)
  deploymentsConfigured: "deployments:configured",
  deploymentsProjects: "deployments:projects",
  deploymentsList: "deployments:list",
  deploymentsLogs: "deployments:logs",
  deploymentsDetail: "deployments:detail",
  deploymentsProjectDetail: "deployments:projectDetail",
  deploymentsCancel: "deployments:cancel",
  deploymentsDelete: "deployments:delete",
  deploymentsRedeploy: "deployments:redeploy",
  deploymentsPromote: "deployments:promote",
  deploymentsRollback: "deployments:rollback",
  // agent 运行状况监控
  monitorSnapshot: "monitor:snapshot",
  monitorKill: "monitor:kill",
  monitorAgentCrash: "monitor:agentCrash",
  // scheduled tasks
  scheduleList: "schedule:list",
  scheduleSave: "schedule:save",
  scheduleDelete: "schedule:delete",
  scheduleRunNow: "schedule:runNow",
  scheduleChanged: "schedule:changed", // main -> renderer push
  scheduleTrigger: "schedule:trigger", // main -> renderer push (open-chat 型触发)
} as const;

export interface ChatCreateOptions {
  cwd: string;
  sessionFile?: string;
  model?: { provider: string; modelId: string };
  thinkingLevel?: ThinkingLevel;
  kind?: ChatKind;
  presetId?: string;
  locale?: "zh" | "en";
}

export interface ChatCreateResult {
  chatId: string;
}
