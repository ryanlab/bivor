import { create } from "zustand";
import type {
  ChatKind,
  ChatStateSnapshot,
  HarnessPayload,
  HostEvent,
  HostEventEnvelope,
  ImagePayload,
  ModelInfo,
  ProviderInfo,
  SessionListItem,
  ApprovalRequestPayload,
  HarnessGuardrails,
  HarnessPreset,
  LocalSandboxMode,
  PolicyEventPayload,
  SandboxStatusPayload,
  ScheduledTask,
  ContextUsagePayload,
  SessionStatsPayload,
  SlashCommandPayload,
  SubagentUpdatePayload,
  SessionTreeNode,
  UpdateCheckPayload,
  ThinkingLevel,
  ToolInfoPayload,
  TrajectoryStepPayload,
} from "@shared/protocol";
import { getRuntimePreset } from "@shared/runtime-presets";
import type { AssistantMessage, PiMessage } from "@/lib/pi-messages";
import { applyTheme, loadThemePreference, type ThemePreference } from "@/lib/theme";
import { applyLocale, loadLocalePreference, type Locale } from "@/lib/locale";
import { t as translate } from "@shared/locales";
import { samePath } from "@/lib/format";
import { type SessionTimeFilter } from "@/lib/session-time";

// ---------- types ----------

export interface ToolRun {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  output: string;
  result?: { content?: unknown[]; details?: Record<string, unknown> };
}

export interface ChatState {
  chatId: string;
  cwd: string;
  kind: ChatKind;
  /** 运行时 preset id（shared/runtime-presets.ts） */
  presetId: string;
  status: "initializing" | "ready" | "error";
  error?: string;
  sessionId?: string;
  sessionFile?: string;
  sessionName?: string;
  model?: ModelInfo;
  thinkingLevel: ThinkingLevel;
  isStreaming: boolean;
  /** 当前这一轮 prompt 的开始时间；用于监控面板的"长时间运行"提示 */
  streamingSince?: number;
  /** 最近一次收到该会话事件的时间；streaming 中长时间无事件 → 监控面板提示疑似无响应 */
  lastEventAt?: number;
  messages: PiMessage[];
  streaming?: AssistantMessage;
  toolRuns: Record<string, ToolRun>;
  queue: { steering: string[]; followUp: string[] };
  lastError?: string;
  compacting: boolean;
  /** prompt to auto-send once the host is ready (welcome screen flow) */
  pendingPrompt?: string;
  /** text to prefill the composer with (after branch navigation) */
  draft?: string;
  tree?: SessionTreeNode[];
  treeOpen: boolean;
  /** 项目文件树面板 */
  filesOpen: boolean;
  /** set when this chat runs in an isolated git worktree */
  worktree?: { branch: string; projectPath: string };
  /** live output of a user-initiated bash command (`!cmd`) */
  bashRunning: boolean;
  bashOutput: string;
  stats?: SessionStatsPayload;
  /** Precise context usage from the SDK (accurate across compactions). */
  contextUsage?: ContextUsagePayload | null;
  autoCompaction?: boolean;
  /** Slash-commands available for composer autocomplete. */
  commands?: SlashCommandPayload[];
  /** Live subagent activity, keyed by subagent id. */
  subagents?: Record<string, SubagentUpdatePayload>;
  tools?: ToolInfoPayload[];
  /** message index (user prompt) -> checkpoint id */
  checkpoints: Record<number, { id: string; time: number }>;
  /**
   * First checkpoint of this UI session — the "baseline" the changes panel
   * diffs against. Unlike per-turn checkpoints it survives full snapshot
   * syncs (those only invalidate message-index keyed rollback points).
   */
  baselineCheckpointId?: string;
  restoringCheckpoint: boolean;
  /** set while the SDK is auto-retrying a failed model call */
  retrying?: { attempt: number; maxAttempts: number; delayMs: number; errorMessage: string };
  harness?: HarnessPayload;
  harnessOpen: boolean;
  harnessBusy: boolean;
  harnessError?: string;
  /** 每步模型实际所见（host 推送，最多保留最近 100 步） */
  trajectory?: TrajectoryStepPayload[];
  /** undefined = 沙箱不可用（无 API key），否则为当前状态 */
  sandbox?: SandboxStatusPayload;
  /** 沙箱进入 running 的时间；用于监控面板显示计费时长 */
  sandboxSince?: number;
  sandboxOpen: boolean;
  /** 执行世界：bash/read/write/edit 的后端（本机 / 云端 VM） */
  executionWorld?: "local" | "vm";
  /** 本机世界的终端输出流（agent 执行的命令，含 ANSI），xterm 按 seq 增量写入 */
  localTerm?: { seq: number; data: string }[];
  /** localTerm 的单调递增计数器（清空缓冲后仍继续递增，保证增量写入不漏块） */
  localTermSeq?: number;
  /** 本机命令沙箱模式（macOS seatbelt） */
  localSandbox?: LocalSandboxMode;
  /** 用户交互终端（main 进程 PTY）的 id 列表，可开多个 */
  userTerms?: string[];
  /** 某个终端 tab 的启动目录（未设则用会话 cwd） */
  termCwds?: Record<string, string>;
  /** 底部终端抽屉当前 tab："agent" 或某个 userTerm id */
  localTab?: string;
  /** 底部终端抽屉是否展开 */
  termOpen?: boolean;
  /** agent 是否在本机真正跑过命令——Agent tab 只在此后出现 */
  agentTermUsed?: boolean;
  guardrails?: HarnessGuardrails;
  policyEvents: PolicyEventPayload[];
  pendingApprovals: ApprovalRequestPayload[];
  lastExportPath?: string;
  /** Updated memory file content after the agent calls memory_save. */
  memoryContent?: string;
  /** Pending project trust prompt; session init is blocked until answered. */
  trustRequest?: { cwd: string; resources: string[] };
}

export interface Project {
  path: string;
  lastOpenedAt: number;
}

/** 欢迎页 / 总览上的项目终端（尚无会话时也能开 shell） */
export const WORKSPACE_TERM_ID = "__workspace__";

export interface WorkspaceTermState {
  open: boolean;
  userTerms: string[];
  localTab?: string;
  termCwds?: Record<string, string>;
}

const EMPTY_WORKSPACE_TERM: WorkspaceTermState = { open: false, userTerms: [] };

function resetWorkspaceTerm(userTerms: string[]): WorkspaceTermState {
  for (const id of userTerms) window.pi.term.dispose(id);
  return EMPTY_WORKSPACE_TERM;
}

interface AppState {
  // chats
  chats: Record<string, ChatState>;
  chatOrder: string[];
  activeChatId?: string;
  // projects
  recentProjects: Project[];
  activeProjectPath?: string;
  activeProjectIsGit: boolean;
  sessions: SessionListItem[];
  sessionsLoading: boolean;
  // catalog
  models: ModelInfo[];
  providers: ProviderInfo[];
  // ui
  settingsOpen: boolean;
  /** Which settings tab to show when the dialog opens. */
  settingsTab?: string;
  sidebarCollapsed: boolean;
  sessionTimeFilter: SessionTimeFilter;
  /** 最近一次新版本检测结果 */
  updateInfo?: UpdateCheckPayload;
  updateChecking: boolean;
  theme: ThemePreference;
  locale: Locale;
  /** "home" = 总览；"welcome" = 新建；"chat" = 会话；"schedule" / "deployments" = 整页 */
  activeView: "home" | "welcome" | "chat" | "schedule" | "deployments";
  paletteOpen: boolean;
  resourcesOpen: boolean;
  /** Which resources tab to show when the dialog opens. */
  resourcesTab?: string;
  usageOpen: boolean;
  monitorOpen: boolean;
  shortcutsOpen: boolean;
  // scheduled tasks
  scheduledTasks: ScheduledTask[];
  /** Daily chat vs coding agent workspace. */
  appMode: ChatKind;
  dailyCwd?: string;
  /** Persistent scratch folder used when no repository is selected. */
  defaultProjectCwd?: string;
  preferredModel?: ModelInfo;
  /** 每个模型各自的思考等级，键为 `provider/modelId` */
  modelThinking: Record<string, ThinkingLevel>;
  /** 编程模式下新会话使用的运行时 preset（coding / review / minimal） */
  codingPresetId: string;
  /** 未进入会话时的项目终端（与 chat 终端相互独立） */
  workspaceTerm: WorkspaceTermState;
  /** 欢迎页云端 VM 面板是否展开 */
  workspaceSandboxOpen: boolean;
  /** 欢迎页云端 VM 状态；undefined = 未配置 E2B key */
  workspaceSandbox?: SandboxStatusPayload;
  e2bConfigured: boolean;
  /** 欢迎页项目文件树是否展开 */
  workspaceFilesOpen: boolean;

  // actions
  setTheme(pref: ThemePreference): void;
  setLocale(locale: Locale): void;
  toggleSidebar(): void;
  setSessionTimeFilter(filter: SessionTimeFilter): void;
  checkForUpdates(force?: boolean): Promise<void>;
  setAppMode(mode: ChatKind): void;
  setPreferredModel(model: ModelInfo): void;
  setCodingPreset(id: string): void;
  newChat(options?: { initialPrompt?: string }): Promise<void>;
  handleEnvelope(envelope: HostEventEnvelope): void;
  openProject(path: string): void;
  removeRecentProject(path: string): void;
  pickAndOpenProject(): Promise<void>;
  selectDefaultProject(): Promise<void>;
  refreshSessions(): Promise<void>;
  openChat(options: {
    cwd: string;
    kind?: ChatKind;
    presetId?: string;
    sessionFile?: string;
    initialPrompt?: string;
    worktree?: { branch: string; projectPath: string };
  }): Promise<void>;
  openWorktreeChat(options?: {
    /** branch the new worktree is created from (default: current HEAD) */
    baseBranch?: string;
    /** used to name the task branch */
    taskHint?: string;
    initialPrompt?: string;
  }): Promise<void>;
  closeChat(chatId: string): void;
  setActiveChat(chatId: string): void;
  sendPrompt(
    chatId: string,
    text: string,
    options?: { images?: ImagePayload[]; mode?: "steer" | "followUp" },
  ): void;
  abort(chatId: string): void;
  clearQueue(chatId: string): void;
  abortRetry(chatId: string): void;
  requestTree(chatId: string): void;
  setTreeOpen(chatId: string, open: boolean): void;
  setFilesOpen(chatId: string, open: boolean): void;
  setWorkspaceFilesOpen(open: boolean): void;
  fork(chatId: string, entryId: string, summarize?: boolean): void;
  /** Branch at the Nth user message and prefill its text for re-editing. */
  forkAtUserMessage(chatId: string, userIndex: number): void;
  /** Answer a pending project trust prompt. */
  respondTrust(chatId: string, trusted: boolean, remember: boolean): void;
  consumeDraft(chatId: string): void;
  runBash(chatId: string, command: string): void;
  abortBash(chatId: string): void;
  requestStats(chatId: string): void;
  requestTools(chatId: string): void;
  setTools(chatId: string, names: string[]): void;
  requestTrajectory(chatId: string): void;
  restoreCheckpoint(chatId: string, checkpointId: string): Promise<number>;
  showHome(): void;
  showWelcome(): void;
  setPaletteOpen(open: boolean): void;
  setResourcesOpen(open: boolean, tab?: string): void;
  setUsageOpen(open: boolean): void;
  setMonitorOpen(open: boolean): void;
  setShortcutsOpen(open: boolean): void;
  setDeploymentsOpen(open: boolean): void;
  requestHarness(chatId: string): void;
  setHarnessOpen(chatId: string, open: boolean): void;
  applyHarness(
    chatId: string,
    config: { disabledSkills: string[]; disabledExtensions: string[]; extraSystemPrompt: string },
  ): void;
  setSandboxOpen(chatId: string, open: boolean): void;
  /** 底部终端抽屉的开合 */
  setTermOpen(chatId: string, open: boolean): void;
  setWorkspaceSandboxOpen(open: boolean): void;
  setWorkspaceSandboxStatus(status: SandboxStatusPayload | undefined, configured?: boolean): void;
  createWorkspaceSandbox(): void;
  destroyWorkspaceSandbox(): void;
  requestGuardrails(chatId: string): void;
  applyGuardrails(chatId: string, guardrails: HarnessGuardrails): void;
  respondApproval(chatId: string, id: string, approved: boolean): void;
  harnessPresets: HarnessPreset[];
  loadPresets(): Promise<void>;
  saveHarnessPreset(chatId: string, name: string): Promise<void>;
  applyHarnessPreset(chatId: string, preset: HarnessPreset): void;
  deleteHarnessPreset(name: string): Promise<void>;
  createSandbox(chatId: string): void;
  destroySandbox(chatId: string): void;
  /** 切换执行世界：bash/read/write/edit 的后端在本机与云端 VM 间热切换 */
  setExecutionWorld(chatId: string, world: "local" | "vm"): void;
  /** 清空本机终端视图的输出缓冲（纯 UI 状态） */
  clearLocalTerm(chatId: string): void;
  /** 设置本机命令沙箱模式（macOS seatbelt） */
  setLocalSandbox(chatId: string, mode: LocalSandboxMode): void;
  /** 新建一个用户交互终端 tab；cwd 可覆盖启动目录 */
  addUserTerminal(chatId: string, cwd?: string): void;
  /** 抽屉首次打开时确保至少有一个终端；幂等（StrictMode 双跑安全） */
  ensureUserTerminal(chatId: string): void;
  /** 关闭一个用户终端 tab（同时销毁 main 进程的 PTY） */
  removeUserTerminal(chatId: string, termId: string): void;
  /** 切换执行环境面板本机世界的 tab */
  setLocalTab(chatId: string, tab: string): void;
  /** 从面板移除一个已结束的子 agent 卡片（纯 UI 状态） */
  dismissSubagent(chatId: string, id: string): void;
  setModel(chatId: string, model: ModelInfo): void;
  /** 设置某个模型的思考等级；传入 chatId 且该模型正被使用时，同时下发给 host。 */
  setModelThinking(model: ModelInfo, level: ThinkingLevel, chatId?: string): void;
  compact(chatId: string): void;
  requestContext(chatId: string): void;
  setAutoCompaction(chatId: string, enabled: boolean): void;
  renameSession(path: string, name: string): Promise<void>;
  deleteSession(path: string): Promise<void>;
  loadCatalog(): Promise<void>;
  setSettingsOpen(open: boolean, tab?: string): void;
  // scheduled tasks
  setScheduledTasksOpen(open: boolean): void;
  refreshScheduledTasks(): Promise<void>;
  saveScheduledTask(task: ScheduledTask): Promise<void>;
  deleteScheduledTask(id: string): Promise<void>;
  runScheduledTaskNow(id: string): Promise<void>;
  /** main 推送的 open-chat 型定时任务触发：打开聊天并自动发送 prompt */
  handleScheduleTrigger(task: ScheduledTask): void;
}

// ---------- helpers ----------

const PROJECTS_KEY = "bivor:recent-projects";
const MODE_KEY = "bivor:app-mode";
const PREFERRED_MODEL_KEY = "bivor:preferred-model";
const MODEL_THINKING_KEY = "bivor:model-thinking";
const CODING_PRESET_KEY = "bivor:coding-preset";
const SESSION_PRESETS_KEY = "bivor:session-presets";
const TIME_FILTER_KEY = "bivor:session-time-filter";
const UPDATE_NOTIFIED_KEY = "bivor:update-notified";

function loadTimeFilter(): SessionTimeFilter {
  try {
    const raw = localStorage.getItem(TIME_FILTER_KEY);
    if (raw === "all" || raw === "today" || raw === "7d" || raw === "30d") return raw;
  } catch {
    // ignore
  }
  return "all";
}

const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
/** 新会话默认开启思考（推理模型上生效） */
const DEFAULT_THINKING_LEVEL: ThinkingLevel = "medium";

function loadCodingPreset(): string {
  try {
    const raw = localStorage.getItem(CODING_PRESET_KEY);
    if (raw && getRuntimePreset(raw).id === raw) return raw;
  } catch {
    // ignore
  }
  return "coding";
}

/** sessionFile -> presetId：重开旧会话时恢复它的运行时 preset。 */
function loadSessionPresets(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SESSION_PRESETS_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function rememberSessionPreset(sessionFile: string, presetId: string): void {
  try {
    const map = loadSessionPresets();
    if (map[sessionFile] === presetId) return;
    map[sessionFile] = presetId;
    // 只保留最近 200 条映射，避免无限膨胀。
    const keys = Object.keys(map);
    if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete map[k];
    localStorage.setItem(SESSION_PRESETS_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

function loadAppMode(): ChatKind {
  try {
    const raw = localStorage.getItem(MODE_KEY);
    if (raw === "daily" || raw === "coding") return raw;
  } catch {
    // ignore
  }
  return "coding";
}

function loadPreferredModel(): ModelInfo | undefined {
  try {
    const raw = localStorage.getItem(PREFERRED_MODEL_KEY);
    if (!raw) return undefined;
    const m = JSON.parse(raw) as ModelInfo;
    if (m && typeof m.provider === "string" && typeof m.id === "string") return m;
  } catch {
    // ignore
  }
  return undefined;
}

/** 思考设置按模型独立保存，键为 `provider/modelId`。 */
function modelThinkingKey(model: Pick<ModelInfo, "provider" | "id">): string {
  return `${model.provider}/${model.id}`;
}

function loadModelThinking(): Record<string, ThinkingLevel> {
  try {
    const raw = JSON.parse(localStorage.getItem(MODEL_THINKING_KEY) ?? "{}") as Record<
      string,
      ThinkingLevel
    >;
    return Object.fromEntries(
      Object.entries(raw).filter(([, v]) => THINKING_LEVELS.includes(v)),
    );
  } catch {
    return {};
  }
}

/** 某个模型的思考等级；没有记录过就用默认值（默认开启思考）。 */
export function thinkingLevelOf(
  map: Record<string, ThinkingLevel>,
  model?: Pick<ModelInfo, "provider" | "id">,
): ThinkingLevel {
  if (!model) return DEFAULT_THINKING_LEVEL;
  return map[modelThinkingKey(model)] ?? DEFAULT_THINKING_LEVEL;
}

/** In-flight openChat calls keyed by sessionFile, to dedupe concurrent opens. */
const openingSessions = new Map<string, Promise<void>>();

function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Project[];
  } catch {
    return [];
  }
}

function saveProjects(projects: Project[]): void {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}

function excludeDefault(projects: Project[], defaultCwd?: string): Project[] {
  return defaultCwd ? projects.filter((p) => !samePath(p.path, defaultCwd)) : projects;
}

async function resolveDefaultCwd(
  get: () => AppState,
  set: (partial: Partial<AppState>) => void,
): Promise<string> {
  const existing = get().defaultProjectCwd;
  if (existing) return existing;
  const cwd = await window.pi.system.defaultProjectCwd();
  const recentProjects = excludeDefault(get().recentProjects, cwd);
  if (recentProjects.length !== get().recentProjects.length) saveProjects(recentProjects);
  set({ defaultProjectCwd: cwd, recentProjects });
  return cwd;
}

function fromSnapshot(chat: ChatState, snapshot: ChatStateSnapshot): ChatState {
  const messages = snapshot.messages as PiMessage[];
  // Checkpoints are keyed by message index at send time. If a snapshot replaces
  // the transcript non-append-wise (branch navigation), those indices no longer
  // point at the same messages — drop them rather than restore the wrong turn.
  const matchesAt = (i: number): boolean => {
    const n = messages[i] as { role?: string; timestamp?: number } | undefined;
    const o = chat.messages[i] as { role?: string; timestamp?: number; __optimistic?: boolean };
    return Boolean(o.__optimistic || (n && n.role === o.role && n.timestamp === o.timestamp));
  };
  // Host can briefly lag the renderer: a snapshot taken before an optimistic
  // user message reached the session. If the snapshot is a prefix of local
  // state and every extra local message is optimistic, keep local — replacing
  // would flash the prompt away and wrongly drop rollback checkpoints.
  const hostBehind =
    messages.length < chat.messages.length &&
    chat.messages
      .slice(messages.length)
      .every((m) => (m as { __optimistic?: boolean }).__optimistic) &&
    messages.every((_, i) => matchesAt(i));
  const appendOnly =
    messages.length >= chat.messages.length && chat.messages.every((_, i) => matchesAt(i));
  return {
    ...chat,
    status: "ready",
    cwd: snapshot.cwd,
    sessionId: snapshot.sessionId,
    sessionFile: snapshot.sessionFile,
    sessionName: snapshot.sessionName ?? chat.sessionName,
    model: snapshot.model ?? chat.model,
    thinkingLevel: snapshot.thinkingLevel,
    isStreaming: hostBehind ? chat.isStreaming : snapshot.isStreaming,
    streamingSince: (hostBehind ? chat.isStreaming : snapshot.isStreaming)
      ? (chat.streamingSince ?? Date.now())
      : undefined,
    kind: snapshot.kind ?? chat.kind,
    presetId: snapshot.presetId ?? chat.presetId,
    executionWorld: snapshot.executionWorld ?? chat.executionWorld,
    localSandbox: snapshot.localSandbox ?? chat.localSandbox,
    messages: hostBehind ? chat.messages : messages,
    checkpoints: appendOnly || hostBehind ? chat.checkpoints : {},
  };
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const v = value as { content?: unknown; output?: unknown; text?: unknown };
    if (typeof v.text === "string") return v.text;
    if (typeof v.output === "string") return v.output;
    if (Array.isArray(v.content)) {
      return v.content
        .map((c) => {
          const cc = c as { type?: string; text?: string };
          return cc.type === "text" && typeof cc.text === "string" ? cc.text : "";
        })
        .join("");
    }
  }
  return "";
}

/** Apply a pi AgentSessionEvent to a chat draft. Returns a new ChatState. */
function applySessionEvent(chat: ChatState, raw: unknown): ChatState {
  const event = raw as Record<string, unknown> & { type: string };
  switch (event.type) {
    case "agent_start":
      return {
        ...chat,
        isStreaming: true,
        streamingSince: chat.streamingSince ?? Date.now(),
        lastError: undefined,
      };

    case "agent_end": {
      // On abort, in-progress tools may never get a tool_execution_end; settle
      // them so cards / mission-control stop spinning forever.
      let toolRuns = chat.toolRuns;
      const runningIds = Object.keys(toolRuns).filter((id) => toolRuns[id].status === "running");
      if (runningIds.length > 0) {
        toolRuns = { ...toolRuns };
        for (const id of runningIds) {
          toolRuns[id] = {
            ...toolRuns[id],
            status: "error",
            output: toolRuns[id].output || translate(useAppStore.getState().locale, "messages.aborted"),
          };
        }
      }
      return { ...chat, isStreaming: false, streamingSince: undefined, streaming: undefined, toolRuns };
    }

    case "message_start": {
      const message = event.message as PiMessage | undefined;
      if (message && message.role === "assistant") {
        return { ...chat, streaming: message as AssistantMessage };
      }
      return chat;
    }

    case "message_update": {
      const inner = event.assistantMessageEvent as
        | (Record<string, unknown> & { type: string })
        | undefined;
      if (!inner) return chat;
      const partial = inner.partial as AssistantMessage | undefined;
      if (partial) {
        return { ...chat, streaming: partial };
      }
      // Delta events: reconstruct into streaming message
      const streaming = chat.streaming
        ? { ...chat.streaming, content: [...chat.streaming.content] }
        : ({ role: "assistant", content: [], timestamp: Date.now() } as AssistantMessage);
      const idx = typeof inner.contentIndex === "number" ? inner.contentIndex : 0;
      const delta = typeof inner.delta === "string" ? inner.delta : "";
      while (streaming.content.length <= idx) {
        streaming.content.push({ type: "text", text: "" });
      }
      const block = { ...streaming.content[idx] } as Record<string, unknown>;
      if (inner.type === "text_delta") {
        block.type = "text";
        block.text = (typeof block.text === "string" ? block.text : "") + delta;
      } else if (inner.type === "thinking_delta") {
        block.type = "thinking";
        block.thinking = (typeof block.thinking === "string" ? block.thinking : "") + delta;
      } else {
        return chat; // toolcall_delta: wait for toolcall_end (has partial)
      }
      streaming.content[idx] = block as never;
      return { ...chat, streaming };
    }

    case "message_end": {
      const message = event.message as PiMessage | undefined;
      if (!message) return chat;
      const messages = [...chat.messages];
      // Replace the trailing optimistic user message with its echo. The echo's
      // text can differ from what we sent (host-side expansion/normalization),
      // so also accept a position match: an optimistic message that is still
      // the last message can only belong to the prompt being echoed now.
      const opt = messages.findLastIndex((m) => (m as { __optimistic?: boolean }).__optimistic);
      if (message.role === "user" && opt >= 0) {
        if (opt === messages.length - 1 || extractText(message) === extractText(messages[opt]))
          messages.splice(opt, 1);
      }
      messages.push(message);
      return {
        ...chat,
        messages,
        streaming: message.role === "assistant" ? undefined : chat.streaming,
      };
    }

    case "tool_execution_start": {
      const id = String(event.toolCallId);
      const toolName = String(event.toolName);
      const runsLocally =
        (toolName === "bash" || toolName === "code_run") &&
        (chat.executionWorld ?? "local") !== "vm";
      return {
        ...chat,
        agentTermUsed: chat.agentTermUsed || runsLocally,
        toolRuns: {
          ...chat.toolRuns,
          [id]: {
            toolCallId: id,
            toolName,
            args: (event.args ?? {}) as Record<string, unknown>,
            status: "running",
            output: "",
          },
        },
      };
    }

    case "tool_execution_update": {
      const id = String(event.toolCallId);
      const run = chat.toolRuns[id];
      if (!run) return chat;
      const text = extractText(event.partialResult);
      return {
        ...chat,
        toolRuns: { ...chat.toolRuns, [id]: { ...run, output: text || run.output } },
      };
    }

    case "bash_execution_update": {
      const id = event.id ? String(event.id) : undefined;
      const delta = typeof event.delta === "string" ? event.delta : "";
      if (!id || !delta) return chat;
      const run = chat.toolRuns[id];
      if (!run) return chat;
      return {
        ...chat,
        toolRuns: { ...chat.toolRuns, [id]: { ...run, output: run.output + delta } },
      };
    }

    case "tool_execution_end": {
      const id = String(event.toolCallId);
      const run = chat.toolRuns[id];
      const isError = Boolean(event.isError);
      const result = event.result as ToolRun["result"];
      const finalText = extractText(result);
      return {
        ...chat,
        toolRuns: {
          ...chat.toolRuns,
          [id]: {
            toolCallId: id,
            toolName: run?.toolName ?? String(event.toolName ?? ""),
            args: run?.args ?? {},
            status: isError ? "error" : "done",
            output: finalText || run?.output || "",
            result,
          },
        },
      };
    }

    case "queue_update":
      return {
        ...chat,
        queue: {
          steering: [...((event.steering as string[]) ?? [])],
          followUp: [...((event.followUp as string[]) ?? [])],
        },
      };

    case "auto_retry_start":
      return {
        ...chat,
        retrying: {
          attempt: Number(event.attempt ?? 0),
          maxAttempts: Number(event.maxAttempts ?? 0),
          delayMs: Number(event.delayMs ?? 0),
          errorMessage: String(event.errorMessage ?? ""),
        },
      };

    case "auto_retry_end":
      return {
        ...chat,
        retrying: undefined,
        lastError:
          event.success === false && event.finalError
            ? String(event.finalError)
            : chat.lastError,
      };

    case "session_info_changed":
      return { ...chat, sessionName: (event.name as string | undefined) ?? undefined };

    case "thinking_level_changed":
      return { ...chat, thinkingLevel: event.level as ThinkingLevel };

    case "compaction_start":
      return { ...chat, compacting: true };
    case "compaction_end":
      return { ...chat, compacting: false };

    default:
      return chat;
  }
}

function applyHostEvent(chat: ChatState, event: HostEvent): ChatState {
  switch (event.type) {
    case "ready":
      return fromSnapshot({ ...chat, status: "ready" }, event.snapshot);
    case "init_error":
      return { ...chat, status: "error", error: event.message };
    case "state":
      return fromSnapshot(chat, event.snapshot);
    case "tree":
      return { ...chat, tree: event.nodes };
    case "navigated":
      return { ...chat, draft: event.editorText ?? chat.draft };
    case "bash_chunk":
      return {
        ...chat,
        bashRunning: true,
        bashOutput: chat.bashOutput + event.data,
        // 用户 ! 直跑也走 agent 的常驻 shell
        agentTermUsed: chat.agentTermUsed || (chat.executionWorld ?? "local") !== "vm",
      };
    case "bash_done":
      return {
        ...chat,
        bashRunning: false,
        bashOutput: "",
        lastError: event.error,
      };
    case "stats":
      return { ...chat, stats: event.stats };
    case "context":
      return { ...chat, contextUsage: event.usage, autoCompaction: event.autoCompaction };
    case "commands":
      return { ...chat, commands: event.commands };
    case "subagent": {
      const subagents = { ...chat.subagents, [event.update.id]: event.update };
      // Keep finished entries briefly visible; prune when a new run starts.
      if (event.update.state === "running") {
        for (const [k, v] of Object.entries(subagents)) {
          if (k !== event.update.id && v.state !== "running") delete subagents[k];
        }
      }
      return { ...chat, subagents };
    }
    case "tools":
      return { ...chat, tools: event.tools };
    case "harness":
      return { ...chat, harness: event.harness, harnessBusy: false, harnessError: undefined };
    case "harness_error":
      return { ...chat, harnessBusy: false, harnessError: event.message };
    case "trajectory":
      return { ...chat, trajectory: event.steps };
    case "sandbox": {
      const wasRunning = chat.sandbox?.status === "running";
      const isRunning = event.sandbox.status === "running";
      return {
        ...chat,
        sandbox: event.sandbox,
        sandboxSince: isRunning ? (wasRunning ? chat.sandboxSince : Date.now()) : undefined,
      };
    }
    case "execution_world":
      return { ...chat, executionWorld: event.world };
    case "local_sandbox":
      return { ...chat, localSandbox: event.mode };
    case "local_term": {
      const seq = (chat.localTermSeq ?? 0) + 1;
      const next = [...(chat.localTerm ?? []), { seq, data: event.data }];
      // 缓冲上限 ~300KB：从头部丢弃旧块（xterm 已渲染过，只影响重新挂载时的回放长度）
      let total = next.reduce((n, c) => n + c.data.length, 0);
      while (next.length > 1 && total > 300_000) {
        total -= next[0].data.length;
        next.shift();
      }
      return { ...chat, localTerm: next, localTermSeq: seq };
    }
    case "exported":
      return { ...chat, lastExportPath: event.path };
    case "memory":
      return { ...chat, memoryContent: event.content };
    case "trust_request":
      return { ...chat, trustRequest: { cwd: event.cwd, resources: event.resources } };
    case "guardrails":
      return { ...chat, guardrails: event.guardrails };
    case "approval_request":
      return { ...chat, pendingApprovals: [...chat.pendingApprovals, event.request] };
    case "approval_resolved":
      return {
        ...chat,
        pendingApprovals: chat.pendingApprovals.filter((a) => a.id !== event.id),
      };
    case "policy_event":
      return { ...chat, policyEvents: [...chat.policyEvents.slice(-99), event.event] };
    case "session_event":
      return applySessionEvent(chat, event.event);
    case "prompt_error": {
      // Drop the half-streamed assistant bubble and any running tool spinners so
      // the UI doesn't leave a ghost message with a blinking cursor.
      const toolRuns = { ...chat.toolRuns };
      for (const [id, run] of Object.entries(toolRuns)) {
        if (run.status === "running") {
          toolRuns[id] = {
            ...run,
            status: "error",
            output: run.output || translate(useAppStore.getState().locale, "messages.interrupted"),
          };
        }
      }
      // De-flag leftover optimistic messages: the prompt failed, so no echo will
      // ever come for them — a later echo must not splice them out.
      const messages = chat.messages.map((m) =>
        (m as { __optimistic?: boolean }).__optimistic
          ? ({ ...m, __optimistic: undefined } as typeof m)
          : m,
      );
      return {
        ...chat,
        messages,
        lastError: event.message,
        isStreaming: false,
        streamingSince: undefined,
        streaming: undefined,
        toolRuns,
      };
    }
    case "prompt_done":
      return chat;
    case "fatal":
      return {
        ...chat,
        status: "error",
        error: event.message,
        isStreaming: false,
        streamingSince: undefined,
      };
    default:
      return chat;
  }
}

// ---------- store ----------

export const useAppStore = create<AppState>((set, get) => ({
  chats: {},
  chatOrder: [],
  activeChatId: undefined,
  recentProjects: loadProjects(),
  activeProjectPath: loadProjects()[0]?.path,
  activeProjectIsGit: false,
  sessions: [],
  sessionsLoading: false,
  models: [],
  providers: [],
  settingsOpen: false,
  sidebarCollapsed: false,
  sessionTimeFilter: loadTimeFilter(),
  updateInfo: undefined,
  updateChecking: false,
  theme: loadThemePreference(),
  locale: loadLocalePreference(),
  activeView: "home",
  paletteOpen: false,
  resourcesOpen: false,
  usageOpen: false,
  monitorOpen: false,
  shortcutsOpen: false,
  scheduledTasks: [],
  appMode: loadAppMode(),
  dailyCwd: undefined,
  defaultProjectCwd: undefined,
  preferredModel: loadPreferredModel(),
  modelThinking: loadModelThinking(),
  codingPresetId: loadCodingPreset(),
  workspaceTerm: EMPTY_WORKSPACE_TERM,
  workspaceSandboxOpen: false,
  workspaceSandbox: undefined,
  e2bConfigured: false,
  workspaceFilesOpen: false,

  setTheme(pref) {
    applyTheme(pref);
    set({ theme: pref });
  },

  setLocale(locale) {
    applyLocale(locale);
    set({ locale });
  },

  toggleSidebar() {
    set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }));
  },

  setSessionTimeFilter(filter) {
    try {
      localStorage.setItem(TIME_FILTER_KEY, filter);
    } catch {
      // ignore
    }
    set({ sessionTimeFilter: filter });
  },

  async checkForUpdates(force) {
    if (get().updateChecking) return;
    set({ updateChecking: true });
    try {
      const info = await window.pi.updates.check(force);
      set({ updateInfo: info });
      // 每个新版本只弹一次系统通知；手动检查时用户就在界面上，无需再弹
      if (info.hasUpdate && info.latest && !force && Notification.permission !== "denied") {
        let notified: string | null = null;
        try {
          notified = localStorage.getItem(UPDATE_NOTIFIED_KEY);
        } catch {
          // ignore
        }
        if (notified !== info.latest) {
          const locale = get().locale;
          const n = new Notification(translate(locale, "updates.notifyTitle"), {
            body: translate(locale, "updates.notifyBody", {
              latest: info.latest,
              current: info.current,
            }),
          });
          n.onclick = () => window.open(info.url);
          try {
            localStorage.setItem(UPDATE_NOTIFIED_KEY, info.latest);
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // main 侧未就绪时忽略
    } finally {
      set({ updateChecking: false });
    }
  },

  setPreferredModel(model) {
    try {
      localStorage.setItem(PREFERRED_MODEL_KEY, JSON.stringify(model));
    } catch {
      // ignore
    }
    set({ preferredModel: model });
  },

  setCodingPreset(id) {
    try {
      localStorage.setItem(CODING_PRESET_KEY, id);
    } catch {
      // ignore
    }
    set({ codingPresetId: id });
  },

  setAppMode(mode) {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      // ignore
    }
    const s = get();
    const current = s.activeChatId ? s.chats[s.activeChatId] : undefined;
    const sameKind = current && current.kind === mode ? current.chatId : undefined;
    const fallback = [...s.chatOrder]
      .reverse()
      .map((id) => s.chats[id])
      .find((c) => c?.kind === mode)?.chatId;
    const nextId = sameKind ?? fallback;
    // 欢迎页上切模式只换预设，不跳走，避免输入框整块抖动。
    if (s.activeView === "welcome") {
      set({ appMode: mode });
    } else {
      set({
        appMode: mode,
        activeChatId: nextId,
        activeView: nextId ? "chat" : "home",
      });
    }
    void window.pi.config.set({ appMode: mode });
    void get().refreshSessions();
  },

  async newChat(options) {
    const s = get();
    if (s.appMode === "daily") {
      let cwd = s.dailyCwd;
      if (!cwd) {
        cwd = await window.pi.system.dailyCwd();
        set({ dailyCwd: cwd });
      }
      await get().openChat({ cwd, kind: "daily", initialPrompt: options?.initialPrompt });
      return;
    }
    if (!s.activeProjectPath) await get().selectDefaultProject();
    const cwd = get().activeProjectPath;
    if (!cwd) return;
    await get().openChat({
      cwd,
      kind: "coding",
      presetId: s.codingPresetId,
      initialPrompt: options?.initialPrompt,
    });
  },

  handleEnvelope(envelope) {
    const { chatId, event } = envelope;
    const chat = get().chats[chatId];
    if (!chat) return;
    // 任何 host 事件都视为该会话的存活证据（监控面板"疑似无响应"判定依据）
    const next = { ...applyHostEvent(chat, event), lastEventAt: Date.now() };
    set((s) => ({ chats: { ...s.chats, [chatId]: next } }));
    // Remember which preset this session ran with, for future reopens.
    if (event.type === "ready" && next.sessionFile) {
      rememberSessionPreset(next.sessionFile, next.presetId);
    }
    // Welcome-screen flow: fire the initial prompt once the host is ready.
    if (event.type === "ready" && next.pendingPrompt) {
      const prompt = next.pendingPrompt;
      set((s) => ({
        chats: { ...s.chats, [chatId]: { ...s.chats[chatId], pendingPrompt: undefined } },
      }));
      get().sendPrompt(chatId, prompt);
    }
    // Session export finished: reveal the file.
    if (event.type === "exported") {
      void window.pi.system.revealPath(event.path);
    }
    // Session list metadata (names, counts) changes as the agent works.
    if (event.type === "session_event") {
      const t = (event.event as { type?: string }).type;
      if (t === "session_info_changed" || t === "agent_end") {
        void get().refreshSessions();
      }
      if (t === "agent_end" && !document.hasFocus() && Notification.permission !== "denied") {
        const tr = (key: string, vars?: Record<string, string | number>) =>
          translate(get().locale, key, vars);
        new Notification("Bivor", {
          body: tr(next.kind === "daily" ? "notify.replyDone" : "notify.taskDone", {
            name: next.sessionName ?? tr("notify.session"),
          }),
          silent: false,
        });
      }
    }
    // Approval visibility: notify when the request lands off-screen, and keep
    // the dock badge equal to the number of approvals waiting anywhere.
    if (event.type === "approval_request") {
      const offScreen = get().activeChatId !== chatId || !document.hasFocus();
      if (offScreen && Notification.permission !== "denied") {
        const tr = (key: string, vars?: Record<string, string | number>) =>
          translate(get().locale, key, vars);
        const n = new Notification(tr("notify.needApproval"), {
          body: tr("notify.approvalBody", {
            name: next.sessionName ?? tr("notify.session"),
            tool: `${event.request.toolName}${event.request.rule ? ` (${event.request.rule})` : ""}`,
          }),
        });
        n.onclick = () => {
          window.focus();
          get().setActiveChat(chatId);
        };
      }
    }
    if (event.type === "approval_request" || event.type === "approval_resolved") {
      const total = Object.values(get().chats).reduce(
        (sum, c) => sum + c.pendingApprovals.length,
        0,
      );
      window.pi.system.setBadge(total);
    }
  },

  openProject(path) {
    if (samePath(path, get().defaultProjectCwd)) {
      void get().selectDefaultProject();
      return;
    }
    const projects = [
      { path, lastOpenedAt: Date.now() },
      ...excludeDefault(get().recentProjects, get().defaultProjectCwd).filter((p) => !samePath(p.path, path)),
    ].slice(0, 20);
    saveProjects(projects);
    const same = samePath(get().activeProjectPath, path);
    set((s) => ({
      recentProjects: projects,
      activeProjectPath: path,
      activeProjectIsGit: false,
      workspaceTerm: same ? s.workspaceTerm : resetWorkspaceTerm(s.workspaceTerm.userTerms),
    }));
    void get().refreshSessions();
    void window.pi.worktrees.isGitRepo(path).then((isGit) => {
      if (samePath(get().activeProjectPath, path)) set({ activeProjectIsGit: isGit });
    });
  },

  removeRecentProject(path) {
    if (samePath(path, get().defaultProjectCwd)) return;
    const projects = get().recentProjects.filter((p) => !samePath(p.path, path));
    saveProjects(projects);
    set({ recentProjects: projects });
    if (samePath(get().activeProjectPath, path)) void get().selectDefaultProject();
  },

  async pickAndOpenProject() {
    const { path } = await window.pi.system.pickFolder();
    if (path) get().openProject(path);
  },

  async selectDefaultProject() {
    const cwd = await resolveDefaultCwd(get, set);
    if (samePath(get().activeProjectPath, cwd)) return;
    set((s) => ({
      activeProjectPath: cwd,
      activeProjectIsGit: false,
      workspaceTerm: resetWorkspaceTerm(s.workspaceTerm.userTerms),
    }));
    void get().refreshSessions();
  },

  async refreshSessions() {
    const s = get();
    const cwd = s.appMode === "daily" ? s.dailyCwd : s.activeProjectPath;
    if (!cwd) {
      set({ sessions: [] });
      return;
    }
    set({ sessionsLoading: true });
    try {
      const sessions = await window.pi.sessions.list(cwd);
      if ((s.appMode === "daily" ? get().dailyCwd : get().activeProjectPath) === cwd) {
        set({ sessions, sessionsLoading: false });
      }
    } catch {
      set({ sessionsLoading: false });
    }
  },

  async openChat({ cwd, sessionFile, initialPrompt, worktree, kind, presetId }) {
    const resolvedKind: ChatKind =
      kind ?? (cwd === get().dailyCwd ? "daily" : get().appMode);
    // preset 解析顺序：显式指定 > 该会话上次使用的 preset > 按模式的默认值
    const resolvedPreset =
      presetId ??
      (sessionFile ? loadSessionPresets()[sessionFile] : undefined) ??
      (resolvedKind === "daily" ? "daily" : get().codingPresetId);
    // If a chat for this session file is already open, focus it.
    if (sessionFile) {
      const existing = Object.values(get().chats).find((c) => c.sessionFile === sessionFile);
      if (existing) {
        set({ activeChatId: existing.chatId, activeView: "chat" });
        return;
      }
      // Guard against a double-open race (two clicks before create resolves):
      // both would pass the check above and spawn two hosts writing one JSONL.
      const opening = openingSessions.get(sessionFile);
      if (opening) {
        await opening;
        const now = Object.values(get().chats).find((c) => c.sessionFile === sessionFile);
        if (now) set({ activeChatId: now.chatId, activeView: "chat" });
        return;
      }
    }
    const preferred = get().preferredModel;
    const preferredThinking = thinkingLevelOf(get().modelThinking, preferred);
    const createPromise = window.pi.chat.create({
      cwd,
      sessionFile,
      kind: resolvedKind,
      presetId: resolvedPreset,
      locale: get().locale,
      // 续开旧会话时不要覆盖它自己保存的思考等级
      ...(sessionFile ? {} : { thinkingLevel: preferredThinking }),
      ...(!sessionFile && preferred
        ? { model: { provider: preferred.provider, modelId: preferred.id } }
        : {}),
    });
    if (sessionFile) openingSessions.set(sessionFile, createPromise.then(() => undefined));
    let chatId: string;
    try {
      ({ chatId } = await createPromise);
    } finally {
      if (sessionFile) openingSessions.delete(sessionFile);
    }
    const chat: ChatState = {
      chatId,
      cwd,
      kind: resolvedKind,
      presetId: resolvedPreset,
      status: "initializing",
      thinkingLevel: sessionFile ? "off" : preferredThinking,
      model: sessionFile ? undefined : get().preferredModel,
      isStreaming: false,
      messages: [],
      toolRuns: {},
      queue: { steering: [], followUp: [] },
      compacting: false,
      pendingPrompt: initialPrompt,
      treeOpen: false,
      filesOpen: false,
      worktree,
      bashRunning: false,
      bashOutput: "",
      checkpoints: {},
      restoringCheckpoint: false,
      harnessOpen: false,
      harnessBusy: false,
      sandboxOpen: false,
      policyEvents: [],
      pendingApprovals: [],
    };
    const runningVm =
      get().workspaceSandbox?.status === "running" || get().workspaceSandbox?.status === "creating";
    if (runningVm) void window.pi.workspaceSandbox.destroy();
    set((s) => ({
      chats: { ...s.chats, [chatId]: chat },
      chatOrder: [...s.chatOrder, chatId],
      activeChatId: chatId,
      activeView: "chat",
      workspaceTerm: resetWorkspaceTerm(s.workspaceTerm.userTerms),
      workspaceSandboxOpen: false,
      workspaceFilesOpen: false,
      workspaceSandbox: runningVm ? { status: "none" } : s.workspaceSandbox,
    }));
  },

  async openWorktreeChat(options) {
    const projectPath = get().activeProjectPath;
    if (!projectPath) return;
    const { path, branch } = await window.pi.worktrees.create(
      projectPath,
      options?.taskHint,
      options?.baseBranch,
    );
    await get().openChat({
      cwd: path,
      kind: "coding",
      worktree: { branch, projectPath },
      initialPrompt: options?.initialPrompt,
    });
  },

  closeChat(chatId) {
    window.pi.chat.dispose(chatId);
    set((s) => {
      const chats = { ...s.chats };
      delete chats[chatId];
      const chatOrder = s.chatOrder.filter((id) => id !== chatId);
      const activeChatId =
        s.activeChatId === chatId ? chatOrder[chatOrder.length - 1] : s.activeChatId;
      return {
        chats,
        chatOrder,
        activeChatId,
        activeView: activeChatId ? s.activeView : "home",
      };
    });
  },

  setActiveChat(chatId) {
    const chat = get().chats[chatId];
    if (chat && chat.kind !== get().appMode) {
      try {
        localStorage.setItem(MODE_KEY, chat.kind);
      } catch {
        // ignore
      }
      set({ appMode: chat.kind });
      void window.pi.config.set({ appMode: chat.kind });
      void get().refreshSessions();
    }
    set({ activeChatId: chatId, activeView: "chat" });
  },

  showHome() {
    set({ activeView: "home" });
  },

  showWelcome() {
    set({ activeView: "welcome" });
  },

  setPaletteOpen(open) {
    set({ paletteOpen: open });
  },

  setResourcesOpen(open, tab) {
    set({ resourcesOpen: open, resourcesTab: open ? tab : undefined });
  },

  setUsageOpen(open) {
    set({ usageOpen: open });
  },

  setMonitorOpen(open) {
    set({ monitorOpen: open });
  },

  setShortcutsOpen(open) {
    set({ shortcutsOpen: open });
  },

  setDeploymentsOpen(open) {
    if (open) set({ activeView: "deployments" });
    else if (get().activeView === "deployments") set({ activeView: "welcome" });
  },

  requestHarness(chatId) {
    window.pi.chat.command(chatId, { type: "get_harness" });
  },

  setHarnessOpen(chatId, open) {
    set((s) => {
      const chat = s.chats[chatId];
      if (!chat) return s;
      return { chats: { ...s.chats, [chatId]: { ...chat, harnessOpen: open } } };
    });
    if (open) get().requestHarness(chatId);
  },

  applyHarness(chatId, config) {
    set((s) => {
      const chat = s.chats[chatId];
      if (!chat) return s;
      return { chats: { ...s.chats, [chatId]: { ...chat, harnessBusy: true } } };
    });
    window.pi.chat.command(chatId, { type: "set_harness", ...config });
  },

  requestGuardrails(chatId) {
    window.pi.chat.command(chatId, { type: "get_guardrails" });
  },

  applyGuardrails(chatId, guardrails) {
    window.pi.chat.command(chatId, { type: "set_guardrails", guardrails });
  },

  respondApproval(chatId, id, approved) {
    window.pi.chat.command(chatId, { type: "approval_response", id, approved });
  },

  harnessPresets: [],

  async loadPresets() {
    const cfg = await window.pi.config.get();
    set({ harnessPresets: cfg.harnessPresets ?? [] });
  },

  async saveHarnessPreset(chatId, name) {
    const chat = get().chats[chatId];
    if (!chat?.harness) return;
    const preset: HarnessPreset = {
      name,
      disabledSkills: chat.harness.skills.filter((s) => s.disabled).map((s) => s.name),
      disabledExtensions: chat.harness.extensions.filter((e) => e.disabled).map((e) => e.path),
      extraSystemPrompt: chat.harness.extraSystemPrompt,
      guardrails: chat.guardrails,
    };
    const next = [...get().harnessPresets.filter((p) => p.name !== name), preset];
    await window.pi.config.set({ harnessPresets: next });
    set({ harnessPresets: next });
  },

  applyHarnessPreset(chatId, preset) {
    get().applyHarness(chatId, {
      disabledSkills: preset.disabledSkills,
      disabledExtensions: preset.disabledExtensions,
      extraSystemPrompt: preset.extraSystemPrompt,
    });
    if (preset.guardrails) get().applyGuardrails(chatId, preset.guardrails);
  },

  async deleteHarnessPreset(name) {
    const next = get().harnessPresets.filter((p) => p.name !== name);
    await window.pi.config.set({ harnessPresets: next });
    set({ harnessPresets: next });
  },

  setSandboxOpen(chatId, open) {
    set((s) => {
      const chat = s.chats[chatId];
      if (!chat) return s;
      return { chats: { ...s.chats, [chatId]: { ...chat, sandboxOpen: open } } };
    });
    if (open) window.pi.chat.command(chatId, { type: "sandbox_status" });
  },

  setWorkspaceSandboxOpen(open) {
    set({ workspaceSandboxOpen: open });
    if (open) {
      void window.pi.workspaceSandbox.get().then((r) => {
        set({
          e2bConfigured: r.configured,
          workspaceSandbox: r.configured ? r.sandbox : undefined,
        });
      });
    }
  },

  setWorkspaceSandboxStatus(status, configured) {
    set((s) => ({
      workspaceSandbox: status,
      e2bConfigured: configured ?? s.e2bConfigured,
    }));
  },

  createWorkspaceSandbox() {
    set({ workspaceSandbox: { status: "creating" } });
    void window.pi.workspaceSandbox.create();
  },

  destroyWorkspaceSandbox() {
    void window.pi.workspaceSandbox.destroy();
  },

  setTermOpen(chatId, open) {
    if (chatId === WORKSPACE_TERM_ID) {
      set((s) => ({ workspaceTerm: { ...s.workspaceTerm, open } }));
      return;
    }
    set((s) => {
      const chat = s.chats[chatId];
      if (!chat) return s;
      return { chats: { ...s.chats, [chatId]: { ...chat, termOpen: open } } };
    });
  },

  createSandbox(chatId) {
    window.pi.chat.command(chatId, { type: "sandbox_create" });
  },

  destroySandbox(chatId) {
    window.pi.chat.command(chatId, { type: "sandbox_destroy" });
  },

  setExecutionWorld(chatId, world) {
    window.pi.chat.command(chatId, { type: "set_execution_world", world });
  },

  clearLocalTerm(chatId) {
    set((s) => {
      const chat = s.chats[chatId];
      if (!chat) return s;
      return { chats: { ...s.chats, [chatId]: { ...chat, localTerm: [] } } };
    });
  },

  setLocalSandbox(chatId, mode) {
    window.pi.chat.command(chatId, { type: "set_local_sandbox", mode });
  },

  addUserTerminal(chatId, cwd) {
    const termId = crypto.randomUUID();
    if (chatId === WORKSPACE_TERM_ID) {
      set((s) => ({
        workspaceTerm: {
          ...s.workspaceTerm,
          userTerms: [...s.workspaceTerm.userTerms, termId],
          localTab: termId,
          termCwds: cwd ? { ...s.workspaceTerm.termCwds, [termId]: cwd } : s.workspaceTerm.termCwds,
        },
      }));
      return;
    }
    set((s) => {
      const chat = s.chats[chatId];
      if (!chat) return s;
      return {
        chats: {
          ...s.chats,
          [chatId]: {
            ...chat,
            userTerms: [...(chat.userTerms ?? []), termId],
            localTab: termId,
            termCwds: cwd ? { ...chat.termCwds, [termId]: cwd } : chat.termCwds,
          },
        },
      };
    });
  },

  ensureUserTerminal(chatId) {
    if (chatId === WORKSPACE_TERM_ID) {
      if (get().workspaceTerm.userTerms.length > 0) return;
      get().addUserTerminal(chatId);
      return;
    }
    const chat = get().chats[chatId];
    if (!chat || (chat.userTerms ?? []).length > 0 || chat.agentTermUsed) return;
    get().addUserTerminal(chatId);
  },

  removeUserTerminal(chatId, termId) {
    window.pi.term.dispose(termId);
    if (chatId === WORKSPACE_TERM_ID) {
      set((s) => {
        const userTerms = s.workspaceTerm.userTerms.filter((id) => id !== termId);
        const localTab =
          s.workspaceTerm.localTab === termId
            ? userTerms[userTerms.length - 1]
            : s.workspaceTerm.localTab;
        const termCwds = { ...s.workspaceTerm.termCwds };
        delete termCwds[termId];
        return { workspaceTerm: { ...s.workspaceTerm, userTerms, localTab, termCwds } };
      });
      return;
    }
    set((s) => {
      const chat = s.chats[chatId];
      if (!chat) return s;
      const userTerms = (chat.userTerms ?? []).filter((id) => id !== termId);
      const localTab =
        chat.localTab === termId ? (userTerms[userTerms.length - 1] ?? "agent") : chat.localTab;
      const termCwds = { ...chat.termCwds };
      delete termCwds[termId];
      return { chats: { ...s.chats, [chatId]: { ...chat, userTerms, localTab, termCwds } } };
    });
  },

  setLocalTab(chatId, tab) {
    if (chatId === WORKSPACE_TERM_ID) {
      set((s) => ({ workspaceTerm: { ...s.workspaceTerm, localTab: tab } }));
      return;
    }
    set((s) => {
      const chat = s.chats[chatId];
      if (!chat) return s;
      return { chats: { ...s.chats, [chatId]: { ...chat, localTab: tab } } };
    });
  },

  dismissSubagent(chatId, id) {
    set((s) => {
      const chat = s.chats[chatId];
      if (!chat?.subagents?.[id] || chat.subagents[id].state === "running") return s;
      const subagents = { ...chat.subagents };
      delete subagents[id];
      return { chats: { ...s.chats, [chatId]: { ...chat, subagents } } };
    });
  },

  sendPrompt(chatId, text, options) {
    const chat = get().chats[chatId];
    if (!chat || chat.status !== "ready") return;
    if (chat.isStreaming) {
      const mode = options?.mode ?? "steer";
      const imgs = options?.images;
      window.pi.chat.command(chatId, {
        type: mode,
        text,
        ...(imgs && imgs.length > 0 ? { images: imgs } : {}),
      });
      return;
    }
    const images = options?.images;
    const content =
      images && images.length > 0
        ? [
            { type: "text", text },
            ...images.map((img) => ({ type: "image", data: img.data, mimeType: img.mimeType })),
          ]
        : text;
    const optimistic = {
      role: "user",
      content,
      timestamp: Date.now(),
      __optimistic: true,
    } as unknown as PiMessage;
    const messageIndex = chat.messages.length;
    set((s) => ({
      chats: {
        ...s.chats,
        [chatId]: {
          ...chat,
          messages: [...chat.messages, optimistic],
          isStreaming: true,
          streamingSince: chat.streamingSince ?? Date.now(),
          lastError: undefined,
        },
      },
    }));
    // Snapshot the working tree first so this turn's file changes can be
    // rolled back. Daily chat has no project workspace — skip checkpoints.
    const afterCheckpoint = (): void => {
      window.pi.chat.command(chatId, {
        type: "prompt",
        text,
        ...(images && images.length > 0 ? { images } : {}),
      });
    };
    if (chat.kind === "daily") {
      afterCheckpoint();
      return;
    }
    void window.pi.checkpoints
      .create(chat.cwd)
      .then((cp) => {
        if (!cp) return;
        set((s) => {
          const c = s.chats[chatId];
          if (!c) return s;
          return {
            chats: {
              ...s.chats,
              [chatId]: {
                ...c,
                checkpoints: { ...c.checkpoints, [messageIndex]: { id: cp.id, time: Date.now() } },
                baselineCheckpointId: c.baselineCheckpointId ?? cp.id,
              },
            },
          };
        });
      })
      .catch(() => undefined)
      .finally(() => {
        afterCheckpoint();
      });
  },

  abort(chatId) {
    window.pi.chat.command(chatId, { type: "abort" });
  },

  clearQueue(chatId) {
    window.pi.chat.command(chatId, { type: "clear_queue" });
  },

  abortRetry(chatId) {
    window.pi.chat.command(chatId, { type: "abort_retry" });
  },

  requestTree(chatId) {
    window.pi.chat.command(chatId, { type: "get_tree" });
  },

  setTreeOpen(chatId, open) {
    set((s) => {
      const chat = s.chats[chatId];
      if (!chat) return s;
      return { chats: { ...s.chats, [chatId]: { ...chat, treeOpen: open } } };
    });
    if (open) get().requestTree(chatId);
  },

  setFilesOpen(chatId, open) {
    set((s) => {
      const chat = s.chats[chatId];
      if (!chat) return s;
      return { chats: { ...s.chats, [chatId]: { ...chat, filesOpen: open } } };
    });
  },

  setWorkspaceFilesOpen(open) {
    set({ workspaceFilesOpen: open });
  },

  fork(chatId, entryId, summarize) {
    window.pi.chat.command(chatId, { type: "fork", entryId, summarize });
  },

  forkAtUserMessage(chatId, userIndex) {
    window.pi.chat.command(chatId, { type: "fork_user_message", userIndex });
  },

  respondTrust(chatId, trusted, remember) {
    window.pi.chat.command(chatId, { type: "trust_response", trusted, remember });
    set((s) => {
      const chat = s.chats[chatId];
      if (!chat) return s;
      return { chats: { ...s.chats, [chatId]: { ...chat, trustRequest: undefined } } };
    });
  },

  consumeDraft(chatId) {
    set((s) => {
      const chat = s.chats[chatId];
      if (!chat) return s;
      return { chats: { ...s.chats, [chatId]: { ...chat, draft: undefined } } };
    });
  },

  runBash(chatId, command) {
    set((s) => {
      const chat = s.chats[chatId];
      if (!chat) return s;
      return {
        chats: { ...s.chats, [chatId]: { ...chat, bashRunning: true, bashOutput: `$ ${command}\n` } },
      };
    });
    window.pi.chat.command(chatId, { type: "bash", command });
  },

  abortBash(chatId) {
    window.pi.chat.command(chatId, { type: "abort_bash" });
  },

  requestStats(chatId) {
    window.pi.chat.command(chatId, { type: "get_stats" });
  },

  requestTools(chatId) {
    window.pi.chat.command(chatId, { type: "list_tools" });
  },

  setTools(chatId, names) {
    window.pi.chat.command(chatId, { type: "set_tools", names });
  },

  requestTrajectory(chatId) {
    window.pi.chat.command(chatId, { type: "get_trajectory" });
  },

  async restoreCheckpoint(chatId, checkpointId) {
    const chat = get().chats[chatId];
    if (!chat) return 0;
    set((s) => ({
      chats: { ...s.chats, [chatId]: { ...s.chats[chatId], restoringCheckpoint: true } },
    }));
    try {
      const { restoredFiles } = await window.pi.checkpoints.restore(chat.cwd, checkpointId);
      return restoredFiles;
    } finally {
      set((s) => {
        const c = s.chats[chatId];
        return c
          ? { chats: { ...s.chats, [chatId]: { ...c, restoringCheckpoint: false } } }
          : s;
      });
    }
  },

  setModel(chatId, model) {
    get().setPreferredModel(model);
    window.pi.chat.command(chatId, { type: "set_model", provider: model.provider, modelId: model.id });
    // 每个模型带着自己的思考设置，切模型时把它的等级一并生效
    window.pi.chat.command(chatId, {
      type: "set_thinking_level",
      level: thinkingLevelOf(get().modelThinking, model),
    });
  },

  setModelThinking(model, level, chatId) {
    const next = { ...get().modelThinking, [modelThinkingKey(model)]: level };
    set({ modelThinking: next });
    try {
      localStorage.setItem(MODEL_THINKING_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
    if (!chatId) return;
    const current = get().chats[chatId]?.model;
    if (current && current.provider === model.provider && current.id === model.id) {
      window.pi.chat.command(chatId, { type: "set_thinking_level", level });
    }
  },

  compact(chatId) {
    window.pi.chat.command(chatId, { type: "compact" });
  },

  requestContext(chatId) {
    window.pi.chat.command(chatId, { type: "get_context" });
  },

  setAutoCompaction(chatId, enabled) {
    window.pi.chat.command(chatId, { type: "set_auto_compaction", enabled });
  },

  async renameSession(path, name) {
    // If the session is open in a chat, rename through its host to avoid
    // concurrent writes to the same JSONL file.
    const open = Object.values(get().chats).find((c) => c.sessionFile === path);
    if (open) {
      window.pi.chat.command(open.chatId, { type: "set_name", name });
    } else {
      await window.pi.sessions.rename(path, name);
    }
    await get().refreshSessions();
  },

  async deleteSession(path) {
    const open = Object.values(get().chats).find((c) => c.sessionFile === path);
    if (open) get().closeChat(open.chatId);
    await window.pi.sessions.delete(path);
    await get().refreshSessions();
  },

  async loadCatalog() {
    const projectPath = get().activeProjectPath;
    if (projectPath) {
      void window.pi.worktrees.isGitRepo(projectPath).then((isGit) => {
        if (get().activeProjectPath === projectPath) set({ activeProjectIsGit: isGit });
      });
    }
    try {
      const [models, providers, config, dailyCwd, defaultProjectCwd] = await Promise.all([
        window.pi.models.list(),
        window.pi.providers.list(),
        window.pi.config.get(),
        window.pi.system.dailyCwd(),
        window.pi.system.defaultProjectCwd(),
      ]);
      const appMode =
        config.appMode === "daily" || config.appMode === "coding" ? config.appMode : get().appMode;
      try {
        localStorage.setItem(MODE_KEY, appMode);
      } catch {
        // ignore
      }
      const recentProjects = excludeDefault(get().recentProjects, defaultProjectCwd);
      if (recentProjects.length !== get().recentProjects.length) saveProjects(recentProjects);
      set({
        models,
        providers,
        dailyCwd,
        defaultProjectCwd,
        appMode,
        recentProjects,
        e2bConfigured: Boolean(config.e2bApiKey),
        ...(!get().activeProjectPath ? { activeProjectPath: defaultProjectCwd, activeProjectIsGit: false } : {}),
      });
      const authed = new Set(providers.filter((p) => p.authenticated).map((p) => p.id));
      const current = get().preferredModel;
      if (!current || !authed.has(current.provider)) {
        const fallback = models.find((m) => authed.has(m.provider));
        if (fallback) get().setPreferredModel(fallback);
      }
      void get().refreshSessions();
    } catch (err) {
      console.error("加载模型目录失败", err);
    }
  },

  setSettingsOpen(open, tab) {
    set({ settingsOpen: open, settingsTab: open ? tab : undefined });
    if (!open) {
      // Provider auth may have changed
      void get().loadCatalog();
    }
  },

  // ---------- scheduled tasks ----------

  setScheduledTasksOpen(open) {
    if (open) {
      set({ activeView: "schedule" });
      void get().refreshScheduledTasks();
    } else if (get().activeView === "schedule") {
      set({ activeView: "welcome" });
    }
  },

  async refreshScheduledTasks() {
    try {
      set({ scheduledTasks: await window.pi.schedule.list() });
    } catch {
      // main 侧未就绪时忽略
    }
  },

  async saveScheduledTask(task) {
    set({ scheduledTasks: await window.pi.schedule.save(task) });
  },

  async deleteScheduledTask(id) {
    set({ scheduledTasks: await window.pi.schedule.delete(id) });
  },

  async runScheduledTaskNow(id) {
    set({ scheduledTasks: await window.pi.schedule.runNow(id) });
  },

  handleScheduleTrigger(task) {
    void get().openChat({
      cwd: task.cwd,
      kind: task.kind,
      presetId: task.presetId,
      initialPrompt: task.prompt,
    });
  },
}));
