import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileEdit,
  FilePlus,
  FolderOpen,
  GitCompareArrows,
  Loader2,
  RefreshCw,
  Undo2,
  X,
} from "lucide-react";
import type { CheckpointFileDiff } from "@shared/protocol";
import type { ChatState } from "@/stores/app-store";
import type { ToolResultMessage } from "@/lib/pi-messages";
import { isAssistantMessage, isToolResultMessage } from "@/lib/pi-messages";
import { ipcErrorMessage, shortenPath } from "@/lib/format";
import { DiffView } from "@/components/messages/DiffView";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";

export interface FileChange {
  path: string;
  kind: "edit" | "write";
  /** unified diff for edits */
  patch?: string;
  /** file content for writes */
  content?: string;
  timestamp: number;
}

export function collectChanges(chat: ChatState): FileChange[] {
  const changes: FileChange[] = [];
  // Map toolCallId -> {name, args} from assistant messages
  const calls = new Map<string, { name: string; args: Record<string, unknown> }>();
  for (const m of chat.messages) {
    if (isAssistantMessage(m)) {
      for (const block of m.content) {
        if (block.type === "toolCall" && (block.name === "edit" || block.name === "write")) {
          calls.set(block.id, { name: block.name, args: block.arguments });
        }
      }
    }
  }
  for (const m of chat.messages) {
    if (!isToolResultMessage(m)) continue;
    const call = calls.get((m as ToolResultMessage).toolCallId);
    if (!call || m.isError) continue;
    const path = String(call.args.path ?? call.args.file_path ?? "");
    if (!path) continue;
    if (call.name === "edit") {
      const patch = typeof m.details?.patch === "string" ? m.details.patch : undefined;
      changes.push({ path, kind: "edit", patch, timestamp: m.timestamp });
    } else {
      changes.push({
        path,
        kind: "write",
        content: typeof call.args.content === "string" ? call.args.content : undefined,
        timestamp: m.timestamp,
      });
    }
  }
  return changes;
}

/** Git baseline diff: everything changed since the session's first checkpoint. */
function GitDiffTab({ chat, baselineId }: { chat: ChatState; baselineId: string }): React.JSX.Element {
  const t = useT();
  const [files, setFiles] = useState<CheckpointFileDiff[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [restoring, setRestoring] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setError(null);
    window.pi.checkpoints
      .diff(chat.cwd, baselineId)
      .then(setFiles)
      .catch((e: unknown) => setError(ipcErrorMessage(e)));
  }, [chat.cwd, baselineId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const totals = useMemo(() => {
    if (!files) return null;
    return files.reduce(
      (t, f) => ({ add: t.add + f.additions, del: t.del + f.deletions }),
      { add: 0, del: 0 },
    );
  }, [files]);

  const restoreFile = async (path: string): Promise<void> => {
    if (!window.confirm(t("changes.confirmRevert", { path }))) return;
    setRestoring(path);
    try {
      await window.pi.checkpoints.restoreFile(chat.cwd, baselineId, path);
      refresh();
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setRestoring(null);
    }
  };

  if (error)
    return (
      <div className="space-y-2 p-4">
        <div className="text-xs text-danger">{error}</div>
        <button type="button" onClick={refresh} className="text-xs text-accent hover:underline">
          {t("common.retry")}
        </button>
      </div>
    );
  if (!files)
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 size={16} className="animate-spin text-fg-muted" />
      </div>
    );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="flex items-center gap-2 px-1 pb-2 text-[11px] text-fg-muted">
        <span>
          {t("changes.fileCount", { n: files.length })}
          {totals && (
            <>
              {" · "}
              <span className="text-success">+{totals.add}</span>{" "}
              <span className="text-danger">−{totals.del}</span>
            </>
          )}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          title={t("common.refresh")}
          onClick={refresh}
          className="rounded p-1 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
        >
          <RefreshCw size={11} />
        </button>
      </div>
      {files.length === 0 && (
        <div className="py-8 text-center text-xs text-fg-muted">{t("changes.noGitDiff")}</div>
      )}
      {files.map((f) => {
        const open = expanded[f.path] ?? false;
        return (
          <div key={f.path} className="pb-1">
            <div
              className={cn(
                "group flex cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-bg-hover",
                open && "bg-bg-hover/60",
              )}
              onClick={() => setExpanded((m) => ({ ...m, [f.path]: !open }))}
            >
              {open ? (
                <ChevronDown size={12} className="shrink-0 text-fg-muted" />
              ) : (
                <ChevronRight size={12} className="shrink-0 text-fg-muted" />
              )}
              <span
                className="selectable min-w-0 flex-1 truncate font-mono text-xs text-fg-secondary"
                title={f.path}
              >
                {f.path}
              </span>
              <span className="shrink-0 font-mono text-[10px]">
                <span className="text-success">+{f.additions}</span>{" "}
                <span className="text-danger">−{f.deletions}</span>
              </span>
              <button
                type="button"
                title={t("changes.revertTitle")}
                disabled={restoring === f.path}
                onClick={(e) => {
                  e.stopPropagation();
                  void restoreFile(f.path);
                }}
                className="hidden shrink-0 rounded p-1 text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-warning group-hover:block"
              >
                {restoring === f.path ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <Undo2 size={11} />
                )}
              </button>
            </div>
            {open &&
              (f.patch ? (
                <div className="pl-5 pt-1">
                  <DiffView patch={f.patch} />
                </div>
              ) : (
                <div className="pl-5 pt-1 text-[11px] text-fg-muted">{t("changes.binary")}</div>
              ))}
          </div>
        );
      })}
    </div>
  );
}

export function ChangesPanel({
  chat,
  onClose,
}: {
  chat: ChatState;
  onClose: () => void;
}): React.JSX.Element {
  const t = useT();
  const changes = useMemo(() => collectChanges(chat), [chat]);
  // Session baseline = first checkpoint of this UI session (survives snapshot
  // syncs); fall back to the earliest per-turn checkpoint if needed.
  const baselineId = useMemo(() => {
    if (chat.baselineCheckpointId) return chat.baselineCheckpointId;
    const entries = Object.values(chat.checkpoints);
    if (entries.length === 0) return null;
    return entries.reduce((a, b) => (a.time <= b.time ? a : b)).id;
  }, [chat.baselineCheckpointId, chat.checkpoints]);
  const [tab, setTab] = useState<"git" | "ops">(baselineId ? "git" : "ops");

  return (
    <div className="flex w-[420px] shrink-0 flex-col bg-transparent">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/40 px-4">
        <span className="text-sm font-medium">{t("chat.changes")}</span>
        {baselineId && (
          <div className="flex rounded-lg bg-bg-tertiary p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setTab("git")}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-0.5 transition-colors",
                tab === "git" ? "bg-bg text-fg shadow-sm" : "text-fg-muted hover:text-fg-secondary",
              )}
            >
              <GitCompareArrows size={11} />
              {t("changes.gitTab")}
            </button>
            <button
              type="button"
              onClick={() => setTab("ops")}
              className={cn(
                "rounded-md px-2 py-0.5 transition-colors",
                tab === "ops" ? "bg-bg text-fg shadow-sm" : "text-fg-muted hover:text-fg-secondary",
              )}
            >
              {t("changes.opsTab", { n: changes.length })}
            </button>
          </div>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
        >
          <X size={14} />
        </button>
      </div>

      {baselineId && tab === "git" ? (
        <GitDiffTab chat={chat} baselineId={baselineId} />
      ) : (
        <OpsTab changes={changes} />
      )}
    </div>
  );
}

function OpsTab({ changes }: { changes: FileChange[] }): React.JSX.Element {
  const t = useT();
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {changes.length === 0 && (
          <div className="py-8 text-center text-xs text-fg-muted">{t("changes.noOps")}</div>
        )}
        {changes.map((change, i) => (
          <div key={i}>
            <div className="flex items-center gap-1.5 pb-1.5">
              {change.kind === "edit" ? (
                <FileEdit size={13} className="shrink-0 text-warning" />
              ) : (
                <FilePlus size={13} className="shrink-0 text-success" />
              )}
              <span
                className="selectable min-w-0 flex-1 truncate font-mono text-xs text-fg-secondary"
                title={change.path}
              >
                {shortenPath(change.path, 48)}
              </span>
              <button
                type="button"
                title={t("changes.reveal")}
                onClick={() => window.pi.system.revealPath(change.path)}
                className="shrink-0 rounded p-1 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-secondary"
              >
                <FolderOpen size={12} />
              </button>
            </div>
            {change.patch ? (
              <DiffView patch={change.patch} />
            ) : change.content ? (
              <pre className="selectable max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-bg-secondary px-3 py-2 font-mono text-xs leading-relaxed text-fg-secondary">
                {change.content}
              </pre>
            ) : (
              <div className="rounded-md border border-border px-3 py-2 text-xs text-fg-muted">
                {t("changes.noDiff")}
              </div>
            )}
          </div>
        ))}
      </div>
  );
}
