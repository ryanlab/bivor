/**
 * Floating approval card: shown when the policy gate pauses a tool call
 * awaiting human decision. The agent is blocked until answered (5min timeout).
 */
import { Check, ShieldQuestion, X } from "lucide-react";
import { useAppStore, type ChatState } from "@/stores/app-store";
import { useT } from "@/lib/i18n";

export function ApprovalCard({ chat }: { chat: ChatState }): React.JSX.Element | null {
  const t = useT();
  const respondApproval = useAppStore((s) => s.respondApproval);
  const req = chat.pendingApprovals[0];
  if (!req) return null;

  const command = typeof req.input.command === "string" ? req.input.command : undefined;

  return (
    <div className="dialog-in pointer-events-auto mx-auto w-full max-w-2xl rounded-2xl border border-warning/40 bg-bg-secondary p-4 shadow-2xl">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-warning/15 p-1.5 text-warning">
          <ShieldQuestion size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">
            {t("approval.request")} <code className="rounded bg-bg-tertiary px-1 py-0.5 font-mono text-[12px]">{req.toolName}</code>
            {req.rule && <span className="pl-2 text-[11px] text-warning">{t("approval.rule", { rule: req.rule })}</span>}
          </div>
          <pre className="selectable mt-2 max-h-36 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-bg-tertiary/60 p-2.5 font-mono text-[11px] leading-relaxed text-fg-secondary">
            {command ?? JSON.stringify(req.input, null, 2)}
          </pre>
          {chat.pendingApprovals.length > 1 && (
            <div className="pt-1.5 text-[10.5px] text-fg-muted">
              {t("approval.more", { n: chat.pendingApprovals.length - 1 })}
            </div>
          )}
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-3">
        <button
          type="button"
          onClick={() => respondApproval(chat.chatId, req.id, false)}
          className="flex items-center gap-1.5 rounded-xl border border-border px-3.5 py-1.5 text-xs text-fg-secondary transition-colors hover:border-danger/40 hover:text-danger"
        >
          <X size={13} />
          {t("approval.reject")}
        </button>
        <button
          type="button"
          onClick={() => respondApproval(chat.chatId, req.id, true)}
          className="flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-1.5 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover"
        >
          <Check size={13} />
          {t("approval.approve")}
        </button>
      </div>
    </div>
  );
}
