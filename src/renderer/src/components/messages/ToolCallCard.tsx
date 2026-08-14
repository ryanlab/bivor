import { useMemo, useState } from "react";
import {
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Compass,
  FileEdit,
  FilePlus,
  FileText,
  FolderOpen,
  Globe,
  Loader2,
  Monitor,
  Plug,
  Rocket,
  Search,
  Terminal,
  Wand2,
  Wrench,
  X,
} from "lucide-react";
import type { ChatState } from "@/stores/app-store";
import type { ImageContent, ToolCallContent, ToolResultMessage } from "@/lib/pi-messages";
import {
  imagesFromUnknown,
  isToolResultMessage,
  toolResultImages,
  toolResultText,
} from "@/lib/pi-messages";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { DiffView } from "./DiffView";

interface ResolvedResult {
  status: "running" | "done" | "error" | "pending";
  output: string;
  images: ImageContent[];
  details?: Record<string, unknown>;
}

function resolveResult(toolCall: ToolCallContent, chat: ChatState): ResolvedResult {
  const msg = chat.messages.find(
    (m): m is ToolResultMessage => isToolResultMessage(m) && m.toolCallId === toolCall.id,
  );
  if (msg) {
    const images = toolResultImages(msg);
    return {
      status: msg.isError ? "error" : "done",
      output: toolResultText(msg),
      images: images.length > 0 ? images : imagesFromUnknown({ details: msg.details }),
      details: msg.details,
    };
  }
  const run = chat.toolRuns[toolCall.id];
  if (run) {
    return {
      status: run.status,
      output: run.output,
      images: imagesFromUnknown(run.result),
      details: run.result?.details,
    };
  }
  return { status: chat.isStreaming ? "pending" : "done", output: "", images: [] };
}

/**
 * Visual category per tool: icon plus a left accent stripe so scanning a long
 * transcript reveals at a glance what kind of work the agent did.
 */
interface ToolStyle {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  stripe: string;
}

const TOOL_STYLES: Record<string, ToolStyle> = {
  bash: { icon: Terminal, stripe: "border-l-fg-muted/50" },
  edit: { icon: FileEdit, stripe: "border-l-accent/60" },
  write: { icon: FilePlus, stripe: "border-l-accent/60" },
  read: { icon: FileText, stripe: "border-l-border-strong" },
  grep: { icon: Search, stripe: "border-l-border-strong" },
  find: { icon: Search, stripe: "border-l-border-strong" },
  ls: { icon: FolderOpen, stripe: "border-l-border-strong" },
  vm_bash: { icon: Monitor, stripe: "border-l-info/60" },
  vm_screenshot: { icon: Monitor, stripe: "border-l-info/60" },
  vm_gui: { icon: Monitor, stripe: "border-l-info/60" },
  vm_file: { icon: Monitor, stripe: "border-l-info/60" },
  subagent_run: { icon: Bot, stripe: "border-l-warning/60" },
  memory_save: { icon: Brain, stripe: "border-l-success/60" },
  harness_propose: { icon: Wand2, stripe: "border-l-warning/60" },
  code_run: { icon: Terminal, stripe: "border-l-accent/60" },
  tool_search: { icon: Search, stripe: "border-l-info/60" },
  tool_activate: { icon: Plug, stripe: "border-l-info/60" },
  web_search: { icon: Globe, stripe: "border-l-info/60" },
  web_fetch: { icon: Globe, stripe: "border-l-info/60" },
  browser: { icon: Compass, stripe: "border-l-info/60" },
  deploy: { icon: Rocket, stripe: "border-l-accent/60" },
};

const TOOL_LABEL_KEYS: Record<string, string> = {
  vm_bash: "tools.vmBash",
  vm_screenshot: "tools.vmScreenshot",
  vm_gui: "tools.vmGui",
  vm_file: "tools.vmFile",
  subagent_run: "tools.subagent",
  memory_save: "tools.memory",
  harness_propose: "tools.harness",
  code_run: "tools.codeMode",
  tool_search: "tools.toolSearch",
  tool_activate: "tools.toolActivate",
  web_search: "tools.webSearch",
  web_fetch: "tools.webFetch",
  browser: "tools.browser",
  deploy: "tools.deploy",
};

function styleFor(name: string): ToolStyle {
  const exact = TOOL_STYLES[name];
  if (exact) return exact;
  if (name.startsWith("mcp_") || name.includes("__")) {
    return { icon: Plug, stripe: "border-l-info/60" };
  }
  return { icon: Wrench, stripe: "border-l-border-strong" };
}

function toolSummary(toolCall: ToolCallContent): string {
  const args = toolCall.arguments ?? {};
  switch (toolCall.name) {
    case "bash":
    case "vm_bash":
      return String(args.command ?? "");
    case "edit":
    case "write":
    case "read":
      return String(args.path ?? args.file_path ?? "");
    case "grep":
      return String(args.pattern ?? "");
    case "find":
      return String(args.pattern ?? args.glob ?? "");
    case "ls":
      return String(args.path ?? ".");
    case "vm_file":
      return `${String(args.action ?? "")} ${String(args.path ?? "")}`.trim();
    case "vm_screenshot":
      return "";
    case "vm_gui":
      return String(args.action ?? "");
    case "subagent_run":
      return String(args.task ?? "").slice(0, 120);
    case "memory_save":
      return String(args.content ?? "").slice(0, 120);
    case "harness_propose":
      return String(args.reason ?? "").slice(0, 120);
    case "code_run":
      return String(args.code ?? "").split("\n")[0].slice(0, 100);
    case "tool_search":
      return String(args.query ?? "");
    case "tool_activate":
      return Array.isArray(args.names) ? args.names.join(", ") : "";
    case "web_search":
      return String(args.query ?? "");
    case "web_fetch":
      return String(args.url ?? "");
    case "browser": {
      const action = String(args.action ?? "");
      const target = args.url ?? args.selector ?? args.text ?? args.key ?? "";
      return `${action} ${String(target)}`.trim().slice(0, 100);
    }
    case "deploy": {
      const project = String(args.project ?? "");
      const dir = String(args.dir ?? ".");
      const target = args.prod ? "production" : "preview";
      return `${project || dir} · ${target}`;
    }
    default: {
      const s = JSON.stringify(args);
      return s.length > 80 ? `${s.slice(0, 80)}…` : s;
    }
  }
}

/** +N −M counts from a unified diff, excluding file headers. */
function diffStat(patch: string): { add: number; del: number } {
  let add = 0;
  let del = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) add++;
    else if (line.startsWith("-") && !line.startsWith("---")) del++;
  }
  return { add, del };
}

function OutputBlock({ text, maxHeightClass = "max-h-72" }: { text: string; maxHeightClass?: string }): React.JSX.Element {
  return (
    <pre
      className={cn(
        "selectable overflow-auto whitespace-pre-wrap break-all rounded-b-lg bg-bg-secondary px-3 py-2 font-mono text-xs leading-relaxed text-fg-secondary",
        maxHeightClass,
      )}
    >
      {text}
    </pre>
  );
}

export function ToolCallCard({
  toolCall,
  chat,
}: {
  toolCall: ToolCallContent;
  chat: ChatState;
}): React.JSX.Element {
  const t = useT();
  const result = resolveResult(toolCall, chat);
  const isEdit = toolCall.name === "edit";
  const isScreenshot = toolCall.name === "vm_screenshot";
  const isDeploy = toolCall.name === "deploy";
  const running = result.status === "running" || result.status === "pending";
  const [openOverride, setOpenOverride] = useState<boolean | undefined>(undefined);
  const deployUrl = typeof result.details?.url === "string" ? result.details.url : "";
  const open =
    openOverride ?? (isEdit || isScreenshot || isDeploy || running || result.status === "error");

  const { icon: Icon, stripe } = styleFor(toolCall.name);
  const labelKey = TOOL_LABEL_KEYS[toolCall.name];
  const label = labelKey ? t(labelKey) : undefined;
  const summary = toolSummary(toolCall);

  const patch = useMemo(() => {
    const d = result.details;
    if (!d) return undefined;
    if (typeof d.patch === "string" && d.patch.trim()) return d.patch;
    return undefined;
  }, [result.details]);

  const stat = useMemo(() => (patch ? diffStat(patch) : undefined), [patch]);

  const body = useMemo(() => {
    if (isEdit && patch) return <DiffView patch={patch} />;
    if (toolCall.name === "write") {
      const content = String(toolCall.arguments?.content ?? "");
      return content ? <OutputBlock text={content} maxHeightClass="max-h-56" /> : null;
    }
    if (result.images.length > 0) {
      return (
        <div className="space-y-2 bg-bg-secondary px-3 py-2">
          {result.images.map((img, i) => (
            <img
              key={i}
              src={`data:${img.mimeType};base64,${img.data}`}
              alt={t("tools.vmScreenshot")}
              className="max-h-80 w-full rounded-lg border border-border object-contain"
            />
          ))}
          {result.output.trim() && (
            <pre className="selectable overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-fg-secondary">
              {result.output}
            </pre>
          )}
        </div>
      );
    }
    if (isDeploy && (deployUrl || result.output.trim() || running)) {
      return (
        <div className="space-y-1.5 bg-bg-secondary px-3 py-2">
          {running && !result.output.trim() && (
            <div className="text-xs text-fg-muted">{t("tools.deploying")}</div>
          )}
          {deployUrl && (
            <a
              href={deployUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 break-all text-xs text-accent hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {deployUrl}
            </a>
          )}
          {result.output.trim() && (
            <pre className="selectable overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-fg-secondary">
              {result.output}
            </pre>
          )}
        </div>
      );
    }
    if (result.output.trim()) return <OutputBlock text={result.output} />;
    if (running) {
      return <div className="px-3 py-2 text-xs text-fg-muted">{t("tools.running")}</div>;
    }
    if (isScreenshot) {
      return <div className="px-3 py-2 text-xs text-fg-muted">{t("tools.screenshotMissing")}</div>;
    }
    return null;
  }, [isEdit, isScreenshot, isDeploy, deployUrl, patch, toolCall, result.images, result.output, running, t]);

  return (
    <div
      className={cn(
        "my-1.5 overflow-hidden rounded-xl border border-l-2 bg-bg-secondary/60 transition-colors",
        result.status === "error" ? "border-danger/30 border-l-danger/60" : "border-border",
        result.status !== "error" && stripe,
        running && "tool-running",
      )}
    >
      <button
        type="button"
        onClick={() => setOpenOverride(!open)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-bg-hover"
      >
        {open ? (
          <ChevronDown size={13} className="shrink-0 text-fg-muted" />
        ) : (
          <ChevronRight size={13} className="shrink-0 text-fg-muted" />
        )}
        <Icon size={14} className="shrink-0 text-fg-secondary" />
        <span className="shrink-0 text-xs font-medium text-fg-secondary">
          {label ?? toolCall.name}
        </span>
        <span className="selectable min-w-0 flex-1 truncate font-mono text-xs text-fg-muted">
          {summary}
        </span>
        {stat && (stat.add > 0 || stat.del > 0) && (
          <span className="shrink-0 font-mono text-[10.5px]">
            {stat.add > 0 && <span className="text-success">+{stat.add}</span>}
            {stat.add > 0 && stat.del > 0 && <span className="text-fg-muted"> </span>}
            {stat.del > 0 && <span className="text-danger">−{stat.del}</span>}
          </span>
        )}
        <span className="shrink-0">
          {running ? (
            <Loader2 size={13} className="animate-spin text-accent" />
          ) : result.status === "error" ? (
            <X size={13} className="text-danger" />
          ) : (
            <Check size={13} className="text-success" />
          )}
        </span>
      </button>
      {open && body}
    </div>
  );
}
