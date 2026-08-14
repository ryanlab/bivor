import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  AtSign,
  Clock,
  GitFork,
  ImagePlus,
  Laptop,
  Loader2,
  SlashSquare,
  Square,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import type { ImagePayload } from "@shared/protocol";
import { getRuntimePreset } from "@shared/runtime-presets";
import { thinkingLevelOf, useAppStore, type ChatState } from "@/stores/app-store";
import { ModelPicker } from "@/components/ModelPicker";
import { ComposerStack, PresetSwitch } from "@/components/ComposerStack";
import { SubagentDock } from "@/components/SubagentDock";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";

function ToolsPopover({ chat }: { chat: ChatState }): React.JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const requestTools = useAppStore((s) => s.requestTools);
  const setTools = useAppStore((s) => s.setTools);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    requestTools(chat.chatId);
    const onClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open, chat.chatId, requestTools]);

  const activeCount = chat.tools?.filter((t) => t.active).length;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title={t("composer.toolsTitle")}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1 rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-secondary",
          open && "bg-bg-hover text-fg-secondary",
        )}
      >
        <Wrench size={14} />
        {activeCount !== undefined && chat.tools && activeCount < chat.tools.length && (
          <span className="text-[10px]">{activeCount}</span>
        )}
      </button>
      {open && (
        <div className="dialog-in absolute bottom-full left-0 z-50 mb-1 w-72 rounded-xl border border-border-strong bg-bg shadow-2xl">
          <div className="border-b border-border px-3 py-2 text-xs font-medium">
            {t("composer.toolsHeader")}
          </div>
          <div className="max-h-64 overflow-y-auto p-1.5">
            {!chat.tools && <div className="px-2 py-3 text-xs text-fg-muted">{t("common.loading")}</div>}
            {chat.tools?.map((tool) => (
              <label
                key={tool.name}
                className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-bg-hover"
              >
                <input
                  type="checkbox"
                  checked={tool.active}
                  onChange={(e) => {
                    const names = (chat.tools ?? [])
                      .filter((t) => (t.name === tool.name ? e.target.checked : t.active))
                      .map((t) => t.name);
                    useAppStore.setState((s) => ({
                      chats: {
                        ...s.chats,
                        [chat.chatId]: {
                          ...s.chats[chat.chatId],
                          tools: s.chats[chat.chatId].tools?.map((t) =>
                            t.name === tool.name ? { ...t, active: e.target.checked } : t,
                          ),
                        },
                      },
                    }));
                    setTools(chat.chatId, names);
                  }}
                  className="mt-0.5 accent-(--t-accent)"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-fg">{tool.name}</span>
                  {tool.description && (
                    <span className="block truncate text-[10.5px] text-fg-muted">
                      {tool.description}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
          <div className="border-t border-border px-3 py-1.5 text-[10.5px] text-fg-muted">
            {t("composer.toolsFooter")}
          </div>
        </div>
      )}
    </div>
  );
}

/** Fuzzy-ish filter: all query chars must appear in order. */
function fuzzyMatch(path: string, query: string): boolean {
  const p = path.toLowerCase();
  const q = query.toLowerCase();
  let i = 0;
  for (const ch of p) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return q.length === 0;
}

interface PendingImage extends ImagePayload {
  id: string;
}

function fileToImage(file: File): Promise<PendingImage | undefined> {
  if (!file.type.startsWith("image/")) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      const base64 = url.slice(url.indexOf(",") + 1);
      resolve({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        data: base64,
        mimeType: file.type,
      });
    };
    reader.onerror = () => resolve(undefined);
    reader.readAsDataURL(file);
  });
}

export function Composer({ chat }: { chat: ChatState }): React.JSX.Element {
  const t = useT();
  const [text, setText] = useState("");
  const [images, setImages] = useState<PendingImage[]>([]);
  const [streamMode, setStreamMode] = useState<"steer" | "followUp">("steer");
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [projectFiles, setProjectFiles] = useState<string[]>();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sendPrompt = useAppStore((s) => s.sendPrompt);
  const abort = useAppStore((s) => s.abort);
  const setModel = useAppStore((s) => s.setModel);
  const setModelThinking = useAppStore((s) => s.setModelThinking);
  const modelThinking = useAppStore((s) => s.modelThinking);
  const models = useAppStore((s) => s.models);
  const providers = useAppStore((s) => s.providers);
  const runBash = useAppStore((s) => s.runBash);
  const abortBash = useAppStore((s) => s.abortBash);
  const clearQueue = useAppStore((s) => s.clearQueue);
  const abortRetry = useAppStore((s) => s.abortRetry);

  const disabled = chat.status !== "ready";
  const supportsImages = chat.model?.input?.includes("image") ?? false;
  const preset = getRuntimePreset(chat.presetId, chat.kind);
  const ui = preset.ui;
  const consumeDraft = useAppStore((s) => s.consumeDraft);

  useEffect(() => {
    if (chat.draft) {
      setText(chat.draft);
      consumeDraft(chat.chatId);
      textareaRef.current?.focus();
    }
  }, [chat.draft, chat.chatId, consumeDraft]);

  // Don't keep a model whose provider has no API key / OAuth.
  useEffect(() => {
    if (chat.status !== "ready" || !chat.model) return;
    const authed = new Set(providers.filter((p) => p.authenticated).map((p) => p.id));
    if (authed.has(chat.model.provider)) return;
    const fallback = models.find((m) => authed.has(m.provider));
    if (fallback) setModel(chat.chatId, fallback);
  }, [chat.status, chat.model, chat.chatId, providers, models, setModel]);

  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, []);

  const addFiles = useCallback(async (files: Iterable<File>) => {
    const added = await Promise.all([...files].map(fileToImage));
    const valid = added.filter((i): i is PendingImage => Boolean(i));
    if (valid.length > 0) setImages((prev) => [...prev, ...valid].slice(0, 8));
  }, []);

  // ---- @file mention ----
  const updateMention = useCallback(
    (value: string, caret: number) => {
      const before = value.slice(0, caret);
      const at = before.lastIndexOf("@");
      if (at < 0 || (at > 0 && !/[\s([{'"`]/.test(before[at - 1]))) {
        setMention(null);
        return;
      }
      const query = before.slice(at + 1);
      if (/\s/.test(query) || query.length > 64) {
        setMention(null);
        return;
      }
      setMention({ start: at, query });
      if (!projectFiles) {
        void window.pi.files.list(chat.cwd).then(setProjectFiles);
      }
    },
    [projectFiles, chat.cwd],
  );

  const mentionMatches = useMemo(() => {
    if (!mention || !projectFiles) return [];
    const q = mention.query;
    const starts: string[] = [];
    const fuzzy: string[] = [];
    for (const f of projectFiles) {
      const base = f.split("/").pop() ?? f;
      if (base.toLowerCase().startsWith(q.toLowerCase()) || f.toLowerCase().includes(q.toLowerCase())) {
        starts.push(f);
      } else if (q.length >= 2 && fuzzyMatch(f, q)) {
        fuzzy.push(f);
      }
      if (starts.length >= 8) break;
    }
    return [...starts, ...fuzzy].slice(0, 8);
  }, [mention, projectFiles]);

  useEffect(() => setMentionIndex(0), [mention?.query]);

  // ---- /command menu (prompt templates, /skill:name, extension commands) ----
  // Only meaningful while typing the first token: prompt() expands "/cmd" there.
  const slashQuery = useMemo(() => {
    if (!text.startsWith("/") || /\s/.test(text)) return null;
    return text.slice(1);
  }, [text]);

  const slashMatches = useMemo(() => {
    if (slashQuery === null || slashDismissed) return [];
    const q = slashQuery.toLowerCase();
    const cmds = chat.commands ?? [];
    return cmds
      .filter((c) => c.name.toLowerCase().includes(q) || (c.description ?? "").toLowerCase().includes(q))
      .slice(0, 8);
  }, [slashQuery, slashDismissed, chat.commands]);

  useEffect(() => {
    setSlashIndex(0);
    setSlashDismissed(false);
  }, [slashQuery]);

  const insertSlash = useCallback(
    (name: string) => {
      setText(`/${name} `);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          const pos = name.length + 2;
          el.setSelectionRange(pos, pos);
          el.focus();
        }
        autoGrow();
      });
    },
    [autoGrow],
  );

  const insertMention = useCallback(
    (path: string) => {
      if (!mention) return;
      const el = textareaRef.current;
      const caret = el?.selectionStart ?? text.length;
      const next = `${text.slice(0, mention.start)}${path} ${text.slice(caret)}`;
      setText(next);
      setMention(null);
      requestAnimationFrame(() => {
        if (el) {
          const pos = mention.start + path.length + 1;
          el.setSelectionRange(pos, pos);
          el.focus();
        }
        autoGrow();
      });
    },
    [mention, text, autoGrow],
  );

  const submit = useCallback(() => {
    const trimmed = text.trim();
    if ((!trimmed && images.length === 0) || disabled) return;
    // `!command` runs directly in the session's shell (recorded into context)
    if (ui.bashBang && trimmed.startsWith("!") && trimmed.length > 1 && !chat.isStreaming) {
      runBash(chat.chatId, trimmed.slice(1).trim());
      setText("");
      requestAnimationFrame(autoGrow);
      return;
    }
    sendPrompt(chat.chatId, trimmed, {
      images: images.map(({ data, mimeType }) => ({ data, mimeType })),
      mode: streamMode,
    });
    setText("");
    setImages([]);
    requestAnimationFrame(autoGrow);
  }, [text, images, disabled, sendPrompt, runBash, chat.chatId, chat.isStreaming, ui.bashBang, streamMode, autoGrow]);

  const queued = [
    ...(chat.queue?.steering ?? []).map((msg) => ({ kind: "steer" as const, text: msg })),
    ...(chat.queue?.followUp ?? []).map((msg) => ({ kind: "followUp" as const, text: msg })),
  ];

  return (
    <div className="mx-auto w-full max-w-3xl shrink-0 px-6 pb-5">
      {chat.retrying && (
        <div className="fade-up mb-2 flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-[11.5px]">
          <Loader2 size={12} className="shrink-0 animate-spin text-warning" />
          <span className="shrink-0 font-medium text-warning">
            {t("composer.retrying", { attempt: chat.retrying.attempt, max: chat.retrying.maxAttempts })}
            {chat.retrying.delayMs > 0 && t("composer.retryIn", { sec: Math.round(chat.retrying.delayMs / 1000) })}
          </span>
          <span className="min-w-0 flex-1 truncate text-fg-muted" title={chat.retrying.errorMessage}>
            {chat.retrying.errorMessage}
          </span>
          <button
            type="button"
            onClick={() => abortRetry(chat.chatId)}
            className="shrink-0 rounded px-1.5 py-0.5 text-fg-muted hover:bg-bg-hover hover:text-danger"
          >
            {t("common.cancel")}
          </button>
        </div>
      )}
      {queued.length > 0 && (
        <div className="fade-up mb-2 overflow-hidden rounded-xl border border-border bg-bg-secondary">
          <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[11px] text-fg-secondary">
            <Clock size={12} className="text-accent" />
            {t("composer.queued", { n: queued.length })}
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => clearQueue(chat.chatId)}
              className="rounded px-1.5 py-0.5 text-fg-muted hover:bg-bg-hover hover:text-danger"
            >
              {t("common.clear")}
            </button>
          </div>
          <div className="max-h-24 overflow-y-auto px-3 py-1.5">
            {queued.map((q, i) => (
              <div key={i} className="flex items-baseline gap-2 py-0.5 text-[11px]">
                <span
                  className={cn(
                    "shrink-0 rounded px-1 py-px text-[9.5px]",
                    q.kind === "steer"
                      ? "bg-warning/15 text-warning"
                      : "bg-accent-muted text-accent",
                  )}
                >
                  {q.kind === "steer" ? t("composer.steer") : t("composer.followUp")}
                </span>
                <span className="min-w-0 flex-1 truncate text-fg-muted">{q.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <SubagentDock chat={chat} />
      {chat.bashRunning && (
        <div className="fade-up mb-2 overflow-hidden rounded-xl border border-border bg-bg-secondary">
          <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[11px] text-fg-secondary">
            <Terminal size={12} className="text-accent" />
            {t("composer.runningCmd")}
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => abortBash(chat.chatId)}
              className="rounded px-1.5 py-0.5 text-fg-muted hover:bg-bg-hover hover:text-danger"
            >
              {t("common.stop")}
            </button>
          </div>
          <pre className="selectable max-h-48 overflow-y-auto whitespace-pre-wrap break-all px-3 py-2 font-mono text-[11.5px] leading-relaxed text-fg-secondary">
            {chat.bashOutput || "…"}
          </pre>
        </div>
      )}
      <ComposerStack stacked={chat.kind !== "daily"}>
      <div
        className={cn(
          "composer-shadow relative rounded-[20px] border border-border bg-bg-input transition-colors focus-within:border-accent/50",
          disabled && "opacity-60",
        )}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void addFiles(e.dataTransfer.files);
        }}
      >
        {ui.slash && slashMatches.length > 0 && (
          <div className="dialog-in absolute bottom-full left-3 z-50 mb-1.5 w-[460px] overflow-hidden rounded-xl border border-border-strong bg-bg shadow-2xl">
            <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-[10.5px] text-fg-muted">
              <SlashSquare size={11} />
              {t("composer.slashHeader")}
            </div>
            <div className="max-h-64 overflow-y-auto p-1">
              {slashMatches.map((c, i) => (
                <button
                  key={`${c.kind}-${c.name}`}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertSlash(c.name);
                  }}
                  onMouseMove={() => setSlashIndex(i)}
                  className={cn(
                    "flex w-full items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors",
                    i === slashIndex ? "bg-accent-muted text-fg" : "text-fg-secondary",
                  )}
                >
                  <span className="shrink-0 font-mono">/{c.name}</span>
                  {c.argumentHint && (
                    <span className="shrink-0 font-mono text-[10.5px] text-fg-muted">{c.argumentHint}</span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-[11px] text-fg-muted">
                    {c.description ?? ""}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded px-1 py-px text-[9.5px]",
                      c.kind === "template" && "bg-accent-muted text-accent",
                      c.kind === "skill" && "bg-success/15 text-success",
                      c.kind === "extension" && "bg-warning/15 text-warning",
                    )}
                  >
                    {c.kind === "template"
                      ? t("composer.kindTemplate")
                      : c.kind === "skill"
                        ? t("composer.kindSkill")
                        : t("composer.kindExtension")}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        {ui.fileMention && mention && mentionMatches.length > 0 && (
          <div className="dialog-in absolute bottom-full left-3 z-50 mb-1.5 w-[420px] overflow-hidden rounded-xl border border-border-strong bg-bg shadow-2xl">
            <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-[10.5px] text-fg-muted">
              <AtSign size={11} />
              {t("composer.mentionHeader")}
            </div>
            <div className="max-h-56 overflow-y-auto p-1">
              {mentionMatches.map((f, i) => (
                <button
                  key={f}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertMention(f);
                  }}
                  onMouseMove={() => setMentionIndex(i)}
                  className={cn(
                    "block w-full truncate rounded-lg px-2.5 py-1.5 text-left font-mono text-xs transition-colors",
                    i === mentionIndex ? "bg-accent-muted text-fg" : "text-fg-secondary",
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        )}
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3.5 pt-3">
            {images.map((img) => (
              <div key={img.id} className="group relative">
                <img
                  src={`data:${img.mimeType};base64,${img.data}`}
                  alt="attachment"
                  className="h-14 w-14 rounded-lg border border-border object-cover"
                />
                <button
                  type="button"
                  onClick={() => setImages((prev) => prev.filter((i) => i.id !== img.id))}
                  className="absolute -right-1.5 -top-1.5 hidden rounded-full border border-border bg-bg p-0.5 text-fg-secondary shadow group-hover:block"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            updateMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
            autoGrow();
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.items]
              .filter((i) => i.kind === "file")
              .map((i) => i.getAsFile())
              .filter((f): f is File => Boolean(f));
            if (files.length > 0) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
          onKeyDown={(e) => {
            if (ui.slash && slashMatches.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSlashIndex((i) => Math.min(i + 1, slashMatches.length - 1));
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSlashIndex((i) => Math.max(i - 1, 0));
                return;
              }
              if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                e.preventDefault();
                insertSlash(slashMatches[slashIndex].name);
                return;
              }
              if (e.key === "Escape") {
                setSlashDismissed(true);
                return;
              }
            }
            if (ui.fileMention && mention && mentionMatches.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setMentionIndex((i) => Math.min(i + 1, mentionMatches.length - 1));
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setMentionIndex((i) => Math.max(i - 1, 0));
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                insertMention(mentionMatches[mentionIndex]);
                return;
              }
              if (e.key === "Escape") {
                setMention(null);
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={
            chat.isStreaming
              ? streamMode === "steer"
                ? t("composer.phSteer")
                : t("composer.phFollowUp")
              : chat.kind === "daily"
                ? t("composer.phDaily")
                : ui.bashBang
                  ? t("composer.phCodingFull")
                  : t("composer.phCoding") + (ui.fileMention ? t("composer.phMention") : "")
          }
          className="max-h-56 w-full resize-none bg-transparent px-4 pt-3.5 text-[14px] leading-relaxed text-fg outline-none placeholder:text-fg-muted disabled:opacity-50"
        />
        <div className="flex items-center gap-1 px-2.5 pb-2.5 pt-1">
          <ModelPicker
            model={chat.model}
            disabled={disabled}
            align="top"
            onSelect={(m) => setModel(chat.chatId, m)}
            thinkingFor={(m) =>
              chat.model && m.provider === chat.model.provider && m.id === chat.model.id
                ? chat.thinkingLevel
                : thinkingLevelOf(modelThinking, m)
            }
            onThinkingLevel={(m, l) => setModelThinking(m, l, chat.chatId)}
          />
          {chat.kind !== "daily" && <PresetSwitch />}
          {chat.kind !== "daily" && (
            <span
              title={
                chat.worktree
                  ? t("composer.worktreeTitle", { branch: chat.worktree.branch })
                  : t("composer.localTitle")
              }
              className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-fg-muted"
            >
              {chat.worktree ? <GitFork size={13} /> : <Laptop size={13} />}
              <span className="max-w-32 truncate">
                {chat.worktree ? chat.worktree.branch : t("common.local")}
              </span>
            </span>
          )}
          {ui.toolsPopover && <ToolsPopover chat={chat} />}
          {supportsImages && (
            <>
              <button
                type="button"
                title={t("composer.addImage")}
                onClick={() => fileInputRef.current?.click()}
                className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-secondary"
              >
                <ImagePlus size={14} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) void addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </>
          )}
          {chat.isStreaming && (
            <div className="ml-1 flex overflow-hidden rounded-lg border border-border text-[11px]">
              {(["steer", "followUp"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setStreamMode(m)}
                  className={cn(
                    "px-2 py-1 transition-colors",
                    streamMode === m
                      ? "bg-accent-muted font-medium text-accent"
                      : "text-fg-muted hover:bg-bg-hover",
                  )}
                >
                  {m === "steer" ? t("composer.steerNow") : t("composer.followLater")}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1" />
          {chat.isStreaming ? (
            <button
              type="button"
              onClick={() => abort(chat.chatId)}
              title={t("common.stop")}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-fg text-bg transition-transform hover:scale-105"
            >
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={(!text.trim() && images.length === 0) || disabled}
              title={t("common.send")}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full transition-all",
                (text.trim() || images.length > 0) && !disabled
                  ? "bg-accent text-accent-fg hover:scale-105 hover:bg-accent-hover"
                  : "bg-bg-hover text-fg-muted",
              )}
            >
              <ArrowUp size={15} />
            </button>
          )}
        </div>
      </div>
      </ComposerStack>
      <div className="pt-1.5 text-center text-[10.5px] text-fg-muted">
        {preset.composerHint}
      </div>
    </div>
  );
}
