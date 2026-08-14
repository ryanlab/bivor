/**
 * Local mirrors of pi's message shapes (structurally compatible with
 * @earendil-works/pi-ai). Kept renderer-side so the web bundle never
 * imports Node-flavored packages.
 */

export interface TextContent {
  type: "text";
  text: string;
}

export interface ThinkingContent {
  type: "thinking";
  thinking: string;
  redacted?: boolean;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface ToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type AssistantContent = TextContent | ThinkingContent | ToolCallContent;

export interface UsageInfo {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost?: { total: number };
}

export interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}

export interface AssistantMessage {
  role: "assistant";
  content: AssistantContent[];
  provider?: string;
  model?: string;
  usage?: UsageInfo;
  stopReason?: string;
  errorMessage?: string;
  timestamp: number;
}

export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  details?: Record<string, unknown>;
  isError: boolean;
  timestamp: number;
}

export interface CustomMessage {
  role: string;
  [key: string]: unknown;
}

export type PiMessage = UserMessage | AssistantMessage | ToolResultMessage | CustomMessage;

export function isUserMessage(m: PiMessage): m is UserMessage {
  return m.role === "user";
}
export function isAssistantMessage(m: PiMessage): m is AssistantMessage {
  return m.role === "assistant" && Array.isArray((m as AssistantMessage).content);
}
export function isToolResultMessage(m: PiMessage): m is ToolResultMessage {
  return m.role === "toolResult";
}

export function userMessageText(m: UserMessage): string {
  if (typeof m.content === "string") return m.content;
  return m.content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

export function userMessageImages(m: UserMessage): ImageContent[] {
  if (typeof m.content === "string") return [];
  return m.content.filter((c): c is ImageContent => c.type === "image");
}

export function toolResultText(m: ToolResultMessage): string {
  return (m.content ?? [])
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

export function toolResultImages(m: ToolResultMessage): ImageContent[] {
  return (m.content ?? []).filter((c): c is ImageContent => c.type === "image");
}

export function imagesFromUnknown(value: unknown): ImageContent[] {
  if (!value || typeof value !== "object") return [];
  const obj = value as { content?: unknown; details?: Record<string, unknown> };
  const fromContent = Array.isArray(obj.content)
    ? obj.content.filter(
        (c): c is ImageContent =>
          Boolean(c) &&
          typeof c === "object" &&
          (c as { type?: string }).type === "image" &&
          typeof (c as { data?: unknown }).data === "string" &&
          typeof (c as { mimeType?: unknown }).mimeType === "string",
      )
    : [];
  if (fromContent.length > 0) return fromContent;
  const d = obj.details;
  if (d && typeof d.image === "string") {
    return [{ type: "image", data: d.image, mimeType: typeof d.mimeType === "string" ? d.mimeType : "image/png" }];
  }
  return [];
}
