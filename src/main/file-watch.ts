/**
 * Watch a project cwd and push relative path changes to renderer windows.
 * Recursive fs.watch; skip heavy dirs; debounce bursts (agent writes).
 */
import { execFile } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { ipcMain } from "electron";
import { IPC, type FilesChangedPayload } from "@shared/protocol";

const exec = promisify(execFile);

const SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  "build",
  ".next",
  "target",
  ".venv",
  "__pycache__",
  ".pi",
]);

interface Subscriber {
  wc: Electron.WebContents;
  cwd: string;
  refs: number;
}

interface WatchEntry {
  watcher: FSWatcher;
  meta?: FSWatcher;
  pending: Set<string>;
  structure: boolean;
  timer?: ReturnType<typeof setTimeout>;
  subscribers: Subscriber[];
}

const entries = new Map<string, WatchEntry>();

function skipRel(rel: string): boolean {
  const parts = rel.split(/[/\\]/);
  if (parts[0] === ".git") {
    return parts[1] !== "HEAD" && parts[1] !== "index";
  }
  return parts.some((p) => SKIP.has(p));
}

function dropEntry(key: string): void {
  const entry = entries.get(key);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  try {
    entry.watcher.close();
  } catch {
    /* already closed */
  }
  try {
    entry.meta?.close();
  } catch {
    /* already closed */
  }
  entries.delete(key);
}

function removeSubscriber(key: string, sender: Electron.WebContents, all = false): void {
  const entry = entries.get(key);
  if (!entry) return;
  const sub = entry.subscribers.find((s) => s.wc === sender);
  if (!sub) return;
  if (!all) sub.refs -= 1;
  if (!all && sub.refs > 0) return;
  entry.subscribers = entry.subscribers.filter((s) => s.wc !== sender);
  if (entry.subscribers.length === 0) dropEntry(key);
}

function scheduleFlush(entry: WatchEntry): void {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => flush(entry), 200);
}

function gitDirCoveredByCwd(cwdKey: string, gitDir: string): boolean {
  const resolved = resolve(gitDir);
  const root = cwdKey.endsWith(sep) ? cwdKey : cwdKey + sep;
  return resolved === join(cwdKey, ".git") || resolved.startsWith(root);
}

function attachGitMeta(key: string, cwd: string): void {
  void exec("git", ["rev-parse", "--absolute-git-dir"], { cwd, timeout: 5000 })
    .then(({ stdout }) => {
      const gitDir = stdout.trim();
      if (!gitDir || gitDirCoveredByCwd(key, gitDir) || !entries.has(key)) return;
      const meta = watch(resolve(gitDir), (_event, filename) => {
        const current = entries.get(key);
        if (!current) return;
        const name = filename ?? "";
        if (name !== "HEAD" && name !== "index") return;
        current.pending.add(name === "HEAD" ? ".git/HEAD" : ".git/index");
        scheduleFlush(current);
      });
      meta.on("error", () => {
        try {
          meta.close();
        } catch {
          /* already closed */
        }
      });
      const current = entries.get(key);
      if (!current || current.meta) {
        meta.close();
        return;
      }
      current.meta = meta;
    })
    .catch(() => undefined);
}

function flush(entry: WatchEntry): void {
  const paths = [...entry.pending].filter(Boolean);
  const structure = entry.structure || paths.length === 0;
  entry.pending.clear();
  entry.structure = false;
  for (const sub of entry.subscribers) {
    if (sub.wc.isDestroyed()) continue;
    const payload: FilesChangedPayload = { cwd: sub.cwd, paths, structure };
    sub.wc.send(IPC.filesChanged, payload);
  }
}

export function watchProject(cwd: string, sender: Electron.WebContents): void {
  const key = resolve(cwd);
  let entry = entries.get(key);
  if (!entry) {
    let watcher: FSWatcher;
    try {
      watcher = watch(key, { recursive: true }, (event, filename) => {
        const current = entries.get(key);
        if (!current) return;
        const rel = filename ? filename.split("\\").join("/") : "";
        if (rel && skipRel(rel)) return;
        if (!rel || event === "rename") current.structure = true;
        current.pending.add(rel);
        scheduleFlush(current);
      });
    } catch {
      return;
    }
    watcher.on("error", () => dropEntry(key));
    entry = { watcher, pending: new Set(), structure: false, subscribers: [] };
    entries.set(key, entry);
    attachGitMeta(key, cwd);
  }
  const existing = entry.subscribers.find((s) => s.wc === sender);
  if (existing) {
    existing.refs += 1;
    existing.cwd = cwd;
    return;
  }
  entry.subscribers.push({ wc: sender, cwd, refs: 1 });
  sender.once("destroyed", () => removeSubscriber(key, sender, true));
}

export function unwatchProject(cwd: string, sender: Electron.WebContents): void {
  removeSubscriber(resolve(cwd), sender);
}

export function disposeAllFileWatchers(): void {
  for (const key of [...entries.keys()]) dropEntry(key);
}

export function registerFileWatchIpc(): void {
  ipcMain.handle(IPC.filesWatch, (e, cwd: string) => {
    watchProject(cwd, e.sender);
  });
  ipcMain.handle(IPC.filesUnwatch, (e, cwd: string) => {
    unwatchProject(cwd, e.sender);
  });
}
