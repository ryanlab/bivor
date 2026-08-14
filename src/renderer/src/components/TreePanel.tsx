import { useEffect } from "react";
import { Bot, GitBranch, RefreshCw, Sparkles, User, X } from "lucide-react";
import type { SessionTreeNode } from "@shared/protocol";
import { useAppStore, type ChatState } from "@/stores/app-store";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";

interface FlatNode {
  node: SessionTreeNode;
  depth: number;
}

function flatten(nodes: SessionTreeNode[], depth = 0, out: FlatNode[] = []): FlatNode[] {
  for (const node of nodes) {
    out.push({ node, depth });
    flatten(node.children, depth + (node.children.length > 1 ? 1 : 0), out);
  }
  return out;
}

function NodeRow({ flat, chat }: { flat: FlatNode; chat: ChatState }): React.JSX.Element | null {
  const t = useT();
  const fork = useAppStore((s) => s.fork);
  const { node, depth } = flat;

  if (node.type !== "message" || (node.role !== "user" && node.role !== "assistant")) {
    return null;
  }
  const isUser = node.role === "user";

  return (
    <div
      className={cn(
        "group flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors",
        node.onActivePath ? "bg-accent-muted" : "opacity-60 hover:opacity-100",
      )}
      style={{ marginLeft: depth * 14 }}
    >
      <span
        className={cn(
          "mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-accent/20 text-accent" : "bg-bg-hover text-fg-muted",
        )}
      >
        {isUser ? <User size={10} /> : <Bot size={10} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] leading-snug text-fg-secondary">
          {node.label && <span className="mr-1 text-accent">[{node.label}]</span>}
          {node.preview || t("common.empty")}
        </div>
      </div>
      <button
        type="button"
        title={t("tree.forkHere")}
        onClick={() => fork(chat.chatId, node.id)}
        className="hidden shrink-0 rounded p-1 text-fg-muted hover:bg-bg-hover hover:text-accent group-hover:block"
      >
        <GitBranch size={12} />
      </button>
      {node.onActivePath && (
        <button
          type="button"
          title={t("tree.forkSummarize")}
          disabled={chat.isStreaming}
          onClick={() => fork(chat.chatId, node.id, true)}
          className="hidden shrink-0 rounded p-1 text-fg-muted hover:bg-bg-hover hover:text-accent group-hover:block disabled:opacity-40"
        >
          <Sparkles size={12} />
        </button>
      )}
    </div>
  );
}

export function TreePanel({ chat }: { chat: ChatState }): React.JSX.Element {
  const t = useT();
  const setTreeOpen = useAppStore((s) => s.setTreeOpen);
  const requestTree = useAppStore((s) => s.requestTree);

  useEffect(() => {
    requestTree(chat.chatId);
    // Refresh when messages settle
  }, [chat.chatId, chat.messages.length, requestTree]);

  const flat = chat.tree ? flatten(chat.tree) : [];
  const branchCount = flat.filter((f) => f.node.children.length > 1).length;

  return (
    <div className="flex w-[300px] shrink-0 flex-col bg-transparent">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/40 px-3.5">
        <GitBranch size={14} className="text-fg-muted" />
        <span className="flex-1 text-[13px] font-medium">{t("tree.title")}</span>
        <button
          type="button"
          title={t("common.refresh")}
          onClick={() => requestTree(chat.chatId)}
          className="rounded-md p-1 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-secondary"
        >
          <RefreshCw size={12.5} />
        </button>
        <button
          type="button"
          title={t("common.close")}
          onClick={() => setTreeOpen(chat.chatId, false)}
          className="rounded-md p-1 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-secondary"
        >
          <X size={13} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!chat.tree && <div className="px-2 py-3 text-xs text-fg-muted">{t("common.loading")}</div>}
        {chat.tree && flat.length === 0 && (
          <div className="px-2 py-3 text-xs text-fg-muted">{t("tree.noMessages")}</div>
        )}
        {flat.map((f) => (
          <NodeRow key={f.node.id} flat={f} chat={chat} />
        ))}
      </div>
      <div className="border-t border-border px-3.5 py-2 text-[11px] leading-relaxed text-fg-muted">
        {t("tree.hint", { extra: branchCount > 0 ? t("tree.branches", { n: branchCount }) : "" })}
      </div>
    </div>
  );
}
