import { cn } from "@/lib/cn";

/**
 * iOS 风格开关：旋钮固定从轨道左侧 2px 出发，打开只平移剩余距离，
 * 避免绝对定位没有 left 时滑出轨道。
 */
export function Switch({
  on,
  onClick,
  title,
  disabled,
  className,
  size = "md",
}: {
  on: boolean;
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
}): React.JSX.Element {
  const sm = size === "sm";
  const classNames = cn(
    "relative shrink-0 rounded-full transition-colors",
    sm ? "h-4 w-7" : "h-[18px] w-8",
    on ? "bg-accent" : "bg-bg-tertiary",
    disabled && "opacity-50",
    className,
  );
  const knob = (
    <span
      className={cn(
        "pointer-events-none absolute top-[2px] left-[2px] rounded-full bg-white shadow transition-transform",
        sm ? "h-3 w-3" : "h-3.5 w-3.5",
        on && (sm ? "translate-x-3" : "translate-x-3.5"),
      )}
    />
  );

  if (!onClick) {
    return (
      <span className={classNames} title={title} aria-hidden>
        {knob}
      </span>
    );
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={classNames}
    >
      {knob}
    </button>
  );
}
