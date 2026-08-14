import { detectLocale, isLocale, type Locale } from "@shared/i18n";

const KEY = "bivor:locale";

export type { Locale };

export function loadLocalePreference(): Locale {
  try {
    const v = localStorage.getItem(KEY);
    if (isLocale(v)) return v;
  } catch {
    // ignore
  }
  return detectLocale(navigator.language);
}

export function persistLocale(locale: Locale): void {
  try {
    localStorage.setItem(KEY, locale);
  } catch {
    // ignore
  }
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
}

export function applyLocale(locale: Locale): void {
  persistLocale(locale);
  void window.pi.config.set({ locale });
}
