import { app } from "electron";
import { detectLocale, isLocale, type Locale } from "@shared/i18n";
import { t } from "@shared/locales";
import { getConfig } from "./config";

export function currentLocale(): Locale {
  const stored = getConfig().locale;
  if (isLocale(stored)) return stored;
  return detectLocale(app.getLocale());
}

export function mt(key: string, vars?: Record<string, string | number>): string {
  return t(currentLocale(), key, vars);
}
