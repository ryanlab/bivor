import { useCallback } from "react";
import { t as translate } from "@shared/locales";
import type { Locale } from "@shared/i18n";
import { useAppStore } from "@/stores/app-store";

export type { Locale };
export type Vars = Record<string, string | number>;
export type Translator = (key: string, vars?: Vars) => string;

/** Translate with the current store locale (safe outside React). */
export function tt(key: string, vars?: Vars): string {
  return translate(useAppStore.getState().locale, key, vars);
}

export function useT(): Translator {
  const locale = useAppStore((s) => s.locale);
  return useCallback((key: string, vars?: Vars) => translate(locale, key, vars), [locale]);
}

export function useLocale(): Locale {
  return useAppStore((s) => s.locale);
}

export function currentLocale(): Locale {
  return useAppStore.getState().locale;
}
