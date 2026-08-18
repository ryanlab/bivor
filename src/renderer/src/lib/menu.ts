import { cn } from "./cn";

/**
 * 下拉/弹出菜单列表容器。
 * 必须用 flex + gap，避免选中/悬停底色和相邻项连成一块。
 */
export const menuPanel =
  "flex flex-col gap-1 rounded-xl border border-border-strong bg-bg p-1 shadow-xl";

/** 菜单项：选中与悬停用独立圆角底，不与邻项相接。 */
export function menuItemClass(active = false, extra?: string): string {
  return cn(
    "flex w-full rounded-lg px-3 py-2 text-left text-[13px] transition-colors",
    active ? "bg-bg-hover text-fg" : "text-fg hover:bg-bg-hover",
    extra,
  );
}
