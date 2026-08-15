/** 渲染层的平台常量：快捷键标签与窗口 chrome 都据此分支。 */
export const PLATFORM = window.pi.system.platform;
export const IS_MAC = PLATFORM === "darwin";
export const IS_WINDOWS = PLATFORM === "win32";

/** 修饰键标签：mac 紧凑风格「⌘K」，其他平台「Ctrl+K」。 */
export const MOD_LABEL = IS_MAC ? "⌘" : "Ctrl+";

/** 组合快捷键提示文本，如 shortcutHint("K") → "⌘K" / "Ctrl+K"。 */
export function shortcutHint(key: string): string {
  return `${MOD_LABEL}${key}`;
}
