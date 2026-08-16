import { useEffect, useMemo, useState } from "react";
import type { GitFileStatus, GitStatusEntry } from "@shared/protocol";

export const GIT_COLOR: Record<GitFileStatus, string> = {
  M: "text-warning",
  U: "text-info",
  A: "text-success",
  D: "text-danger",
  C: "text-danger",
};

export const GIT_LABEL: Record<GitFileStatus, string> = {
  M: "files.gitModified",
  U: "files.gitUntracked",
  A: "files.gitAdded",
  D: "files.gitDeleted",
  C: "files.gitConflict",
};

const GIT_RANK: Record<GitFileStatus, number> = { U: 1, A: 2, M: 3, D: 4, C: 5 };

function betterGit(a: GitFileStatus | undefined, b: GitFileStatus): GitFileStatus {
  if (!a) return b;
  return GIT_RANK[b] > GIT_RANK[a] ? b : a;
}

/** Ancestor folders of dirty files — O(n), looked up O(1) in the tree. */
export function buildFolderGitMap(entries: GitStatusEntry[]): Map<string, GitFileStatus> {
  const folders = new Map<string, GitFileStatus>();
  for (const { path, status } of entries) {
    let i = path.indexOf("/");
    while (i !== -1) {
      const dir = path.slice(0, i);
      folders.set(dir, betterGit(folders.get(dir), status));
      i = path.indexOf("/", i + 1);
    }
  }
  return folders;
}

export function isGitHeadPath(rel: string): boolean {
  return rel === ".git/HEAD";
}

type Listener = (entries: GitStatusEntry[]) => void;

interface CwdState {
  entries: GitStatusEntry[];
  subs: Set<Listener>;
  fetching: boolean;
  queued: boolean;
  unsub?: () => void;
}

const cache = new Map<string, CwdState>();

async function pull(cwd: string, state: CwdState): Promise<void> {
  if (state.fetching) {
    state.queued = true;
    return;
  }
  state.fetching = true;
  try {
    state.entries = await window.pi.files.gitStatus(cwd);
    for (const cb of state.subs) cb(state.entries);
  } catch {
    state.entries = [];
    for (const cb of state.subs) cb(state.entries);
  } finally {
    state.fetching = false;
    if (state.queued) {
      state.queued = false;
      void pull(cwd, state);
    }
  }
}

function ensure(cwd: string): CwdState {
  let state = cache.get(cwd);
  if (state) return state;
  state = { entries: [], subs: new Set(), fetching: false, queued: false };
  void window.pi.files.watch(cwd);
  state.unsub = window.pi.files.onChanged((evt) => {
    if (evt.cwd === cwd) void pull(cwd, state!);
  });
  cache.set(cwd, state);
  void pull(cwd, state);
  return state;
}

export function refreshGitStatus(cwd: string): void {
  const state = cache.get(cwd);
  if (state) void pull(cwd, state);
}

export function subscribeGitStatus(cwd: string, cb: Listener): () => void {
  const state = ensure(cwd);
  state.subs.add(cb);
  cb(state.entries);
  return () => {
    state.subs.delete(cb);
    if (state.subs.size > 0) return;
    state.unsub?.();
    void window.pi.files.unwatch(cwd);
    cache.delete(cwd);
  };
}

export function useGitStatus(cwd?: string): {
  entries: GitStatusEntry[];
  map: Map<string, GitFileStatus>;
  folderMap: Map<string, GitFileStatus>;
} {
  const [entries, setEntries] = useState<GitStatusEntry[]>([]);

  useEffect(() => {
    if (!cwd) {
      setEntries([]);
      return;
    }
    return subscribeGitStatus(cwd, setEntries);
  }, [cwd]);

  const map = useMemo(() => new Map(entries.map((e) => [e.path, e.status])), [entries]);
  const folderMap = useMemo(() => buildFolderGitMap(entries), [entries]);
  return { entries, map, folderMap };
}
