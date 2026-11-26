import { syntaxTree } from "@codemirror/language";
import { StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { renderMarkdownPreview } from "../markdown/renderer";
import { replaceableMarkdownTables } from "./markdown-tables";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";

export const MARKDOWN_LIVE_PREVIEW_MAX_LENGTH = 512 * 1024;

export interface ActiveLineRange {
  from: number;
  to: number;
}

const hiddenMarkerNodes = new Set([
  "CodeMark",
  "EmphasisMark",
  "HeaderMark",
  "LinkMark",
  "QuoteMark",
  "StrikethroughMark",
]);

export function activeLineRanges(state: EditorState): ActiveLineRange[] {
  const ranges = state.selection.ranges
    .map((selection) => ({
      from: state.doc.lineAt(selection.from).from,
      to: state.doc.lineAt(selection.to).to,
    }))
    .sort((a, b) => a.from - b.from);

  const merged: ActiveLineRange[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.from <= previous.to + 1) previous.to = Math.max(previous.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

export function rangeTouchesActiveLine(from: number, to: number, activeLines: readonly ActiveLineRange[]): boolean {
  return activeLines.some((line) => from <= line.to && to > line.from);
}

export function imagePlaceholderLabel(source: string): string {
  if (!source.startsWith("![")) return "Image";
  let alt = "";
  let escaped = false;
  for (let index = 2; index < source.length; index += 1) {
    const character = source[index];
    if (!escaped && character === "]") break;
    if (!escaped && character === "\\") {
      escaped = true;
      continue;
    }
    alt += character;
    escaped = false;
  }
  const compact = alt.replace(/\s+/g, " ").trim();
  if (!compact) return "Image";
  const shortened = compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
  return `Image: ${shortened}`;
}

class MarkerPlaceholder extends WidgetType {
  constructor(private readonly label: string, private readonly className: string) { super(); }

  override eq(other: WidgetType): boolean {
    return other instanceof MarkerPlaceholder && other.label === this.label && other.className === this.className;
  }

  override toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = this.className;
    element.textContent = this.label;
    element.setAttribute("aria-label", this.label);
    return element;
  }
}

class MarkdownTableWidget extends WidgetType {
  constructor(readonly source: string) { super(); }

  override eq(other: WidgetType): boolean {
    return other instanceof MarkdownTableWidget && other.source === this.source;
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-table-widget";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-md-table-edit";
    button.textContent = "编辑表格源码";
    const scroll = document.createElement("div");
    scroll.className = "cm-md-table-scroll";
    // Only the shared safe renderer creates HTML: images are placeholders,
    // raw HTML is escaped and links have no navigation target.
    scroll.innerHTML = renderMarkdownPreview(this.source);
    wrapper.append(button, scroll);
    wrapper.addEventListener("mousedown", (event) => event.preventDefault());
    wrapper.addEventListener("click", () => {
      if (view.composing) return;
      // DOM identity is resolved against CURRENT state decorations. No captured
      // offsets survive edits, undo, or reuse of an identical table widget.
      const position = view.posAtDOM(wrapper);
      const decorations = view.state.field(markdownTableDecorations).decorations;
      let target: number | undefined;
      decorations.between(position, position, (from, to, decoration) => {
        if (decoration.spec.widget instanceof MarkdownTableWidget && from <= position && to >= position) target = from;
      });
      if (target === undefined) return;
      view.dispatch({ selection: { anchor: target }, scrollIntoView: true });
      view.focus();
    });
    return wrapper;
  }

  override ignoreEvent(): boolean { return true; }
}

const tableComposition = StateEffect.define<boolean>();

function tableDecorationsFor(state: EditorState): DecorationSet {
  return Decoration.set(replaceableMarkdownTables(state).map(({ from, to }) =>
    Decoration.replace({ block: true, widget: new MarkdownTableWidget(state.sliceDoc(from, to)) }).range(from, to)), true);
}

// Block replacements must be provided directly by state, never by ViewPlugin.
export const markdownTableDecorations = StateField.define<{ decorations: DecorationSet; composing: boolean }>({
  create: (state) => ({ decorations: tableDecorationsFor(state), composing: false }),
  update(value, transaction) {
    let composing = value.composing;
    for (const effect of transaction.effects) if (effect.is(tableComposition)) composing = effect.value;
    if (composing) return { composing, decorations: value.decorations.map(transaction.changes) };
    if (value.composing || transaction.docChanged || transaction.selection || transaction.reconfigured ||
        syntaxTree(transaction.startState) !== syntaxTree(transaction.state)) {
      return { composing, decorations: tableDecorationsFor(transaction.state) };
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

const tableCompositionHandlers = ViewPlugin.fromClass(class {
  timer: ReturnType<typeof setTimeout> | undefined;
  destroy(): void { clearTimeout(this.timer); }
}, {
  eventHandlers: {
    compositionstart(_event, view) {
      clearTimeout(this.timer);
      view.dispatch({ effects: tableComposition.of(true) });
    },
    compositionend(_event, view) {
      // Let CodeMirror finish applying the composition before restoring widgets.
      this.timer = setTimeout(() => {
        if (view.state.field(markdownTableDecorations, false)) view.dispatch({ effects: tableComposition.of(false) });
      }, 0);
    },
  },
});

function addLineDecorations(decorations: Range<Decoration>[], state: EditorState, from: number, to: number, className: string): void {
  if (to < from) return;
  let line = state.doc.lineAt(from);
  const lastLine = state.doc.lineAt(Math.max(from, to - 1)).number;
  while (line.number <= lastLine) {
    decorations.push(Decoration.line({ class: className }).range(line.from));
    if (line.number === state.doc.lines) break;
    line = state.doc.line(line.number + 1);
  }
}

function decorationsFor(view: EditorView): DecorationSet {
  const { state } = view;
  if (state.doc.length > MARKDOWN_LIVE_PREVIEW_MAX_LENGTH) return Decoration.none;

  const decorations: Range<Decoration>[] = [];
  const activeLines = activeLineRanges(state);
  const seenNodes = new Set<string>();

  for (const visible of view.visibleRanges) {
    syntaxTree(state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        // A table is either a state-owned block widget or entirely raw source.
        if (node.name === "Table") return false;
        const key = `${node.name}:${node.from}:${node.to}`;
        const repeated = seenNodes.has(key);
        seenNodes.add(key);

        if (node.name === "Blockquote") {
          addLineDecorations(decorations, state, Math.max(node.from, visible.from), Math.min(node.to, visible.to), "cm-md-quote-line");
          return true;
        }
        if (node.name === "FencedCode" || node.name === "CodeBlock") {
          addLineDecorations(decorations, state, Math.max(node.from, visible.from), Math.min(node.to, visible.to), "cm-md-code-line");
          return true;
        }
        // Never descend twice into a replaced image (fragmented visible ranges).
        if (repeated) return node.name !== "Image";

        const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name);
        if (heading) {
          decorations.push(Decoration.line({ class: `cm-md-heading cm-md-heading-${heading[1]}` }).range(state.doc.lineAt(node.from).from));
        } else if (node.name === "StrongEmphasis") {
          decorations.push(Decoration.mark({ class: "cm-md-strong" }).range(node.from, node.to));
        } else if (node.name === "Emphasis") {
          decorations.push(Decoration.mark({ class: "cm-md-emphasis" }).range(node.from, node.to));
        } else if (node.name === "Strikethrough") {
          decorations.push(Decoration.mark({ class: "cm-md-strikethrough" }).range(node.from, node.to));
        } else if (node.name === "InlineCode") {
          decorations.push(Decoration.mark({ class: "cm-md-inline-code" }).range(node.from, node.to));
        } else if (node.name === "Link") {
          decorations.push(Decoration.mark({ class: "cm-md-link" }).range(node.from, node.to));
        } else if (node.name === "URL") {
          decorations.push(Decoration.mark({ class: "cm-md-url" }).range(node.from, node.to));
        } else if (node.name === "Image" && state.doc.lineAt(node.from).number === state.doc.lineAt(node.to).number && !rangeTouchesActiveLine(node.from, node.to, activeLines)) {
          const source = state.sliceDoc(node.from, node.to);
          const label = imagePlaceholderLabel(source);
          decorations.push(Decoration.replace({ widget: new MarkerPlaceholder(label, "cm-md-image-placeholder") }).range(node.from, node.to));
          return false;
        } else if (node.name === "ListMark" && !rangeTouchesActiveLine(node.from, node.to, activeLines)) {
          const marker = state.sliceDoc(node.from, node.to);
          const label = /^\d/.test(marker) ? marker : "•";
          decorations.push(Decoration.replace({ widget: new MarkerPlaceholder(label, "cm-md-list-marker") }).range(node.from, node.to));
        } else if (node.name === "TaskMarker" && !rangeTouchesActiveLine(node.from, node.to, activeLines)) {
          const checked = /x/i.test(state.sliceDoc(node.from, node.to));
          decorations.push(Decoration.replace({ widget: new MarkerPlaceholder(checked ? "☑" : "☐", "cm-md-task-marker") }).range(node.from, node.to));
        } else if (hiddenMarkerNodes.has(node.name) && !rangeTouchesActiveLine(node.from, node.to, activeLines)) {
          decorations.push(Decoration.replace({}).range(node.from, node.to));
        }
        return true;
      },
    });
  }

  return Decoration.set(decorations, true);
}

const markdownDecorations = ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  constructor(view: EditorView) { this.decorations = decorationsFor(view); }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.selectionSet || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
      this.decorations = decorationsFor(update.view);
    }
  }
}, { decorations: (plugin) => plugin.decorations });

const markdownModeAttributes = EditorView.editorAttributes.compute(["doc"], (state) => ({
  class: state.doc.length <= MARKDOWN_LIVE_PREVIEW_MAX_LENGTH ? "cm-md-live-preview" : "",
}));

const markdownTheme = EditorView.theme({
  "&.cm-md-live-preview .cm-content": { fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" },
  ".cm-md-table-widget": { margin: "8px 24px 12px 20px", maxWidth: "calc(100% - 44px)", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", color: "var(--color-base-content)" },
  ".cm-md-table-scroll": { overflowX: "auto", maxWidth: "100%" },
  ".cm-md-table-widget table": { borderCollapse: "collapse", width: "max-content", minWidth: "100%" },
  ".cm-md-table-widget th, .cm-md-table-widget td": { border: "1px solid var(--color-base-300)", padding: "7px 12px", minWidth: "80px" },
  ".cm-md-table-widget th": { backgroundColor: "var(--color-base-200)", fontWeight: "700" },
  ".cm-md-table-widget code": { backgroundColor: "var(--color-base-200)", borderRadius: "3px", padding: "1px 4px" },
  ".cm-md-table-widget .link": { color: "var(--color-primary)", textDecoration: "underline" },
  ".cm-md-table-widget .markdown-image-placeholder": { color: "var(--syntax-comment)" },
  ".cm-md-table-edit": { cursor: "pointer", color: "var(--color-primary)", backgroundColor: "var(--color-base-100)", border: "1px solid var(--color-base-300)", borderRadius: "4px", padding: "2px 8px", marginBottom: "5px", fontSize: "12px" },
  ".cm-md-table-edit:focus-visible": { outline: "2px solid var(--color-primary)", outlineOffset: "2px" },
  ".cm-md-heading": { fontWeight: "700", lineHeight: "1.35", color: "var(--color-base-content)" },
  ".cm-md-heading-1": { fontSize: "1.9em" },
  ".cm-md-heading-2": { fontSize: "1.55em" },
  ".cm-md-heading-3": { fontSize: "1.3em" },
  ".cm-md-heading-4": { fontSize: "1.15em" },
  ".cm-md-heading-5, .cm-md-heading-6": { fontSize: "1.05em" },
  ".cm-md-quote-line": {
    borderLeft: "3px solid var(--color-primary)",
    color: "color-mix(in srgb, var(--color-base-content) 72%, transparent)",
    paddingLeft: "17px",
  },
  ".cm-md-code-line": {
    backgroundColor: "var(--color-base-200)",
    fontFamily: "'Cascadia Code', 'Consolas', 'SFMono-Regular', monospace",
  },
  ".cm-md-inline-code": {
    backgroundColor: "var(--color-base-200)",
    borderRadius: "4px",
    fontFamily: "'Cascadia Code', 'Consolas', 'SFMono-Regular', monospace",
    padding: "0.1em 0.25em",
  },
  ".cm-md-strong": { fontWeight: "700" },
  ".cm-md-emphasis": { fontStyle: "italic" },
  ".cm-md-strikethrough": { textDecoration: "line-through" },
  ".cm-md-link": { color: "var(--color-primary)", textDecoration: "underline", textUnderlineOffset: "2px" },
  ".cm-md-url": { marginLeft: "0.25em", opacity: "0.65", fontFamily: "'Cascadia Code', 'Consolas', monospace", fontSize: "0.9em" },
  ".cm-md-list-marker": { display: "inline-block", minWidth: "1em", color: "var(--color-primary)" },
  ".cm-md-task-marker": { display: "inline-block", minWidth: "1.25em", color: "var(--color-primary)" },
  ".cm-md-image-placeholder": {
    display: "inline-block",
    border: "1px solid var(--color-base-300)",
    borderRadius: "6px",
    backgroundColor: "var(--color-base-200)",
    color: "color-mix(in srgb, var(--color-base-content) 72%, transparent)",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    fontSize: "0.9em",
    padding: "0.1em 0.5em",
  },
});

export function markdownLivePreview(): Extension {
  return [markdownModeAttributes, markdownTableDecorations, tableCompositionHandlers, markdownDecorations, markdownTheme];
}
