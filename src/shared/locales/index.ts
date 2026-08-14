import type { Locale } from "../i18n";
import { lookup } from "../i18n";
import { en } from "./en";
import { zh, type Messages } from "./zh";

export const catalogs: Record<Locale, Messages> = { zh, en };

export type { Messages };

export function t(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  return lookup(catalogs[locale], key, vars);
}
