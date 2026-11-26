import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

// Oversized individual tables stay editable as source. Bounds synchronous Marked
// work even for documents below the global 524,288 UTF-16 code-unit limit.
export const MAX_TABLE_CHARS = 32 * 1024;
export const MAX_TABLE_LINES = 200;
export const MAX_TABLE_DOCUMENT_CHARS = 512 * 1024;

export interface MarkdownTableRange { from: number; to: number }

export function tableTouchesSelection(state: EditorState, table: MarkdownTableRange): boolean {
  return state.selection.ranges.some((range) =>
    table.from <= state.doc.lineAt(range.to).to && table.to > state.doc.lineAt(range.from).from);
}

export function markdownTableRanges(state: EditorState): MarkdownTableRange[] {
  if (state.doc.length > MAX_TABLE_DOCUMENT_CHARS) return [];
  const tables: MarkdownTableRange[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === "FencedCode" || node.name === "CodeBlock" || node.name === "HTMLBlock") return false;
      if (node.name !== "Table") return true;
      // Only replace standalone, whole-line tables. Nested quote/list prefixes
      // must not be swallowed, nor handed to Marked as a different block type.
      const first = state.doc.lineAt(node.from);
      const last = state.doc.lineAt(node.to);
      if (node.node.parent?.name === "Document" &&
          !state.sliceDoc(first.from, node.from).trim() && last.to === node.to &&
          node.to - first.from <= MAX_TABLE_CHARS && last.number - first.number < MAX_TABLE_LINES) {
        tables.push({ from: first.from, to: node.to });
      }
      return false;
    },
  });
  return tables;
}

export function replaceableMarkdownTables(state: EditorState): MarkdownTableRange[] {
  return markdownTableRanges(state).filter((table) => !tableTouchesSelection(state, table));
}
