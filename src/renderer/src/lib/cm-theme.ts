/**
 * CodeMirror 6 主题：运行时读应用 CSS 变量，随 data-theme 切换。
 */
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function watchTheme(apply: () => void): () => void {
  const observer = new MutationObserver(apply);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

export function createCmTheme(): Extension {
  const bg = cssVar("--t-bg-secondary") || "#262521";
  const fg = cssVar("--t-fg") || "#ede8de";
  const muted = cssVar("--t-fg-muted") || "#837d70";
  const secondary = cssVar("--t-fg-secondary") || "#b8b2a5";
  const hover = cssVar("--t-bg-hover") || "#383630";
  const tertiary = cssVar("--t-bg-tertiary") || "#2e2c27";
  const accent = cssVar("--t-accent") || "#d97757";
  const success = cssVar("--t-success") || "#5fbf82";
  const warning = cssVar("--t-warning") || "#d9a854";
  const info = cssVar("--t-info") || "#7da7c9";
  const danger = cssVar("--t-danger") || "#e5766b";
  const border = cssVar("--t-border") || "#3a3831";

  const highlight = HighlightStyle.define([
    { tag: t.comment, color: muted, fontStyle: "italic" },
    { tag: t.lineComment, color: muted, fontStyle: "italic" },
    { tag: t.keyword, color: accent },
    { tag: t.controlKeyword, color: accent },
    { tag: t.definitionKeyword, color: accent },
    { tag: t.operatorKeyword, color: accent },
    { tag: t.string, color: success },
    { tag: t.special(t.string), color: success },
    { tag: t.number, color: warning },
    { tag: t.bool, color: warning },
    { tag: t.null, color: warning },
    { tag: t.atom, color: warning },
    { tag: t.name, color: fg },
    { tag: t.variableName, color: fg },
    { tag: t.propertyName, color: info },
    { tag: t.attributeName, color: info },
    { tag: t.typeName, color: info },
    { tag: t.className, color: info },
    { tag: t.namespace, color: info },
    { tag: t.heading, color: fg, fontWeight: "600" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strong, fontWeight: "600" },
    { tag: t.link, color: info },
    { tag: t.url, color: info },
    { tag: t.meta, color: muted },
    { tag: t.processingInstruction, color: muted },
    { tag: t.invalid, color: danger },
    { tag: t.tagName, color: accent },
    { tag: t.angleBracket, color: muted },
    { tag: t.punctuation, color: secondary },
    { tag: t.operator, color: secondary },
    { tag: t.separator, color: secondary },
    { tag: t.bracket, color: secondary },
    { tag: t.function(t.variableName), color: info },
    { tag: t.definition(t.variableName), color: fg },
  ]);

  const theme = EditorView.theme(
    {
      "&": {
        height: "100%",
        backgroundColor: bg,
        color: fg,
        fontSize: "12px",
      },
      "&.cm-focused": { outline: "none" },
      ".cm-scroller": {
        fontFamily: '"SF Mono", ui-monospace, Menlo, Consolas, monospace',
        lineHeight: "1.55",
        overflow: "auto",
      },
      ".cm-content": { caretColor: accent },
      ".cm-gutters": {
        backgroundColor: bg,
        color: muted,
        border: "none",
      },
      ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 10px" },
      ".cm-activeLine": { backgroundColor: hover },
      ".cm-activeLineGutter": { backgroundColor: hover, color: secondary },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
        backgroundColor: hover,
      },
      ".cm-cursor": { borderLeftColor: accent },
      ".cm-panels": { backgroundColor: tertiary, color: fg },
      ".cm-panels.cm-panels-top": { borderBottom: `1px solid ${border}` },
      ".cm-searchMatch": { backgroundColor: `${warning}44` },
      ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: `${accent}66` },
      ".cm-foldPlaceholder": {
        backgroundColor: tertiary,
        border: "none",
        color: muted,
      },
      ".cm-deletedChunk": {
        paddingLeft: "0",
        backgroundColor: "transparent",
      },
      ".cm-deletedLine": {
        display: "block",
        backgroundColor: cssVar("--t-diff-del") || "#3d2225",
        color: cssVar("--t-diff-del-fg") || "#f0a8ac",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        paddingLeft: "16px",
        textIndent: "-12px",
      },
      ".cm-deletedLine::before": {
        content: '"-"',
        display: "inline-block",
        width: "12px",
        color: cssVar("--t-diff-del-fg") || "#f0a8ac",
      },
      ".cm-deletedLine del, .cm-insertedLine": {
        textDecoration: "none",
      },
      "&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine": {
        backgroundColor: cssVar("--t-diff-add") || "#203527",
        color: cssVar("--t-diff-add-fg") || "#8fdcab",
        paddingLeft: "16px",
      },
      "&.cm-merge-b .cm-changedLine::before": {
        content: '"+"',
        display: "inline-block",
        width: "12px",
        marginLeft: "-12px",
        color: cssVar("--t-diff-add-fg") || "#8fdcab",
      },
      "&.cm-merge-b .cm-changedText, .cm-deletedChunk .cm-deletedText": {
        background: "none",
      },
      ".cm-collapsedLines": {
        color: muted,
        background: `linear-gradient(to bottom, transparent 0, ${tertiary} 30%, ${tertiary} 70%, transparent 100%)`,
      },
      ".cm-changedLineGutter": { backgroundColor: success },
      ".cm-deletedLineGutter": { backgroundColor: danger },
    },
    { dark: document.documentElement.dataset.theme !== "light" },
  );

  return [theme, syntaxHighlighting(highlight)];
}
