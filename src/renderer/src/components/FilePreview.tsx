/**
 * 文件预览 / 编辑：可同时打开多个，用标签切换。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches, search } from "@codemirror/search";
import { foldGutter } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { unifiedMergeView } from "@codemirror/merge";
import type { Extension } from "@codemirror/state";
import type { GitHeadFile, ProjectFileRead } from "@shared/protocol";
import { SquareArrowOutUpRight, X } from "lucide-react";
import { createCmTheme, watchTheme } from "@/lib/cm-theme";
import { ipcErrorMessage } from "@/lib/format";
import { isGitHeadPath } from "@/lib/git-status";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";

function headOriginal(o: GitHeadFile | undefined): string | null {
  return o?.kind === "text" ? o.content : null;
}

function languageFor(path: string): Extension | undefined {
  const name = path.split("/").pop() ?? path;
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  const base = name.toLowerCase();
  if (ext === "ts" || ext === "mts" || ext === "cts") return javascript({ typescript: true });
  if (ext === "tsx") return javascript({ typescript: true, jsx: true });
  if (ext === "jsx") return javascript({ jsx: true });
  if (ext === "js" || ext === "mjs" || ext === "cjs") return javascript();
  if (ext === "json" || ext === "jsonc" || base === "tsconfig.json") return json();
  if (ext === "html" || ext === "htm") return html();
  if (ext === "css" || ext === "scss" || ext === "less") return css();
  if (ext === "md" || ext === "mdx") return markdown();
  if (ext === "py") return python();
  if (ext === "xml" || ext === "svg") return xml();
  if (ext === "yml" || ext === "yaml") return yaml();
  return undefined;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function pathAffected(filePath: string, changed: string[]): boolean {
  if (changed.length === 0) return true;
  return changed.some(
    (p) => p === filePath || filePath.startsWith(`${p}/`) || p.startsWith(`${filePath}/`),
  );
}

function CodeMirrorPane({
  path,
  content,
  original,
  readOnly,
  onChange,
  onSave,
}: {
  path: string;
  content: string;
  original?: string;
  readOnly: boolean;
  onChange: (text: string) => void;
  onSave: () => void;
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const [themeTick, setThemeTick] = useState(0);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => watchTheme(() => setThemeTick((n) => n + 1)), []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const lang = languageFor(path);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: content,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          foldGutter(),
          EditorView.lineWrapping,
          search(),
          highlightSelectionMatches(),
          history(),
          keymap.of([
            { key: "Mod-s", preventDefault: true, run: () => { onSaveRef.current(); return true; } },
            indentWithTab,
            ...historyKeymap,
            ...defaultKeymap,
            ...searchKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
          ...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
          createCmTheme(),
          ...(lang ? [lang] : []),
          ...(original != null
            ? unifiedMergeView({
                original,
                highlightChanges: false,
                gutter: false,
                mergeControls: false,
                allowInlineDiffs: false,
              })
            : []),
        ],
      }),
    });
    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, themeTick, readOnly, original]);

  return <div ref={hostRef} className="min-h-0 flex-1" />;
}

function FilePane({
  cwd,
  path,
  active,
  revision,
  onDirty,
}: {
  cwd: string;
  path: string;
  active: boolean;
  revision?: number;
  onDirty: (path: string, dirty: boolean) => void;
}): React.JSX.Element {
  const t = useT();
  const [data, setData] = useState<ProjectFileRead>();
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState("");
  const [saving, setSaving] = useState(false);
  const [original, setOriginal] = useState<string | null | undefined>(undefined);
  const [diskGen, setDiskGen] = useState(0);
  const draftRef = useRef("");
  const savedRef = useRef("");
  const originalRef = useRef<string | null>(null);
  const name = basename(path);
  const editable = data?.kind === "text" && !data.truncated;
  const dirty = editable && draft !== saved;
  const vsHead = original != null && draft !== original;
  const diffReady = original !== undefined;

  useEffect(() => {
    draftRef.current = draft;
    savedRef.current = saved;
    onDirty(path, dirty);
  }, [draft, saved, dirty, path, onDirty]);

  const applyText = (content: string, nextOriginal: string | null, remount: boolean): void => {
    originalRef.current = nextOriginal;
    setOriginal(nextOriginal);
    setData({ kind: "text", content, truncated: false });
    setDraft(content);
    setSaved(content);
    if (remount) setDiskGen((n) => n + 1);
  };

  useEffect(() => {
    let cancelled = false;
    setData(undefined);
    setError(undefined);
    setDraft("");
    setSaved("");
    setOriginal(undefined);
    void Promise.allSettled([
      window.pi.files.read(cwd, path),
      window.pi.files.readHead(cwd, path),
    ]).then(([fileRes, origRes]) => {
      if (cancelled) return;
      const nextOriginal = origRes.status === "fulfilled" ? headOriginal(origRes.value) : null;
      if (fileRes.status === "fulfilled") {
        const file = fileRes.value;
        setData(file);
        originalRef.current = nextOriginal;
        setOriginal(nextOriginal);
        if (file.kind === "text") {
          setDraft(file.content);
          setSaved(file.content);
        }
        return;
      }
      if (nextOriginal != null) {
        applyText("", nextOriginal, false);
        return;
      }
      setError(ipcErrorMessage(fileRes.reason));
    });
    return () => {
      cancelled = true;
    };
  }, [cwd, path, revision]);

  useEffect(() => {
    return window.pi.files.onChanged((evt) => {
      if (evt.cwd !== cwd) return;
      const gitHead = evt.paths.some(isGitHeadPath);
      const hit = pathAffected(path, evt.paths);
      if (!hit && !gitHead && evt.paths.length > 0) return;
      if (draftRef.current !== savedRef.current) return;
      const fileP = hit || evt.paths.length === 0 ? window.pi.files.read(cwd, path) : null;
      const headP = gitHead || evt.paths.length === 0 ? window.pi.files.readHead(cwd, path) : null;
      void Promise.allSettled([
        fileP ?? Promise.resolve(undefined),
        headP ?? Promise.resolve(undefined),
      ]).then(([fileRes, origRes]) => {
        const nextOriginal =
          origRes.status === "fulfilled" && origRes.value
            ? headOriginal(origRes.value)
            : originalRef.current;
        if (fileRes.status === "fulfilled" && fileRes.value && fileRes.value.kind === "text") {
          if (fileRes.value.content === savedRef.current && nextOriginal === originalRef.current) {
            return;
          }
          applyText(fileRes.value.content, nextOriginal, true);
          return;
        }
        if (fileRes.status === "rejected" && nextOriginal != null) {
          if (savedRef.current === "" && nextOriginal === originalRef.current) return;
          applyText("", nextOriginal, true);
          return;
        }
        if (fileRes.status === "fulfilled" && fileRes.value) {
          setData(fileRes.value);
          if (nextOriginal !== originalRef.current) {
            originalRef.current = nextOriginal;
            setOriginal(nextOriginal);
          }
          setDiskGen((n) => n + 1);
          return;
        }
        if (nextOriginal !== originalRef.current) {
          originalRef.current = nextOriginal;
          setOriginal(nextOriginal);
          setDiskGen((n) => n + 1);
        }
      });
    });
  }, [cwd, path]);

  const save = useCallback(async (): Promise<void> => {
    const text = draftRef.current;
    if (text === savedRef.current) return;
    setSaving(true);
    setError(undefined);
    try {
      await window.pi.files.write(cwd, path, text);
      setSaved(text);
    } catch (err) {
      setError(ipcErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [cwd, path]);

  useEffect(() => {
    return () => {
      if (draftRef.current !== savedRef.current) {
        void window.pi.files.write(cwd, path, draftRef.current).catch(() => undefined);
      }
    };
  }, [cwd, path]);

  const status = !editable
    ? undefined
    : saving
      ? t("files.previewSaving")
        : dirty
        ? t("files.previewUnsaved")
        : vsHead
          ? t("files.previewDiff")
          : t("files.previewSaved");

  return (
    <div
      className={cn(
        "absolute inset-0 flex flex-col",
        active ? "visible" : "invisible pointer-events-none",
      )}
    >
      {status && <div className="px-4 pb-1 text-[11px] text-fg-muted">{status}</div>}
      {!data && !error && <div className="px-4 py-3 text-xs text-fg-muted">{t("files.previewLoading")}</div>}
      {error && <div className="px-4 py-3 text-xs text-fg-muted">{error}</div>}
      {data?.kind === "text" && diffReady && (
        <>
          {data.truncated && (
            <div className="px-4 pb-1 text-[11px] text-fg-muted">{t("files.previewTruncated")}</div>
          )}
          <CodeMirrorPane
            key={`${path}:${revision ?? 0}:${diskGen}:${original == null ? "edit" : "diff"}`}
            path={path}
            content={data.content}
            original={original ?? undefined}
            readOnly={data.truncated}
            onChange={setDraft}
            onSave={() => void save()}
          />
        </>
      )}
      {data?.kind === "image" && (
        <div className="min-h-0 flex-1 overflow-auto px-4 pb-3">
          <img
            src={`data:${data.mime};base64,${data.data}`}
            alt={name}
            className="max-w-full rounded-lg"
          />
        </div>
      )}
      {data?.kind === "binary" && (
        <div className="px-4 py-3 text-xs text-fg-muted">{t("files.previewBinary")}</div>
      )}
      {data?.kind === "tooLarge" && (
        <div className="px-4 py-3 text-xs text-fg-muted">
          {t("files.previewTooLarge", { size: formatBytes(data.size) })}
        </div>
      )}
    </div>
  );
}

export function FilePreview({
  cwd,
  paths,
  active,
  onSelect,
  onClose,
  revisions,
  hideTitle,
  onPopOut,
}: {
  cwd: string;
  paths: string[];
  active: string;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  revisions?: Record<string, number>;
  hideTitle?: boolean;
  onPopOut?: () => void;
}): React.JSX.Element {
  const t = useT();
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const onDirty = useCallback((path: string, next: boolean) => {
    setDirty((prev) => (prev[path] === next ? prev : { ...prev, [path]: next }));
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {!hideTitle && (
        <div className="flex h-10 shrink-0 items-center gap-2 px-3">
          <span className="text-[12px] text-fg-muted">{t("files.previewTitle")}</span>
          <span className="flex-1" />
          {onPopOut && (
            <button
              type="button"
              title={t("files.popOut")}
              onClick={onPopOut}
              className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
            >
              <SquareArrowOutUpRight size={14} />
            </button>
          )}
        </div>
      )}
      <div
        className={cn(
          "flex shrink-0 items-center gap-0.5 overflow-x-auto px-2 pb-1",
          hideTitle && "pt-1",
        )}
      >
        {paths.map((path) => (
          <button
            key={path}
            type="button"
            title={path}
            onClick={() => onSelect(path)}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onClose(path);
              }
            }}
            className={cn(
              "group flex w-[128px] shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[12px] transition-colors",
              path === active ? "bg-bg-hover text-fg" : "text-fg-muted hover:bg-bg-hover hover:text-fg",
            )}
          >
            {dirty[path] && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
            <span className="min-w-0 flex-1 truncate text-left">{basename(path)}</span>
            <span
              role="button"
              tabIndex={0}
              title={t("common.close")}
              className={cn(
                "ml-auto shrink-0 rounded p-0.5 text-fg-muted hover:bg-bg-tertiary hover:text-fg",
                path === active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
              onClick={(e) => {
                e.stopPropagation();
                onClose(path);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onClose(path);
                }
              }}
            >
              <X size={11} />
            </span>
          </button>
        ))}
      </div>
      <div className="relative min-h-0 flex-1">
        {paths.map((path) => (
          <FilePane
            key={path}
            cwd={cwd}
            path={path}
            active={path === active}
            revision={revisions?.[path]}
            onDirty={onDirty}
          />
        ))}
      </div>
    </div>
  );
}
