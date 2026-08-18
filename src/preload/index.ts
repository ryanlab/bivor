import { homedir } from "node:os";
import { join } from "node:path";
import { contextBridge, ipcRenderer } from "electron";
import type {
  AgentCrashPayload,
  AgentMonitorSnapshot,
  AppConfigPayload,
  AppVersions,
  AuthFlowEvent,
  ChatCreateOptions,
  ChatCreateResult,
  CheckpointFileContent,
  CheckpointFileDiff,
  EditorOpenFile,
  EditorSession,
  FilesChangedPayload,
  GitHeadFile,
  GitStatusEntry,
  HostCommand,
  HostEventEnvelope,
  McpConfigInfo,
  ModelInfo,
  PackageItem,
  PackageProgressPayload,
  ProjectFileRead,
  ProviderInfo,
  SessionListItem,
  SessionSearchHit,
  UsageStats,
  WorktreeMergeResult,
  WorktreeStatusInfo,
  PromptItem,
  ScheduledTask,
  SkillItem,
  VercelDeploymentDetail,
  VercelDeploymentInfo,
  VercelProjectDetail,
  VercelProjectInfo,
  VercelTestResult,
  ApiKeyTestResult,
  CustomProviderDraft,
  SandboxStatusPayload,
  UpdateCheckPayload,
} from "@shared/protocol";
import { IPC } from "@shared/protocol";

function expandUserPath(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return join(homedir(), p.slice(2));
  return p;
}

const api = {
  chat: {
    create: (options: ChatCreateOptions): Promise<ChatCreateResult> =>
      ipcRenderer.invoke(IPC.chatCreate, options),
    command: (chatId: string, command: HostCommand): void => {
      ipcRenderer.send(IPC.chatCommand, chatId, command);
    },
    dispose: (chatId: string): void => {
      ipcRenderer.send(IPC.chatDispose, chatId);
    },
    onEvent: (listener: (envelope: HostEventEnvelope) => void): (() => void) => {
      const handler = (_event: unknown, envelope: HostEventEnvelope): void => listener(envelope);
      ipcRenderer.on(IPC.chatEvent, handler);
      return () => ipcRenderer.removeListener(IPC.chatEvent, handler);
    },
  },
  models: {
    list: (): Promise<ModelInfo[]> => ipcRenderer.invoke(IPC.listModels),
  },
  providers: {
    list: (): Promise<ProviderInfo[]> => ipcRenderer.invoke(IPC.listProviders),
    setApiKey: (providerId: string, key: string): Promise<void> =>
      ipcRenderer.invoke(IPC.setApiKey, providerId, key),
    removeApiKey: (providerId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.removeApiKey, providerId),
    test: (opts: { providerId: string; apiKey: string }): Promise<ApiKeyTestResult> =>
      ipcRenderer.invoke(IPC.testApiKey, opts),
    testEndpoint: (opts: { baseUrl: string; apiKey: string }): Promise<ApiKeyTestResult> =>
      ipcRenderer.invoke(IPC.testCustomEndpoint, opts),
    saveCustom: (draft: CustomProviderDraft): Promise<void> =>
      ipcRenderer.invoke(IPC.saveCustomProvider, draft),
    removeCustom: (id: string): Promise<void> => ipcRenderer.invoke(IPC.removeCustomProvider, id),
  },
  config: {
    get: (): Promise<AppConfigPayload> => ipcRenderer.invoke(IPC.configGet),
    set: (patch: Partial<AppConfigPayload>): Promise<AppConfigPayload> =>
      ipcRenderer.invoke(IPC.configSet, patch),
  },
  bark: {
    test: (opts?: {
      deviceUrl?: string;
      title?: string;
      body?: string;
    }): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IPC.barkTest, opts),
  },
  e2b: {
    test: (opts?: { apiKey?: string }): Promise<ApiKeyTestResult> =>
      ipcRenderer.invoke(IPC.e2bTest, opts),
  },
  tavily: {
    test: (opts?: { apiKey?: string }): Promise<ApiKeyTestResult> =>
      ipcRenderer.invoke(IPC.tavilyTest, opts),
  },
  resources: {
    listPackages: (cwd: string): Promise<PackageItem[]> =>
      ipcRenderer.invoke(IPC.packagesList, cwd),
    installPackage: (cwd: string, source: string, local: boolean): Promise<void> =>
      ipcRenderer.invoke(IPC.packagesInstall, cwd, source, local),
    removePackage: (cwd: string, source: string, local: boolean): Promise<void> =>
      ipcRenderer.invoke(IPC.packagesRemove, cwd, source, local),
    updatePackages: (cwd: string): Promise<void> => ipcRenderer.invoke(IPC.packagesUpdate, cwd),
    onPackageProgress: (listener: (event: PackageProgressPayload) => void): (() => void) => {
      const handler = (_e: unknown, payload: PackageProgressPayload): void => listener(payload);
      ipcRenderer.on(IPC.packagesProgress, handler);
      return () => ipcRenderer.removeListener(IPC.packagesProgress, handler);
    },
    listSkills: (cwd: string): Promise<SkillItem[]> => ipcRenderer.invoke(IPC.skillsList, cwd),
    readSkill: (cwd: string, path: string): Promise<string> =>
      ipcRenderer.invoke(IPC.skillsRead, cwd, path),
    saveSkill: (cwd: string, path: string, content: string): Promise<void> =>
      ipcRenderer.invoke(IPC.skillsSave, cwd, path, content),
    createSkill: (
      scope: "user" | "project",
      cwd: string,
      name: string,
      description: string,
    ): Promise<string> => ipcRenderer.invoke(IPC.skillsCreate, scope, cwd, name, description),
    deleteSkill: (cwd: string, path: string): Promise<void> =>
      ipcRenderer.invoke(IPC.skillsDelete, cwd, path),
    listPrompts: (cwd: string): Promise<PromptItem[]> => ipcRenderer.invoke(IPC.promptsList, cwd),
    readPrompt: (cwd: string, path: string): Promise<string> =>
      ipcRenderer.invoke(IPC.promptsRead, cwd, path),
    savePrompt: (cwd: string, path: string, content: string): Promise<void> =>
      ipcRenderer.invoke(IPC.promptsSave, cwd, path, content),
    createPrompt: (
      scope: "user" | "project",
      cwd: string,
      name: string,
      description: string,
    ): Promise<string> => ipcRenderer.invoke(IPC.promptsCreate, scope, cwd, name, description),
    deletePrompt: (cwd: string, path: string): Promise<void> =>
      ipcRenderer.invoke(IPC.promptsDelete, cwd, path),
    readMcp: (cwd: string): Promise<McpConfigInfo> => ipcRenderer.invoke(IPC.mcpRead, cwd),
    saveMcp: (cwd: string, path: string, content: string): Promise<void> =>
      ipcRenderer.invoke(IPC.mcpSave, cwd, path, content),
    readMemory: (cwd: string): Promise<{ path: string; content: string }> =>
      ipcRenderer.invoke(IPC.memoryRead, cwd),
    saveMemory: (cwd: string, content: string): Promise<void> =>
      ipcRenderer.invoke(IPC.memorySave, cwd, content),
  },
  checkpoints: {
    create: (cwd: string): Promise<{ id: string; dirtyFiles: number } | null> =>
      ipcRenderer.invoke(IPC.checkpointCreate, cwd),
    restore: (cwd: string, id: string): Promise<{ restoredFiles: number }> =>
      ipcRenderer.invoke(IPC.checkpointRestore, cwd, id),
    diff: (cwd: string, id: string): Promise<CheckpointFileDiff[]> =>
      ipcRenderer.invoke(IPC.checkpointDiff, cwd, id),
    restoreFile: (cwd: string, id: string, path: string): Promise<void> =>
      ipcRenderer.invoke(IPC.checkpointRestoreFile, cwd, id, path),
    readFile: (cwd: string, id: string, path: string): Promise<CheckpointFileContent> =>
      ipcRenderer.invoke(IPC.checkpointReadFile, cwd, id, path),
  },
  editor: {
    open: (session: EditorSession): Promise<void> => ipcRenderer.invoke(IPC.editorOpen, session),
    focus: (): Promise<void> => ipcRenderer.invoke(IPC.editorFocus),
    close: (): Promise<void> => ipcRenderer.invoke(IPC.editorClose),
    isOpen: (): Promise<boolean> => ipcRenderer.invoke(IPC.editorIsOpen),
    getSession: (): Promise<EditorSession | null> => ipcRenderer.invoke(IPC.editorGetSession),
    push: (file: EditorOpenFile): Promise<boolean> => ipcRenderer.invoke(IPC.editorPush, file),
    dock: (): Promise<void> => ipcRenderer.invoke(IPC.editorDock),
    report: (session: EditorSession): void => {
      ipcRenderer.send(IPC.editorState, session);
    },
    onInit: (listener: (session: EditorSession) => void): (() => void) => {
      const handler = (_e: unknown, session: EditorSession): void => listener(session);
      ipcRenderer.on(IPC.editorInit, handler);
      return () => ipcRenderer.removeListener(IPC.editorInit, handler);
    },
    onOpenFile: (listener: (file: EditorOpenFile) => void): (() => void) => {
      const handler = (_e: unknown, file: EditorOpenFile): void => listener(file);
      ipcRenderer.on(IPC.editorOpenFile, handler);
      return () => ipcRenderer.removeListener(IPC.editorOpenFile, handler);
    },
    onOpened: (listener: (session: EditorSession) => void): (() => void) => {
      const handler = (_e: unknown, session: EditorSession): void => listener(session);
      ipcRenderer.on(IPC.editorOpened, handler);
      return () => ipcRenderer.removeListener(IPC.editorOpened, handler);
    },
    onClosed: (listener: (session: EditorSession | null) => void): (() => void) => {
      const handler = (_e: unknown, session: EditorSession | null): void => listener(session);
      ipcRenderer.on(IPC.editorClosed, handler);
      return () => ipcRenderer.removeListener(IPC.editorClosed, handler);
    },
    onChanged: (listener: (session: EditorSession) => void): (() => void) => {
      const handler = (_e: unknown, session: EditorSession): void => listener(session);
      ipcRenderer.on(IPC.editorChanged, handler);
      return () => ipcRenderer.removeListener(IPC.editorChanged, handler);
    },
  },
  files: {
    list: (cwd: string): Promise<string[]> => ipcRenderer.invoke(IPC.listProjectFiles, cwd),
    tree: (cwd: string): Promise<{ path: string; dir: boolean }[]> =>
      ipcRenderer.invoke(IPC.listProjectTree, cwd),
    create: (cwd: string, parent: string, name: string, dir: boolean): Promise<string> =>
      ipcRenderer.invoke(IPC.filesCreate, cwd, parent, name, dir),
    rename: (cwd: string, from: string, name: string): Promise<string> =>
      ipcRenderer.invoke(IPC.filesRename, cwd, from, name),
    delete: (cwd: string, rel: string): Promise<void> =>
      ipcRenderer.invoke(IPC.filesDelete, cwd, rel),
    copy: (cwd: string, from: string, parent: string): Promise<string> =>
      ipcRenderer.invoke(IPC.filesCopy, cwd, from, parent),
    move: (cwd: string, from: string, parent: string): Promise<string> =>
      ipcRenderer.invoke(IPC.filesMove, cwd, from, parent),
    read: (cwd: string, rel: string): Promise<ProjectFileRead> =>
      ipcRenderer.invoke(IPC.filesRead, cwd, rel),
    write: (cwd: string, rel: string, content: string): Promise<void> =>
      ipcRenderer.invoke(IPC.filesWrite, cwd, rel, content),
    gitStatus: (cwd: string): Promise<GitStatusEntry[]> =>
      ipcRenderer.invoke(IPC.filesGitStatus, cwd),
    readHead: (cwd: string, rel: string): Promise<GitHeadFile> =>
      ipcRenderer.invoke(IPC.filesGitHead, cwd, rel),
    revert: (cwd: string, rel: string): Promise<void> =>
      ipcRenderer.invoke(IPC.filesGitRevert, cwd, rel),
    watch: (cwd: string): Promise<void> => ipcRenderer.invoke(IPC.filesWatch, cwd),
    unwatch: (cwd: string): Promise<void> => ipcRenderer.invoke(IPC.filesUnwatch, cwd),
    onChanged: (listener: (payload: FilesChangedPayload) => void): (() => void) => {
      const handler = (_e: unknown, payload: FilesChangedPayload): void => listener(payload);
      ipcRenderer.on(IPC.filesChanged, handler);
      return () => ipcRenderer.removeListener(IPC.filesChanged, handler);
    },
  },
  worktrees: {
    isGitRepo: (path: string): Promise<boolean> => ipcRenderer.invoke(IPC.isGitRepo, path),
    create: (
      path: string,
      hint?: string,
      baseBranch?: string,
    ): Promise<{ path: string; branch: string }> =>
      ipcRenderer.invoke(IPC.createWorktree, path, hint, baseBranch),
    list: (path: string): Promise<{ path: string; branch: string; isMain: boolean }[]> =>
      ipcRenderer.invoke(IPC.listWorktrees, path),
    branches: (path: string): Promise<{ current: string; branches: string[] }> =>
      ipcRenderer.invoke(IPC.listBranches, path),
    status: (path: string, wt: string, branch: string): Promise<WorktreeStatusInfo> =>
      ipcRenderer.invoke(IPC.worktreeStatus, path, wt, branch),
    merge: (
      path: string,
      wt: string,
      branch: string,
      message?: string,
    ): Promise<WorktreeMergeResult> =>
      ipcRenderer.invoke(IPC.worktreeMerge, path, wt, branch, message),
    remove: (path: string, worktreePath: string, branch?: string): Promise<void> =>
      ipcRenderer.invoke(IPC.removeWorktree, path, worktreePath, branch),
  },
  auth: {
    startLogin: (providerId: string): Promise<string> =>
      ipcRenderer.invoke(IPC.authStartLogin, providerId),
    respondToPrompt: (flowId: string, promptId: string, value: string): void => {
      ipcRenderer.send(IPC.authPromptResponse, flowId, promptId, value);
    },
    cancelLogin: (flowId: string): void => {
      ipcRenderer.send(IPC.authCancelLogin, flowId);
    },
    onFlowEvent: (listener: (event: AuthFlowEvent) => void): (() => void) => {
      const handler = (_event: unknown, payload: AuthFlowEvent): void => listener(payload);
      ipcRenderer.on(IPC.authFlowEvent, handler);
      return () => ipcRenderer.removeListener(IPC.authFlowEvent, handler);
    },
  },
  sessions: {
    list: (cwd?: string): Promise<SessionListItem[]> => ipcRenderer.invoke(IPC.listSessions, cwd),
    search: (cwd: string, query: string): Promise<SessionSearchHit[]> =>
      ipcRenderer.invoke(IPC.searchSessions, cwd, query),
    usage: (cwd: string): Promise<UsageStats> => ipcRenderer.invoke(IPC.usageStats, cwd),
    rename: (path: string, name: string): Promise<void> =>
      ipcRenderer.invoke(IPC.renameSession, path, name),
    delete: (path: string): Promise<void> => ipcRenderer.invoke(IPC.deleteSession, path),
  },
  deployments: {
    configured: (): Promise<boolean> => ipcRenderer.invoke(IPC.deploymentsConfigured),
    projects: (): Promise<VercelProjectInfo[]> => ipcRenderer.invoke(IPC.deploymentsProjects),
    list: (projectId?: string): Promise<VercelDeploymentInfo[]> =>
      ipcRenderer.invoke(IPC.deploymentsList, projectId),
    logs: (id: string): Promise<string> => ipcRenderer.invoke(IPC.deploymentsLogs, id),
    detail: (id: string): Promise<VercelDeploymentDetail> =>
      ipcRenderer.invoke(IPC.deploymentsDetail, id),
    projectDetail: (projectId: string): Promise<VercelProjectDetail> =>
      ipcRenderer.invoke(IPC.deploymentsProjectDetail, projectId),
    cancel: (id: string): Promise<void> => ipcRenderer.invoke(IPC.deploymentsCancel, id),
    delete: (id: string): Promise<void> => ipcRenderer.invoke(IPC.deploymentsDelete, id),
    promote: (projectId: string, id: string): Promise<void> =>
      ipcRenderer.invoke(IPC.deploymentsPromote, projectId, id),
    rollback: (projectId: string, id: string): Promise<void> =>
      ipcRenderer.invoke(IPC.deploymentsRollback, projectId, id),
    test: (opts?: { token?: string; teamId?: string }): Promise<VercelTestResult> =>
      ipcRenderer.invoke(IPC.deploymentsTest, opts),
  },
  schedule: {
    list: (): Promise<ScheduledTask[]> => ipcRenderer.invoke(IPC.scheduleList),
    save: (task: ScheduledTask): Promise<ScheduledTask[]> =>
      ipcRenderer.invoke(IPC.scheduleSave, task),
    delete: (id: string): Promise<ScheduledTask[]> => ipcRenderer.invoke(IPC.scheduleDelete, id),
    runNow: (id: string): Promise<ScheduledTask[]> => ipcRenderer.invoke(IPC.scheduleRunNow, id),
    onChanged: (listener: (tasks: ScheduledTask[]) => void): (() => void) => {
      const handler = (_event: unknown, tasks: ScheduledTask[]): void => listener(tasks);
      ipcRenderer.on(IPC.scheduleChanged, handler);
      return () => ipcRenderer.removeListener(IPC.scheduleChanged, handler);
    },
  },
  workspaceSandbox: {
    get: (): Promise<{ configured: boolean; sandbox?: SandboxStatusPayload }> =>
      ipcRenderer.invoke(IPC.workspaceSandboxGet),
    create: (): Promise<SandboxStatusPayload> => ipcRenderer.invoke(IPC.workspaceSandboxCreate),
    destroy: (): Promise<void> => ipcRenderer.invoke(IPC.workspaceSandboxDestroy),
    onStatus: (listener: (status: SandboxStatusPayload) => void): (() => void) => {
      const handler = (_e: unknown, status: SandboxStatusPayload): void => listener(status);
      ipcRenderer.on(IPC.workspaceSandboxEvent, handler);
      return () => ipcRenderer.removeListener(IPC.workspaceSandboxEvent, handler);
    },
  },
  term: {
    create: (
      chatId: string,
      termId: string,
      cwd: string,
      cols: number,
      rows: number,
    ): Promise<{ backlog: string }> =>
      ipcRenderer.invoke(IPC.termCreate, chatId, termId, cwd, cols, rows),
    input: (termId: string, data: string): void => {
      ipcRenderer.send(IPC.termInput, termId, data);
    },
    resize: (termId: string, cols: number, rows: number): void => {
      ipcRenderer.send(IPC.termResize, termId, cols, rows);
    },
    dispose: (termId: string): void => {
      ipcRenderer.send(IPC.termDispose, termId);
    },
    onData: (listener: (termId: string, data: string) => void): (() => void) => {
      const handler = (_e: unknown, termId: string, data: string): void => listener(termId, data);
      ipcRenderer.on(IPC.termData, handler);
      return () => ipcRenderer.removeListener(IPC.termData, handler);
    },
    onExit: (listener: (termId: string, exitCode: number) => void): (() => void) => {
      const handler = (_e: unknown, termId: string, exitCode: number): void =>
        listener(termId, exitCode);
      ipcRenderer.on(IPC.termExit, handler);
      return () => ipcRenderer.removeListener(IPC.termExit, handler);
    },
  },
  monitor: {
    snapshot: (): Promise<AgentMonitorSnapshot> => ipcRenderer.invoke(IPC.monitorSnapshot),
    kill: (chatId: string): Promise<void> => ipcRenderer.invoke(IPC.monitorKill, chatId),
    onAgentCrash: (listener: (payload: AgentCrashPayload) => void): (() => void) => {
      const handler = (_e: unknown, payload: AgentCrashPayload): void => listener(payload);
      ipcRenderer.on(IPC.monitorAgentCrash, handler);
      return () => ipcRenderer.removeListener(IPC.monitorAgentCrash, handler);
    },
  },
  system: {
    pickFolder: (): Promise<{ path: string | null }> => ipcRenderer.invoke(IPC.pickFolder),
    createFolder: (): Promise<{ path: string | null }> => ipcRenderer.invoke(IPC.createFolder),
    dailyCwd: (): Promise<string> => ipcRenderer.invoke(IPC.dailyCwd),
    defaultProjectCwd: (): Promise<string> => ipcRenderer.invoke(IPC.defaultProjectCwd),
    revealPath: (path: string): void => {
      ipcRenderer.send(IPC.revealPath, expandUserPath(path));
    },
    setBadge: (count: number): void => {
      ipcRenderer.send(IPC.setBadge, count);
    },
    onMenuAction: (listener: (action: string) => void): (() => void) => {
      const handler = (_event: unknown, action: string): void => listener(action);
      ipcRenderer.on("menu:action", handler);
      return () => ipcRenderer.removeListener("menu:action", handler);
    },
    platform: process.platform,
    versions: (): Promise<AppVersions> => ipcRenderer.invoke(IPC.systemVersions),
  },
  updates: {
    check: (force?: boolean): Promise<UpdateCheckPayload> =>
      ipcRenderer.invoke(IPC.updatesCheck, force),
  },
};

export type BivorApi = typeof api;

contextBridge.exposeInMainWorld("pi", api);
