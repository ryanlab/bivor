import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  Brain,
  Check,
  ChevronDown,
  Download,
  FolderGit2,
  FolderOpen,
  Loader2,
  Package,
  PenLine,
  Plug,
  Plus,
  RefreshCw,
  Save,
  SlashSquare,
  Trash2,
  X,
} from "lucide-react";
import type { McpConfigInfo, PackageItem, PromptItem, SkillItem } from "@shared/protocol";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/cn";
import { tt, useT, type Translator } from "@/lib/i18n";
import { menuItemClass, menuPanel } from "@/lib/menu";
import { useDismiss } from "@/lib/use-dismiss";

function useCwd(): string {
  return useAppStore((s) => s.activeProjectPath ?? s.defaultProjectCwd) ?? "/";
}

function PathReveal({ path }: { path: string }): React.JSX.Element {
  return (
    <button
      type="button"
      title={path}
      onClick={() => window.pi.system.revealPath(path)}
      className="block w-full min-w-0 max-w-full truncate rounded bg-bg-tertiary px-1.5 py-0.5 text-left font-mono text-[10.5px] text-fg-secondary underline decoration-transparent underline-offset-2 transition-colors hover:bg-bg-hover hover:text-accent hover:decoration-accent"
    >
      {path}
    </button>
  );
}

function ScopeSelect({
  value,
  onChange,
}: {
  value: "user" | "project";
  onChange: (v: "user" | "project") => void;
}): React.JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, ref, () => setOpen(false));
  const options: { id: "user" | "project"; label: string }[] = [
    { id: "user", label: t("resources.globalHome") },
    { id: "project", label: t("resources.projectPi") },
  ];
  const current = options.find((o) => o.id === value) ?? options[0];

  return (
    <div ref={ref} className="relative h-9 shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="box-border flex h-9 w-full items-center justify-between gap-1.5 whitespace-nowrap rounded-lg border border-border bg-bg-input px-2.5 text-xs text-fg"
      >
        {current.label}
        <ChevronDown size={13} className="shrink-0 text-fg-muted" />
      </button>
      {open && (
        <div className={cn("dialog-in absolute right-0 top-full z-50 mt-1 min-w-full", menuPanel)}>
          {options.map((o) => {
            const selected = o.id === value;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
                className={menuItemClass(selected, "items-center gap-2 whitespace-nowrap px-2.5 py-1.5")}
              >
                <span className="flex w-3.5 shrink-0 justify-center">
                  {selected && <Check size={14} strokeWidth={2.2} className="text-success" />}
                </span>
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ScopeTag({ scope }: { scope: "user" | "project" }): React.JSX.Element {
  const t = useT();
  return (
    <span className="shrink-0 rounded-md bg-bg-hover px-1.5 py-0.5 text-[10.5px] font-normal text-fg-muted">
      {scope === "project" ? t("resources.project") : t("resources.global")}
    </span>
  );
}

const fieldInput =
  "box-border h-9 w-full min-w-0 rounded-lg border border-border bg-bg-input px-2.5 text-xs outline-none focus:border-accent/60";

const editorInput =
  "selectable min-h-0 flex-1 resize-none rounded-xl border border-border bg-bg-input p-3.5 font-mono text-xs leading-relaxed text-fg outline-none transition-colors focus:border-accent/50 placeholder:text-fg-muted";

function ResourceEditor({
  title,
  intro,
  path,
  value,
  dirty,
  error,
  onChange,
  onSave,
  onCancel,
}: {
  title: string;
  intro?: string;
  path: string;
  value: string;
  dirty: boolean;
  error?: string;
  onChange: (v: string) => void;
  onSave: () => Promise<void>;
  onCancel: () => void;
}): React.JSX.Element {
  const t = useT();
  const [saving, setSaving] = useState(false);
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-4">
      <div className="min-w-0 shrink-0">
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate text-sm font-medium">{title}</span>
        </div>
        {intro ? (
          <p className="line-clamp-2 pt-1 text-xs leading-relaxed text-fg-muted">{intro}</p>
        ) : null}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className={editorInput}
      />
      <div className="flex min-w-0 shrink-0 items-center gap-2">
        {error ? (
          <span className="min-w-0 flex-1 truncate text-[11px] text-danger">{error}</span>
        ) : path ? (
          <div className="min-w-0 flex-1 overflow-hidden">
            <PathReveal path={path} />
          </div>
        ) : (
          <div className="flex-1" />
        )}
        <button
          type="button"
          disabled={saving}
          onClick={onCancel}
          className="inline-flex h-8 shrink-0 items-center rounded-lg px-3 text-xs text-fg-secondary hover:bg-bg-hover disabled:opacity-40"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => {
            setSaving(true);
            void onSave().finally(() => setSaving(false));
          }}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          {t("common.save")}
        </button>
      </div>
    </div>
  );
}

const listRow = "border-b border-border/50 bg-bg last:border-0 hover:bg-bg-hover/50";
const listCell = "truncate px-3 py-2";

function ResourceTable({
  columns,
  empty,
  children,
}: {
  columns: { label: string; className?: string }[];
  empty?: ReactNode;
  children?: ReactNode;
}): React.JSX.Element {
  const cols = (
    <colgroup>
      {columns.map((c, i) => (
        <col key={i} className={c.className} />
      ))}
    </colgroup>
  );
  const head = (
    <thead>
      <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-fg-muted/80">
        {columns.map((c, i) => (
          <th key={i} className="px-3 py-1.5 font-semibold">
            {c.label}
          </th>
        ))}
      </tr>
    </thead>
  );

  if (empty) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border">
        <table className="w-full shrink-0 table-fixed text-xs [&_th]:align-middle">
          {cols}
          {head}
        </table>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-bg px-4">
          <span className="text-center text-xs text-fg-muted">{empty}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border">
      <table className="w-full shrink-0 table-fixed text-xs [&_th]:align-middle">
        {cols}
        {head}
      </table>
      <div className="min-h-0 flex-1 overflow-y-auto bg-bg">
        <table className="w-full table-fixed text-xs [&_td]:align-middle">
          {cols}
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function draftSkill(t: Translator, name: string, description: string): string {
  const slug = slugify(name) || "skill";
  const title = name.trim() || t("resources.skillDraftTitle");
  return `---
name: ${slug}
description: ${description.trim() || t("resources.skillDraftDesc")}
---

# ${title}

${t("resources.skillDraftBody")}
`;
}

function draftPrompt(t: Translator, name: string, description: string): string {
  const slug = slugify(name) || "name";
  return `---
description: ${description.trim() || t("resources.promptDraftDesc")}
argument-hint: ${t("resources.promptDraftHint")}
---

${t("resources.promptDraftBody", { slug })}
`;
}

// ---------- Packages ----------

function PackagesTab(): React.JSX.Element {
  const t = useT();
  const cwd = useCwd();
  const [packages, setPackages] = useState<PackageItem[]>();
  const [installing, setInstalling] = useState(false);
  const [source, setSource] = useState("");
  const [scope, setScope] = useState<"user" | "project">("user");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [updateKeys, setUpdateKeys] = useState<Set<string>>(() => new Set());
  const [updatingKey, setUpdatingKey] = useState("");
  const logRef = useRef<HTMLPreElement>(null);

  const refresh = useCallback(() => {
    void window.pi.resources.listPackages(cwd).then(setPackages);
  }, [cwd]);

  useEffect(refresh, [refresh]);
  useEffect(() => {
    if (!packages?.length) {
      setUpdateKeys(new Set());
      return;
    }
    let cancelled = false;
    void window.pi.resources
      .checkPackageUpdates(cwd)
      .then((list) => {
        if (cancelled) return;
        setUpdateKeys(new Set(list.map((u) => `${u.scope}\0${u.source}`)));
      })
      .catch(() => {
        if (!cancelled) setUpdateKeys(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, packages]);
  useEffect(
    () =>
      window.pi.resources.onPackageProgress((e) => {
        const line = e.message ?? `${e.action} ${e.source}…`;
        setProgress((prev) => (prev ? `${prev}\n${line}` : line));
      }),
    [],
  );
  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [progress]);

  const run = async (fn: () => Promise<void>): Promise<boolean> => {
    setBusy(true);
    setError("");
    try {
      await fn();
      refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openInstall = (preset = ""): void => {
    setSource(preset);
    setError("");
    setProgress("");
    setInstalling(true);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{t("resources.packages")}</div>
          <p className="pt-1 text-xs leading-relaxed text-fg-muted">{t("resources.packagesIntro")}</p>
        </div>
        <button
          type="button"
          disabled={installing}
          onClick={() => openInstall()}
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-xs font-medium transition-colors",
            installing
              ? "cursor-default bg-bg-tertiary text-fg-muted"
              : "bg-accent text-accent-fg hover:bg-accent-hover",
          )}
        >
          <Download size={13} />
          {t("resources.installPkg")}
        </button>
      </div>

      {error && (
        <div className="shrink-0 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      {installing ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          <div className="grid w-full shrink-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
            <div className="min-w-0">
              <input
                autoFocus
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className={cn(fieldInput, "font-mono")}
              />
              <p className="pt-1 text-[11px] leading-relaxed text-fg-muted">{t("resources.packagePh")}</p>
            </div>
            <ScopeSelect value={scope} onChange={setScope} />
          </div>
          <div className="flex shrink-0 justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setInstalling(false);
                setError("");
                setProgress("");
              }}
              className="inline-flex h-8 items-center rounded-lg px-3 text-xs text-fg-secondary hover:bg-bg-hover disabled:opacity-40"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={!source.trim() || busy}
              onClick={() => {
                setProgress("");
                void run(() =>
                  window.pi.resources.installPackage(cwd, source.trim(), scope === "project"),
                ).then((ok) => {
                  if (!ok) return;
                  setSource("");
                  setInstalling(false);
                });
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-accent-fg hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
              {t("common.install")}
            </button>
          </div>
          {(busy || progress) && (
            <pre
              ref={logRef}
              className="selectable min-h-0 min-w-0 w-full flex-1 overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-all rounded-xl border border-border bg-bg-input p-3 font-mono text-[11px] leading-relaxed text-fg-muted"
            >
              {progress}
            </pre>
          )}
        </div>
      ) : (
        <>
          <ResourceTable
            columns={[
              { label: t("resources.colName") },
              { label: "", className: "w-14" },
            ]}
            empty={
              packages?.length === 0 ? (
                <>
                  {t("resources.noPackages").split("npm:pi-mcp-adapter")[0]?.trimEnd()}
                  {" "}
                  <button
                    type="button"
                    className="font-mono text-accent hover:underline"
                    onClick={() => openInstall("npm:pi-mcp-adapter")}
                  >
                    npm:pi-mcp-adapter
                  </button>
                  {" "}
                  {t("resources.noPackages").split("npm:pi-mcp-adapter")[1]?.trimStart()}
                </>
              ) : undefined
            }
          >
            {packages?.map((pkg) => (
              <tr key={`${pkg.scope}-${pkg.source}`} className={listRow}>
                <td className="px-3 py-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <ScopeTag scope={pkg.scope} />
                    {pkg.source.startsWith("git") ? (
                      <FolderGit2 size={13} className="shrink-0 text-fg-muted" />
                    ) : (
                      <Package size={13} className="shrink-0 text-fg-muted" />
                    )}
                    <span className="min-w-0 truncate font-mono">{pkg.source}</span>
                    {pkg.version ? (
                      <span className="shrink-0 font-mono text-[11px] text-fg-muted">({pkg.version})</span>
                    ) : !pkg.installedPath ? (
                      <span className="shrink-0 text-[11px] text-fg-muted">{t("resources.notInstalled")}</span>
                    ) : pkg.filtered ? (
                      <span className="shrink-0 text-[11px] text-fg-muted">{t("resources.partial")}</span>
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      title={
                        updateKeys.has(`${pkg.scope}\0${pkg.source}`)
                          ? t("resources.updateAvailable")
                          : t("resources.update")
                      }
                      disabled={busy}
                      onClick={() => {
                        const key = `${pkg.scope}\0${pkg.source}`;
                        setUpdatingKey(key);
                        void run(() =>
                          window.pi.resources.updatePackages(cwd, pkg.source),
                        ).finally(() => setUpdatingKey(""));
                      }}
                      className={cn(
                        "rounded-md p-1 transition-colors hover:bg-bg-hover disabled:opacity-40",
                        updateKeys.has(`${pkg.scope}\0${pkg.source}`)
                          ? "text-accent hover:text-accent"
                          : "text-fg-muted hover:text-fg",
                      )}
                    >
                      {updatingKey === `${pkg.scope}\0${pkg.source}` ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <RefreshCw size={13} />
                      )}
                    </button>
                    <button
                      type="button"
                      title={t("resources.uninstall")}
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          window.pi.resources.removePackage(cwd, pkg.source, pkg.scope === "project"),
                        )
                      }
                      className="rounded-md p-1 text-fg-muted transition-colors hover:bg-bg-hover hover:text-danger"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </ResourceTable>
        </>
      )}
    </div>
  );
}

// ---------- Skills ----------

function SkillsTab(): React.JSX.Element {
  const t = useT();
  const cwd = useCwd();
  const [skills, setSkills] = useState<SkillItem[]>();
  const [editing, setEditing] = useState<{ skill: SkillItem; content: string; original: string }>();
  const [creating, setCreating] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [importing, setImporting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const [source, setSource] = useState("");
  const [importPath, setImportPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newContent, setNewContent] = useState(() => draftSkill(tt, "", ""));
  const [contentTouched, setContentTouched] = useState(false);
  const [newScope, setNewScope] = useState<"user" | "project">("user");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    void window.pi.resources.listSkills(cwd).then(setSkills);
  }, [cwd]);
  useEffect(refresh, [refresh]);
  useEffect(
    () =>
      window.pi.resources.onSkillProgress((message) => {
        setProgress((prev) => (prev ? `${prev}\n${message}` : message));
      }),
    [],
  );
  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [progress]);
  useEffect(() => {
    if (!creating || contentTouched) return;
    setNewContent(draftSkill(t, newName, newDesc));
  }, [t, creating, contentTouched, newName, newDesc]);

  const openInstall = (preset = ""): void => {
    setCreating(false);
    setImporting(false);
    setMenuOpen(false);
    setError("");
    setProgress("");
    if (!installing || preset) setSource(preset);
    setInstalling(true);
  };

  const openCreate = (): void => {
    setInstalling(false);
    setImporting(false);
    setMenuOpen(false);
    setError("");
    if (!creating) {
      setNewName("");
      setNewDesc("");
      setNewContent(draftSkill(t, "", ""));
      setContentTouched(false);
    }
    setCreating(true);
  };

  const openImport = (): void => {
    setCreating(false);
    setInstalling(false);
    setMenuOpen(false);
    setError("");
    if (!importing) setImportPath("");
    setImporting(true);
  };

  useDismiss(menuOpen, menuRef, () => setMenuOpen(false));
  const inFlow = creating || installing || importing;

  if (editing) {
    return (
      <ResourceEditor
        title={editing.skill.name}
        intro={editing.skill.description}
        path={editing.skill.filePath}
        value={editing.content}
        dirty={editing.content !== editing.original}
        error={error}
        onChange={(content) => setEditing({ ...editing, content })}
        onSave={async () => {
          setError("");
          try {
            await window.pi.resources.saveSkill(cwd, editing.skill.filePath, editing.content);
            setEditing(undefined);
            refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
        onCancel={() => {
          setEditing(undefined);
          setError("");
        }}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{t("resources.skillsTitle")}</div>
          <p className="pt-1 text-xs leading-relaxed text-fg-muted">{t("resources.skillsIntro")}</p>
        </div>
        <div ref={menuRef} className="relative h-8 shrink-0">
          <button
            type="button"
            disabled={busy}
            onClick={() => setMenuOpen((v) => !v)}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-xs font-medium leading-none transition-colors",
              inFlow
                ? "bg-bg-tertiary text-fg-muted"
                : "bg-accent text-accent-fg hover:bg-accent-hover",
            )}
          >
            <Download size={13} className="shrink-0" />
            {t("resources.installSkill")}
          </button>
          {menuOpen && (
            <div className={cn("dialog-in absolute right-0 top-full z-50 mt-1 min-w-[10.5rem]", menuPanel)}>
              <button
                type="button"
                onClick={openCreate}
                className={menuItemClass(creating, "items-center gap-2 px-2.5 py-1.5")}
              >
                <PenLine size={13} className="shrink-0 text-fg-muted" />
                {t("resources.skillCustom")}
              </button>
              <button
                type="button"
                onClick={() => openInstall()}
                className={menuItemClass(installing, "items-center gap-2 px-2.5 py-1.5")}
              >
                <Download size={13} className="shrink-0 text-fg-muted" />
                {t("resources.skillInstallNpx")}
              </button>
              <button
                type="button"
                onClick={openImport}
                className={menuItemClass(importing, "items-center gap-2 px-2.5 py-1.5")}
              >
                <FolderOpen size={13} className="shrink-0 text-fg-muted" />
                {t("resources.skillImport")}
              </button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="shrink-0 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      {installing ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          <div className="grid w-full shrink-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
            <div className="min-w-0">
              <input
                autoFocus
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className={cn(fieldInput, "font-mono")}
              />
              <p className="pt-1 text-[11px] leading-relaxed text-fg-muted">{t("resources.skillSourcePh")}</p>
            </div>
            <ScopeSelect value={newScope} onChange={setNewScope} />
          </div>
          <div className="flex shrink-0 justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setInstalling(false);
                setError("");
                setProgress("");
              }}
              className="inline-flex h-8 items-center rounded-lg px-3 text-xs text-fg-secondary hover:bg-bg-hover disabled:opacity-40"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={!source.trim() || busy}
              onClick={() => {
                setError("");
                setProgress("");
                setBusy(true);
                void window.pi.resources
                  .installSkill(cwd, source.trim(), newScope === "project")
                  .then(() => {
                    setSource("");
                    setInstalling(false);
                    setProgress("");
                    refresh();
                  })
                  .catch((err: Error) => setError(err.message))
                  .finally(() => setBusy(false));
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-accent-fg hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
              {t("common.install")}
            </button>
          </div>
          {(busy || progress) && (
            <pre
              ref={logRef}
              className="selectable min-h-0 min-w-0 w-full flex-1 overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-all rounded-xl border border-border bg-bg-input p-3 font-mono text-[11px] leading-relaxed text-fg-muted"
            >
              {progress}
            </pre>
          )}
        </div>
      ) : creating ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="grid w-full shrink-0 grid-cols-[minmax(0,1fr)_auto] gap-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => {
                const name = e.target.value;
                setNewName(name);
                if (!contentTouched) setNewContent(draftSkill(t, name, newDesc));
              }}
              placeholder={t("resources.skillNamePh")}
              className={fieldInput}
            />
            <ScopeSelect value={newScope} onChange={setNewScope} />
            <input
              value={newDesc}
              onChange={(e) => {
                const description = e.target.value;
                setNewDesc(description);
                if (!contentTouched) setNewContent(draftSkill(t, newName, description));
              }}
              placeholder={t("resources.skillDescPh")}
              className={cn(fieldInput, "col-span-2")}
            />
          </div>
          <textarea
            value={newContent}
            onChange={(e) => {
              setContentTouched(true);
              setNewContent(e.target.value);
            }}
            spellCheck={false}
            className={editorInput}
          />
          <div className="flex shrink-0 justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setError("");
              }}
              className="inline-flex h-8 items-center rounded-lg px-3 text-xs text-fg-secondary hover:bg-bg-hover"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={!newName.trim() || saving}
              onClick={() => {
                setError("");
                setSaving(true);
                void window.pi.resources
                  .createSkill(newScope, cwd, newName.trim(), newDesc.trim())
                  .then((path) => window.pi.resources.saveSkill(cwd, path, newContent))
                  .then(() => {
                    setCreating(false);
                    setNewName("");
                    setNewDesc("");
                    setNewContent(draftSkill(t, "", ""));
                    setContentTouched(false);
                    refresh();
                  })
                  .catch((err: Error) => setError(err.message))
                  .finally(() => setSaving(false));
              }}
              className="inline-flex h-8 items-center rounded-lg bg-accent px-3 text-xs font-medium text-accent-fg hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : t("common.create")}
            </button>
          </div>
        </div>
      ) : importing ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="grid w-full shrink-0 grid-cols-[minmax(0,1fr)_auto] gap-2">
            <button
              type="button"
              onClick={() => {
                void window.pi.system
                  .pickFolder({ title: t("resources.pickSkillFolder") })
                  .then(({ path }) => {
                    if (path) setImportPath(path);
                  });
              }}
              className={cn(fieldInput, "flex items-center gap-2 text-left font-mono")}
            >
              <FolderOpen size={13} className="shrink-0 text-fg-muted" />
              <span className={cn("min-w-0 truncate", importPath ? "text-fg" : "text-fg-muted")}>
                {importPath || t("resources.skillImportPh")}
              </span>
            </button>
            <ScopeSelect value={newScope} onChange={setNewScope} />
          </div>
          <div className="flex shrink-0 justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setImporting(false);
                setImportPath("");
                setError("");
              }}
              className="inline-flex h-8 items-center rounded-lg px-3 text-xs text-fg-secondary hover:bg-bg-hover disabled:opacity-40"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={!importPath || busy}
              onClick={() => {
                setError("");
                setBusy(true);
                void window.pi.resources
                  .importSkill(newScope, cwd, importPath)
                  .then(() => {
                    setImportPath("");
                    setImporting(false);
                    refresh();
                  })
                  .catch((err: Error) => setError(err.message))
                  .finally(() => setBusy(false));
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-accent-fg hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <FolderOpen size={12} />}
              {t("resources.skillImport")}
            </button>
          </div>
        </div>
      ) : (
      <ResourceTable
        columns={[
          { label: t("resources.colName"), className: "w-1/2" },
          { label: t("resources.colDesc"), className: "w-1/2" },
          { label: "", className: "w-14" },
        ]}
        empty={
          skills?.length === 0 ? (
            <>
              {t("resources.noSkills").split("supabase/agent-skills")[0]?.trimEnd()}
              {" "}
              <button
                type="button"
                className="font-mono text-accent hover:underline"
                onClick={() => openInstall("supabase/agent-skills")}
              >
                supabase/agent-skills
              </button>
              {" "}
              {t("resources.noSkills").split("supabase/agent-skills")[1]?.trimStart()}
            </>
          ) : undefined
        }
      >
        {skills?.map((skill) => (
          <tr key={skill.filePath} className={listRow}>
            <td className="px-3 py-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <ScopeTag scope={skill.scope} />
                <span className="min-w-0 truncate font-medium">{skill.name}</span>
              </div>
            </td>
            <td className={cn(listCell, "text-fg-muted")}>{skill.description}</td>
            <td className="px-3 py-2">
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  title={t("common.edit")}
                  onClick={() => {
                    void window.pi.resources.readSkill(cwd, skill.filePath).then((content) => {
                      setError("");
                      setEditing({ skill, content, original: content });
                    });
                  }}
                  className="rounded-md p-1 text-fg-muted hover:bg-bg-hover hover:text-fg"
                >
                  <PenLine size={13} />
                </button>
                <button
                  type="button"
                  title={t("common.delete")}
                  onClick={() => {
                    if (confirm(t("resources.deleteSkill", { name: skill.name }))) {
                      void window.pi.resources.deleteSkill(cwd, skill.filePath).then(refresh);
                    }
                  }}
                  className="rounded-md p-1 text-fg-muted hover:bg-bg-hover hover:text-danger"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </td>
          </tr>
        ))}
      </ResourceTable>
      )}
    </div>
  );
}

// ---------- Prompt templates ----------

function PromptsTab(): React.JSX.Element {
  const t = useT();
  const cwd = useCwd();
  const [prompts, setPrompts] = useState<PromptItem[]>();
  const [editing, setEditing] = useState<{ prompt: PromptItem; content: string; original: string }>();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newContent, setNewContent] = useState(() => draftPrompt(tt, "", ""));
  const [contentTouched, setContentTouched] = useState(false);
  const [newScope, setNewScope] = useState<"user" | "project">("user");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    void window.pi.resources.listPrompts(cwd).then(setPrompts);
  }, [cwd]);
  useEffect(refresh, [refresh]);
  useEffect(() => {
    if (!creating || contentTouched) return;
    setNewContent(draftPrompt(t, newName, newDesc));
  }, [t, creating, contentTouched, newName, newDesc]);

  if (editing) {
    return (
      <ResourceEditor
        title={`/${editing.prompt.name}`}
        intro={editing.prompt.description}
        path={editing.prompt.filePath}
        value={editing.content}
        dirty={editing.content !== editing.original}
        error={error}
        onChange={(content) => setEditing({ ...editing, content })}
        onSave={async () => {
          setError("");
          try {
            await window.pi.resources.savePrompt(cwd, editing.prompt.filePath, editing.content);
            setEditing(undefined);
            refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
        onCancel={() => {
          setEditing(undefined);
          setError("");
        }}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{t("resources.prompts")}</div>
          <p className="pt-1 text-xs leading-relaxed text-fg-muted">{t("resources.promptsIntro")}</p>
        </div>
        <button
          type="button"
          disabled={creating}
          onClick={() => {
            setNewName("");
            setNewDesc("");
            setNewContent(draftPrompt(t, "", ""));
            setContentTouched(false);
            setError("");
            setCreating(true);
          }}
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-xs font-medium transition-colors",
            creating
              ? "cursor-default bg-bg-tertiary text-fg-muted"
              : "bg-accent text-accent-fg hover:bg-accent-hover",
          )}
        >
          <Plus size={13} />
          {t("resources.newPrompt")}
        </button>
      </div>

      {error && (
        <div className="shrink-0 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      {creating ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="grid w-full shrink-0 grid-cols-[minmax(0,1fr)_auto] gap-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => {
                const name = e.target.value;
                setNewName(name);
                if (!contentTouched) setNewContent(draftPrompt(t, name, newDesc));
              }}
              placeholder={t("resources.promptNamePh")}
              className={fieldInput}
            />
            <ScopeSelect value={newScope} onChange={setNewScope} />
            <input
              value={newDesc}
              onChange={(e) => {
                const description = e.target.value;
                setNewDesc(description);
                if (!contentTouched) setNewContent(draftPrompt(t, newName, description));
              }}
              placeholder={t("resources.promptDescPh")}
              className={cn(fieldInput, "col-span-2")}
            />
          </div>
          <textarea
            value={newContent}
            onChange={(e) => {
              setContentTouched(true);
              setNewContent(e.target.value);
            }}
            spellCheck={false}
            className={editorInput}
          />
          <div className="flex shrink-0 justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setError("");
              }}
              className="inline-flex h-8 items-center rounded-lg px-3 text-xs text-fg-secondary hover:bg-bg-hover"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={!newName.trim() || saving}
              onClick={() => {
                setError("");
                setSaving(true);
                void window.pi.resources
                  .createPrompt(newScope, cwd, newName.trim(), newDesc.trim())
                  .then((path) => window.pi.resources.savePrompt(cwd, path, newContent))
                  .then(() => {
                    setCreating(false);
                    setNewName("");
                    setNewDesc("");
                    setNewContent(draftPrompt(t, "", ""));
                    setContentTouched(false);
                    refresh();
                  })
                  .catch((err: Error) => setError(err.message))
                  .finally(() => setSaving(false));
              }}
              className="inline-flex h-8 items-center rounded-lg bg-accent px-3 text-xs font-medium text-accent-fg hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : t("common.create")}
            </button>
          </div>
        </div>
      ) : (
      <ResourceTable
        columns={[
          { label: t("resources.colName"), className: "w-1/2" },
          { label: t("resources.colDesc"), className: "w-1/2" },
          { label: "", className: "w-14" },
        ]}
        empty={prompts?.length === 0 ? t("resources.noPrompts") : undefined}
      >
        {prompts?.map((p) => (
          <tr key={p.filePath} className={listRow}>
            <td className="px-3 py-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <ScopeTag scope={p.scope} />
                <span className="min-w-0 truncate font-mono font-medium">/{p.name}</span>
                {p.argumentHint ? (
                  <span className="min-w-0 truncate font-mono text-[10.5px] text-fg-muted">
                    {p.argumentHint}
                  </span>
                ) : null}
              </div>
            </td>
            <td className={cn(listCell, "text-fg-muted")}>{p.description}</td>
            <td className="px-3 py-2">
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  title={t("common.edit")}
                  onClick={() => {
                    void window.pi.resources.readPrompt(cwd, p.filePath).then((content) => {
                      setError("");
                      setEditing({ prompt: p, content, original: content });
                    });
                  }}
                  className="rounded-md p-1 text-fg-muted hover:bg-bg-hover hover:text-fg"
                >
                  <PenLine size={13} />
                </button>
                <button
                  type="button"
                  title={t("common.delete")}
                  onClick={() => {
                    if (confirm(t("resources.deletePrompt", { name: p.name }))) {
                      void window.pi.resources.deletePrompt(cwd, p.filePath).then(refresh);
                    }
                  }}
                  className="rounded-md p-1 text-fg-muted hover:bg-bg-hover hover:text-danger"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </td>
          </tr>
        ))}
      </ResourceTable>
      )}
    </div>
  );
}

// ---------- MCP ----------

function McpTab(): React.JSX.Element {
  const t = useT();
  const cwd = useCwd();
  const [info, setInfo] = useState<McpConfigInfo>();
  const [text, setText] = useState("");
  const [target, setTarget] = useState<"global" | "project">("global");
  const [status, setStatus] = useState("");
  const [installing, setInstalling] = useState(false);

  const refresh = useCallback(() => {
    void window.pi.resources.readMcp(cwd).then((i) => {
      setInfo(i);
      setText(
        (i[target === "global" ? "globalContent" : "projectContent"] as string | undefined) ??
          '{\n  "mcpServers": {\n  }\n}\n',
      );
    });
  }, [cwd, target]);
  useEffect(refresh, [refresh]);

  const servers = ((): { name: string; desc: string }[] => {
    try {
      const parsed = JSON.parse(text) as {
        mcpServers?: Record<string, { command?: string; url?: string; disabled?: boolean }>;
      };
      return Object.entries(parsed.mcpServers ?? {}).map(([name, cfg]) => ({
        name,
        desc: cfg.url ?? cfg.command ?? "",
      }));
    } catch {
      return [];
    }
  })();

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-4">
      <div>
        <div className="text-sm font-medium">{t("resources.mcpTitle")}</div>
        <p className="pt-1 text-xs leading-relaxed text-fg-muted">
          {t("resources.mcpIntro")} {t("resources.mcpHint")}
        </p>
      </div>

      {info && !info.adapterInstalled && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-4 py-6 text-center">
          <p className="text-xs text-fg-muted">{t("resources.mcpMissing")}</p>
          <button
            type="button"
            disabled={installing}
            onClick={() => {
              setInstalling(true);
              void window.pi.resources
                .installPackage(cwd, "npm:pi-mcp-adapter", false)
                .then(() => refresh())
                .finally(() => setInstalling(false));
            }}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {installing ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            {t("resources.installNow")}
          </button>
        </div>
      )}

      {info?.adapterInstalled && (
        <>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-bg-input transition-colors focus-within:border-accent/50">
            <div className="flex shrink-0 items-center gap-1 px-2 pt-2">
              {(["global", "project"] as const).map((scope) => (
                <button
                  key={scope}
                  type="button"
                  onClick={() => setTarget(scope)}
                  className={cn(
                    "rounded-md px-2 py-1 text-[11px] transition-colors",
                    target === scope
                      ? "bg-bg-hover font-medium text-fg"
                      : "text-fg-secondary hover:bg-bg-hover/60",
                  )}
                >
                  {scope === "global" ? t("resources.mcpGlobal") : t("resources.mcpProject")}
                </button>
              ))}
              <span className="flex-1" />
              {servers.length > 0 && (
                <span className="pr-1 text-[11px] text-fg-muted">
                  {t("resources.serverCount", { n: servers.length })}
                </span>
              )}
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              className="selectable min-h-0 flex-1 resize-none bg-transparent px-3.5 pb-3.5 pt-2 font-mono text-xs leading-relaxed text-fg outline-none placeholder:text-fg-muted"
            />
          </div>
          <div className="flex min-w-0 shrink-0 items-center gap-2">
            <div className="min-w-0 flex-1 overflow-hidden">
              <PathReveal path={target === "global" ? info.globalPath : info.projectPath} />
            </div>
            {status && <span className="text-[11px] text-success">{status}</span>}
            <button
              type="button"
              onClick={() => {
                const path = target === "global" ? info.globalPath : info.projectPath;
                if (!path) return;
                void window.pi.resources
                  .saveMcp(cwd, path, text)
                  .then(() => {
                    setStatus(t("resources.savedReload"));
                    setTimeout(() => setStatus(""), 3000);
                  })
                  .catch((err: Error) => {
                    setStatus("");
                    alert(t("resources.invalidJson", { error: err.message }));
                  });
              }}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover"
            >
              <Save size={13} />
              {t("common.save")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Project memory ----------

function MemoryTab(): React.JSX.Element {
  const t = useT();
  const cwd = useCwd();
  const [content, setContent] = useState<string>();
  const [path, setPath] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Live refresh when the agent saves a memory while this tab is open.
  const liveMemory = useAppStore((s) => {
    const id = s.activeChatId;
    return id ? s.chats[id]?.memoryContent : undefined;
  });

  useEffect(() => {
    void window.pi.resources
      .readMemory(cwd)
      .then((r) => {
        setPath(r.path);
        setContent(r.content);
      })
      .catch((e: Error) => setError(e.message));
  }, [cwd]);

  useEffect(() => {
    if (liveMemory !== undefined && !dirty) setContent(liveMemory);
  }, [liveMemory, dirty]);

  const save = async (): Promise<void> => {
    if (content === undefined) return;
    setSaving(true);
    setError("");
    try {
      await window.pi.resources.saveMemory(cwd, content);
      setDirty(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const entries = (content ?? "").split("\n").filter((l) => l.trimStart().startsWith("- ")).length;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{t("resources.memoryTitle")}</span>
          {entries > 0 && <span className="text-[11px] text-fg-muted">{t("resources.memoryCount", { n: entries })}</span>}
        </div>
        <p className="pt-1 text-xs leading-relaxed text-fg-muted">{t("resources.memoryIntro")}</p>
      </div>
      {content === undefined && !error ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 size={16} className="animate-spin text-fg-muted" />
        </div>
      ) : (
        <textarea
          value={content ?? ""}
          onChange={(e) => {
            setContent(e.target.value);
            setDirty(true);
          }}
          spellCheck={false}
          placeholder={t("resources.memoryPh")}
          className="min-h-0 flex-1 resize-none rounded-xl border border-border bg-bg-input p-3.5 font-mono text-xs leading-relaxed text-fg outline-none transition-colors focus:border-accent/50 placeholder:text-fg-muted"
        />
      )}
      <div className="flex min-w-0 shrink-0 items-center gap-2">
        {error && <span className="min-w-0 flex-1 truncate text-[11px] text-danger">{error}</span>}
        {!error && path ? (
          <div className="min-w-0 flex-1 overflow-hidden">
            <PathReveal path={path} />
          </div>
        ) : (
          <div className="flex-1" />
        )}
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => void save()}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          {t("common.save")}
        </button>
      </div>
    </div>
  );
}

// ---------- Dialog ----------

const TAB_IDS = ["packages", "skills", "prompts", "memory", "mcp"] as const;
type TabId = (typeof TAB_IDS)[number];

export function ResourcesDialog(): React.JSX.Element | null {
  const t = useT();
  const tabs = [
    { id: "packages" as const, label: t("resources.packages"), icon: <Package size={14} /> },
    { id: "skills" as const, label: t("resources.skills"), icon: <BookOpen size={14} /> },
    { id: "prompts" as const, label: t("resources.prompts"), icon: <SlashSquare size={14} /> },
    { id: "memory" as const, label: t("resources.memory"), icon: <Brain size={14} /> },
    { id: "mcp" as const, label: t("resources.mcp"), icon: <Plug size={14} /> },
  ];
  const open = useAppStore((s) => s.resourcesOpen);
  const requestedTab = useAppStore((s) => s.resourcesTab);
  const setOpen = useAppStore((s) => s.setResourcesOpen);
  const [tab, setTab] = useState<TabId>("packages");

  useEffect(() => {
    if (open && requestedTab && TAB_IDS.includes(requestedTab as TabId)) {
      setTab(requestedTab as TabId);
    }
  }, [open, requestedTab]);

  if (!open) return null;

  return (
    <div
      className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={() => setOpen(false)}
    >
      <div
        className="dialog-in flex h-[480px] max-h-[80vh] w-[700px] overflow-hidden rounded-2xl border border-border-strong bg-bg-secondary shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left nav */}
        <div className="flex w-52 shrink-0 flex-col border-r border-border bg-bg-tertiary/50 p-2">
          <div className="px-2.5 pb-2 pt-1.5 text-[13px] font-semibold">{t("resources.title")}</div>
          <div className="flex flex-col gap-1">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors",
                  tab === item.id
                    ? "bg-bg-hover font-medium text-fg"
                    : "text-fg-secondary hover:bg-bg-hover/60",
                )}
              >
                {item.icon}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-end px-3 pt-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 pb-5">
            {tab === "packages" && <PackagesTab />}
            {tab === "skills" && <SkillsTab />}
            {tab === "prompts" && <PromptsTab />}
            {tab === "memory" && <MemoryTab />}
            {tab === "mcp" && <McpTab />}
          </div>
        </div>
      </div>
    </div>
  );
}
