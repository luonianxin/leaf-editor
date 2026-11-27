import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

export const MAX_MERMAID_CHARS = 64 * 1024;
export const MAX_MERMAID_LINES = 400;
export const MAX_MERMAID_DOCUMENT_CHARS = 512 * 1024;

export interface MermaidDiagramRange {
  from: number;
  to: number;
  source: string;
}

export function diagramTouchesSelection(state: EditorState, diagram: MermaidDiagramRange): boolean {
  return state.selection.ranges.some((range) =>
    diagram.from <= state.doc.lineAt(range.to).to && diagram.to > state.doc.lineAt(range.from).from);
}

export function mermaidDiagramRanges(state: EditorState): MermaidDiagramRange[] {
  if (state.doc.length > MAX_MERMAID_DOCUMENT_CHARS) return [];
  const diagrams: MermaidDiagramRange[] = [];

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "FencedCode") return true;
      if (node.node.parent?.name !== "Document") return false;

      const first = state.doc.lineAt(node.from);
      const last = state.doc.lineAt(Math.max(node.from, node.to - 1));
      const opening = /^(?: {0,3})(`{3,}|~{3,})\s*mermaid\s*$/i.exec(first.text);
      if (!opening || last.number <= first.number) return false;

      const fence = opening[1]!;
      const closingPattern = new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`);
      if (!closingPattern.test(last.text) || first.from !== node.from || last.to !== node.to) return false;

      const contentFrom = state.doc.line(first.number + 1).from;
      const contentTo = state.doc.line(last.number - 1).to;
      const source = state.sliceDoc(contentFrom, contentTo);
      if (source.trim() && source.length <= MAX_MERMAID_CHARS && last.number - first.number - 1 <= MAX_MERMAID_LINES) {
        diagrams.push({ from: first.from, to: last.to, source });
      }
      return false;
    },
  });
  return diagrams;
}

export function replaceableMermaidDiagrams(state: EditorState): MermaidDiagramRange[] {
  return mermaidDiagramRanges(state).filter((diagram) => !diagramTouchesSelection(state, diagram));
}
