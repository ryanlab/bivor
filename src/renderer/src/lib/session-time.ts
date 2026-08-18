export const SESSION_TIME_FILTERS = ["all", "today", "7d", "30d"] as const;
export type SessionTimeFilter = (typeof SESSION_TIME_FILTERS)[number];

export const TIME_FILTER_LABEL: Record<SessionTimeFilter, string> = {
  all: "window.filterAll",
  today: "window.filterToday",
  "7d": "window.filter7d",
  "30d": "window.filter30d",
};

/** Inclusive local-day cutoff; `all` has none. */
export function timeFilterCutoff(filter: SessionTimeFilter): number | null {
  if (filter === "all") return null;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (filter === "today") return start.getTime();
  start.setDate(start.getDate() - (filter === "7d" ? 6 : 29));
  return start.getTime();
}

export function filterSessionsByTime<T extends { modifiedAt?: number; createdAt?: number }>(
  sessions: T[],
  filter: SessionTimeFilter,
): T[] {
  const cutoff = timeFilterCutoff(filter);
  if (cutoff == null) return sessions;
  return sessions.filter((s) => {
    const ts = s.modifiedAt ?? s.createdAt;
    return ts != null && ts >= cutoff;
  });
}
