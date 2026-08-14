import { useState } from "react";
import { Brain, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";

export function ThinkingBlock({
  thinking,
  streaming,
}: {
  thinking: string;
  streaming?: boolean;
}): React.JSX.Element | null {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!thinking.trim() && !streaming) return null;

  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg-secondary",
          streaming && "text-fg-secondary",
        )}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Brain size={13} className={cn(streaming && "streaming-dot")} />
        <span>{streaming ? t("thinking.streaming") : t("thinking.done", { n: thinking.length })}</span>
      </button>
      {open && (
        <div className="selectable mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs leading-relaxed text-fg-muted">
          {thinking}
        </div>
      )}
    </div>
  );
}
