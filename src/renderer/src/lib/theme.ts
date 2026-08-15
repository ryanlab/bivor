export type ThemePreference = "system" | "light" | "dark";

const KEY = "bivor:theme";
const media = window.matchMedia("(prefers-color-scheme: light)");

export function loadThemePreference(): ThemePreference {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

/** 与 styles/index.css 的 --t-bg / --t-fg-secondary 保持一致。 */
const OVERLAY_COLORS = {
  dark: { color: "#1f1e1b", symbolColor: "#b8b2a5" },
  light: { color: "#f7f5f0", symbolColor: "#6e6a5c" },
} as const;

export function applyTheme(pref: ThemePreference): void {
  localStorage.setItem(KEY, pref);
  const resolved = pref === "system" ? (media.matches ? "light" : "dark") : pref;
  document.documentElement.dataset.theme = resolved;
  // Windows/Linux 的窗口控件 overlay 配色跟随主题（macOS 侧为 no-op）
  window.pi?.system?.setTitleBarOverlay?.(OVERLAY_COLORS[resolved]);
}

export function watchSystemTheme(getPref: () => ThemePreference): void {
  media.addEventListener("change", () => {
    if (getPref() === "system") applyTheme("system");
  });
}
