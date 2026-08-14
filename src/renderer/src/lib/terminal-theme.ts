/**
 * 终端配色：不写死颜色，运行时读应用主题的 CSS 变量，让终端背景
 * 与应用主背景（--t-bg）完全同色、前景用应用正文色，
 * 浅/深主题都无缝融入。ANSI 色板按主题二选一（VS Code Light+/Dark+，
 * 分别为浅底和深底调过对比度）。
 */
import type { ITheme } from "@xterm/xterm";

export const TERMINAL_FONT = '"SF Mono", ui-monospace, Menlo, Consolas, monospace';

const LIGHT_ANSI: Partial<ITheme> = {
  black: "#000000",
  red: "#cd3131",
  green: "#00bc00",
  yellow: "#949800",
  blue: "#0451a5",
  magenta: "#bc05bc",
  cyan: "#0598bc",
  white: "#555555",
  brightBlack: "#666666",
  brightRed: "#cd3131",
  brightGreen: "#14ce14",
  brightYellow: "#b5ba00",
  brightBlue: "#0451a5",
  brightMagenta: "#bc05bc",
  brightCyan: "#0598bc",
  brightWhite: "#a5a5a5",
};

const DARK_ANSI: Partial<ITheme> = {
  black: "#3a3831",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#e5e5e5",
};

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function getTerminalTheme(): ITheme {
  const light = document.documentElement.dataset.theme === "light";
  const background = cssVar("--t-bg") || (light ? "#f7f5f0" : "#1f1e1b");
  const foreground = cssVar("--t-fg") || (light ? "#3d3929" : "#ede8de");
  return {
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: cssVar("--t-bg-hover") || (light ? "#e4e0d5" : "#383630"),
    ...(light ? LIGHT_ANSI : DARK_ANSI),
  };
}

/** 主题切换（html[data-theme] 变化）时回调，用于给已打开的终端热换肤。 */
export function watchTerminalTheme(apply: () => void): () => void {
  const observer = new MutationObserver(apply);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}
