import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

const RESET_LAYOUT = "bivor:reset-layout";

const LAYOUT_WIDTH_KEYS = [
  "bivor:sidebar-width",
  "bivor:preview-width",
  "bivor:files-width",
] as const;

/** Clear persisted panel widths and notify open hooks to snap back to defaults. */
export function resetLayoutWidths(): void {
  for (const key of LAYOUT_WIDTH_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
  window.dispatchEvent(new Event(RESET_LAYOUT));
}

function readWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const n = Number(localStorage.getItem(key));
    if (Number.isFinite(n)) return Math.min(max, Math.max(min, n));
  } catch {
    // ignore
  }
  return fallback;
}

/** `right`：往右拖加宽（左侧栏）；`left`：往左拖加宽（右侧栏）。 */
export function useDragWidth(
  key: string,
  fallback: number,
  min: number,
  max: number,
  grow: "left" | "right" = "left",
) {
  const [width, setWidth] = useState(() => readWidth(key, fallback, min, max));
  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    const onReset = (): void => setWidth(fallback);
    window.addEventListener(RESET_LAYOUT, onReset);
    return () => window.removeEventListener(RESET_LAYOUT, onReset);
  }, [fallback]);

  const onPointerDown = (e: React.PointerEvent): void => {
    e.preventDefault();
    const origin = e.clientX;
    const start = widthRef.current;
    const move = (ev: PointerEvent): void => {
      const delta = grow === "right" ? ev.clientX - origin : origin - ev.clientX;
      setWidth(Math.round(Math.min(max, Math.max(min, start + delta))));
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      try {
        localStorage.setItem(key, String(widthRef.current));
      } catch {
        // ignore
      }
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return [width, onPointerDown] as const;
}

export function ColSash({
  onDrag,
  className,
}: {
  onDrag: (e: React.PointerEvent) => void;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onDrag}
      className={cn("relative z-10 w-px shrink-0 cursor-col-resize bg-border", className)}
    >
      <div className="absolute inset-y-0 -left-1 w-2 hover:bg-bg-hover/50" />
    </div>
  );
}
