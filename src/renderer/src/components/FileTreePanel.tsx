/**
 * 项目文件面板：目录树 +（有会话时）文件变更。
 * 支持新建 / 重命名 / 删除（限制在工作区内）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileJson,
  FilePlus,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideo,
  Folder,
  FolderOpen,
  FolderPlus,
  RefreshCw,
  Search,
  Settings,
  SquareArrowOutUpRight,
  Terminal,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { EditorSession, GitFileStatus } from "@shared/protocol";
import { ChangesView } from "@/components/ChangesPanel";
import { FilePreview } from "@/components/FilePreview";
import { useAppStore, WORKSPACE_TERM_ID, type ChatState } from "@/stores/app-store";
import { ipcErrorMessage } from "@/lib/format";
import { GIT_COLOR, GIT_LABEL, refreshGitStatus, useGitStatus } from "@/lib/git-status";
import { useDismiss } from "@/lib/use-dismiss";
import { cn } from "@/lib/cn";
import { ColSash, useDragWidth } from "@/lib/use-drag-width";
import { useT } from "@/lib/i18n";

interface TreeEntry {
  path: string;
  dir: boolean;
}

interface FileNode {
  name: string;
  path: string;
  dir: boolean;
  children?: FileNode[];
}

type Editor = { kind: "create"; parent: string; dir: boolean } | { kind: "rename"; path: string };

interface FileClip {
  cwd: string;
  path: string;
  dir: boolean;
  mode: "copy" | "cut";
}

let persistedClip: FileClip | undefined;

const IS_MAC = window.pi.system.platform === "darwin";
const KEYS = {
  cut: IS_MAC ? "⌘X" : "Ctrl+X",
  copy: IS_MAC ? "⌘C" : "Ctrl+C",
  paste: IS_MAC ? "⌘V" : "Ctrl+V",
  copyPath: IS_MAC ? "⌥⌘C" : "Ctrl+Alt+C",
  copyRelative: IS_MAC ? "⌥⇧⌘C" : "Ctrl+Alt+Shift+C",
  rename: "↩",
  delete: IS_MAC ? "⌘⌫" : "Ctrl+Backspace",
};

function isMod(e: KeyboardEvent): boolean {
  return IS_MAC ? e.metaKey : e.ctrlKey;
}

function MenuItem({
  label,
  shortcut,
  disabled,
  onClick,
}: {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-10 rounded-lg px-2.5 py-1.5 text-left text-[13px]",
        disabled
          ? "text-fg-muted/45"
          : "text-fg-secondary hover:bg-bg-hover hover:text-fg",
      )}
    >
      <span>{label}</span>
      {shortcut && (
        <span className={cn("shrink-0 text-[12px]", disabled ? "text-fg-muted/35" : "text-fg-muted")}>
          {shortcut}
        </span>
      )}
    </button>
  );
}

function MenuSep(): React.JSX.Element {
  return <div className="mx-2 my-1 h-px bg-fg-muted/15" />;
}

const iconBtn =
  "rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg";

const PREVIEW_W_KEY = "bivor:preview-width";
const TREE_W_KEY = "bivor:files-width";
const PREVIEW_W = { fallback: 480, min: 320, max: 960 };
const TREE_W = { fallback: 272, min: 200, max: 480 };

function buildTree(entries: TreeEntry[]): FileNode[] {
  const root: FileNode[] = [];
  const dirs = new Map<string, FileNode>();

  const ensureDir = (rel: string): FileNode[] => {
    if (!rel) return root;
    const existing = dirs.get(rel);
    if (existing?.children) return existing.children;
    const slash = rel.lastIndexOf("/");
    const name = slash < 0 ? rel : rel.slice(slash + 1);
    const parent = slash < 0 ? "" : rel.slice(0, slash);
    const node: FileNode = { name, path: rel, dir: true, children: [] };
    dirs.set(rel, node);
    ensureDir(parent).push(node);
    return node.children!;
  };

  for (const e of entries) {
    if (e.dir) {
      ensureDir(e.path);
      continue;
    }
    const slash = e.path.lastIndexOf("/");
    const name = slash < 0 ? e.path : e.path.slice(slash + 1);
    const parent = slash < 0 ? "" : e.path.slice(0, slash);
    ensureDir(parent).push({ name, path: e.path, dir: false });
  }

  const sort = (nodes: FileNode[]): void => {
    nodes.sort((a, b) => {
      if (a.dir !== b.dir) return a.dir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) if (n.children) sort(n.children);
  };
  sort(root);
  return root;
}

function filterTree(nodes: FileNode[], q: string): FileNode[] {
  if (!q) return nodes;
  const needle = q.toLowerCase();
  const walk = (list: FileNode[]): FileNode[] => {
    const out: FileNode[] = [];
    for (const n of list) {
      if (n.dir) {
        const kids = n.children ? walk(n.children) : [];
        if (kids.length > 0 || n.name.toLowerCase().includes(needle)) {
          out.push({ ...n, children: kids });
        }
      } else if (n.path.toLowerCase().includes(needle) || n.name.toLowerCase().includes(needle)) {
        out.push(n);
      }
    }
    return out;
  };
  return walk(nodes);
}

function collectDirs(nodes: FileNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.dir) {
      out.push(n.path);
      if (n.children) collectDirs(n.children, out);
    }
  }
  return out;
}

function dirsToDepth(nodes: FileNode[], maxDepth: number, depth = 0, out: string[] = []): string[] {
  if (depth >= maxDepth) return out;
  for (const n of nodes) {
    if (n.dir) {
      out.push(n.path);
      if (n.children) dirsToDepth(n.children, maxDepth, depth + 1, out);
    }
  }
  return out;
}

function joinPath(cwd: string, rel: string): string {
  const base = cwd.replace(/[/\\]+$/, "");
  return rel ? `${base}/${rel}` : base;
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

const CODE_EXT = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "go",
  "rs",
  "java",
  "kt",
  "swift",
  "c",
  "cc",
  "cpp",
  "h",
  "hpp",
  "cs",
  "rb",
  "php",
  "lua",
  "scala",
  "vue",
  "svelte",
]);
const DOC_EXT = new Set(["md", "mdx", "txt", "rst", "adoc", "rtf"]);
const STYLE_EXT = new Set(["css", "scss", "sass", "less"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "avif"]);
const AUDIO_EXT = new Set(["mp3", "wav", "flac", "aac", "ogg", "m4a"]);
const VIDEO_EXT = new Set(["mp4", "mov", "webm", "mkv", "avi"]);
const ARCHIVE_EXT = new Set(["zip", "tar", "gz", "tgz", "bz2", "7z", "rar"]);
const TABLE_EXT = new Set(["csv", "tsv", "xls", "xlsx"]);
const CONFIG_EXT = new Set(["yml", "yaml", "toml", "ini", "cfg", "conf"]);
const SHELL_EXT = new Set(["sh", "bash", "zsh", "fish", "ps1", "bat", "cmd"]);
const SPECIAL_FILE: Record<string, LucideIcon> = {
  "package.json": FileJson,
  "package-lock.json": FileJson,
  "pnpm-lock.yaml": FileJson,
  "yarn.lock": FileJson,
  "tsconfig.json": FileJson,
  dockerfile: FileCode,
  makefile: FileCode,
  license: FileText,
  ".gitignore": FileText,
  ".env": Settings,
};

function fileGlyph(name: string): LucideIcon {
  const special = SPECIAL_FILE[name.toLowerCase()];
  if (special) return special;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  if (ext === "json" || ext === "jsonc") return FileJson;
  if (CODE_EXT.has(ext) || ext === "html" || ext === "htm") return FileCode;
  if (DOC_EXT.has(ext)) return FileText;
  if (STYLE_EXT.has(ext)) return FileType;
  if (IMAGE_EXT.has(ext)) return FileImage;
  if (AUDIO_EXT.has(ext)) return FileAudio;
  if (VIDEO_EXT.has(ext)) return FileVideo;
  if (ARCHIVE_EXT.has(ext)) return FileArchive;
  if (TABLE_EXT.has(ext)) return FileSpreadsheet;
  if (CONFIG_EXT.has(ext)) return Settings;
  if (SHELL_EXT.has(ext)) return Terminal;
  return File;
}

function EntryIcon({ name, dir, open }: { name: string; dir: boolean; open?: boolean }): React.JSX.Element {
  const Icon = dir ? (open ? FolderOpen : Folder) : fileGlyph(name);
  return <Icon size={13} strokeWidth={1.7} className="shrink-0 text-fg-muted" />;
}

function remapPath(path: string, from: string, to: string): string {
  if (path === from) return to;
  if (path.startsWith(`${from}/`)) return to + path.slice(from.length);
  return path;
}

function remapExpanded(prev: Set<string>, from: string, to: string): Set<string> {
  return new Set([...prev].map((p) => remapPath(p, from, to)));
}

function remapRev(prev: Record<string, number>, from: string, to: string): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [k, v] of Object.entries(prev)) next[remapPath(k, from, to)] = v;
  return next;
}

function NameField({
  initial,
  dir,
  placeholder,
  onCommit,
  onCancel,
}: {
  initial: string;
  dir: boolean;
  placeholder: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [value, setValue] = useState(initial);
  return (
    <>
      <EntryIcon name={value} dir={dir} />
      <input
        autoFocus
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          const n = value.trim();
          if (n && n !== initial) onCommit(n);
          else onCancel();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            const n = value.trim();
            if (n) onCommit(n);
            else onCancel();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onClick={(e) => e.stopPropagation()}
        className="min-w-0 flex-1 rounded-md border border-accent/50 bg-bg-input px-2 py-1 text-xs text-fg outline-none"
      />
    </>
  );
}

function TreeRow({
  node,
  depth,
  cwd,
  editor,
  expanded,
  onToggle,
  onMenu,
  onCommit,
  onCancelEdit,
  onOpenFile,
  previewPath,
  cutPath,
  gitMap,
  folderMap,
}: {
  node: FileNode;
  depth: number;
  cwd: string;
  editor?: Editor;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onMenu: (e: React.MouseEvent, path: string, dir: boolean) => void;
  onCommit: (name: string) => void;
  onCancelEdit: () => void;
  onOpenFile: (path: string) => void;
  previewPath?: string;
  cutPath?: string;
  gitMap: Map<string, GitFileStatus>;
  folderMap: Map<string, GitFileStatus>;
}): React.JSX.Element {
  const t = useT();
  const renaming = editor?.kind === "rename" && editor.path === node.path;
  const creatingHere = editor?.kind === "create" && editor.parent === node.path && node.dir;
  const open = node.dir && (expanded.has(node.path) || creatingHere);
  const abs = joinPath(cwd, node.path);
  const kids = node.dir && open ? (node.children ?? []) : [];
  const dimmed = Boolean(cutPath && (node.path === cutPath || node.path.startsWith(`${cutPath}/`)));
  const git = node.dir ? (folderMap.get(node.path) ?? gitMap.get(node.path)) : gitMap.get(node.path);
  const gitColor = git ? GIT_COLOR[git] : undefined;

  return (
    <div>
      <div
        className={cn(
          "group flex cursor-pointer items-center gap-2 rounded-lg py-1.5 pr-2 text-left text-[13px] transition-colors",
          previewPath === node.path ? "bg-bg-hover" : "hover:bg-bg-hover",
          dimmed && "opacity-45",
        )}
        style={{ paddingLeft: 8 }}
        onContextMenu={(e) => onMenu(e, node.path, node.dir)}
        onClick={() => {
          if (renaming) return;
          if (node.dir) onToggle(node.path);
          else onOpenFile(node.path);
        }}
        onDoubleClick={() => {
          if (!node.dir) window.pi.system.revealPath(abs);
        }}
      >
        {depth > 0 && <span className="shrink-0" style={{ width: depth * 12 }} />}
        {node.dir ? (
          open ? (
            <ChevronDown size={13} className="shrink-0 text-fg-muted" />
          ) : (
            <ChevronRight size={13} className="shrink-0 text-fg-muted" />
          )
        ) : (
          <span className="w-[13px] shrink-0" />
        )}
        {renaming ? (
          <NameField
            initial={node.name}
            dir={node.dir}
            placeholder={t("files.namePlaceholder")}
            onCommit={onCommit}
            onCancel={onCancelEdit}
          />
        ) : (
          <>
            <EntryIcon name={node.name} dir={node.dir} open={open} />
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                gitColor ?? (previewPath === node.path ? "text-fg" : "text-fg-secondary group-hover:text-fg"),
              )}
              title={
                git
                  ? t(node.dir ? "files.gitFolderDirty" : GIT_LABEL[git])
                  : node.dir
                    ? undefined
                    : t("files.reveal")
              }
            >
              {node.name}
            </span>
            {git && !node.dir && (
              <span className={cn("w-3 shrink-0 text-right text-[11px] font-medium", gitColor)}>
                {git}
              </span>
            )}
            {git && node.dir && (
              <span className={cn("flex w-3 shrink-0 justify-end", gitColor)}>
                <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-current" />
              </span>
            )}
          </>
        )}
      </div>
      {creatingHere && (
        <div className="flex items-center gap-2 rounded-lg py-1.5 pr-2" style={{ paddingLeft: 8 + (depth + 1) * 12 }}>
          <NameField
            initial=""
            dir={editor.dir}
            placeholder={t("files.namePlaceholder")}
            onCommit={onCommit}
            onCancel={onCancelEdit}
          />
        </div>
      )}
      {kids.map((child) => (
        <TreeRow
          key={child.path}
          node={child}
          depth={depth + 1}
          cwd={cwd}
          editor={editor}
          expanded={expanded}
          onToggle={onToggle}
          onMenu={onMenu}
          onCommit={onCommit}
          onCancelEdit={onCancelEdit}
          onOpenFile={onOpenFile}
          previewPath={previewPath}
          cutPath={cutPath}
          gitMap={gitMap}
          folderMap={folderMap}
        />
      ))}
    </div>
  );
}

export function FileTreePanel({
  cwd,
  chat,
  onClose,
}: {
  cwd: string;
  chat?: ChatState;
  onClose: () => void;
}): React.JSX.Element {
  const t = useT();
  const addUserTerminal = useAppStore((s) => s.addUserTerminal);
  const setTermOpen = useAppStore((s) => s.setTermOpen);
  const [tab, setTab] = useState<"tree" | "changes">("tree");
  const [entries, setEntries] = useState<TreeEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<{ path: string; dir: boolean }>();
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string>();
  const [fileRev, setFileRev] = useState<Record<string, number>>({});
  const [detached, setDetached] = useState(false);
  const detachedRef = useRef(false);
  detachedRef.current = detached;
  const [previewWidth, dragPreview] = useDragWidth(
    PREVIEW_W_KEY,
    PREVIEW_W.fallback,
    PREVIEW_W.min,
    PREVIEW_W.max,
  );
  const [treeWidth, dragTree] = useDragWidth(TREE_W_KEY, TREE_W.fallback, TREE_W.min, TREE_W.max);
  const { entries: gitEntries, map: gitMap, folderMap } = useGitStatus(cwd);
  const [editor, setEditor] = useState<Editor>();
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; dir: boolean }>();
  const [clip, setClip] = useState<FileClip | undefined>(persistedClip);
  const [error, setError] = useState<string>();
  const menuRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const termChatId = chat?.chatId ?? WORKSPACE_TERM_ID;
  useDismiss(Boolean(menu), menuRef, () => {
    setMenu(undefined);
    setSelected(undefined);
  });

  const rememberClip = (next?: FileClip): void => {
    persistedClip = next;
    setClip(next);
  };

  const loadTree = useCallback((keepExpanded = true) => {
    void window.pi.files.tree(cwd).then((list) => {
      const next = buildTree(list);
      setEntries(list);
      setExpanded((prev) =>
        keepExpanded && prev.size > 0 ? prev : new Set(dirsToDepth(next, 2)),
      );
    });
  }, [cwd]);

  const load = useCallback(
    (keepExpanded = true) => {
      loadTree(keepExpanded);
      refreshGitStatus(cwd);
    },
    [cwd, loadTree],
  );

  const applySession = (session: EditorSession): void => {
    setOpenFiles(session.paths);
    setActiveFile(session.active ?? session.paths[session.paths.length - 1]);
    if (session.revisions) setFileRev(session.revisions);
  };

  useEffect(() => {
    loadTree(false);
    setOpenFiles([]);
    setActiveFile(undefined);
    setFileRev({});
    setDetached(false);
    void window.pi.editor.getSession().then((s) => {
      if (s?.cwd === cwd) {
        setDetached(true);
        applySession(s);
      }
    });
  }, [loadTree, cwd]);

  useEffect(() => {
    return window.pi.files.onChanged((evt) => {
      if (evt.cwd !== cwd || evt.structure === false) return;
      loadTree(true);
    });
  }, [cwd, loadTree]);

  useEffect(() => {
    const unsubOpened = window.pi.editor.onOpened((session) => {
      setDetached(session.cwd === cwd);
    });
    const unsubClosed = window.pi.editor.onClosed((session) => {
      setDetached(false);
      if (session?.cwd === cwd) applySession(session);
    });
    const unsubChanged = window.pi.editor.onChanged((session) => {
      if (session.cwd === cwd) applySession(session);
    });
    return () => {
      unsubOpened();
      unsubClosed();
      unsubChanged();
    };
  }, [cwd]);

  const tree = useMemo(() => (entries ? buildTree(entries) : []), [entries]);
  const visible = useMemo(() => filterTree(tree, query.trim()), [tree, query]);
  const searching = query.trim().length > 0;
  const shownExpanded = useMemo(() => {
    if (!searching) return expanded;
    return new Set(collectDirs(visible));
  }, [searching, expanded, visible]);

  const fail = (err: unknown): void => {
    const raw = ipcErrorMessage(err);
    if (/EEXIST|already exists/i.test(raw)) setError(t("files.exists"));
    else if (/invalid name|invalid path/i.test(raw)) setError(t("files.invalidName"));
    else setError(raw);
  };

  const startCreate = (dir: boolean, parent = ""): void => {
    setError(undefined);
    setMenu(undefined);
    setEditor({ kind: "create", parent, dir });
    if (parent) setExpanded((prev) => new Set(prev).add(parent));
  };

  const commit = (name: string): void => {
    if (!editor) return;
    const current = editor;
    setEditor(undefined);
    setError(undefined);
    if (current.kind === "create") {
      void window.pi.files
        .create(cwd, current.parent, name, current.dir)
        .then((rel) => {
          if (current.dir) setExpanded((prev) => new Set(prev).add(rel));
          load();
        })
        .catch(fail);
      return;
    }
    void window.pi.files
      .rename(cwd, current.path, name)
      .then((rel) => {
        const nextPaths = openFiles.map((p) => remapPath(p, current.path, rel));
        const nextActive = activeFile ? remapPath(activeFile, current.path, rel) : undefined;
        const nextRev = remapRev(fileRev, current.path, rel);
        setExpanded((prev) => remapExpanded(prev, current.path, rel));
        setOpenFiles(nextPaths);
        setActiveFile(nextActive);
        setFileRev(nextRev);
        if (detachedRef.current) {
          void window.pi.editor.open({
            cwd,
            paths: nextPaths,
            active: nextActive,
            revisions: nextRev,
          });
        }
        load();
      })
      .catch(fail);
  };

  const remove = (path: string, name: string): void => {
    setMenu(undefined);
    if (!path) return;
    if (!window.confirm(t("files.confirmDelete", { name }))) return;
    setError(undefined);
    void window.pi.files
      .delete(cwd, path)
      .then(() => {
        if (selected?.path === path) setSelected(undefined);
        if (clip?.path === path) rememberClip(undefined);
        const nextPaths = openFiles.filter((p) => p !== path && !p.startsWith(`${path}/`));
        const nextActive =
          activeFile === path || activeFile?.startsWith(`${path}/`)
            ? nextPaths[nextPaths.length - 1]
            : activeFile;
        setOpenFiles(nextPaths);
        setActiveFile(nextActive);
        if (detachedRef.current) {
          void window.pi.editor.open({
            cwd,
            paths: nextPaths,
            active: nextActive,
            revisions: fileRev,
          });
        }
        load();
      })
      .catch(fail);
  };

  const copyAbs = (path: string): void => {
    void navigator.clipboard.writeText(joinPath(cwd, path));
    setMenu(undefined);
  };

  const copyRel = (path: string): void => {
    void navigator.clipboard.writeText(path);
    setMenu(undefined);
  };

  const setEntryClip = (path: string, dir: boolean, mode: "copy" | "cut"): void => {
    if (!path) return;
    rememberClip({ cwd, path, dir, mode });
    setMenu(undefined);
  };

  const pasteInto = (parent: string): void => {
    const src = clip;
    setMenu(undefined);
    if (!src || src.cwd !== cwd) return;
    setError(undefined);
    const op = src.mode === "cut" ? window.pi.files.move : window.pi.files.copy;
    void op(cwd, src.path, parent)
      .then((rel) => {
        if (src.mode === "cut") {
          const nextPaths = openFiles.map((p) => remapPath(p, src.path, rel));
          const nextActive = activeFile ? remapPath(activeFile, src.path, rel) : undefined;
          const nextRev = remapRev(fileRev, src.path, rel);
          rememberClip(undefined);
          setExpanded((prev) => remapExpanded(prev, src.path, rel));
          setOpenFiles(nextPaths);
          setActiveFile(nextActive);
          setFileRev(nextRev);
          if (detachedRef.current) {
            void window.pi.editor.open({
              cwd,
              paths: nextPaths,
              active: nextActive,
              revisions: nextRev,
            });
          }
        }
        if (parent) setExpanded((prev) => new Set(prev).add(parent));
        load();
      })
      .catch(fail);
  };

  const openTerminal = (path: string, dir: boolean): void => {
    const folder = dir ? path : parentOf(path);
    addUserTerminal(termChatId, joinPath(cwd, folder));
    setTermOpen(termChatId, true);
    setMenu(undefined);
  };

  const toggle = (path: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const openMenu = (e: React.MouseEvent, path: string, dir: boolean): void => {
    e.preventDefault();
    e.stopPropagation();
    panelRef.current?.focus();
    setSelected({ path, dir });
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - 280),
      y: Math.min(e.clientY, window.innerHeight - 380),
      path,
      dir,
    });
  };

  const canPaste = Boolean(clip && clip.cwd === cwd);
  const cutPath = clip?.mode === "cut" && clip.cwd === cwd ? clip.path : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (editor || tab !== "tree") return;
      if ((e.target as HTMLElement | null)?.closest("input, textarea")) return;
      if (!panelRef.current?.contains(document.activeElement)) return;
      const item = selected;
      if (e.key === "F2" || (e.key === "Enter" && !isMod(e) && item?.path)) {
        if (!item?.path) return;
        e.preventDefault();
        setEditor({ kind: "rename", path: item.path });
        return;
      }
      if (!isMod(e)) return;
      if (e.key === "x" && item?.path) {
        e.preventDefault();
        setEntryClip(item.path, item.dir, "cut");
      } else if (e.key === "c" && item) {
        e.preventDefault();
        if (e.altKey && e.shiftKey) copyRel(item.path);
        else if (e.altKey) copyAbs(item.path);
        else if (item.path) setEntryClip(item.path, item.dir, "copy");
      } else if (e.key === "v") {
        e.preventDefault();
        const parent = item?.dir ? item.path : item ? parentOf(item.path) : "";
        pasteInto(parent);
      } else if (e.key === "Backspace" && item?.path) {
        e.preventDefault();
        remove(item.path, item.path.split("/").pop() ?? item.path);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, selected, tab, clip, cwd]);

  const fileCount = entries?.filter((e) => !e.dir).length ?? 0;
  const creatingAtRoot = editor?.kind === "create" && editor.parent === "";

  const openFile = (path: string): void => {
    setOpenFiles((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setActiveFile(path);
    if (detached) void window.pi.editor.push({ path });
  };

  const popOut = (): void => {
    if (detached) {
      void window.pi.editor.focus();
      return;
    }
    void window.pi.editor.open({
      cwd,
      paths: openFiles,
      active: activeFile,
      revisions: fileRev,
    });
  };

  const closeFile = (path: string): void => {
    setOpenFiles((prev) => {
      const next = prev.filter((p) => p !== path);
      setActiveFile((cur) => (cur === path ? next[next.length - 1] : cur));
      return next;
    });
  };

  return (
    <div className="flex min-h-0 shrink-0">
    {!detached && openFiles.length > 0 && activeFile && (
      <>
        <ColSash onDrag={dragPreview} />
        <div
          className="flex min-h-0 shrink-0 flex-col bg-bg-secondary"
          style={{ width: previewWidth }}
        >
          <FilePreview
            cwd={cwd}
            paths={openFiles}
            active={activeFile}
            onSelect={setActiveFile}
            onClose={closeFile}
            revisions={fileRev}
            onPopOut={popOut}
          />
        </div>
      </>
    )}
    <ColSash onDrag={dragTree} />
    <div
      ref={panelRef}
      tabIndex={-1}
      className="flex shrink-0 flex-col bg-bg-secondary outline-none"
      style={{ width: treeWidth }}
      onPointerDown={() => panelRef.current?.focus()}
    >
      <div className="flex h-10 shrink-0 items-center justify-between px-3">
        <div className="flex items-center gap-3 text-[12px]">
          <button
            type="button"
            onClick={() => setTab("tree")}
            className={cn(
              "transition-colors",
              tab === "tree" ? "text-fg" : "text-fg-muted hover:text-fg-secondary",
            )}
          >
            {t("files.title")}
          </button>
          <button
            type="button"
            onClick={() => setTab("changes")}
            className={cn(
              "flex items-center gap-1 transition-colors",
              tab === "changes" ? "text-fg" : "text-fg-muted hover:text-fg-secondary",
            )}
          >
            {t("files.tabChanges")}
            {gitEntries.length > 0 && (
              <span className="tabular-nums text-accent">{gitEntries.length}</span>
            )}
          </button>
        </div>
        <div className="flex items-center">
          {tab === "tree" && (
            <>
              <button type="button" title={t("files.newFile")} onClick={() => startCreate(false)} className={iconBtn}>
                <FilePlus size={14} />
              </button>
              <button type="button" title={t("files.newFolder")} onClick={() => startCreate(true)} className={iconBtn}>
                <FolderPlus size={14} />
              </button>
              <button
                type="button"
                title={t("files.search")}
                onClick={() => {
                  setSearchOpen((v) => {
                    if (v) setQuery("");
                    return !v;
                  });
                }}
                className={cn(iconBtn, searchOpen && "bg-bg-hover text-fg")}
              >
                <Search size={14} />
              </button>
              <button type="button" title={t("common.refresh")} onClick={() => load(true)} className={iconBtn}>
                <RefreshCw size={14} />
              </button>
              <button
                type="button"
                title={t("files.popOut")}
                onClick={popOut}
                className={cn(iconBtn, detached && "bg-bg-hover text-fg")}
              >
                <SquareArrowOutUpRight size={14} />
              </button>
            </>
          )}
          <button type="button" title={t("common.close")} onClick={onClose} className={iconBtn}>
            <X size={14} />
          </button>
        </div>
      </div>
      {tab === "changes" ? (
        <ChangesView
          cwd={cwd}
          files={gitEntries}
          activePath={activeFile}
          onOpenFile={openFile}
          onReverted={(path) => {
            setFileRev((prev) => ({ ...prev, [path]: (prev[path] ?? 0) + 1 }));
            load(true);
          }}
        />
      ) : (
        <>
          {searchOpen && (
            <div className="shrink-0 px-2 pb-1">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setQuery("");
                    setSearchOpen(false);
                  }
                }}
                placeholder={t("files.search")}
                className="w-full rounded-md border border-border bg-bg-input px-2 py-1 text-xs text-fg outline-none placeholder:text-fg-muted"
              />
            </div>
          )}
          <div
            className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
            onContextMenu={(e) => {
              if ((e.target as HTMLElement).closest("[data-tree-row]")) return;
              openMenu(e, "", true);
            }}
          >
              {entries === null && <div className="px-2 py-3 text-xs text-fg-muted">{t("files.loading")}</div>}
              {entries && visible.length === 0 && !creatingAtRoot && (
                <div className="px-2 py-3 text-xs text-fg-muted">{t("files.empty")}</div>
              )}
              {creatingAtRoot && editor && (
                <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                  <NameField
                    initial=""
                    dir={editor.dir}
                    placeholder={t("files.namePlaceholder")}
                    onCommit={commit}
                    onCancel={() => setEditor(undefined)}
                  />
                </div>
              )}
              {visible.map((node) => (
                <div key={node.path} data-tree-row>
                  <TreeRow
                    node={node}
                    depth={0}
                    cwd={cwd}
                    editor={editor}
                    expanded={shownExpanded}
                    onToggle={toggle}
                    onMenu={openMenu}
                    onCommit={commit}
                    onCancelEdit={() => setEditor(undefined)}
                    onOpenFile={openFile}
                    previewPath={activeFile}
                    cutPath={cutPath}
                    gitMap={gitMap}
                    folderMap={folderMap}
                  />
                </div>
              ))}
          </div>
          <div className="p-2 text-xs text-fg-muted">
            <div className="rounded-lg px-2.5 py-2">
              {error ?? (entries ? t("files.count", { n: fileCount }) : "")}
            </div>
          </div>
        </>
      )}
      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[248px] rounded-lg bg-bg-secondary py-1 shadow-lg"
          style={{ left: menu.x, top: menu.y }}
        >
          <MenuItem
            label={t("files.newFile")}
            onClick={() => startCreate(false, menu.dir ? menu.path : parentOf(menu.path))}
          />
          <MenuItem
            label={t("files.newFolder")}
            onClick={() => startCreate(true, menu.dir ? menu.path : parentOf(menu.path))}
          />
          <MenuItem
            label={t("files.reveal")}
            onClick={() => {
              window.pi.system.revealPath(joinPath(cwd, menu.path));
              setMenu(undefined);
            }}
          />
          <MenuItem
            label={t("files.openTerminal")}
            onClick={() => openTerminal(menu.path, menu.dir)}
          />
          <MenuSep />
          <MenuItem
            label={t("files.cut")}
            shortcut={KEYS.cut}
            disabled={!menu.path}
            onClick={() => setEntryClip(menu.path, menu.dir, "cut")}
          />
          <MenuItem
            label={t("files.copy")}
            shortcut={KEYS.copy}
            disabled={!menu.path}
            onClick={() => setEntryClip(menu.path, menu.dir, "copy")}
          />
          <MenuItem
            label={t("files.paste")}
            shortcut={KEYS.paste}
            disabled={!canPaste}
            onClick={() => pasteInto(menu.dir ? menu.path : parentOf(menu.path))}
          />
          <MenuSep />
          <MenuItem
            label={t("files.copyPath")}
            shortcut={KEYS.copyPath}
            onClick={() => copyAbs(menu.path)}
          />
          <MenuItem
            label={t("files.copyRelative")}
            shortcut={KEYS.copyRelative}
            onClick={() => copyRel(menu.path)}
          />
          <MenuSep />
          <MenuItem
            label={t("files.rename")}
            shortcut={KEYS.rename}
            disabled={!menu.path}
            onClick={() => {
              setMenu(undefined);
              setEditor({ kind: "rename", path: menu.path });
            }}
          />
          <MenuItem
            label={t("files.delete")}
            shortcut={KEYS.delete}
            disabled={!menu.path}
            onClick={() => remove(menu.path, menu.path.split("/").pop() ?? menu.path)}
          />
        </div>
      )}
    </div>
    </div>
  );
}
