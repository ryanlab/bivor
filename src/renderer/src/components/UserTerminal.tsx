/**
 * 用户交互终端：连接 main 进程 node-pty 的真 shell（每 chat 一个）。
 * 与 agent 的一次性 bash 命令相互独立。PTY 常驻 main 进程，
 * 面板关闭重开时通过 backlog 回放恢复现场。
 */
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useT } from "@/lib/i18n";
import { TERMINAL_FONT, getTerminalTheme, watchTerminalTheme } from "@/lib/terminal-theme";
import "@xterm/xterm/css/xterm.css";

export function UserTerminal({
  chatId,
  termId,
  cwd,
}: {
  chatId: string;
  termId: string;
  cwd: string;
}): React.JSX.Element {
  const t = useT();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [exited, setExited] = useState(false);
  /** 递增触发重建（shell 退出后点击重启） */
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let disposed = false;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 11.5,
      lineHeight: 1.4,
      fontFamily: TERMINAL_FONT,
      scrollback: 8000,
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
      // container not laid out yet
    }
    termRef.current = term;
    fitRef.current = fit;

    const offData = window.pi.term.onData((id, data) => {
      if (id === termId) term.write(data);
    });
    const offExit = window.pi.term.onExit((id) => {
      if (id === termId && !disposed) setExited(true);
    });
    const inputSub = term.onData((data) => {
      window.pi.term.input(termId, data);
    });

    void window.pi.term.create(chatId, termId, cwd, term.cols, term.rows).then(({ backlog }) => {
      if (disposed) return;
      if (backlog) term.write(backlog);
      setExited(false);
      term.focus();
    });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        if (Number.isFinite(term.cols) && Number.isFinite(term.rows) && term.cols >= 2) {
          window.pi.term.resize(termId, term.cols, term.rows);
        }
      } catch {
        // ignore fit races during unmount
      }
    });
    ro.observe(el);

    return () => {
      disposed = true;
      ro.disconnect();
      unwatchTheme();
      inputSub.dispose();
      offData();
      offExit();
      term.dispose();
      termRef.current = null;
      // PTY 留在 main 进程继续跑：关面板不杀 shell（dev server 等不中断）
    };
  }, [chatId, termId, cwd, epoch]);

  return (
    <div className="relative min-h-0 flex-1 bg-bg">
      <div ref={containerRef} className="absolute inset-0 py-2 pl-2" />
      {exited && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-bg/70">
          <div className="text-xs text-fg-muted">{t("sandbox.shellExited")}</div>
          <button
            type="button"
            onClick={() => {
              window.pi.term.dispose(termId);
              setExited(false);
              setEpoch((n) => n + 1);
            }}
            className="rounded-lg border border-border px-2.5 py-1 text-[11px] text-fg-secondary hover:bg-bg-hover"
          >
            {t("sandbox.shellRestart")}
          </button>
        </div>
      )}
    </div>
  );
}
