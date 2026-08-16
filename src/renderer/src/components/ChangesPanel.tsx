/**
 * 工作区相对上一提交（HEAD）的变更列表。与文件树共用 git status。
 */
import { useState } from "react";
import { Loader2, Undo2 } from "lucide-react";
import type { GitStatusEntry } from "@shared/protocol";
import { ipcErrorMessage } from "@/lib/format";
import { GIT_COLOR, GIT_LABEL } from "@/lib/git-status";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";

export function ChangesView({
  cwd,
  files,
  activePath,
  onOpenFile,
  onReverted,
}: {
  cwd: string;
  files: GitStatusEntry[];
  activePath?: string;
  onOpenFile: (path: string) => void;
  onReverted?: (path: string) => void;
}): React.JSX.Element {
  const t = useT();
  const [error, setError] = useState<string>();
  const [restoring, setRestoring] = useState<string>();

  const revert = async (path: string): Promise<void> => {
    if (!window.confirm(t("changes.confirmRevert", { path }))) return;
    setRestoring(path);
    setError(undefined);
    try {
      await window.pi.files.revert(cwd, path);
      onReverted?.(path);
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setRestoring(undefined);
    }
  };

  const totals = files.reduce(
    (acc, f) => ({ add: acc.add + (f.additions ?? 0), del: acc.del + (f.deletions ?? 0) }),
    { add: 0, del: 0 },
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="flex items-center gap-2 px-1 pb-2 text-[11px] text-fg-muted">
        <span>
          {t("changes.fileCount", { n: files.length })}
          {files.length > 0 && (totals.add > 0 || totals.del > 0) && (
            <>
              {" · "}
              <span className="text-success">+{totals.add}</span>{" "}
              <span className="text-danger">−{totals.del}</span>
            </>
          )}
        </span>
      </div>
      {error && <div className="px-1 pb-2 text-xs text-danger">{error}</div>}
      {files.length === 0 && (
        <div className="py-8 text-center text-xs text-fg-muted">{t("changes.noGitDiff")}</div>
      )}
      {files.map((f) => {
        const current = activePath === f.path;
        const color = GIT_COLOR[f.status];
        return (
          <div
            key={f.path}
            className={cn(
              "group flex cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-bg-hover",
              current && "bg-bg-hover",
            )}
            onClick={() => onOpenFile(f.path)}
          >
            <span className={cn("w-3 shrink-0 text-right text-[11px] font-medium", color)}>
              {f.status}
            </span>
            <span className={cn("selectable min-w-0 flex-1 truncate font-mono text-xs", color)} title={f.path}>
              {f.path}
            </span>
            {(f.additions != null || f.deletions != null) && (
              <span className="shrink-0 font-mono text-[10px]">
                <span className="text-success">+{f.additions ?? 0}</span>{" "}
                <span className="text-danger">−{f.deletions ?? 0}</span>
              </span>
            )}
            <button
              type="button"
              title={t("changes.revertTitle")}
              disabled={restoring === f.path}
              onClick={(e) => {
                e.stopPropagation();
                void revert(f.path);
              }}
              className="hidden shrink-0 rounded p-1 text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-warning group-hover:block"
            >
              {restoring === f.path ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Undo2 size={11} />
              )}
            </button>
            <span className="sr-only">{t(GIT_LABEL[f.status])}</span>
          </div>
        );
      })}
    </div>
  );
}
