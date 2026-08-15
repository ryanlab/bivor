import { dateLocale } from "@shared/i18n";
import { currentLocale, tt } from "@/lib/i18n";

/** Strip Electron's `Error invoking remote method '…': Error:` wrapper. */
export function ipcErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, "").trim();
}

export function formatTokens(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return "-";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatCost(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return "";
  if (n === 0) return "$0";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

export function formatRelativeTime(ts: number | undefined): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return tt("time.justNow");
  if (min < 60) return tt("time.minutesAgo", { n: min });
  const hours = Math.floor(min / 60);
  if (hours < 24) return tt("time.hoursAgo", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return tt("time.daysAgo", { n: days });
  return new Date(ts).toLocaleDateString(dateLocale(currentLocale()));
}

export function formatDateTime(
  ts: number,
  opts?: Intl.DateTimeFormatOptions,
): string {
  return new Date(ts).toLocaleString(dateLocale(currentLocale()), opts);
}

export function formatDate(ts: number, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(ts).toLocaleDateString(dateLocale(currentLocale()), opts);
}

export function formatTime(ts: number, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(ts).toLocaleTimeString(dateLocale(currentLocale()), opts);
}

export function basename(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() ?? path;
}

export function samePath(a?: string, b?: string): boolean {
  return Boolean(a && b && a.replace(/\/+$/, "") === b.replace(/\/+$/, ""));
}

/** Localized label for the coding workspace; the scratch folder is not shown as "Scratch". */
export function projectName(path: string | undefined, defaultCwd?: string): string {
  if (samePath(path, defaultCwd)) return tt("composer.defaultProject");
  if (!path) return tt("composer.selectProject");
  return basename(path);
}

export function shortenPath(path: string, maxLen = 40): string {
  const home = path.replace(/^\/Users\/[^/]+/, "~");
  if (home.length <= maxLen) return home;
  const parts = home.split("/");
  if (parts.length <= 3) return home;
  return `${parts[0]}/…/${parts.slice(-2).join("/")}`;
}
