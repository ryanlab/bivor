import { useEffect, useRef, useState } from "react";
import { Check, GitBranch, GitMerge, Loader2, Trash2 } from "lucide-react";
import type { WorktreeMergeResult, WorktreeStatusInfo } from "@shared/protocol";
import { useAppStore, type ChatState } from "@/stores/app-store";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";

/**
 * Branch chip in the chat header for worktree tasks. Opens a panel showing
 * the branch's status vs the main working copy, with one-click merge-back
 * and post-merge cleanup.
 */
export function WorktreeMergePanel({ chat }: { chat: ChatState }): React.JSX.Element | null {
  const t = useT();
  const closeChat = useAppStore((s) => s.closeChat);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<WorktreeStatusInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [result, setResult] = useState<WorktreeMergeResult | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const wt = chat.worktree;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open || !wt) return;
    setStatus(null);
    setError(null);
    setResult(null);
    window.pi.worktrees
      .status(wt.projectPath, chat.cwd, wt.branch)
      .then(setStatus)
      .catch((e: Error) => setError(e.message));
  }, [open, wt, chat.cwd]);

  if (!wt) return null;

  const doMerge = async (): Promise<void> => {
    setMerging(true);
    setError(null);
    try {
      const r = await window.pi.worktrees.merge(wt.projectPath, chat.cwd, wt.branch);
      setResult(r);
      if (!r.merged) setError(r.error ?? t("worktree.mergeFailed"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMerging(false);
    }
  };

  const doCleanup = async (): Promise<void> => {
    setCleaning(true);
    try {
      await window.pi.worktrees.remove(wt.projectPath, chat.cwd, wt.branch);
      closeChat(chat.chatId);
    } catch (e) {
      setError((e as Error).message);
      setCleaning(false);
    }
  };

  const pending = status ? status.ahead + (status.dirtyFiles > 0 ? 1 : 0) : 0;

  return (
    <div ref={ref} className="relative inline-flex shrink-0 translate-y-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t("worktree.title")}
        className={cn(
          "no-drag inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] transition-colors",
          open ? "bg-accent text-accent-fg" : "bg-accent-muted text-accent hover:bg-accent/25",
        )}
      >
        <GitBranch size={10} />
        {wt.branch}
      </button>

      {open && (
        <div className="dialog-in absolute left-0 top-7 z-40 w-[300px] rounded-xl border border-border-strong bg-bg-secondary p-3 shadow-xl">
          {!status && !error && (
            <div className="flex items-center gap-2 py-2 text-xs text-fg-muted">
              <Loader2 size={12} className="animate-spin" />
              {t("worktree.checking")}
            </div>
          )}

          {status && !result && (
            <>
              <div className="space-y-1 pb-2 text-[11.5px] text-fg-secondary">
                <div>
                  {t("worktree.target")}
                  <span className="font-mono text-fg">{status.mainBranch}</span>
                </div>
                <div>
                  {t("worktree.pending")}
                  <span className="text-fg">{status.ahead}</span>
                  {status.dirtyFiles > 0 && (
                    <span className="text-warning">{t("worktree.dirty", { n: status.dirtyFiles })}</span>
                  )}
                </div>
              </div>
              {status.changedFiles.length > 0 && (
                <div className="mb-2 max-h-28 overflow-y-auto rounded-lg border border-border bg-bg px-2 py-1.5">
                  {status.changedFiles.slice(0, 12).map((f) => (
                    <div key={f} className="truncate font-mono text-[10.5px] text-fg-muted">
                      {f}
                    </div>
                  ))}
                  {status.changedFiles.length > 12 && (
                    <div className="pt-0.5 text-[10px] text-fg-muted">
                      {t("worktree.moreFiles", { n: status.changedFiles.length })}
                    </div>
                  )}
                </div>
              )}
              {pending === 0 ? (
                <div className="py-1 text-[11.5px] text-fg-muted">{t("worktree.noNeed")}</div>
              ) : (
                <button
                  type="button"
                  disabled={merging || chat.isStreaming}
                  onClick={() => void doMerge()}
                  title={chat.isStreaming ? t("worktree.waitAgent") : undefined}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-40"
                >
                  {merging ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <GitMerge size={12} />
                  )}
                  {t("worktree.mergeTo", { branch: status.mainBranch })}
                </button>
              )}
            </>
          )}

          {result?.merged && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs text-success">
                <Check size={13} />
                {result.mergedCommits > 0
                  ? t("worktree.merged", { n: result.mergedCommits, branch: result.mainBranch })
                  : t("worktree.alreadySynced")}
              </div>
              <button
                type="button"
                disabled={cleaning}
                onClick={() => void doCleanup()}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-fg-secondary transition-colors hover:border-danger/40 hover:text-danger disabled:opacity-40"
              >
                {cleaning ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                {t("worktree.cleanup")}
              </button>
            </div>
          )}

          {error && <div className="pt-1.5 text-[11px] leading-relaxed text-danger">{error}</div>}
        </div>
      )}
    </div>
  );
}
