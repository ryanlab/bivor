/**
 * 独立代码编辑器窗口：只渲染预览/编辑，不跑主界面。
 */
import { useEffect, useRef, useState } from "react";
import { SquareArrowDownLeft } from "lucide-react";
import type { EditorOpenFile, EditorSession } from "@shared/protocol";
import { TITLEBAR_HEIGHT } from "@shared/titlebar";
import { FilePreview } from "@/components/FilePreview";
import { useT } from "@/lib/i18n";

interface EditorState {
  cwd: string;
  paths: string[];
  active?: string;
  revisions: Record<string, number>;
}

function toSession(s: EditorState): EditorSession {
  return {
    cwd: s.cwd,
    paths: s.paths,
    active: s.active,
    revisions: s.revisions,
  };
}

function fromSession(session: EditorSession): EditorState {
  return {
    cwd: session.cwd,
    paths: session.paths,
    active: session.active ?? session.paths[session.paths.length - 1],
    revisions: session.revisions ?? {},
  };
}

export function EditorWindow(): React.JSX.Element {
  const t = useT();
  const [state, setState] = useState<EditorState>({
    cwd: "",
    paths: [],
    revisions: {},
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  const commit = (next: EditorState): void => {
    setState(next);
    window.pi.editor.report(toSession(next));
  };

  useEffect(() => {
    const apply = (session: EditorSession): void => {
      const next = fromSession(session);
      setState(next);
      window.pi.editor.report(toSession(next));
    };
    const unsubInit = window.pi.editor.onInit(apply);
    const unsubOpen = window.pi.editor.onOpenFile((file: EditorOpenFile) => {
      const cur = stateRef.current;
      const paths = cur.paths.includes(file.path) ? cur.paths : [...cur.paths, file.path];
      commit({
        ...cur,
        cwd: cur.cwd,
        paths,
        active: file.path,
      });
    });
    void window.pi.editor.getSession().then((s) => {
      if (s) apply(s);
    });
    return () => {
      unsubInit();
      unsubOpen();
    };
  }, []);

  useEffect(() => {
    if (!state.cwd) return;
    void window.pi.files.watch(state.cwd);
    return () => {
      void window.pi.files.unwatch(state.cwd);
    };
  }, [state.cwd]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "w") return;
      e.preventDefault();
      const cur = stateRef.current;
      if (cur.active) {
        const paths = cur.paths.filter((p) => p !== cur.active);
        commit({
          ...cur,
          paths,
          active: paths[paths.length - 1],
        });
        return;
      }
      void window.pi.editor.dock();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-secondary">
      <div
        className="drag-region flex shrink-0 items-center gap-2 pr-3"
        style={{ height: TITLEBAR_HEIGHT }}
      >
        <div className="w-[88px] shrink-0" aria-hidden />
        <span className="min-w-0 truncate text-[12px] text-fg-muted">{t("files.previewTitle")}</span>
        <span className="flex-1" />
        <button
          type="button"
          title={t("files.dock")}
          onClick={() => void window.pi.editor.dock()}
          className="no-drag rounded-lg p-1 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
        >
          <SquareArrowDownLeft size={14} />
        </button>
      </div>
      {state.cwd && state.paths.length > 0 && state.active ? (
        <FilePreview
          cwd={state.cwd}
          paths={state.paths}
          active={state.active}
          onSelect={(path) => commit({ ...state, active: path })}
          onClose={(path) => {
            const paths = state.paths.filter((p) => p !== path);
            commit({
              ...state,
              paths,
              active: state.active === path ? paths[paths.length - 1] : state.active,
            });
          }}
          revisions={state.revisions}
          hideTitle
        />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-xs text-fg-muted">
          {t("files.editorEmpty")}
        </div>
      )}
    </div>
  );
}
