/**
 * agent 命令终端视图：实时展示 agent 在本机执行的命令输出（含 ANSI
 * 颜色）。数据由 host 的 local_term 事件推送，store 按 seq 缓冲；
 * 这里增量写入，重新挂载时回放整个缓冲。agent 命令跑在 PTY 里，
 * 用户键入会转发给正在运行的命令（回答提示、Ctrl+C 接管）。
 */
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { TERMINAL_FONT, getTerminalTheme, watchTerminalTheme } from "@/lib/terminal-theme";
import "@xterm/xterm/css/xterm.css";

export interface LocalTermChunk {
  seq: number;
  data: string;
}

export function LocalTerminal({
  chatId,
  chunks,
  placeholder,
}: {
  /** 传入时启用输入接管：键入转发给 agent 当前运行的命令 PTY */
  chatId?: string;
  chunks: LocalTermChunk[];
  placeholder: string;
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const lastSeqRef = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const interactive = Boolean(chatId);
    const term = new Terminal({
      convertEol: true,
      disableStdin: !interactive,
      cursorInactiveStyle: "none",
      fontSize: 11.5,
      lineHeight: 1.4,
      fontFamily: TERMINAL_FONT,
      scrollback: 5000,
      theme: getTerminalTheme(),
    });
    const unwatchTheme = watchTerminalTheme(() => {
      term.options.theme = getTerminalTheme();
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    try {
      fit.fit();
    } catch {
      // container not laid out yet; ResizeObserver will fit shortly
    }
    termRef.current = term;
    lastSeqRef.current = 0;
    const inputSub = chatId
      ? term.onData((data) => {
          window.pi.chat.command(chatId, { type: "agent_term_input", data });
        })
      : undefined;
    const sendSize = (): void => {
      if (chatId && Number.isFinite(term.cols) && Number.isFinite(term.rows) && term.cols >= 2) {
        window.pi.chat.command(chatId, {
          type: "agent_term_resize",
          cols: term.cols,
          rows: term.rows,
        });
      }
    };
    sendSize();
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        sendSize();
      } catch {
        // ignore fit races during unmount
      }
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      unwatchTheme();
      inputSub?.dispose();
      term.dispose();
      termRef.current = null;
    };
  }, [chatId]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    if (chunks.length === 0) {
      if (lastSeqRef.current > 0) term.reset();
      return;
    }
    for (const c of chunks) {
      if (c.seq > lastSeqRef.current) {
        term.write(c.data);
        lastSeqRef.current = c.seq;
      }
    }
  }, [chunks]);

  return (
    <div className="relative min-h-0 flex-1 bg-bg">
      <div ref={containerRef} className="absolute inset-0 py-2 pl-2" />
      {chunks.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-8 text-center text-xs leading-relaxed text-fg-muted">
          {placeholder}
        </div>
      )}
    </div>
  );
}
