import { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  Brain,
  Download,
  FolderGit2,
  Loader2,
  Package,
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
import { useT } from "@/lib/i18n";

function useCwd(): string {
  return useAppStore((s) => s.activeProjectPath) ?? "/";
}

// ---------- Packages ----------

function PackagesTab(): React.JSX.Element {
  const t = useT();
  const cwd = useCwd();
  const [packages, setPackages] = useState<PackageItem[]>();
  const [source, setSource] = useState("");
  const [scope, setScope] = useState<"user" | "project">("user");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    void window.pi.resources.listPackages(cwd).then(setPackages);
  }, [cwd]);

  useEffect(refresh, [refresh]);
  useEffect(
    () =>
      window.pi.resources.onPackageProgress((e) => {
        setProgress(e.message ?? `${e.action} ${e.source}…`);
        if (e.type === "complete" || e.type === "error") {
          setTimeout(() => setProgress(""), 1500);
        }
      }),
    [],
  );

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

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-medium">{t("resources.packages")}</div>
        <p className="pt-0.5 text-xs leading-relaxed text-fg-muted">{t("resources.packagesIntro")}</p>
      </div>

      <div className="flex gap-1.5">
        <input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder={t("resources.packagePh")}
          className="min-w-0 flex-1 rounded-lg border border-border bg-bg-input px-3 py-1.5 font-mono text-xs outline-none focus:border-accent/60"
        />
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as "user" | "project")}
          className="rounded-lg border border-border bg-bg-input px-2 text-xs outline-none"
        >
          <option value="user">{t("resources.global")}</option>
          <option value="project">{t("resources.project")}</option>
        </select>
        <button
          type="button"
          disabled={!source.trim() || busy}
          onClick={() =>
            void run(() =>
              window.pi.resources.installPackage(cwd, source.trim(), scope === "project"),
            ).then((ok) => {
              // Keep what the user typed if the install failed.
              if (ok) setSource("");
            })
          }
          className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
          {t("common.install")}
        </button>
      </div>

      {progress && <div className="text-[11px] text-fg-muted">{progress}</div>}
      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        {packages?.length === 0 && (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-fg-muted">
            {t("resources.noPackages").split("npm:pi-mcp-adapter")[0]}
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={() => setSource("npm:pi-mcp-adapter")}
            >
              npm:pi-mcp-adapter
            </button>
            {t("resources.noPackages").split("npm:pi-mcp-adapter")[1]}
          </div>
        )}
        {packages?.map((pkg) => (
          <div
            key={`${pkg.scope}-${pkg.source}`}
            className="flex items-center gap-2.5 rounded-xl border border-border bg-bg px-3 py-2"
          >
            {pkg.source.startsWith("git") ? (
              <FolderGit2 size={14} className="shrink-0 text-fg-muted" />
            ) : (
              <Package size={14} className="shrink-0 text-fg-muted" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-xs">{pkg.source}</div>
              <div className="text-[10.5px] text-fg-muted">
                {pkg.scope === "user" ? t("resources.global") : t("resources.project")}
                {pkg.filtered ? t("resources.partial") : ""}
                {!pkg.installedPath ? t("resources.notInstalled") : ""}
              </div>
            </div>
            <button
              type="button"
              title={t("resources.uninstall")}
              disabled={busy}
              onClick={() =>
                void run(() =>
                  window.pi.resources.removePackage(cwd, pkg.source, pkg.scope === "project"),
                )
              }
              className="shrink-0 rounded-md p-1.5 text-fg-muted transition-colors hover:bg-bg-hover hover:text-danger"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>

      {packages && packages.length > 0 && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => window.pi.resources.updatePackages(cwd))}
          className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-fg-secondary transition-colors hover:border-border-strong"
        >
          <RefreshCw size={12} className={cn(busy && "animate-spin")} />
          {t("resources.updateAll")}
        </button>
      )}
    </div>
  );
}

// ---------- Skills ----------

function SkillsTab(): React.JSX.Element {
  const t = useT();
  const cwd = useCwd();
  const [skills, setSkills] = useState<SkillItem[]>();
  const [editing, setEditing] = useState<{ skill: SkillItem; content: string }>();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newScope, setNewScope] = useState<"user" | "project">("user");
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    void window.pi.resources.listSkills(cwd).then(setSkills);
  }, [cwd]);
  useEffect(refresh, [refresh]);

  if (editing) {
    return (
      <div className="flex h-full flex-col gap-2">
        <div className="flex items-center gap-2">
          <BookOpen size={14} className="text-accent" />
          <span className="flex-1 truncate font-mono text-xs">{editing.skill.filePath}</span>
          <button
            type="button"
            onClick={() => {
              void window.pi.resources
                .saveSkill(cwd, editing.skill.filePath, editing.content)
                .then(() => {
                  setEditing(undefined);
                  refresh();
                });
            }}
            className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-hover"
          >
            <Save size={12} />
            {t("common.save")}
          </button>
          <button
            type="button"
            onClick={() => setEditing(undefined)}
            className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-fg-secondary hover:border-border-strong"
          >
            {t("common.cancel")}
          </button>
        </div>
        <textarea
          value={editing.content}
          onChange={(e) => setEditing({ ...editing, content: e.target.value })}
          spellCheck={false}
          className="selectable min-h-0 flex-1 resize-none rounded-xl border border-border bg-bg-input p-3 font-mono text-xs leading-relaxed outline-none focus:border-accent/60"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{t("resources.skillsTitle")}</div>
          <p className="pt-0.5 text-xs leading-relaxed text-fg-muted">{t("resources.skillsIntro")}</p>
        </div>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-hover"
        >
          <Plus size={12} />
          {t("resources.newSkill")}
        </button>
      </div>

      {creating && (
        <div className="space-y-2 rounded-xl border border-border bg-bg p-3">
          <div className="flex gap-1.5">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("resources.skillNamePh")}
              className="min-w-0 flex-1 rounded-lg border border-border bg-bg-input px-2.5 py-1.5 text-xs outline-none focus:border-accent/60"
            />
            <select
              value={newScope}
              onChange={(e) => setNewScope(e.target.value as "user" | "project")}
              className="rounded-lg border border-border bg-bg-input px-2 text-xs outline-none"
            >
              <option value="user">{t("resources.globalHome")}</option>
              <option value="project">{t("resources.projectPi")}</option>
            </select>
          </div>
          <input
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder={t("resources.skillDescPh")}
            className="w-full rounded-lg border border-border bg-bg-input px-2.5 py-1.5 text-xs outline-none focus:border-accent/60"
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-lg px-2.5 py-1.5 text-xs text-fg-secondary hover:bg-bg-hover"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={!newName.trim()}
              onClick={() => {
                setError("");
                void window.pi.resources
                  .createSkill(newScope, cwd, newName.trim(), newDesc.trim())
                  .then((path) => {
                    setCreating(false);
                    setNewName("");
                    setNewDesc("");
                    refresh();
                    return window.pi.resources.readSkill(cwd, path).then((content) => {
                      setEditing({
                        skill: {
                          name: newName.trim(),
                          description: newDesc,
                          filePath: path,
                          baseDir: "",
                          source: "",
                        },
                        content,
                      });
                    });
                  })
                  .catch((err: Error) => setError(err.message));
              }}
              className="rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-40"
            >
              {t("resources.createEdit")}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        {skills?.length === 0 && (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-fg-muted">
            {t("resources.noSkills")}
          </div>
        )}
        {skills?.map((skill) => (
          <div
            key={skill.filePath}
            className="group flex items-start gap-2.5 rounded-xl border border-border bg-bg px-3 py-2.5"
          >
            <BookOpen size={14} className="mt-0.5 shrink-0 text-accent/70" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium">{skill.name}</div>
              <div className="line-clamp-2 text-[11px] leading-relaxed text-fg-muted">
                {skill.description}
              </div>
              <div className="pt-0.5 font-mono text-[10px] text-fg-muted/70">{skill.source}</div>
            </div>
            <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                title={t("common.edit")}
                onClick={() => {
                  void window.pi.resources.readSkill(cwd, skill.filePath).then((content) => {
                    setEditing({ skill, content });
                  });
                }}
                className="rounded-md p-1.5 text-fg-muted hover:bg-bg-hover hover:text-fg"
              >
                <BookOpen size={13} />
              </button>
              <button
                type="button"
                title={t("common.delete")}
                onClick={() => {
                  if (confirm(t("resources.deleteSkill", { name: skill.name }))) {
                    void window.pi.resources.deleteSkill(cwd, skill.filePath).then(refresh);
                  }
                }}
                className="rounded-md p-1.5 text-fg-muted hover:bg-bg-hover hover:text-danger"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Prompt templates ----------

function PromptsTab(): React.JSX.Element {
  const t = useT();
  const cwd = useCwd();
  const [prompts, setPrompts] = useState<PromptItem[]>();
  const [editing, setEditing] = useState<{ prompt: PromptItem; content: string }>();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newScope, setNewScope] = useState<"user" | "project">("user");
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    void window.pi.resources.listPrompts(cwd).then(setPrompts);
  }, [cwd]);
  useEffect(refresh, [refresh]);

  if (editing) {
    return (
      <div className="flex h-full flex-col gap-2">
        <div className="flex items-center gap-2">
          <SlashSquare size={14} className="text-accent" />
          <span className="flex-1 truncate font-mono text-xs">{editing.prompt.filePath}</span>
          <button
            type="button"
            onClick={() => {
              void window.pi.resources
                .savePrompt(cwd, editing.prompt.filePath, editing.content)
                .then(() => {
                  setEditing(undefined);
                  refresh();
                });
            }}
            className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-hover"
          >
            <Save size={12} />
            {t("common.save")}
          </button>
          <button
            type="button"
            onClick={() => setEditing(undefined)}
            className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-fg-secondary hover:border-border-strong"
          >
            {t("common.cancel")}
          </button>
        </div>
        <textarea
          value={editing.content}
          onChange={(e) => setEditing({ ...editing, content: e.target.value })}
          spellCheck={false}
          className="selectable min-h-0 flex-1 resize-none rounded-xl border border-border bg-bg-input p-3 font-mono text-xs leading-relaxed outline-none focus:border-accent/60"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{t("resources.prompts")}</div>
          <p className="pt-0.5 text-xs leading-relaxed text-fg-muted">{t("resources.promptsIntro")}</p>
        </div>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-hover"
        >
          <Plus size={12} />
          {t("resources.newPrompt")}
        </button>
      </div>

      {creating && (
        <div className="space-y-2 rounded-xl border border-border bg-bg p-3">
          <div className="flex gap-1.5">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("resources.promptNamePh")}
              className="min-w-0 flex-1 rounded-lg border border-border bg-bg-input px-2.5 py-1.5 text-xs outline-none focus:border-accent/60"
            />
            <select
              value={newScope}
              onChange={(e) => setNewScope(e.target.value as "user" | "project")}
              className="rounded-lg border border-border bg-bg-input px-2 text-xs outline-none"
            >
              <option value="user">{t("resources.globalHome")}</option>
              <option value="project">{t("resources.projectPi")}</option>
            </select>
          </div>
          <input
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder={t("resources.promptDescPh")}
            className="w-full rounded-lg border border-border bg-bg-input px-2.5 py-1.5 text-xs outline-none focus:border-accent/60"
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-lg px-2.5 py-1.5 text-xs text-fg-secondary hover:bg-bg-hover"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={!newName.trim()}
              onClick={() => {
                setError("");
                void window.pi.resources
                  .createPrompt(newScope, cwd, newName.trim(), newDesc.trim())
                  .then((path) => {
                    setCreating(false);
                    setNewName("");
                    setNewDesc("");
                    refresh();
                    return window.pi.resources.readPrompt(cwd, path).then((content) => {
                      setEditing({
                        prompt: {
                          name: newName.trim(),
                          description: newDesc,
                          filePath: path,
                          scope: newScope,
                        },
                        content,
                      });
                    });
                  })
                  .catch((err: Error) => setError(err.message));
              }}
              className="rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-40"
            >
              {t("resources.createEdit")}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        {prompts?.length === 0 && (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-fg-muted">
            {t("resources.noPrompts")}
          </div>
        )}
        {prompts?.map((p) => (
          <div
            key={p.filePath}
            className="group flex items-start gap-2.5 rounded-xl border border-border bg-bg px-3 py-2.5"
          >
            <SlashSquare size={14} className="mt-0.5 shrink-0 text-accent/70" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-xs font-medium">/{p.name}</span>
                {p.argumentHint && (
                  <span className="font-mono text-[10.5px] text-fg-muted">{p.argumentHint}</span>
                )}
              </div>
              <div className="line-clamp-2 text-[11px] leading-relaxed text-fg-muted">
                {p.description}
              </div>
              <div className="pt-0.5 font-mono text-[10px] text-fg-muted/70">
                {p.scope === "user" ? t("resources.global") : t("resources.project")}
              </div>
            </div>
            <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                title={t("common.edit")}
                onClick={() => {
                  void window.pi.resources.readPrompt(cwd, p.filePath).then((content) => {
                    setEditing({ prompt: p, content });
                  });
                }}
                className="rounded-md p-1.5 text-fg-muted hover:bg-bg-hover hover:text-fg"
              >
                <BookOpen size={13} />
              </button>
              <button
                type="button"
                title={t("common.delete")}
                onClick={() => {
                  if (confirm(t("resources.deletePrompt", { name: p.name }))) {
                    void window.pi.resources.deletePrompt(cwd, p.filePath).then(refresh);
                  }
                }}
                className="rounded-md p-1.5 text-fg-muted hover:bg-bg-hover hover:text-danger"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
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
    <div className="flex h-full flex-col gap-3">
      <div>
        <div className="text-sm font-medium">{t("resources.mcpTitle")}</div>
        <p className="pt-0.5 text-xs leading-relaxed text-fg-muted">
          {t("resources.mcpIntro")} {t("resources.mcpHint")}
        </p>
      </div>

      {info && !info.adapterInstalled && (
        <div className="flex items-center gap-3 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5">
          <Plug size={15} className="shrink-0 text-warning" />
          <div className="flex-1 text-xs text-fg-secondary">
            {t("resources.mcpMissing")}
          </div>
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
            className="flex shrink-0 items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50"
          >
            {installing ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            {t("resources.installNow")}
          </button>
        </div>
      )}

      <div className="flex items-center gap-1.5">
        {(["global", "project"] as const).map((scope) => (
          <button
            key={scope}
            type="button"
            onClick={() => setTarget(scope)}
            className={cn(
              "rounded-lg px-2.5 py-1.5 text-xs transition-colors",
              target === scope ? "bg-bg-hover font-medium text-fg" : "text-fg-secondary hover:bg-bg-hover/60",
            )}
          >
            {scope === "global" ? t("resources.mcpGlobal") : t("resources.mcpProject")}
          </button>
        ))}
        <span className="flex-1" />
        {servers.length > 0 && (
          <span className="text-[11px] text-fg-muted">{t("resources.serverCount", { n: servers.length })}</span>
        )}
      </div>

      {servers.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {servers.map((sv) => (
            <span
              key={sv.name}
              title={sv.desc}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg px-2 py-1 text-[11px]"
            >
              <Plug size={10.5} className="text-accent" />
              {sv.name}
            </span>
          ))}
        </div>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        className="selectable min-h-[180px] flex-1 resize-none rounded-xl border border-border bg-bg-input p-3 font-mono text-xs leading-relaxed outline-none focus:border-accent/60"
      />
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate font-mono text-[10.5px] text-fg-muted">
          {target === "global" ? info?.globalPath : info?.projectPath}
        </span>
        {status && <span className="text-[11px] text-success">{status}</span>}
        <button
          type="button"
          onClick={() => {
            const path = target === "global" ? info?.globalPath : info?.projectPath;
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
          className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-hover"
        >
          <Save size={12} />
          {t("common.save")}
        </button>
      </div>
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
    <div className="flex h-full flex-col gap-3 pt-1">
      <div>
        <div className="flex items-center gap-2">
          <Brain size={15} className="text-accent" />
          <span className="text-sm font-medium">{t("resources.memoryTitle")}</span>
          {entries > 0 && <span className="text-[11px] text-fg-muted">{t("resources.memoryCount", { n: entries })}</span>}
        </div>
        <p className="pt-1 text-[11.5px] leading-relaxed text-fg-muted">
          {t("resources.memoryIntro", { path: path || ".pi/memory.md" })}
        </p>
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
          className="min-h-0 flex-1 resize-none rounded-xl border border-border bg-bg p-3.5 font-mono text-xs leading-relaxed text-fg outline-none transition-colors focus:border-accent/50 placeholder:text-fg-muted"
        />
      )}
      <div className="flex items-center gap-2">
        {error && <span className="text-[11px] text-danger">{error}</span>}
        <div className="flex-1" />
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => void save()}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-40"
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
        className="dialog-in flex h-[600px] max-h-[85vh] w-[720px] overflow-hidden rounded-2xl border border-border-strong bg-bg-secondary shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex w-40 shrink-0 flex-col border-r border-border bg-bg-tertiary/50 p-2">
          <div className="px-2.5 pb-2 pt-1.5 text-[13px] font-semibold">{t("resources.title")}</div>
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
              {item.label}
            </button>
          ))}
          <div className="flex-1" />
          <p className="px-2.5 pb-1 text-[10px] leading-relaxed text-fg-muted">
            {t("resources.sharedHint")}
          </p>
        </div>

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
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
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
