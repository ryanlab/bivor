import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlarmClock,
  BarChart3,
  FileDown,
  Keyboard,
  FolderOpen,
  GitBranch,
  History,
  Languages,
  LayoutGrid,
  MessageSquare,
  Moon,
  Package,
  Palette,
  Plus,
  Rocket,
  Search,
  Settings,
  Sun,
  X,
} from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { basename, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";

interface Item {
  id: string;
  icon: React.ReactNode;
  label: string;
  hint?: string;
  keywords: string;
  run: () => void;
}

export function CommandPalette(): React.JSX.Element | null {
  const t = useT();
  const open = useAppStore((s) => s.paletteOpen);
  const setOpen = useAppStore((s) => s.setPaletteOpen);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Reactive slices so the list doesn't freeze while the palette stays open
  // (e.g. sessions finishing their async load, chats being renamed).
  const activeProjectIsGit = useAppStore((s) => s.activeProjectIsGit);
  const activeChatId = useAppStore((s) => s.activeChatId);
  const chatOrder = useAppStore((s) => s.chatOrder);
  const chats = useAppStore((s) => s.chats);
  const sessionList = useAppStore((s) => s.sessions);
  const appMode = useAppStore((s) => s.appMode);
  const locale = useAppStore((s) => s.locale);

  const items = useMemo<Item[]>(() => {
    const s = useAppStore.getState();
    const close = (): void => s.setPaletteOpen(false);
    const isDaily = s.appMode === "daily";
    const actions: Item[] = [
      {
        id: "new-task",
        icon: <Plus size={14} />,
        label: isDaily ? t("sidebar.newChat") : t("sidebar.newTask"),
        hint: "⌘N",
        keywords: "new task chat xinrenwu xinduihua",
        run: () => {
          close();
          s.showWelcome();
        },
      },
      ...(!isDaily && s.activeProjectIsGit
        ? [
            {
              id: "worktree",
              icon: <GitBranch size={14} />,
              label: t("palette.worktree"),
              keywords: "worktree parallel binghang",
              run: () => {
                close();
                void s.openWorktreeChat();
              },
            },
          ]
        : []),
      {
        id: "home",
        icon: <LayoutGrid size={14} />,
        label: isDaily ? t("sidebar.overviewChat") : t("sidebar.overviewTask"),
        hint: "⌘O",
        keywords: "mission control home zonglan",
        run: () => {
          close();
          s.showHome();
        },
      },
      ...(s.activeChatId
        ? [
            {
              id: "export-html",
              icon: <FileDown size={14} />,
              label: t("palette.exportHtml"),
              keywords: "export html daochu",
              run: () => {
                close();
                window.pi.chat.command(s.activeChatId!, { type: "export_html" });
              },
            },
            {
              id: "export-jsonl",
              icon: <FileDown size={14} />,
              label: t("palette.exportJsonl"),
              keywords: "export jsonl daochu",
              run: () => {
                close();
                window.pi.chat.command(s.activeChatId!, { type: "export_jsonl" });
              },
            },
          ]
        : []),
      {
        id: "open-project",
        icon: <FolderOpen size={14} />,
        label: t("palette.openProject"),
        keywords: "open project folder dakai",
        run: () => {
          close();
          void s.pickAndOpenProject();
        },
      },
      {
        id: "settings",
        icon: <Settings size={14} />,
        label: t("common.settings"),
        hint: "⌘,",
        keywords: "settings shezhi vercel deploy bushu",
        run: () => {
          close();
          s.setSettingsOpen(true);
        },
      },
      {
        id: "resources",
        icon: <Package size={14} />,
        label: t("palette.resources"),
        keywords: "resources packages skills mcp ziyuan chajian jineng",
        run: () => {
          close();
          s.setResourcesOpen(true);
        },
      },
      {
        id: "usage",
        icon: <BarChart3 size={14} />,
        label: t("palette.usage"),
        keywords: "usage stats token cost yongliang tongji chengben",
        run: () => {
          close();
          s.setUsageOpen(true);
        },
      },
      {
        id: "scheduled-tasks",
        icon: <AlarmClock size={14} />,
        label: t("sidebar.schedule"),
        keywords: "schedule cron task timer dingshi renwu jihua",
        run: () => {
          close();
          s.setScheduledTasksOpen(true);
        },
      },
      {
        id: "deployments",
        icon: <Rocket size={14} />,
        label: t("palette.deployments"),
        keywords: "deploy deployments vercel ops rollback bushu yunwei huigun",
        run: () => {
          close();
          s.setDeploymentsOpen(true);
        },
      },
      {
        id: "shortcuts",
        icon: <Keyboard size={14} />,
        label: t("palette.shortcuts"),
        hint: "⌘/",
        keywords: "shortcuts keyboard kuaijiejian",
        run: () => {
          close();
          s.setShortcutsOpen(true);
        },
      },
      {
        id: "theme-light",
        icon: <Sun size={14} />,
        label: t("palette.themeLight"),
        keywords: "light theme qianse",
        run: () => {
          close();
          s.setTheme("light");
        },
      },
      {
        id: "theme-dark",
        icon: <Moon size={14} />,
        label: t("palette.themeDark"),
        keywords: "dark theme shense",
        run: () => {
          close();
          s.setTheme("dark");
        },
      },
      {
        id: "theme-system",
        icon: <Palette size={14} />,
        label: t("palette.themeSystem"),
        keywords: "system theme gensui",
        run: () => {
          close();
          s.setTheme("system");
        },
      },
      {
        id: "locale-zh",
        icon: <Languages size={14} />,
        label: t("palette.localeZh"),
        keywords: "chinese zhongwen 中文",
        run: () => {
          close();
          s.setLocale("zh");
        },
      },
      {
        id: "locale-en",
        icon: <Languages size={14} />,
        label: t("palette.localeEn"),
        keywords: "english yingwen 英文",
        run: () => {
          close();
          s.setLocale("en");
        },
      },
    ];
    const openChats: Item[] = s.chatOrder
      .filter((chatId) => s.chats[chatId]?.kind === s.appMode)
      .map((chatId) => {
        const c = s.chats[chatId];
        const label = c?.sessionName ?? (isDaily ? t("sidebar.newChat") : t("sidebar.newSession"));
        return {
          id: `chat-${chatId}`,
          icon: <MessageSquare size={14} />,
          label,
          hint: t("palette.inProgress"),
          keywords: `chat ${label}`,
          run: () => {
            close();
            s.setActiveChat(chatId);
          },
        };
      });
    const sessions: Item[] = s.sessions.slice(0, 30).map((sess) => {
      const label = sess.name || sess.firstUserMessage || t("sidebar.emptyChat");
      return {
        id: `session-${sess.path}`,
        icon: <History size={14} />,
        label: label.slice(0, 60),
        hint: sess.modifiedAt ? formatRelativeTime(sess.modifiedAt) : undefined,
        keywords: `session history ${label}`,
        run: () => {
          close();
          void s.openChat({
            cwd: sess.cwd || (isDaily ? s.dailyCwd : s.activeProjectPath)!,
            sessionFile: sess.path,
            kind: s.appMode,
          });
        },
      };
    });
    return [...actions, ...openChats, ...sessions];
  }, [open, activeProjectIsGit, activeChatId, chatOrder, chats, sessionList, appMode, locale, t]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) => i.label.toLowerCase().includes(q) || i.keywords.toLowerCase().includes(q),
    );
  }, [items, query]);

  useEffect(() => {
    setIndex(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    const el = listRef.current?.children[index] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [index]);

  if (!open) return null;

  return (
    <div
      className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/25"
      onClick={() => setOpen(false)}
    >
      <div
        className="dialog-in w-[560px] overflow-hidden rounded-[20px] border border-border bg-bg-secondary shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-4">
          <Search size={16} strokeWidth={1.7} className="shrink-0 text-fg-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                filtered[index]?.run();
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder={t("palette.placeholder")}
            className="w-full bg-transparent py-3.5 text-[15px] text-fg outline-none placeholder:text-fg-muted"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md p-1 text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
          >
            <X size={15} />
          </button>
        </div>
        <div ref={listRef} className="max-h-[46vh] overflow-y-auto p-1.5">
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-fg-muted">{t("palette.noResults")}</div>
          )}
          {filtered.map((item, i) => (
            <button
              key={item.id}
              type="button"
              onClick={item.run}
              onMouseMove={() => setIndex(i)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors",
                i === index ? "bg-bg-hover text-fg" : "text-fg-secondary",
              )}
            >
              <span className="shrink-0 text-fg-muted">
                {item.icon}
              </span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.hint && <span className="shrink-0 text-[10.5px] text-fg-muted">{item.hint}</span>}
            </button>
          ))}
        </div>
        <div className="px-4 pb-3 pt-1 text-[11px] text-fg-muted">
          {basename(useAppStore.getState().activeProjectPath ?? "") || t("palette.noProject")}
        </div>
      </div>
    </div>
  );
}
