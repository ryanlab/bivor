/**
 * 把共享 preset 表应用到 pi 会话：custom tools 注册过滤 + 工具启用策略。
 */
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { RuntimePresetDef } from "@shared/runtime-presets";

/** 按 preset 白名单过滤桌面自带 custom tools（在注册前生效）。 */
export function filterCustomTools(
  preset: RuntimePresetDef,
  tools: ToolDefinition[],
): ToolDefinition[] {
  if (preset.customTools === "all") return tools;
  const allow = new Set(preset.customTools);
  return tools.filter((t) => allow.has(t.name));
}

/** 按 preset 策略设置启用工具（作用于内建 + 自带 + 扩展全体工具）。 */
export function applyPresetToolPolicy(
  session: {
    getAllTools: () => { name: string }[];
    setActiveToolsByName: (names: string[]) => void;
  },
  preset: RuntimePresetDef,
): void {
  const policy = preset.tools;
  if (policy.mode === "all") return;
  const all = session.getAllTools().map((t) => t.name);
  const names =
    policy.mode === "deny"
      ? all.filter((n) => !new Set(policy.names).has(n))
      : all.filter((n) => new Set(policy.names).has(n));
  session.setActiveToolsByName(names);
}
