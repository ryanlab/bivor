import { memo } from "react";
import { cn } from "@/lib/cn";

interface DiffLine {
  kind: "add" | "del" | "ctx" | "hunk" | "meta";
  text: string;
}

function parseUnifiedDiff(patch: string): DiffLine[] {
  const lines = patch.split("\n");
  const result: DiffLine[] = [];
  let inHunk = false;
  for (const line of lines) {
    if (line.startsWith("@@")) {
      inHunk = true;
      result.push({ kind: "hunk", text: line });
    } else if (
      // File headers only appear before the first hunk. Once inside a hunk, a
      // line like "+++x" or "---y" is real added/removed content, not meta.
      !inHunk &&
      (line.startsWith("+++ ") ||
        line.startsWith("--- ") ||
        line.startsWith("diff ") ||
        line.startsWith("index "))
    ) {
      result.push({ kind: "meta", text: line });
    } else if (line.startsWith("+")) {
      result.push({ kind: "add", text: line.slice(1) });
    } else if (line.startsWith("-")) {
      result.push({ kind: "del", text: line.slice(1) });
    } else {
      result.push({ kind: "ctx", text: line.startsWith(" ") ? line.slice(1) : line });
    }
  }
  // Trim trailing empty context lines
  while (result.length > 0 && result[result.length - 1].kind === "ctx" && result[result.length - 1].text === "") {
    result.pop();
  }
  return result;
}

export const DiffView = memo(function DiffView({ patch }: { patch: string }): React.JSX.Element {
  const lines = parseUnifiedDiff(patch);
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.kind === "add") added++;
    if (l.kind === "del") removed++;
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-bg-tertiary px-3 py-1 font-mono text-xs">
        <span className="text-diff-add-fg">+{added}</span>
        <span className="text-diff-del-fg">-{removed}</span>
      </div>
      <div className="selectable max-h-80 overflow-auto bg-bg-secondary font-mono text-xs leading-relaxed">
        {lines.map((line, i) => {
          if (line.kind === "meta") return null;
          return (
            <div
              key={i}
              className={cn(
                "flex whitespace-pre px-3",
                line.kind === "add" && "bg-diff-add text-diff-add-fg",
                line.kind === "del" && "bg-diff-del text-diff-del-fg",
                line.kind === "hunk" && "bg-bg-tertiary py-0.5 text-fg-muted",
                line.kind === "ctx" && "text-fg-secondary",
              )}
            >
              <span className="w-4 shrink-0 select-none text-fg-muted">
                {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
              </span>
              <span>{line.text || " "}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});
