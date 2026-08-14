import { useEffect, useRef, useState } from "react";
import { Check, Copy, History, Loader2, PencilLine, Terminal } from "lucide-react";
import { useAppStore, type ChatState } from "@/stores/app-store";
import type { AssistantMessage, PiMessage, UserMessage } from "@/lib/pi-messages";
import {
  isAssistantMessage,
  isToolResultMessage,
  isUserMessage,
  userMessageImages,
  userMessageText,
} from "@/lib/pi-messages";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/cn";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCallCard } from "./ToolCallCard";
import { useT } from "@/lib/i18n";

function CopyButton({ text, className }: { text: string; className?: string }): React.JSX.Element {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={t("common.copy")}
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={cn(
        "rounded-md p-1 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-secondary",
        className,
      )}
    >
      {copied ? <Check size={12.5} className="text-success" /> : <Copy size={12.5} />}
    </button>
  );
}

function RestoreButton({ chat, index }: { chat: ChatState; index: number }): React.JSX.Element | null {
  const t = useT();
  const restoreCheckpoint = useAppStore((s) => s.restoreCheckpoint);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<string>();
  const checkpoint = chat.checkpoints[index];
  if (!checkpoint) return null;

  if (result) {
    return <span className="mt-2.5 text-[10.5px] text-success">{result}</span>;
  }
  return (
    <button
      type="button"
      title={t("messages.restoreTitle")}
      disabled={chat.restoringCheckpoint || chat.isStreaming}
      onClick={() => {
        if (!confirming) {
          setConfirming(true);
          setTimeout(() => setConfirming(false), 3000);
          return;
        }
        void restoreCheckpoint(chat.chatId, checkpoint.id).then((n) => {
          setResult(t("messages.restored", { n }));
          setTimeout(() => setResult(undefined), 4000);
        });
        setConfirming(false);
      }}
      className={cn(
        "mt-1.5 flex items-center gap-1 rounded-md px-1.5 py-1 text-[10.5px] transition-all",
        confirming
          ? "bg-danger/15 text-danger opacity-100"
          : "text-fg-muted opacity-0 hover:bg-bg-hover hover:text-fg-secondary group-hover:opacity-100",
      )}
    >
      {chat.restoringCheckpoint ? (
        <Loader2 size={11} className="animate-spin" />
      ) : (
        <History size={11} />
      )}
      {confirming ? t("messages.confirmRestore") : t("messages.restore")}
    </button>
  );
}

function ForkButton({
  chat,
  userIndex,
}: {
  chat: ChatState;
  userIndex: number;
}): React.JSX.Element {
  const t = useT();
  const forkAtUserMessage = useAppStore((s) => s.forkAtUserMessage);
  return (
    <button
      type="button"
      title={t("messages.forkTitle")}
      disabled={chat.isStreaming}
      onClick={() => forkAtUserMessage(chat.chatId, userIndex)}
      className="mt-2 rounded-md p-1 text-fg-muted opacity-0 transition-all hover:bg-bg-hover hover:text-fg-secondary group-hover:opacity-100 disabled:opacity-0"
    >
      <PencilLine size={12.5} />
    </button>
  );
}

function UserBubble({
  message,
  chat,
  index,
  userIndex,
}: {
  message: UserMessage;
  chat: ChatState;
  index: number;
  userIndex: number;
}): React.JSX.Element {
  const text = userMessageText(message);
  const images = userMessageImages(message);
  return (
    <div className="group my-4 flex justify-end">
      <div className="flex max-w-[85%] items-start gap-1">
        <RestoreButton chat={chat} index={index} />
        <ForkButton chat={chat} userIndex={userIndex} />
        <CopyButton text={text} className="mt-2 opacity-0 transition-opacity group-hover:opacity-100" />
        <div className="min-w-0">
          {images.length > 0 && (
            <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
              {images.map((img, i) => (
                <img
                  key={i}
                  src={`data:${img.mimeType};base64,${img.data}`}
                  alt="attachment"
                  className="max-h-40 rounded-xl border border-border object-cover"
                />
              ))}
            </div>
          )}
          {text && (
            <div className="selectable whitespace-pre-wrap rounded-2xl rounded-br-lg bg-user-bubble px-4 py-2.5 text-[14px] leading-relaxed text-fg">
              {text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function assistantText(message: AssistantMessage): string {
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n\n");
}

function AssistantBlocks({
  message,
  chat,
  streaming,
}: {
  message: AssistantMessage;
  chat: ChatState;
  streaming?: boolean;
}): React.JSX.Element {
  const text = assistantText(message);
  const lastTextIdx = message.content.reduce(
    (acc, b, i) => (b.type === "text" ? i : acc),
    -1,
  );
  return (
    <div className="group relative my-4">
      {message.content.map((block, i) => {
        if (block.type === "thinking") {
          const isLast = streaming && i === message.content.length - 1;
          return <ThinkingBlock key={i} thinking={block.thinking} streaming={isLast} />;
        }
        if (block.type === "toolCall") {
          return <ToolCallCard key={block.id || i} toolCall={block} chat={chat} />;
        }
        if (block.type === "text" && block.text) {
          const showCursor = streaming && i === lastTextIdx && i === message.content.length - 1;
          return (
            <div key={i} className={cn("selectable", showCursor && "streaming-cursor")}>
              <Markdown text={block.text} />
            </div>
          );
        }
        return null;
      })}
      {message.errorMessage && (
        <div className="mt-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {message.errorMessage}
        </div>
      )}
      {!streaming && text && (
        <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <CopyButton text={text} />
          {message.model && <span className="text-[10.5px] text-fg-muted">{message.model}</span>}
        </div>
      )}
    </div>
  );
}

function BashCard({ message }: { message: PiMessage }): React.JSX.Element {
  const t = useT();
  const m = message as { command?: string; output?: string; exitCode?: number };
  const [open, setOpen] = useState(false);
  const failed = m.exitCode !== undefined && m.exitCode !== 0;
  return (
    <div className="my-2 overflow-hidden rounded-xl border border-border bg-bg-secondary/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-bg-hover"
      >
        <Terminal size={13} className="shrink-0 text-fg-secondary" />
        <span className="selectable min-w-0 flex-1 truncate font-mono text-xs text-fg-secondary">
          $ {m.command}
        </span>
        <span className={cn("shrink-0 text-[10.5px]", failed ? "text-danger" : "text-fg-muted")}>
          {failed ? `exit ${m.exitCode}` : t("messages.manualBash")}
        </span>
      </button>
      {open && m.output && (
        <pre className="selectable max-h-72 overflow-auto whitespace-pre-wrap break-all border-t border-border px-3 py-2 font-mono text-xs leading-relaxed text-fg-secondary">
          {m.output}
        </pre>
      )}
    </div>
  );
}

function SystemNote({ message }: { message: PiMessage }): React.JSX.Element | null {
  const t = useT();
  const m = message as Record<string, unknown>;
  const [open, setOpen] = useState(false);
  const summary = typeof m.summary === "string" ? m.summary : undefined;
  const label =
    m.role === "branchSummary"
      ? t("messages.branchSummary")
      : m.role === "compactionSummary" || m.role === "compaction" || m.type === "compaction"
        ? t("messages.compacted")
        : typeof m.customType === "string"
          ? String(m.customType)
          : undefined;
  if (!label) return null;
  return (
    <div className="my-4">
      <div className="flex items-center gap-2 text-xs text-fg-muted">
        <div className="h-px flex-1 bg-border" />
        {summary ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-md px-1.5 py-0.5 transition-colors hover:bg-bg-hover hover:text-fg-secondary"
          >
            {label} {open ? "▾" : "▸"}
          </button>
        ) : (
          <span>{label}</span>
        )}
        <div className="h-px flex-1 bg-border" />
      </div>
      {open && summary && (
        <div className="selectable mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl border border-border bg-bg-secondary/60 px-3.5 py-2.5 text-xs leading-relaxed text-fg-secondary">
          {summary}
        </div>
      )}
    </div>
  );
}

export function MessageList({
  chat,
  searchTarget,
}: {
  chat: ChatState;
  /** message index to scroll to and highlight (in-session search) */
  searchTarget?: number | null;
}): React.JSX.Element {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  });

  useEffect(() => {
    if (searchTarget == null) return;
    stickToBottom.current = false;
    scrollRef.current
      ?.querySelector(`[data-msg-idx="${searchTarget}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [searchTarget]);

  const handleScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  return (
    <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 pb-6 pt-4">
        {(() => {
          let userCount = 0;
          return chat.messages.map((message, i) => {
            const userIndex = isUserMessage(message) ? userCount++ : -1;
            return { message, i, userIndex };
          });
        })().map(({ message, i, userIndex }) => {
          // Key on timestamp+index so expansion state doesn't leak onto a
          // different message when the array is replaced (branch navigation).
          const ts = (message as { timestamp?: number }).timestamp;
          const key = ts ? `${ts}-${i}` : i;
          let node: React.ReactNode = null;
          if (isUserMessage(message)) {
            node = <UserBubble message={message} chat={chat} index={i} userIndex={userIndex} />;
          } else if (isAssistantMessage(message)) {
            node = <AssistantBlocks message={message} chat={chat} />;
          } else if (isToolResultMessage(message)) {
            return null; // rendered inside its ToolCallCard
          } else if ((message as { role?: string }).role === "bashExecution") {
            node = <BashCard message={message} />;
          } else {
            node = <SystemNote message={message} />;
          }
          return (
            <div
              key={key}
              data-msg-idx={i}
              className={cn(
                i === searchTarget && "rounded-xl outline outline-2 outline-accent/50",
              )}
            >
              {node}
            </div>
          );
        })}

        {chat.streaming && <AssistantBlocks message={chat.streaming} chat={chat} streaming />}

        {chat.isStreaming && !chat.streaming && (
          <div className="my-4 flex items-center gap-2 text-sm text-fg-muted">
            <span className="streaming-dot inline-block h-2 w-2 rounded-full bg-accent" />
            {t("messages.thinking")}
          </div>
        )}

        {chat.compacting && (
          <div className="my-3 text-center text-xs text-fg-muted">{t("messages.compacting")}</div>
        )}

        {chat.lastError && (
          <div className="my-3 rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2 text-sm text-danger">
            {chat.lastError}
          </div>
        )}

        {chat.queue.steering.length + chat.queue.followUp.length > 0 && (
          <div className="my-3 space-y-1">
            {[...chat.queue.steering, ...chat.queue.followUp].map((text, i) => (
              <div
                key={i}
                className="rounded-lg border border-border bg-bg-tertiary px-3 py-1.5 text-xs text-fg-muted"
              >
                {t("messages.queued", { text })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
