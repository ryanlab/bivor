import { useEffect } from "react";
import { Bot, GitBranch, RefreshCw, Sparkles, User, X } from "lucide-react";
import type { SessionTreeNode } from "@shared/protocol";
import { useAppStore, type ChatState } from "@/stores/app-store";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";

interface Row {
  node: SessionTreeNode;
  depth: number;
  /** For each ancestor indent level, whether a vertical guide line passes through this row. */
  guides: boolean[];
  lineUp: boolean;
  lineDown: boolean;
  /** First row of an abandoned side branch: draws an elbow connector from the parent rail. */
  sideStart: boolean;
}

const isMessage = (n: SessionTreeNode): boolean =>
  n.type === "message" && (n.role === "user" || n.role === "assistant");

/**
 * Walks a chain of nodes keeping the active path at the same depth, and
 * rendering abandoned branches as indented side chains right after their
 * fork point (chronological order).
 */
function walkChain(start: SessionTreeNode, depth: number, guides: boolean[], out: Row[]): void {
  const chain: Row[] = [];
  const pending: { afterIndex: number; roots: SessionTreeNode[] }[] = [];
  let node: SessionTreeNode | undefined = start;
  while (node) {
    if (isMessage(node)) {
      chain.push({ node, depth, guides, lineUp: false, lineDown: false, sideStart: false });
    }
    const kids: SessionTreeNode[] = node.children;
    if (kids.length === 0) break;
    if (kids.length === 1) {
      node = kids[0];
      continue;
    }
    const active = kids.find((k) => k.onActivePath) ?? kids[kids.length - 1];
    pending.push({ afterIndex: chain.length - 1, roots: kids.filter((k) => k !== active) });
    node = active;
  }
  for (let i = 0; i < chain.length; i++) {
    chain[i].lineUp = i > 0;
    chain[i].lineDown = i < chain.length - 1;
  }

  const emitSides = (roots: SessionTreeNode[], railContinues: boolean): void => {
    for (const root of roots) {
      const sub: Row[] = [];
      walkChain(root, depth + 1, [...guides, railContinues], sub);
      if (sub[0]) sub[0].sideStart = true;
      out.push(...sub);
    }
  };

  let pi = 0;
  while (pi < pending.length && pending[pi].afterIndex < 0) {
    emitSides(pending[pi].roots, chain.length > 0);
    pi++;
  }
  for (let i = 0; i < chain.length; i++) {
    out.push(chain[i]);
    while (pi < pending.length && pending[pi].afterIndex === i) {
      emitSides(pending[pi].roots, chain[i].lineDown);
      pi++;
    }
  }
}

function buildRows(roots: SessionTreeNode[]): Row[] {
  const out: Row[] = [];
  for (const root of roots) walkChain(root, 0, [], out);
  return out;
}

function NodeRow({ row, chat }: { row: Row; chat: ChatState }): React.JSX.Element {
  const t = useT();
  const fork = useAppStore((s) => s.fork);
  const { node } = row;
  const isUser = node.role === "user";
  const active = node.onActivePath;

  return (
    <div
      className={cn(
        "group relative flex items-stretch",
        !active && "opacity-55 transition-opacity hover:opacity-100",
      )}
    >
      {row.guides.map((g, i) => (
        <div key={i} className="relative w-5 shrink-0">
          {g && <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />}
        </div>
      ))}
      <div className="relative w-5 shrink-0">
        {row.sideStart ? (
          <div className="absolute right-1/2 top-0 h-[15px] w-5 rounded-bl-lg border-b border-l border-border" />
        ) : (
          row.lineUp && (
            <div className="absolute left-1/2 top-0 h-[6px] w-px -translate-x-1/2 bg-border" />
          )
        )}
        {row.lineDown && (
          <div className="absolute bottom-0 left-1/2 top-[24px] w-px -translate-x-1/2 bg-border" />
        )}
        <span className="absolute left-1/2 top-[6px] -translate-x-1/2 rounded-full bg-bg-secondary p-px">
          <span
            className={cn(
              "flex h-4 w-4 items-center justify-center rounded-full",
              isUser ? "bg-accent/20 text-accent" : "bg-bg-hover text-fg-muted",
            )}
          >
            {isUser ? <User size={9} /> : <Bot size={9} />}
          </span>
        </span>
      </div>
      <div
        className={cn(
          "mb-1 ml-1.5 flex min-w-0 flex-1 items-start gap-1 rounded-lg px-2 py-1.5 transition-colors",
          active ? "bg-accent-muted" : "hover:bg-bg-hover",
        )}
      >
        <div className="min-w-0 flex-1 truncate text-[12px] leading-snug text-fg-secondary">
          {node.label && (
            <span className="mr-1 rounded bg-bg-hover px-1 py-px font-mono text-[10px] text-fg-muted">
              {node.label}
            </span>
          )}
          {node.preview || (!node.label && t("common.empty"))}
        </div>
        <button
          type="button"
          title={t("tree.forkHere")}
          onClick={() => fork(chat.chatId, node.id)}
          className="hidden shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[10px] text-fg-muted hover:bg-bg-hover hover:text-accent group-hover:flex"
        >
          <GitBranch size={11} />
          {t("tree.forkShort")}
        </button>
        {active && (
          <button
            type="button"
            title={t("tree.forkSummarize")}
            disabled={chat.isStreaming}
            onClick={() => fork(chat.chatId, node.id, true)}
            className="hidden shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[10px] text-fg-muted hover:bg-bg-hover hover:text-accent group-hover:flex disabled:opacity-40"
          >
            <Sparkles size={11} />
            {t("tree.forkSummarizeShort")}
          </button>
        )}
      </div>
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

  const rows = chat.tree ? buildRows(chat.tree) : [];
  const branchCount = rows.filter((r) => r.sideStart).length;

  return (
    <div className="flex w-[300px] shrink-0 flex-col bg-bg-secondary">
      <div className="flex h-11 shrink-0 items-center gap-2 px-3.5">
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
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-2">
        {!chat.tree && <div className="px-2 py-3 text-xs text-fg-muted">{t("common.loading")}</div>}
        {chat.tree && rows.length === 0 && (
          <div className="px-2 py-3 text-xs text-fg-muted">{t("tree.noMessages")}</div>
        )}
        {rows.map((r) => (
          <NodeRow key={r.node.id} row={r} chat={chat} />
        ))}
      </div>
      <div className="bg-bg-tertiary px-3.5 py-2 text-[11px] leading-relaxed text-fg-muted">
        {t("tree.hint", { extra: branchCount > 0 ? t("tree.branches", { n: branchCount }) : "" })}
      </div>
    </div>
  );
}
