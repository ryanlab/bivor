/**
 * Checkpoints: snapshot the working tree before each agent turn so the user
 * can roll back file changes with one click (Codex-style).
 *
 * Implementation: build a tree object in a temporary git index (does not
 * touch the user's index or working tree), then anchor it with a ref under
 * refs/pi-checkpoints/ so gc never prunes it.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

async function git(
  cwd: string,
  args: string[],
  env?: Record<string, string>,
): Promise<string> {
  const { stdout } = await exec("git", args, {
    cwd,
    timeout: 30000,
    maxBuffer: 64 * 1024 * 1024,
    env: env ? { ...process.env, ...env } : process.env,
  });
  return stdout.trim();
}

export interface CheckpointResult {
  id: string;
  /** files changed vs HEAD at snapshot time (informational) */
  dirtyFiles: number;
}

export async function createCheckpoint(cwd: string): Promise<CheckpointResult | null> {
  try {
    await git(cwd, ["rev-parse", "--git-dir"]);
  } catch {
    return null; // not a git repo — checkpoints unavailable
  }
  const tmpIndexDir = mkdtempSync(join(tmpdir(), "pi-ckpt-"));
  const tmpIndex = join(tmpIndexDir, "index");
  try {
    const env = { GIT_INDEX_FILE: tmpIndex };
    // Seed the temp index from HEAD if it exists (fresh repos may have none).
    try {
      await git(cwd, ["read-tree", "HEAD"], env);
    } catch {
      await git(cwd, ["read-tree", "--empty"], env);
    }
    await git(cwd, ["add", "-A"], env);
    const tree = await git(cwd, ["write-tree"], env);
    const status = await git(cwd, ["status", "--porcelain"]);
    const dirtyFiles = status ? status.split("\n").length : 0;
    const id = randomUUID().slice(0, 8);
    let commitArgs = ["commit-tree", tree, "-m", `pi checkpoint ${new Date().toISOString()}`];
    try {
      const head = await git(cwd, ["rev-parse", "HEAD"]);
      commitArgs = ["commit-tree", tree, "-p", head, "-m", `pi checkpoint`];
    } catch {
      // no HEAD yet
    }
    const commit = await git(cwd, commitArgs, {
      GIT_AUTHOR_NAME: "bivor",
      GIT_AUTHOR_EMAIL: "pi@desktop.local",
      GIT_COMMITTER_NAME: "bivor",
      GIT_COMMITTER_EMAIL: "pi@desktop.local",
    });
    await git(cwd, ["update-ref", `refs/pi-checkpoints/${id}`, commit]);
    return { id, dirtyFiles };
  } catch {
    return null;
  } finally {
    rmSync(tmpIndexDir, { recursive: true, force: true });
  }
}

export interface CheckpointFileDiff {
  path: string;
  additions: number;
  deletions: number;
  /** unified diff for this file */
  patch: string;
}

/**
 * Diff a checkpoint against the current working tree, per file.
 * Catches ALL changes (including ones made via bash), unlike message-based
 * aggregation which only sees edit/write tool calls.
 *
 * Implementation: snapshot the current worktree into a temp-index tree (same
 * technique as createCheckpoint), then do a pure tree-to-tree diff. A plain
 * `git diff <commit>` would miss untracked new files and misreport files that
 * are untracked in the real index as deletions.
 */
export async function diffCheckpoint(cwd: string, id: string): Promise<CheckpointFileDiff[]> {
  const commit = await git(cwd, ["rev-parse", `refs/pi-checkpoints/${id}`]);
  const tmpIndexDir = mkdtempSync(join(tmpdir(), "pi-diff-"));
  const tmpIndex = join(tmpIndexDir, "index");
  try {
    const env = { GIT_INDEX_FILE: tmpIndex };
    try {
      await git(cwd, ["read-tree", "HEAD"], env);
    } catch {
      await git(cwd, ["read-tree", "--empty"], env);
    }
    await git(cwd, ["add", "-A"], env);
    const nowTree = await git(cwd, ["write-tree"], env);
    // .pi holds pi's own metadata (session logs etc.) — churn, not user code.
    const pathspec = ["--", ".", ":(exclude).pi"];
    const numstat = await git(cwd, ["diff", "--numstat", commit, nowTree, ...pathspec]);
    if (!numstat) return [];
    const files: CheckpointFileDiff[] = [];
    for (const line of numstat.split("\n")) {
      const [a, d, ...rest] = line.split("\t");
      const path = rest.join("\t");
      if (!path || path.includes("=>")) continue; // skip renames' combined syntax
      files.push({
        path,
        additions: a === "-" ? 0 : Number(a),
        deletions: d === "-" ? 0 : Number(d),
        patch: "",
      });
    }
    // Fetch per-file patches (bounded to avoid pathological sessions).
    for (const f of files.slice(0, 50)) {
      try {
        f.patch = await git(cwd, ["diff", commit, nowTree, "--", f.path]);
        if (f.patch.length > 200_000) f.patch = f.patch.slice(0, 200_000) + "\n… (diff 已截断)";
      } catch {
        f.patch = "";
      }
    }
    return files;
  } finally {
    rmSync(tmpIndexDir, { recursive: true, force: true });
  }
}

/** Restore a single file to its checkpoint state. */
export async function restoreCheckpointFile(
  cwd: string,
  id: string,
  path: string,
): Promise<void> {
  if (path.startsWith("/") || path.split("/").includes("..")) {
    throw new Error("非法文件路径");
  }
  const commit = await git(cwd, ["rev-parse", `refs/pi-checkpoints/${id}`]);
  // File may not exist in the checkpoint (newly created) — then delete is the
  // "restore", but deleting user files is risky, so surface a clear error.
  try {
    await git(cwd, ["cat-file", "-e", `${commit}:${path}`]);
  } catch {
    throw new Error("该文件在基线中不存在（新建文件请手动删除）");
  }
  await git(cwd, ["restore", "--source", commit, "--worktree", "--", path]);
}

export interface RestoreResult {
  restoredFiles: number;
}

export async function restoreCheckpoint(cwd: string, id: string): Promise<RestoreResult> {
  const ref = `refs/pi-checkpoints/${id}`;
  const commit = await git(cwd, ["rev-parse", ref]);
  // Which files differ between the checkpoint and the current working tree?
  // Exclude .pi metadata (session logs churn constantly and rolling them back
  // would corrupt live sessions).
  const pathspec = [".", ":(exclude).pi"];
  const diff = await git(cwd, ["diff", "--name-only", commit, "--", ...pathspec]);
  const files = diff ? diff.split("\n").filter(Boolean) : [];
  // Restore tracked content to the checkpoint state (worktree only; the
  // user's staging area is left alone except for restored paths).
  await git(cwd, ["restore", "--source", commit, "--worktree", "--", ...pathspec]);
  // Files created after the checkpoint (present now, absent in checkpoint)
  // are intentionally left in place — deleting user files is too risky.
  return { restoredFiles: files.length };
}
