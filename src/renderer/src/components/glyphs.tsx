/**
 * 自绘 16px 线性图标：与 WindowChrome 左侧窗口控件同一套绘制语言
 * （1.3 线宽、大圆角、无外框的极简线性图形）。
 */

const ICON = 16;
const STROKE = 1.3;

export function Glyph({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      width={ICON}
      height={ICON}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      stroke="currentColor"
      strokeWidth={STROKE}
    >
      {children}
    </svg>
  );
}

/** 统计：三根柱状条 */
export function StatsGlyph(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M3.5 13.5V9" strokeLinecap="round" />
      <path d="M8 13.5V2.8" strokeLinecap="round" />
      <path d="M12.5 13.5V6.4" strokeLinecap="round" />
    </Glyph>
  );
}

/** 项目文件：文件夹 */
export function FilesGlyph(): React.JSX.Element {
  return (
    <Glyph>
      <path
        d="M14 12.2V6.4c0-1-.8-1.8-1.8-1.8H8.3L7.1 3.3c-.3-.4-.8-.6-1.3-.6H3.8C2.8 2.7 2 3.5 2 4.5v7.7c0 1 .8 1.8 1.8 1.8h8.4c1 0 1.8-.8 1.8-1.8Z"
        strokeLinejoin="round"
      />
    </Glyph>
  );
}

/** 终端：提示符 */
export function TerminalGlyph(): React.JSX.Element {
  return (
    <Glyph>
      <path d="m3.2 4.6 3.8 3.4-3.8 3.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.4 12.4h3.6" strokeLinecap="round" />
    </Glyph>
  );
}

/** 虚拟机 / 沙箱：显示器 */
export function SandboxGlyph(): React.JSX.Element {
  return (
    <Glyph>
      <rect x="1.8" y="2.6" width="12.4" height="8.6" rx="2.2" />
      <path d="M8 11.2v2.2" strokeLinecap="round" />
      <path d="M5.2 13.6h5.6" strokeLinecap="round" />
    </Glyph>
  );
}

/** Harness 编排：两根调节滑杆 */
export function HarnessGlyph(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M2.4 5h11.2" strokeLinecap="round" />
      <path d="M6.2 3.1v3.8" strokeLinecap="round" />
      <path d="M2.4 11h11.2" strokeLinecap="round" />
      <path d="M9.8 9.1v3.8" strokeLinecap="round" />
    </Glyph>
  );
}

/** 会话树：分支 */
export function TreeGlyph(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M4 2v8" strokeLinecap="round" />
      <circle cx="12" cy="4" r="2" />
      <circle cx="4" cy="12" r="2" />
      <path d="M12 6a6 6 0 0 1-6 6" />
    </Glyph>
  );
}

/** 会话文件：文档 */
export function DocGlyph(): React.JSX.Element {
  return (
    <Glyph>
      <rect x="3.2" y="1.8" width="9.6" height="12.4" rx="2" />
      <path d="M5.7 6.2h4.6" strokeLinecap="round" />
      <path d="M5.7 8.7h4.6" strokeLinecap="round" />
      <path d="M5.7 11.2h3" strokeLinecap="round" />
    </Glyph>
  );
}
