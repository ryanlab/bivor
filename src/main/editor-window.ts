/**
 * Singleton pop-out code editor window.
 * Independent of the main window; file tree in the opener routes opens here.
 */
import { join } from "node:path";
import { release } from "node:os";
import { app, BrowserWindow, ipcMain } from "electron";
import type { EditorOpenFile, EditorSession } from "@shared/protocol";
import { IPC } from "@shared/protocol";
import { TITLEBAR_HEIGHT } from "@shared/titlebar";

const isDev = !app.isPackaged;

let editorWin: BrowserWindow | null = null;
let opener: Electron.WebContents | null = null;
let lastSession: EditorSession | null = null;

function trafficLightPosition(): { x: number; y: number } {
  const major = Number(release().split(".")[0] ?? 0);
  const size = major >= 25 ? 14 : 16;
  return { x: 16, y: Math.round((TITLEBAR_HEIGHT - size) / 2) };
}

function notify(target: Electron.WebContents | null, channel: string, payload?: unknown): void {
  if (target && !target.isDestroyed()) target.send(channel, payload);
}

function applyTitle(session: EditorSession | null): void {
  if (!editorWin) return;
  const name = session?.active?.split("/").pop();
  editorWin.setTitle(name || "Bivor");
}

function loadEditor(win: BrowserWindow): void {
  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#editor`);
    return;
  }
  void win.loadFile(join(import.meta.dirname, "../renderer/index.html"), { hash: "editor" });
}

export function openEditorWindow(from: Electron.WebContents, session: EditorSession): void {
  if (editorWin) {
    if (opener && opener !== from) notify(opener, IPC.editorClosed, lastSession);
    opener = from;
    lastSession = session;
    editorWin.webContents.send(IPC.editorInit, session);
    applyTitle(session);
    notify(from, IPC.editorOpened, session);
    if (editorWin.isMinimized()) editorWin.restore();
    editorWin.focus();
    return;
  }

  opener = from;
  lastSession = session;
  const win = new BrowserWindow({
    width: 920,
    height: 720,
    minWidth: 520,
    minHeight: 360,
    show: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: trafficLightPosition(),
    backgroundColor: "#262521",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.mjs"),
      contextIsolation: true,
      sandbox: false,
    },
  });
  editorWin = win;
  win.on("ready-to-show", () => {
    applyTitle(lastSession);
    win.show();
  });
  win.webContents.on("did-finish-load", () => {
    if (lastSession) win.webContents.send(IPC.editorInit, lastSession);
  });
  win.on("closed", () => {
    const snap = lastSession;
    editorWin = null;
    notify(opener, IPC.editorClosed, snap);
    opener = null;
    lastSession = null;
  });
  loadEditor(win);
  notify(from, IPC.editorOpened, session);
}

export function pushEditorFile(file: EditorOpenFile): boolean {
  if (!editorWin) return false;
  editorWin.webContents.send(IPC.editorOpenFile, file);
  if (editorWin.isMinimized()) editorWin.restore();
  editorWin.focus();
  return true;
}

export function reportEditorState(session: EditorSession): void {
  lastSession = session;
  applyTitle(session);
  notify(opener, IPC.editorChanged, session);
}

export function getEditorSession(): EditorSession | null {
  return lastSession;
}

export function isEditorOpen(): boolean {
  return editorWin !== null;
}

export function focusEditorWindow(): void {
  if (!editorWin) return;
  if (editorWin.isMinimized()) editorWin.restore();
  editorWin.focus();
}

export function closeEditorWindow(): void {
  editorWin?.close();
}

export function registerEditorIpc(): void {
  ipcMain.handle(IPC.editorOpen, (e, session: EditorSession) => {
    openEditorWindow(e.sender, session);
  });
  ipcMain.handle(IPC.editorFocus, () => {
    focusEditorWindow();
  });
  ipcMain.handle(IPC.editorClose, () => {
    closeEditorWindow();
  });
  ipcMain.handle(IPC.editorIsOpen, () => isEditorOpen());
  ipcMain.handle(IPC.editorGetSession, () => getEditorSession());
  ipcMain.handle(IPC.editorPush, (_e, file: EditorOpenFile) => pushEditorFile(file));
  ipcMain.handle(IPC.editorDock, () => {
    closeEditorWindow();
  });
  ipcMain.on(IPC.editorState, (_e, session: EditorSession) => {
    reportEditorState(session);
  });
}
