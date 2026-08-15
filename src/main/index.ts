import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import type { ChatCreateOptions, HostCommand, ScheduledTask } from "@shared/protocol";
import { IPC } from "@shared/protocol";
import { createChat, disposeAllChats, disposeChat, sendChatCommand } from "./chats";
import {
  createTerminal,
  disposeAllTerminals,
  disposeChatTerminals,
  disposeTerminal,
  resizeTerminal,
  writeTerminal,
} from "./terminal";
import {
  deleteTask,
  listTasks,
  runTaskNow,
  saveTask,
  startScheduler,
  stopScheduler,
} from "./scheduler";
import { installMenu } from "./menu";
import { mt } from "./i18n";
import { cancelLogin, respondToPrompt, startLogin } from "./auth-flow";
import {
  createCheckpoint,
  diffCheckpoint,
  restoreCheckpoint,
  restoreCheckpointFile,
} from "./checkpoints";
import { getConfig, setConfig } from "./config";
import {
  cancelVercelDeployment,
  deleteVercelDeployment,
  deploymentsConfigured,
  getVercelDeploymentDetail,
  getVercelDeploymentLogs,
  getVercelProjectDetail,
  listVercelDeployments,
  listVercelProjects,
  promoteVercelDeployment,
  redeployVercelDeployment,
  rollbackVercelDeployment,
} from "./deployments";
import {
  createPrompt,
  createSkill,
  deletePrompt,
  deleteSkill,
  installPackage,
  listPackages,
  listPrompts,
  listSkills,
  readMcpConfig,
  readProjectMemory,
  readPrompt,
  readSkill,
  removePackage,
  saveMcpConfig,
  saveProjectMemory,
  savePrompt,
  saveSkill,
  updatePackages,
} from "./resources";
import { listProjectFiles } from "./files";
import {
  createWorktree,
  isGitRepo,
  listBranches,
  listWorktrees,
  mergeWorktree,
  removeWorktree,
  worktreeStatus,
} from "./worktrees";
import {
  getRuntime,
  listModels,
  listProviders,
  listSessions,
  searchSessions,
  usageStats,
  removeApiKey,
  renameSession,
  setApiKey,
} from "./services";

const isDev = !app.isPackaged;
const isMac = process.platform === "darwin";

/** 标题栏行高 48px（h-12），Windows/Linux 的窗口控件 overlay 与之对齐。 */
const TITLEBAR_HEIGHT = 48;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 600,
    show: false,
    // macOS 用 hiddenInset 红绿灯；其他平台用 Window Controls Overlay，
    // 配色由 renderer 在主题切换时通过 IPC 同步。
    ...(isMac
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 16, y: 14 } }
      : {
          titleBarStyle: "hidden" as const,
          titleBarOverlay: { color: "#1f1e1b", symbolColor: "#b8b2a5", height: TITLEBAR_HEIGHT },
        }),
    ...(isDev && !isMac ? { icon: join(app.getAppPath(), "build", "icon.png") } : {}),
    backgroundColor: "#0d0d0f",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.mjs"),
      contextIsolation: true,
      sandbox: false,
      webviewTag: true,
    },
  });

  win.on("ready-to-show", () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
  return win;
}

function registerIpc(): void {
  ipcMain.handle(IPC.chatCreate, (event, options: ChatCreateOptions) => {
    const chatId = createChat(event.sender, options);
    return { chatId };
  });

  ipcMain.on(IPC.chatCommand, (_event, chatId: string, command: HostCommand) => {
    sendChatCommand(chatId, command);
  });

  ipcMain.on(IPC.chatDispose, (_event, chatId: string) => {
    disposeChat(chatId);
    disposeChatTerminals(chatId);
  });

  // 交互终端（用户 shell，每 chat 可开多个 PTY）
  ipcMain.handle(
    IPC.termCreate,
    (event, chatId: string, termId: string, cwd: string, cols: number, rows: number) =>
      createTerminal(event.sender, chatId, termId, cwd, cols, rows),
  );
  ipcMain.on(IPC.termInput, (_e, termId: string, data: string) => writeTerminal(termId, data));
  ipcMain.on(IPC.termResize, (_e, termId: string, cols: number, rows: number) =>
    resizeTerminal(termId, cols, rows),
  );
  ipcMain.on(IPC.termDispose, (_e, termId: string) => disposeTerminal(termId));

  ipcMain.handle(IPC.listModels, () => listModels());
  ipcMain.handle(IPC.listProviders, () => listProviders());
  ipcMain.handle(IPC.setApiKey, (_e, providerId: string, key: string) => setApiKey(providerId, key));
  ipcMain.handle(IPC.removeApiKey, (_e, providerId: string) => removeApiKey(providerId));
  ipcMain.handle(IPC.listSessions, (_e, cwd?: string) => listSessions(cwd));
  ipcMain.handle(IPC.searchSessions, (_e, cwd: string, query: string) =>
    searchSessions(cwd, query),
  );
  ipcMain.handle(IPC.usageStats, (_e, cwd: string) => usageStats(cwd));
  ipcMain.handle(IPC.renameSession, (_e, path: string, name: string) => renameSession(path, name));
  ipcMain.handle(IPC.deleteSession, (_e, path: string) => shell.trashItem(path));
  ipcMain.handle(IPC.configGet, () => getConfig());
  ipcMain.handle(IPC.configSet, (_e, patch: Record<string, unknown>) => {
    const next = setConfig(patch);
    if ("locale" in patch) installMenu();
    return next;
  });
  ipcMain.handle(IPC.packagesList, (_e, cwd: string) => listPackages(cwd));
  ipcMain.handle(IPC.packagesInstall, (e, cwd: string, source: string, local: boolean) =>
    installPackage(cwd, source, local, e.sender),
  );
  ipcMain.handle(IPC.packagesRemove, (e, cwd: string, source: string, local: boolean) =>
    removePackage(cwd, source, local, e.sender),
  );
  ipcMain.handle(IPC.packagesUpdate, (e, cwd: string) => updatePackages(cwd, e.sender));
  ipcMain.handle(IPC.skillsList, (_e, cwd: string) => listSkills(cwd));
  ipcMain.handle(IPC.skillsRead, (_e, cwd: string, path: string) => readSkill(cwd, path));
  ipcMain.handle(IPC.skillsSave, (_e, cwd: string, path: string, content: string) =>
    saveSkill(cwd, path, content),
  );
  ipcMain.handle(
    IPC.skillsCreate,
    (_e, scope: "user" | "project", cwd: string, name: string, description: string) =>
      createSkill(scope, cwd, name, description),
  );
  ipcMain.handle(IPC.skillsDelete, (_e, cwd: string, path: string) => deleteSkill(cwd, path));
  ipcMain.handle(IPC.promptsList, (_e, cwd: string) => listPrompts(cwd));
  ipcMain.handle(IPC.promptsRead, (_e, cwd: string, path: string) => readPrompt(cwd, path));
  ipcMain.handle(IPC.promptsSave, (_e, cwd: string, path: string, content: string) =>
    savePrompt(cwd, path, content),
  );
  ipcMain.handle(
    IPC.promptsCreate,
    (_e, scope: "user" | "project", cwd: string, name: string, description: string) =>
      createPrompt(scope, cwd, name, description),
  );
  ipcMain.handle(IPC.promptsDelete, (_e, cwd: string, path: string) => deletePrompt(cwd, path));
  ipcMain.handle(IPC.mcpRead, (_e, cwd: string) => readMcpConfig(cwd));
  ipcMain.handle(IPC.mcpSave, (_e, cwd: string, path: string, content: string) =>
    saveMcpConfig(cwd, path, content),
  );
  ipcMain.handle(IPC.memoryRead, (_e, cwd: string) => readProjectMemory(cwd));
  ipcMain.handle(IPC.memorySave, (_e, cwd: string, content: string) =>
    saveProjectMemory(cwd, content),
  );
  ipcMain.handle(IPC.checkpointCreate, (_e, cwd: string) => createCheckpoint(cwd));
  ipcMain.handle(IPC.checkpointRestore, (_e, cwd: string, id: string) =>
    restoreCheckpoint(cwd, id),
  );
  ipcMain.handle(IPC.checkpointDiff, (_e, cwd: string, id: string) => diffCheckpoint(cwd, id));
  ipcMain.handle(IPC.checkpointRestoreFile, (_e, cwd: string, id: string, path: string) =>
    restoreCheckpointFile(cwd, id, path),
  );
  ipcMain.handle(IPC.listProjectFiles, (_e, cwd: string) => listProjectFiles(cwd));
  ipcMain.handle(IPC.isGitRepo, (_e, path: string) => isGitRepo(path));
  ipcMain.handle(IPC.createWorktree, (_e, path: string, hint?: string, baseBranch?: string) =>
    createWorktree(path, hint, baseBranch),
  );
  ipcMain.handle(IPC.listWorktrees, (_e, path: string) => listWorktrees(path));
  ipcMain.handle(IPC.listBranches, (_e, path: string) => listBranches(path));
  ipcMain.handle(IPC.removeWorktree, (_e, path: string, wt: string, branch?: string) =>
    removeWorktree(path, wt, branch),
  );
  ipcMain.handle(IPC.worktreeStatus, (_e, path: string, wt: string, branch: string) =>
    worktreeStatus(path, wt, branch),
  );
  ipcMain.handle(
    IPC.worktreeMerge,
    (_e, path: string, wt: string, branch: string, message?: string) =>
      mergeWorktree(path, wt, branch, message),
  );
  ipcMain.handle(IPC.deploymentsConfigured, () => deploymentsConfigured());
  ipcMain.handle(IPC.deploymentsProjects, () => listVercelProjects());
  ipcMain.handle(IPC.deploymentsList, (_e, projectId?: string) =>
    listVercelDeployments(projectId),
  );
  ipcMain.handle(IPC.deploymentsLogs, (_e, id: string) => getVercelDeploymentLogs(id));
  ipcMain.handle(IPC.deploymentsDetail, (_e, id: string) => getVercelDeploymentDetail(id));
  ipcMain.handle(IPC.deploymentsProjectDetail, (_e, projectId: string) =>
    getVercelProjectDetail(projectId),
  );
  ipcMain.handle(IPC.deploymentsCancel, (_e, id: string) => cancelVercelDeployment(id));
  ipcMain.handle(IPC.deploymentsDelete, (_e, id: string) => deleteVercelDeployment(id));
  ipcMain.handle(IPC.deploymentsRedeploy, (_e, id: string, name: string, target?: "production") =>
    redeployVercelDeployment(id, name, target),
  );
  ipcMain.handle(IPC.deploymentsPromote, (_e, projectId: string, id: string) =>
    promoteVercelDeployment(projectId, id),
  );
  ipcMain.handle(IPC.deploymentsRollback, (_e, projectId: string, id: string) =>
    rollbackVercelDeployment(projectId, id),
  );
  ipcMain.handle(IPC.authStartLogin, (e, providerId: string) =>
    startLogin(e.sender, getRuntime, providerId),
  );
  ipcMain.on(IPC.authPromptResponse, (_e, flowId: string, promptId: string, value: string) =>
    respondToPrompt(flowId, promptId, value),
  );
  ipcMain.on(IPC.authCancelLogin, (_e, flowId: string) => cancelLogin(flowId));

  ipcMain.handle(IPC.pickFolder, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = {
      properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[],
      title: mt("dialog.pickFolder"),
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    return { path: result.canceled ? null : (result.filePaths[0] ?? null) };
  });
  ipcMain.handle(IPC.createFolder, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: mt("dialog.createFolder"),
      defaultPath: join(app.getPath("documents"), "New project"),
      buttonLabel: mt("dialog.create"),
    };
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { path: null };
    mkdirSync(result.filePath, { recursive: true });
    return { path: result.filePath };
  });

  ipcMain.handle(IPC.dailyCwd, () => {
    const dir = join(app.getPath("userData"), "daily");
    mkdirSync(dir, { recursive: true });
    return dir;
  });

  ipcMain.on(IPC.revealPath, (_e, path: string) => {
    shell.showItemInFolder(path);
  });

  // Dock/taskbar badge = number of approvals waiting across all chats.
  ipcMain.on(IPC.setBadge, (_e, count: number) => {
    app.setBadgeCount(Math.max(0, Math.floor(count) || 0));
  });

  // Windows/Linux：主题切换时同步窗口控件 overlay 配色（macOS 无 overlay）。
  ipcMain.on(IPC.setTitleBarOverlay, (e, colors: { color: string; symbolColor: string }) => {
    if (isMac) return;
    const win = BrowserWindow.fromWebContents(e.sender);
    try {
      win?.setTitleBarOverlay({ ...colors, height: TITLEBAR_HEIGHT });
    } catch {
      // overlay 未启用（如 Linux 某些环境）时忽略
    }
  });

  // 定时任务
  ipcMain.handle(IPC.scheduleList, () => listTasks());
  ipcMain.handle(IPC.scheduleSave, (_e, task: ScheduledTask) => saveTask(task));
  ipcMain.handle(IPC.scheduleDelete, (_e, id: string) => deleteTask(id));
  ipcMain.handle(IPC.scheduleRunNow, (_e, id: string) => runTaskNow(id));
}

app.whenReady().then(() => {
  // 打包版由 icns 接管；dev 模式手动设置 Dock 图标，替换默认的 Electron 标。
  if (isDev && process.platform === "darwin") {
    try {
      app.dock?.setIcon(join(app.getAppPath(), "build", "icon.png"));
    } catch {
      // 纯装饰，失败无妨
    }
  }
  installMenu();
  registerIpc();
  startScheduler();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let quitting = false;
app.on("before-quit", (event) => {
  // Give hosts a moment to destroy their cloud VMs before we exit.
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  stopScheduler();
  disposeAllTerminals();
  void disposeAllChats().finally(() => app.exit(0));
});
