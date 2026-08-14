export type ThemePreference = "system" | "light" | "dark";

const KEY = "bivor:theme";
const media = window.matchMedia("(prefers-color-scheme: light)");

export function loadThemePreference(): ThemePreference {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

export function applyTheme(pref: ThemePreference): void {
  localStorage.setItem(KEY, pref);
  const resolved = pref === "system" ? (media.matches ? "light" : "dark") : pref;
  document.documentElement.dataset.theme = resolved;
}

export function watchSystemTheme(getPref: () => ThemePreference): void {
  media.addEventListener("change", () => {
    if (getPref() === "system") applyTheme("system");
  });
}
