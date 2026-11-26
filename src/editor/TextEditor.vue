<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Compartment, EditorSelection, EditorState, Transaction, type Extension } from "@codemirror/state";
import { EditorView, crosshairCursor, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, rectangularSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from "@codemirror/commands";
import { HighlightStyle, bracketMatching, defaultHighlightStyle, foldGutter, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { closeSearchPanel, highlightSelectionMatches, openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { tags } from "@lezer/highlight";
import type { DocumentTab } from "../core/types";
import { loadLanguage, type LanguageId } from "./languages";
import { markdownLivePreview } from "./markdown-live-preview";

const props = withDefaults(defineProps<{ document: DocumentTab; documentIds: string[]; language: LanguageId; dark: boolean; wrap: boolean; fontSize: number; visualMarkdown?: boolean }>(), { visualMarkdown: false });
const emit = defineEmits<{ change: [id: string, text: string]; cursor: [line: number, column: number, selected: number]; ready: [] }>();
const host = ref<HTMLDivElement>();
const languageComp = new Compartment();
const appearanceComp = new Compartment();
const wrapComp = new Compartment();
const visualMarkdownComp = new Compartment();
const states = new Map<string, { state: EditorState; top: number; left: number }>();
let view: EditorView | undefined;
let currentId = "";
let languageGeneration = 0;
let destroyed = false;

const highlights = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.keyword, color: "var(--syntax-keyword)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--syntax-string)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--syntax-number)" },
  { tag: tags.comment, color: "var(--syntax-comment)", fontStyle: "italic" },
  { tag: [tags.function(tags.variableName), tags.definition(tags.variableName)], color: "var(--syntax-function)" },
  { tag: tags.heading, fontWeight: "600", color: "var(--syntax-keyword)" },
]));

function appearance(): Extension {
  return EditorView.theme({
    "&": { height: "100%", fontSize: `${props.fontSize}px`, color: "var(--color-base-content)", backgroundColor: "var(--color-base-100)" },
    ".cm-scroller": { fontFamily: "'Cascadia Code', 'Consolas', 'SFMono-Regular', monospace", lineHeight: "1.7", overflow: "auto" },
    ".cm-content": { padding: "18px 0", caretColor: "var(--color-primary)" },
    ".cm-line": { paddingLeft: "20px", paddingRight: "24px" },
    ".cm-gutters": { backgroundColor: "var(--editor-gutter)", color: "var(--syntax-comment)", border: "none", minWidth: "52px" },
    ".cm-gutterElement": { padding: "0 10px 0 12px" },
    ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--editor-active-line)" },
    "&.cm-focused": { outline: "none" },
    ".cm-selectionBackground": { backgroundColor: "var(--editor-selection-blurred) !important", borderRadius: "2px" },
    "&.cm-focused .cm-selectionBackground": { backgroundColor: "var(--editor-selection) !important", boxShadow: "inset 0 -1px color-mix(in srgb, var(--color-primary) 40%, transparent)" },
    ".cm-content ::selection": { backgroundColor: "var(--editor-selection)" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-primary)" },
    ".cm-searchMatch": { backgroundColor: "var(--editor-search)" },
    ".cm-searchMatch-selected": { backgroundColor: "var(--editor-selection)", outline: "1px solid var(--color-primary)" },
    ".cm-panels": { backgroundColor: "var(--color-base-200)", color: "var(--color-base-content)" },
    ".cm-panel.cm-search": { padding: "10px 16px", fontSize: "12px" },
    ".cm-textfield": { background: "var(--color-base-100)", border: "1px solid var(--color-base-300)", borderRadius: "5px", padding: "5px 8px", color: "var(--color-base-content)" },
    ".cm-button": { background: "var(--color-base-100)", border: "1px solid var(--color-base-300)", borderRadius: "5px", color: "var(--color-base-content)", padding: "4px 10px", fontSize: "12px", textTransform: "none" },
  }, { dark: props.dark });
}

function reportCursor(): void {
  if (!view) return;
  const selection = view.state.selection.main;
  const line = view.state.doc.lineAt(selection.head);
  emit("cursor", line.number, selection.head - line.from + 1, view.state.selection.ranges.reduce((sum, range) => sum + range.to - range.from, 0));
}

function createState(text: string): EditorState {
  return EditorState.create({
    doc: text,
    extensions: [
      history(), lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(),
      dropCursor(), rectangularSelection(), crosshairCursor(), bracketMatching(), closeBrackets(), indentOnInput(), foldGutter(),
      EditorState.phrases.of({ Find: "查找内容", Replace: "替换为", next: "下一个", previous: "上一个", all: "全部选中", "match case": "区分大小写", regexp: "正则表达式", "by word": "整词匹配", replace: "替换", "replace all": "全部替换", close: "关闭查找", "Go to line": "跳转到行", go: "跳转" }),
      search({ top: true }), highlightSelectionMatches(), syntaxHighlighting(defaultHighlightStyle, { fallback: true }), highlights,
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      languageComp.of([]), appearanceComp.of(appearance()), wrapComp.of(props.wrap ? EditorView.lineWrapping : []),
      visualMarkdownComp.of(props.visualMarkdown && props.language === "markdown" ? markdownLivePreview() : []),
      EditorView.contentAttributes.of({ "aria-label": "文件内容", spellcheck: "false" }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) emit("change", currentId, update.state.doc.toString());
        if (update.selectionSet || update.docChanged) reportCursor();
      }),
    ],
  });
}

function applyVisualMarkdown(): void {
  view?.dispatch({ effects: visualMarkdownComp.reconfigure(props.visualMarkdown && props.language === "markdown" ? markdownLivePreview() : []) });
}

async function applyLanguage(): Promise<void> {
  const generation = ++languageGeneration;
  try {
    // Very large files remain plain text rather than parsing the whole document.
    const extension = props.document.text.length > 2 * 1024 * 1024 ? [] : await loadLanguage(props.language);
    if (destroyed || generation !== languageGeneration || !view) return;
    view.dispatch({ effects: languageComp.reconfigure(extension) });
  } catch (error) { console.warn("Language loading failed; plain text remains available", error); }
}

function activate(): void {
  if (!view) return;
  const document = props.document;
  if (currentId !== document.id) {
    if (currentId) states.set(currentId, { state: view.state, top: view.scrollDOM.scrollTop, left: view.scrollDOM.scrollLeft });
    currentId = document.id;
    const cached = states.get(currentId);
    view.setState(cached?.state ?? createState(document.text));
    view.scrollDOM.scrollTop = cached?.top ?? 0;
    view.scrollDOM.scrollLeft = cached?.left ?? 0;
    view.dispatch({ effects: [
      appearanceComp.reconfigure(appearance()),
      wrapComp.reconfigure(props.wrap ? EditorView.lineWrapping : []),
      visualMarkdownComp.reconfigure(props.visualMarkdown && props.language === "markdown" ? markdownLivePreview() : []),
    ] });
    void applyLanguage();
  }
  const text = view.state.doc.toString();
  if (text !== document.text) {
    // Explicit reload remains undoable. Programmatic updates never mix histories between tabs.
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: document.text }, annotations: Transaction.userEvent.of("input.reload") });
  }
  reportCursor();
}

onMounted(() => {
  if (!host.value) return;
  currentId = props.document.id;
  view = new EditorView({ state: createState(props.document.text), parent: host.value });
  reportCursor();
  void applyLanguage();
  view.focus();
  performance.mark("leaf:editor-ready");
  emit("ready");
});

watch(() => [props.document.id, props.document.text], activate, { flush: "sync" });
watch(() => props.language, () => { void applyLanguage(); applyVisualMarkdown(); });
watch(() => [props.dark, props.fontSize], () => view?.dispatch({ effects: appearanceComp.reconfigure(appearance()) }));
watch(() => props.wrap, () => view?.dispatch({ effects: wrapComp.reconfigure(props.wrap ? EditorView.lineWrapping : []) }));
watch(() => props.visualMarkdown, applyVisualMarkdown);
watch(() => props.documentIds, (ids) => { for (const id of states.keys()) if (!ids.includes(id)) states.delete(id); });
onBeforeUnmount(() => { destroyed = true; languageGeneration += 1; view?.destroy(); states.clear(); });

function goToLine(number: number): void {
  if (!view) return;
  const line = view.state.doc.line(Math.max(1, Math.min(Math.trunc(number), view.state.doc.lines)));
  view.dispatch({ selection: EditorSelection.cursor(line.from), scrollIntoView: true });
  view.focus();
}

defineExpose({
  search: () => view && openSearchPanel(view),
  closeSearch: () => view && closeSearchPanel(view),
  undo: () => view && undo(view),
  redo: () => view && redo(view),
  focus: () => view?.focus(),
  goToLine,
});
</script>

<template>
  <div ref="host" class="h-full min-h-0 w-full" data-testid="editor" />
</template>
