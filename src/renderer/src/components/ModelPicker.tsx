import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight, Cpu, SlidersHorizontal } from "lucide-react";
import type { ModelInfo, ThinkingLevel } from "@shared/protocol";
import { useAppStore } from "@/stores/app-store";
import { useT } from "@/lib/i18n";
import type { Translator } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { Switch } from "@/components/Switch";

const DROPDOWN_WIDTH = 320;
const DROPDOWN_MAX_H = 384;
const OPTIONS_WIDTH = 208;
const GAP = 4;
const VIEWPORT_PAD = 8;
const RECENT_KEY = "bivor:recent-models";
const RECENT_MAX = 6;
const NEST_MIN_MODELS = 10;

/** 思考强度档位，从低到高（"off" 单独由开关控制） */
const THINKING_EFFORTS: Exclude<ThinkingLevel, "off">[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

function thinkingLabel(t: Translator, level: ThinkingLevel): string {
  return t(`model.${level}`);
}

/** 打开「思考」开关时，若没有历史档位就用这个 */
const DEFAULT_EFFORT: ThinkingLevel = "medium";

const VENDOR_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  amazon: "Amazon",
  ai21: "AI21",
  qwen: "Qwen",
  mistralai: "Mistral",
  "meta-llama": "Meta",
  deepseek: "DeepSeek",
  "x-ai": "xAI",
  "z-ai": "Z.AI",
  moonshotai: "Moonshot",
  minimax: "MiniMax",
  nvidia: "NVIDIA",
  "aion-labs": "AionLabs",
  "bytedance-seed": "ByteDance",
  inclusionai: "InclusionAI",
  openrouter: "OpenRouter",
  cohere: "Cohere",
  perplexity: "Perplexity",
  "nousresearch": "Nous",
  inception: "Inception",
};

type DropdownPos = { top: number; left: number; maxHeight: number };
type RecentRef = { provider: string; id: string };

function measureDropdown(anchor: HTMLElement, align: "bottom" | "top"): DropdownPos {
  const rect = anchor.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom - GAP - VIEWPORT_PAD;
  const spaceAbove = rect.top - GAP - VIEWPORT_PAD;
  const preferBottom = align === "bottom";
  const placeBottom = preferBottom
    ? spaceBelow >= 200 || spaceBelow >= spaceAbove
    : spaceAbove < 200 && spaceBelow > spaceAbove;
  const available = placeBottom ? spaceBelow : spaceAbove;
  const maxHeight = Math.max(160, Math.min(DROPDOWN_MAX_H, available));
  const left = Math.min(
    Math.max(VIEWPORT_PAD, rect.left),
    window.innerWidth - DROPDOWN_WIDTH - VIEWPORT_PAD,
  );
  const top = placeBottom ? rect.bottom + GAP : rect.top - GAP - maxHeight;
  return { top, left, maxHeight };
}

function vendorOf(model: ModelInfo): string {
  const slash = model.id.indexOf("/");
  return slash > 0 ? model.id.slice(0, slash) : model.provider;
}

function vendorLabel(slug: string): string {
  if (VENDOR_LABELS[slug]) return VENDOR_LABELS[slug];
  return slug
    .split(/[-_]/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function modelKey(m: Pick<ModelInfo, "provider" | "id">): string {
  return `${m.provider}/${m.id}`;
}

function loadRecent(): RecentRef[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (x): x is RecentRef =>
        !!x &&
        typeof x === "object" &&
        typeof (x as RecentRef).provider === "string" &&
        typeof (x as RecentRef).id === "string",
    );
  } catch {
    return [];
  }
}

function pushRecent(model: ModelInfo): void {
  const next = [
    { provider: model.provider, id: model.id },
    ...loadRecent().filter((x) => !(x.provider === model.provider && x.id === model.id)),
  ].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}


function ModelRow({
  model,
  active,
  onSelect,
  providerLabel,
  effort,
  onOpenOptions,
  optionsOpen,
}: {
  model: ModelInfo;
  active: boolean;
  onSelect: (model: ModelInfo) => void;
  providerLabel?: string;
  /** 这个模型自己的思考档位（仅推理模型、且调用方接管了思考设置时传入） */
  effort?: ThinkingLevel;
  onOpenOptions?: (model: ModelInfo, anchor: HTMLElement) => void;
  /** 该行的思考面板是否展开（展开时固定显示 Edit） */
  optionsOpen?: boolean;
}): React.JSX.Element {
  const t = useT();
  const adjustable = Boolean(onOpenOptions && model.reasoning);
  return (
    <div
      className={cn(
        "group flex w-full items-center gap-2 rounded-md px-2 text-xs transition-colors hover:bg-bg-hover",
        active ? "text-accent" : "text-fg-secondary",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(model)}
        className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left"
      >
        <span className="min-w-0 truncate">
          {model.name}
          {providerLabel && (
            <span className={cn("font-normal", active ? "text-accent/70" : "text-fg-muted")}>
              {" "}
              [{providerLabel}]
            </span>
          )}
        </span>
        {adjustable && effort && effort !== "off" && (
          <span className={cn("shrink-0", active ? "text-accent/70" : "text-fg-muted")}>
            {thinkingLabel(t, effort)}
          </span>
        )}
      </button>
      {adjustable ? (
        <button
          type="button"
          title={t("model.thinkingTitle")}
          onClick={(e) => onOpenOptions?.(model, e.currentTarget)}
          className={cn(
            "flex shrink-0 items-center gap-1 py-1 text-fg-muted transition-opacity",
            optionsOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        >
          <SlidersHorizontal size={11} />
          Edit
        </button>
      ) : (
        model.reasoning && (
          <span className="rounded bg-bg-tertiary px-1 py-px text-[10px] text-fg-muted">推理</span>
        )
      )}
    </div>
  );
}

function FolderRow({
  label,
  count,
  open,
  foldable,
  onToggle,
}: {
  label: string;
  count: number;
  open: boolean;
  foldable: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => foldable && onToggle()}
      className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-[11.5px] text-fg-secondary hover:bg-bg-hover"
    >
      {foldable ? (
        <ChevronRight
          size={11}
          className={cn("shrink-0 text-fg-muted transition-transform", open && "rotate-90")}
        />
      ) : (
        <span className="w-[11px]" />
      )}
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      <span className="text-[10.5px] text-fg-muted">{count}</span>
    </button>
  );
}

export function ModelPicker({
  model,
  onSelect,
  disabled,
  align = "bottom",
  hideTrigger = false,
  open: openProp,
  onOpenChange,
  thinkingFor,
  onThinkingLevel,
}: {
  model?: ModelInfo;
  onSelect: (model: ModelInfo) => void;
  disabled?: boolean;
  /** dropdown direction relative to the trigger */
  align?: "bottom" | "top";
  /** render only the dropdown (no trigger button); requires controlled open */
  hideTrigger?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 传入这两项后，推理模型行可展开各自独立的思考开关与强度面板 */
  thinkingFor?: (model: ModelInfo) => ThinkingLevel;
  onThinkingLevel?: (model: ModelInfo, level: ThinkingLevel) => void;
}): React.JSX.Element | null {
  const t = useT();
  const models = useAppStore((s) => s.models);
  const providers = useAppStore((s) => s.providers);
  const [openInner, setOpenInner] = useState(false);
  const open = openProp ?? openInner;
  const setOpen = (v: boolean | ((p: boolean) => boolean)): void => {
    const next = typeof v === "function" ? v(open) : v;
    onOpenChange ? onOpenChange(next) : setOpenInner(next);
  };
  const [filter, setFilter] = useState("");
  const [pos, setPos] = useState<DropdownPos | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [recentTick, setRecentTick] = useState(0);
  const [options, setOptions] = useState<{ model: ModelInfo; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  /** 每个模型关闭思考前的档位，再打开时按模型恢复 */
  const lastEffort = useRef<Record<string, ThinkingLevel>>({});

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const update = (): void => {
      const anchor = ref.current;
      if (!anchor) return;
      setPos(measureDropdown(anchor, align));
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, align]);

  useEffect(() => {
    if (!open) {
      setFilter("");
      setOptions(null);
      return;
    }
    const onClick = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (
        ref.current?.contains(t) ||
        dropdownRef.current?.contains(t) ||
        optionsRef.current?.contains(t)
      ) {
        return;
      }
      setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const authenticatedSet = useMemo(
    () => new Set(providers.filter((p) => p.authenticated).map((p) => p.id)),
    [providers],
  );

  const usableModel = model && authenticatedSet.has(model.provider) ? model : undefined;

  useEffect(() => {
    if (!open) return;
    if (!usableModel) return;
    setExpanded(
      new Set([
        `p:${usableModel.provider}`,
        `${usableModel.provider}:${vendorOf(usableModel)}`,
      ]),
    );
  }, [open]);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return models.filter(
      (m) =>
        authenticatedSet.has(m.provider) &&
        (!f ||
          m.id.toLowerCase().includes(f) ||
          m.name.toLowerCase().includes(f) ||
          m.provider.toLowerCase().includes(f) ||
          vendorLabel(vendorOf(m)).toLowerCase().includes(f)),
    );
  }, [models, authenticatedSet, filter]);

  const searching = filter.trim().length > 0;

  const recents = useMemo(() => {
    if (searching) return [];
    const byKey = new Map(filtered.map((m) => [modelKey(m), m]));
    return loadRecent()
      .map((r) => byKey.get(modelKey(r)))
      .filter((m): m is ModelInfo => !!m);
  }, [filtered, searching, recentTick]);

  const sections = useMemo(() => {
    const byProvider = new Map<string, ModelInfo[]>();
    for (const m of filtered) {
      const list = byProvider.get(m.provider) ?? [];
      list.push(m);
      byProvider.set(m.provider, list);
    }
    return [...byProvider.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([provider, list]) => {
        const vendors = new Map<string, ModelInfo[]>();
        for (const m of list) {
          const v = vendorOf(m);
          const bucket = vendors.get(v) ?? [];
          bucket.push(m);
          vendors.set(v, bucket);
        }
        const nested = list.length >= NEST_MIN_MODELS && vendors.size >= 2;
        return {
          provider,
          label: providers.find((p) => p.id === provider)?.name ?? provider,
          nested,
          groups: nested
            ? [...vendors.entries()]
                .sort((a, b) => vendorLabel(a[0]).localeCompare(vendorLabel(b[0]), "en"))
                .map(([slug, models]) => ({
                  key: `${provider}:${slug}`,
                  label: vendorLabel(slug),
                  models,
                }))
            : [{ key: `${provider}:all`, label: "", models: list }],
        };
      });
  }, [filtered, providers]);

  const pick = (m: ModelInfo): void => {
    pushRecent(m);
    setRecentTick((n) => n + 1);
    onSelect(m);
    setOpen(false);
  };

  /** 每个模型各自一份思考设置，所以编辑不改变当前选中的模型 */
  const openOptions = (m: ModelInfo, anchor: HTMLElement): void => {
    const rect = anchor.getBoundingClientRect();
    setOptions((prev) => (prev && modelKey(prev.model) === modelKey(m) ? null : { model: m, top: rect.top }));
  };

  const setEffort = (m: ModelInfo, level: ThinkingLevel): void => {
    if (level !== "off") lastEffort.current[modelKey(m)] = level;
    onThinkingLevel?.(m, level);
  };

  const triggerEffort = usableModel && thinkingFor ? thinkingFor(usableModel) : undefined;

  const toggle = (key: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (!hideTrigger && authenticatedSet.size === 0) return null;

  const dropdown =
    open &&
    pos &&
    createPortal(
      <div
        ref={dropdownRef}
        style={{ top: pos.top, left: pos.left, width: DROPDOWN_WIDTH, maxHeight: pos.maxHeight }}
        className="dialog-in fixed z-50 flex flex-col overflow-hidden rounded-xl border border-border-strong bg-bg shadow-2xl"
      >
        <div className="shrink-0 px-3 py-2">
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("model.search")}
            className="w-full bg-transparent py-0.5 text-xs text-fg outline-none placeholder:text-fg-muted"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {sections.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-fg-muted">
              {authenticatedSet.size === 0 ? t("model.noneAuth") : t("model.noneMatch")}
            </div>
          )}
          {recents.length > 0 && (
            <div className="mb-0.5">
              <div className="px-2 pb-0.5 pt-1.5 text-[11px] font-medium text-fg-muted">最近</div>
              {recents.map((m) => (
                <ModelRow
                  key={`recent:${modelKey(m)}`}
                  model={m}
                  providerLabel={providers.find((p) => p.id === m.provider)?.name ?? m.provider}
                  active={
                    !!usableModel &&
                    m.provider === usableModel.provider &&
                    m.id === usableModel.id
                  }
                  onSelect={pick}
                  effort={thinkingFor?.(m)}
                  onOpenOptions={onThinkingLevel ? openOptions : undefined}
                  optionsOpen={!!options && modelKey(options.model) === modelKey(m)}
                />
              ))}
            </div>
          )}
          {(sections.length > 1 || sections.some((s) => s.nested)) && (
            <div className="px-2 pb-0.5 pt-1.5 text-[11px] font-medium text-fg-muted">
              {sections.length > 1 ? t("model.providers") : t("model.vendors")}
            </div>
          )}
          {sections.map((section) => {
            const providerKey = `p:${section.provider}`;
            const providerFoldable = sections.length > 1 && !searching;
            const providerOpen = !providerFoldable || expanded.has(providerKey);
            const modelCount = section.groups.reduce((n, g) => n + g.models.length, 0);
            return (
              <div key={section.provider}>
                {sections.length > 1 ? (
                  <FolderRow
                    label={section.label}
                    count={modelCount}
                    open={providerOpen}
                    foldable={providerFoldable}
                    onToggle={() => toggle(providerKey)}
                  />
                ) : (
                  !section.nested && (
                    <div className="flex items-center gap-1.5 px-2 pb-0.5 pt-2 text-[11px] font-medium uppercase tracking-wide text-fg-muted">
                      {section.label}
                    </div>
                  )
                )}
                {providerOpen && (
                  <div className={sections.length > 1 ? "pl-3" : undefined}>
                    {section.groups.map((group) => {
                      const foldable = section.nested && !searching;
                      const openGroup = !foldable || expanded.has(group.key);
                      return (
                        <div key={group.key}>
                          {section.nested && (
                            <FolderRow
                              label={group.label}
                              count={group.models.length}
                              open={openGroup}
                              foldable={foldable}
                              onToggle={() => toggle(group.key)}
                            />
                          )}
                          {openGroup && (
                            <div className={section.nested ? "pl-3" : undefined}>
                              {group.models.map((m) => (
                                <ModelRow
                                  key={modelKey(m)}
                                  model={m}
                                  active={
                                    !!usableModel &&
                                    m.provider === usableModel.provider &&
                                    m.id === usableModel.id
                                  }
                                  onSelect={pick}
                                  effort={thinkingFor?.(m)}
                                  onOpenOptions={onThinkingLevel ? openOptions : undefined}
                                  optionsOpen={!!options && modelKey(options.model) === modelKey(m)}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>,
      document.body,
    );

  const optionsLevel = options && thinkingFor ? thinkingFor(options.model) : "off";
  const optionsOn = optionsLevel !== "off";

  const optionsPanel =
    open &&
    pos &&
    options &&
    onThinkingLevel &&
    createPortal(
      <div
        ref={optionsRef}
        style={{
          top: Math.min(
            Math.max(VIEWPORT_PAD, options.top - 8),
            Math.max(VIEWPORT_PAD, window.innerHeight - 300 - VIEWPORT_PAD),
          ),
          left:
            pos.left + DROPDOWN_WIDTH + GAP + OPTIONS_WIDTH + VIEWPORT_PAD <= window.innerWidth
              ? pos.left + DROPDOWN_WIDTH + GAP
              : Math.max(VIEWPORT_PAD, pos.left - OPTIONS_WIDTH - GAP),
          width: OPTIONS_WIDTH,
        }}
        className="dialog-in fixed z-50 overflow-hidden rounded-xl border border-border-strong bg-bg shadow-2xl"
      >
        <div className="px-3 pb-1.5 pt-2">
          <div className="text-[11px] font-medium text-fg">Edit</div>
          <div className="truncate text-[10.5px] text-fg-muted">{options.model.name}</div>
        </div>
        <div className="p-1">
          <button
            type="button"
            onClick={() =>
              setEffort(
                options.model,
                optionsOn ? "off" : (lastEffort.current[modelKey(options.model)] ?? DEFAULT_EFFORT),
              )
            }
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-fg transition-colors hover:bg-bg-hover"
          >
            <span className="min-w-0 flex-1">思考</span>
            <Switch on={optionsOn} />
          </button>
        </div>
        <div className={cn("p-1", !optionsOn && "opacity-40")}>
          <div className="px-2 pb-0.5 pt-1 text-[10.5px] font-medium text-fg-muted">强度</div>
          {THINKING_EFFORTS.map((l) => (
            <button
              key={l}
              type="button"
              disabled={!optionsOn}
              onClick={() => setEffort(options.model, l)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                l === optionsLevel ? "text-accent" : "text-fg-secondary",
                optionsOn ? "hover:bg-bg-hover" : "cursor-not-allowed",
              )}
            >
              <span className="min-w-0 flex-1">{thinkingLabel(t, l)}</span>
              {l === optionsLevel && <Check size={13} className="shrink-0" />}
            </button>
          ))}
        </div>
      </div>,
      document.body,
    );

  return (
    <div ref={ref} className="relative">
      {!hideTrigger && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-fg-secondary transition-colors hover:bg-bg-hover",
            disabled && "cursor-not-allowed opacity-50",
          )}
        >
          <Cpu size={13} />
          <span className="max-w-44 truncate">{usableModel ? usableModel.name : t("model.select")}</span>
          {usableModel?.reasoning && triggerEffort && triggerEffort !== "off" && (
            <span className="text-fg-muted">{thinkingLabel(t, triggerEffort)}</span>
          )}
          <ChevronDown size={12} className="text-fg-muted" />
        </button>
      )}
      {dropdown}
      {optionsPanel}
    </div>
  );
}
