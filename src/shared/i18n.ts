/** Shared locale helpers for renderer, main, and host. */

export type Locale = "zh" | "en";

export const LOCALES: { id: Locale; label: string; nativeLabel: string }[] = [
  { id: "zh", label: "Chinese", nativeLabel: "中文" },
  { id: "en", label: "English", nativeLabel: "English" },
];

export function isLocale(v: unknown): v is Locale {
  return v === "zh" || v === "en";
}

/** Prefer an explicit hint (navigator / Electron locale); default to Chinese. */
export function detectLocale(hint?: string): Locale {
  const h = (hint ?? "").toLowerCase();
  if (h.startsWith("zh")) return "zh";
  if (h.startsWith("en")) return "en";
  return "zh";
}

export function dateLocale(locale: Locale): string {
  return locale === "zh" ? "zh-CN" : "en-US";
}

export function interpolate(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    vars[k] !== undefined ? String(vars[k]) : `{${k}}`,
  );
}

export function lookup(
  catalog: unknown,
  key: string,
  vars?: Record<string, string | number>,
): string {
  let cur: unknown = catalog;
  for (const part of key.split(".")) {
    if (cur && typeof cur === "object" && part in cur) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }
  if (typeof cur !== "string") return key;
  return interpolate(cur, vars);
}
