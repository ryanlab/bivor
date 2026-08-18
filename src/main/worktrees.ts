/**
 * Git worktree support: run parallel agent tasks on isolated branches
 * without touching the main working copy.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface WorktreeInfo {
  path: string;
  branch: string;
  isMain: boolean;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd, timeout: 15000 });
  return stdout.trim();
}

export async function isGitRepo(path: string): Promise<boolean> {
  try {
    await git(path, "rev-parse", "--git-dir");
    return true;
  } catch {
    return false;
  }
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug || "task";
}

async function refExists(root: string, branch: string): Promise<boolean> {
  try {
    await git(root, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`);
    return true;
  } catch {
    return false;
  }
}

export async function createWorktree(
  projectPath: string,
  taskHint?: string,
  baseBranch?: string,
): Promise<{ path: string; branch: string }> {
  const root = await git(projectPath, "rev-parse", "--show-toplevel");
  const container = join(homedir(), ".pi", "desktop-worktrees", basename(root));
  mkdirSync(container, { recursive: true });
  const hint = slugify(taskHint ?? "task");

  for (let i = 0; i < 8; i++) {
    const stamp = new Date().toISOString().slice(5, 19).replace(/[-:T]/g, "");
    const slug = i === 0 ? `${hint}-${stamp}` : `${hint}-${stamp}-${i + 1}`;
    const branch = `pi/${slug}`;
    const worktreePath = join(container, slug);
    if (existsSync(worktreePath) || (await refExists(root, branch))) continue;
    const args = ["worktree", "add", "-b", branch, worktreePath];
    if (baseBranch) args.push(baseBranch);
    await git(root, ...args);
    return { path: worktreePath, branch };
  }

  throw new Error("无法创建并行任务：分支名冲突，请稍后重试");
}

export interface BranchList {
  /** branch currently checked out in the main working copy ("HEAD" when detached) */
  current: string;
  /** local branches, most recently committed first */
  branches: string[];
}

export async function listBranches(projectPath: string): Promise<BranchList> {
  const root = await git(projectPath, "rev-parse", "--show-toplevel");
  // `--show-current` works even on an unborn branch (fresh repo without
  // commits, where `rev-parse HEAD` fails); empty output means detached HEAD.
  const current = (await git(root, "branch", "--show-current")) || "HEAD";
  const out = await git(
    root,
    "branch",
    "--format=%(refname:short)",
    "--sort=-committerdate",
  );
  // Empty on a repo without commits: no worktree base is available yet.
  const branches = out.split("\n").filter(Boolean);
  return { current, branches };
}

export async function listWorktrees(projectPath: string): Promise<WorktreeInfo[]> {
  const out = await git(projectPath, "worktree", "list", "--porcelain");
  const result: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice(9), isMain: result.length === 0 };
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice(7).replace("refs/heads/", "");
    } else if (line === "") {
      if (current.path) result.push(current as WorktreeInfo);
      current = {};
    }
  }
  if (current.path) result.push(current as WorktreeInfo);
  return result;
}

export async function removeWorktree(
  projectPath: string,
  worktreePath: string,
  branch?: string,
): Promise<void> {
  const root = await git(projectPath, "rev-parse", "--show-toplevel");
  await git(root, "worktree", "remove", "--force", worktreePath);
  if (branch) {
    // Safe delete only (-d): refuses if the branch has unmerged work.
    try {
      await git(root, "branch", "-d", branch);
    } catch {
      // keep unmerged branches around
    }
  }
}

export interface WorktreeStatus {
  /** current branch of the main working copy (merge target) */
  mainBranch: string;
  /** uncommitted changes inside the task worktree */
  dirtyFiles: number;
  /** commits on the task branch not yet on the main branch */
  ahead: number;
  /** files changed by the task branch relative to the main branch */
  changedFiles: string[];
}

export async function worktreeStatus(
  projectPath: string,
  worktreePath: string,
  branch: string,
): Promise<WorktreeStatus> {
  const root = await git(projectPath, "rev-parse", "--show-toplevel");
  const mainBranch = await git(root, "rev-parse", "--abbrev-ref", "HEAD");
  const status = await git(worktreePath, "status", "--porcelain");
  const dirtyFiles = status ? status.split("\n").filter(Boolean).length : 0;
  let ahead = 0;
  let changedFiles: string[] = [];
  try {
    ahead = Number(await git(root, "rev-list", "--count", `${mainBranch}..${branch}`));
    const diff = await git(root, "diff", "--name-only", `${mainBranch}...${branch}`);
    changedFiles = diff ? diff.split("\n").filter(Boolean) : [];
  } catch {
    // branch may have no common history yet
  }
  return { mainBranch, dirtyFiles, ahead, changedFiles };
}

export interface MergeResult {
  merged: boolean;
  mainBranch: string;
  mergedCommits: number;
  error?: string;
}

/**
 * Merge a task worktree branch back into the main working copy's branch.
 * Uncommitted changes in the worktree are committed first (agents often leave
 * work uncommitted). On conflict the merge is aborted and reported.
 */
export async function mergeWorktree(
  projectPath: string,
  worktreePath: string,
  branch: string,
  message?: string,
): Promise<MergeResult> {
  const root = await git(projectPath, "rev-parse", "--show-toplevel");
  const mainBranch = await git(root, "rev-parse", "--abbrev-ref", "HEAD");
  // 1. Auto-commit any uncommitted work inside the task worktree.
  const dirty = await git(worktreePath, "status", "--porcelain");
  if (dirty) {
    await git(worktreePath, "add", "-A");
    await exec(
      "git",
      ["commit", "-m", message || `pi 任务提交（${branch}）`],
      {
        cwd: worktreePath,
        timeout: 30000,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? "bivor",
          GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? "pi@desktop.local",
          GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? "bivor",
          GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? "pi@desktop.local",
        },
      },
    );
  }
  const mergedCommits = Number(
    await git(root, "rev-list", "--count", `${mainBranch}..${branch}`).catch(() => "0"),
  );
  if (mergedCommits === 0) return { merged: true, mainBranch, mergedCommits: 0 };
  // 2. Merge into the main working copy (no-ff keeps the task grouped).
  try {
    await git(root, "merge", "--no-ff", branch, "-m", message || `合并 pi 任务分支 ${branch}`);
    return { merged: true, mainBranch, mergedCommits };
  } catch (err) {
    try {
      await git(root, "merge", "--abort");
    } catch {
      // no merge in progress
    }
    const msg = err instanceof Error ? err.message : String(err);
    return {
      merged: false,
      mainBranch,
      mergedCommits: 0,
      error: `合并冲突或失败，已回退：${msg.split("\n").slice(-3).join(" ").slice(0, 200)}`,
    };
  }
}
