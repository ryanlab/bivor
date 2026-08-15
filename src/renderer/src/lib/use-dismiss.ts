import { useEffect, useRef, type RefObject } from "react";

/** Close a popover when pointer/focus leaves `root`, or Escape is pressed. */
export function useDismiss(
  open: boolean,
  root: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const inside = (node: EventTarget | null): boolean =>
      Boolean(node && root.current?.contains(node as Node));
    const close = (): void => onCloseRef.current();
    const onPointerDown = (e: PointerEvent): void => {
      if (!inside(e.target)) close();
    };
    const onFocusIn = (e: FocusEvent): void => {
      if (!inside(e.target)) close();
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("focusin", onFocusIn);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, root]);
}
