/**
 * Project file listing for @-mentions in the composer,
 * plus workspace-scoped create / rename / delete for the file tree.
 */
import { execFile } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { shell } from "electron";
import type { GitFileStatus, GitHeadFile, GitStatusEntry, ProjectFileRead } from "@shared/protocol";

const exec = promisify(execFile);

const MAX_FILES = 8000;
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  "build",
  ".next",
  "target",
  ".venv",
  "__pycache__",
]);

export async function listProjectFiles(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await exec(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard"],
      { cwd, timeout: 10000, maxBuffer: 64 * 1024 * 1024 },
    );
    const files = stdout.split("\n").filter(Boolean);
    if (files.length > 0) return files.slice(0, MAX_FILES);
  } catch {
    // not a git repo — fall through
  }
  const result: string[] = [];
  const walk = (dir: string, rel: string, depth: number): void => {
    if (result.length >= MAX_FILES || depth > 8) return;
    let entries;
    try {
      entries = readdirSync(join(dir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (result.length >= MAX_FILES) return;
      if (e.name.startsWith(".") && e.name !== ".env") continue;
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(dir, relPath, depth + 1);
      } else {
        result.push(relPath);
      }
    }
  };
  walk(cwd, "", 0);
  return result;
}

export interface ProjectTreeEntry {
  path: string;
  dir: boolean;
}

/** 文件树用：包含目录（含空文件夹），跳过 node_modules 等。 */
export function listProjectTree(cwd: string): ProjectTreeEntry[] {
  const out: ProjectTreeEntry[] = [];
  const walk = (rel: string, depth: number): void => {
    if (out.length >= MAX_FILES || depth > 8) return;
    let entries;
    try {
      entries = readdirSync(join(cwd, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      if (e.isSymbolicLink()) continue;
      if (e.name.startsWith(".") && e.name !== ".env" && e.name !== ".gitignore") continue;
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        out.push({ path: relPath, dir: true });
        walk(relPath, depth + 1);
      } else if (e.isFile()) {
        out.push({ path: relPath, dir: false });
      }
    }
  };
  walk("", 0);
  return out;
}

function resolveInside(cwd: string, rel: string): string {
  const root = resolve(cwd);
  const abs = resolve(root, rel);
  const relToRoot = relative(root, abs);
  if (!relToRoot || relToRoot.startsWith("..") || isAbsolute(relToRoot)) {
    throw new Error("path outside workspace");
  }
  if (relToRoot.split(sep).some((p) => p === ".." || p === "")) {
    throw new Error("invalid path");
  }
  return abs;
}

export function assertEntryName(name: string): string {
  const n = name.trim();
  if (!n || n === "." || n === ".." || /[/\\:\0]/.test(n)) {
    throw new Error("invalid name");
  }
  return n;
}

export function createProjectEntry(cwd: string, parent: string, name: string, dir: boolean): string {
  const n = assertEntryName(name);
  if (parent) {
    const parentAbs = resolveInside(cwd, parent);
    if (!statSync(parentAbs).isDirectory()) throw new Error("invalid path");
  }
  const rel = parent ? `${parent}/${n}` : n;
  const abs = resolveInside(cwd, rel);
  if (existsSync(abs)) throw new Error("EEXIST");
  if (dir) mkdirSync(abs, { recursive: false });
  else writeFileSync(abs, "", { flag: "wx" });
  return rel;
}

export function renameProjectEntry(cwd: string, fromRel: string, newName: string): string {
  const n = assertEntryName(newName);
  const slash = fromRel.lastIndexOf("/");
  const parent = slash < 0 ? "" : fromRel.slice(0, slash);
  const toRel = parent ? `${parent}/${n}` : n;
  if (toRel === fromRel) return toRel;
  const from = resolveInside(cwd, fromRel);
  const to = resolveInside(cwd, toRel);
  if (existsSync(to)) throw new Error("EEXIST");
  renameSync(from, to);
  return toRel;
}

export async function deleteProjectEntry(cwd: string, rel: string): Promise<void> {
  const abs = resolveInside(cwd, rel);
  await shell.trashItem(abs);
}

function uniqueDestName(parentAbs: string, name: string): string {
  if (!existsSync(join(parentAbs, name))) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 0; ; i++) {
    const next = i === 0 ? `${stem} copy${ext}` : `${stem} copy ${i + 1}${ext}`;
    if (!existsSync(join(parentAbs, next))) return next;
  }
}

function destRel(cwd: string, fromRel: string, toParent: string): string {
  if (toParent === fromRel || (fromRel && toParent.startsWith(`${fromRel}/`))) {
    throw new Error("invalid path");
  }
  if (toParent) {
    const parentAbs = resolveInside(cwd, toParent);
    if (!statSync(parentAbs).isDirectory()) throw new Error("invalid path");
  }
  const name = fromRel.split("/").pop() ?? fromRel;
  const parentAbs = toParent ? resolveInside(cwd, toParent) : resolve(cwd);
  const destName = uniqueDestName(parentAbs, name);
  return toParent ? `${toParent}/${destName}` : destName;
}

export function copyProjectEntry(cwd: string, fromRel: string, toParent: string): string {
  const toRel = destRel(cwd, fromRel, toParent);
  const from = resolveInside(cwd, fromRel);
  const to = resolveInside(cwd, toRel);
  cpSync(from, to, { recursive: true, errorOnExist: true });
  return toRel;
}

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
  avif: "image/avif",
};

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHARS = 400_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function writeProjectFile(cwd: string, rel: string, content: string): void {
  const abs = resolveInside(cwd, rel);
  if (Buffer.byteLength(content, "utf8") > MAX_TEXT_BYTES) throw new Error("file too large");
  writeFileSync(abs, content, "utf8");
}

export function readProjectFile(cwd: string, rel: string): ProjectFileRead {
  const abs = resolveInside(cwd, rel);
  const st = statSync(abs);
  if (!st.isFile()) throw new Error("not a file");
  const ext = rel.includes(".") ? (rel.split(".").pop() ?? "").toLowerCase() : "";
  const mime = IMAGE_MIME[ext];
  if (mime) {
    if (st.size > MAX_IMAGE_BYTES) return { kind: "tooLarge", size: st.size };
    return { kind: "image", mime, data: readFileSync(abs).toString("base64") };
  }
  if (st.size > MAX_TEXT_BYTES) return { kind: "tooLarge", size: st.size };
  const buf = readFileSync(abs);
  if (buf.includes(0)) return { kind: "binary" };
  const full = buf.toString("utf8");
  const truncated = full.length > MAX_TEXT_CHARS;
  return { kind: "text", content: truncated ? full.slice(0, MAX_TEXT_CHARS) : full, truncated };
}

function classifyGit(xy: string): GitFileStatus {
  const x = xy[0] ?? " ";
  const y = xy[1] ?? " ";
  if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) return "C";
  if (x === "?" && y === "?") return "U";
  if (x === "D" || y === "D") return "D";
  if (x === "A" || y === "A") return "A";
  return "M";
}

function parseGitPath(raw: string): string {
  let path = raw;
  if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);
  const renamed = path.indexOf(" -> ");
  if (renamed >= 0) path = path.slice(renamed + 4);
  const arrow = path.indexOf(" => ");
  if (arrow >= 0) {
    path = path.slice(arrow + 4).replace(/^\{/, "").replace(/\}$/, "");
  }
  return path.replace(/\\/g, "/").replace(/\/$/, "");
}

/** `HEAD:./rel` is cwd-relative; bare `HEAD:rel` is repo-root-relative. */
function headSpec(rel: string): string {
  return `HEAD:./${rel}`;
}

async function gitPrefix(cwd: string): Promise<string> {
  try {
    const { stdout } = await exec("git", ["rev-parse", "--show-prefix"], {
      cwd,
      timeout: 5000,
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

function toCwdPath(prefix: string, gitPath: string): string | undefined {
  if (!prefix) return gitPath;
  if (gitPath.startsWith(prefix)) return gitPath.slice(prefix.length);
  return undefined;
}

async function gitNumstat(cwd: string): Promise<Map<string, { add: number; del: number }>> {
  const counts = new Map<string, { add: number; del: number }>();
  try {
    const { stdout } = await exec("git", ["diff", "--relative", "--numstat", "HEAD"], {
      cwd,
      timeout: 8000,
      maxBuffer: 8 * 1024 * 1024,
    });
    for (const line of stdout.split("\n")) {
      const tab1 = line.indexOf("\t");
      const tab2 = line.indexOf("\t", tab1 + 1);
      if (tab1 < 0 || tab2 < 0) continue;
      const addRaw = line.slice(0, tab1);
      const delRaw = line.slice(tab1 + 1, tab2);
      const path = parseGitPath(line.slice(tab2 + 1));
      if (!path) continue;
      counts.set(path, {
        add: addRaw === "-" ? 0 : Number(addRaw) || 0,
        del: delRaw === "-" ? 0 : Number(delRaw) || 0,
      });
    }
  } catch {
    /* no HEAD or not a git repo */
  }
  return counts;
}

/** Working-tree git status vs HEAD (unstaged + staged; no add/commit required). */
export async function gitStatus(cwd: string): Promise<GitStatusEntry[]> {
  try {
    const [status, prefix, counts] = await Promise.all([
      exec("git", ["status", "--porcelain=v1", "-uall"], {
        cwd,
        timeout: 8000,
        maxBuffer: 8 * 1024 * 1024,
      }),
      gitPrefix(cwd),
      gitNumstat(cwd),
    ]);
    if (!status.stdout.trim()) return [];
    const out: GitStatusEntry[] = [];
    for (const raw of status.stdout.split("\n")) {
      if (raw.length < 4) continue;
      const gitPath = parseGitPath(raw.slice(3));
      const path = gitPath ? toCwdPath(prefix, gitPath) : undefined;
      if (!path) continue;
      const n = counts.get(path);
      out.push({
        path,
        status: classifyGit(raw.slice(0, 2)),
        additions: n?.add,
        deletions: n?.del,
      });
    }
    return out;
  } catch {
    return [];
  }
}

const MAX_HEAD_BYTES = 2 * 1024 * 1024;

function gitErr(err: unknown): string {
  if (err && typeof err === "object" && "stderr" in err) return String((err as { stderr: unknown }).stderr);
  return err instanceof Error ? err.message : String(err);
}

/** Last-commit content for the editor merge view. */
export async function readGitHead(cwd: string, rel: string): Promise<GitHeadFile> {
  resolveInside(cwd, rel);
  try {
    const { stdout } = await exec("git", ["show", headSpec(rel)], {
      cwd,
      timeout: 15000,
      maxBuffer: MAX_HEAD_BYTES + 1,
      env: { ...process.env, GIT_PAGER: "cat" },
    });
    if (stdout.includes("\0")) return { kind: "binary" };
    return { kind: "text", content: stdout };
  } catch (err) {
    const msg = gitErr(err);
    if (/not a git repository/i.test(msg)) return { kind: "none" };
    if (/does not exist|exists on disk|bad file|pathspec/i.test(msg)) return { kind: "missing" };
    if (/bad revision|unknown revision|invalid object name|ambiguous argument/i.test(msg)) {
      return { kind: "missing" };
    }
    if (/maxBuffer|ENOBUFS/i.test(msg)) return { kind: "binary" };
    return { kind: "none" };
  }
}

/** Restore a path to HEAD (tracked) or trash it (untracked / not in HEAD). */
export async function revertGitFile(cwd: string, rel: string): Promise<void> {
  const abs = resolveInside(cwd, rel);
  try {
    await exec("git", ["cat-file", "-e", headSpec(rel)], { cwd, timeout: 8000 });
  } catch {
    if (existsSync(abs)) await shell.trashItem(abs);
    return;
  }
  await exec("git", ["restore", "--source", "HEAD", "--worktree", "--staged", "--", rel], {
    cwd,
    timeout: 15000,
  });
}

export function moveProjectEntry(cwd: string, fromRel: string, toParent: string): string {
  const name = fromRel.split("/").pop() ?? fromRel;
  const same = (toParent ? `${toParent}/${name}` : name) === fromRel;
  if (same) return fromRel;
  const toRel = destRel(cwd, fromRel, toParent);
  const from = resolveInside(cwd, fromRel);
  const to = resolveInside(cwd, toRel);
  renameSync(from, to);
  return toRel;
}
