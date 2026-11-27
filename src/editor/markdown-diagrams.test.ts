import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  MAX_MERMAID_CHARS,
  MAX_MERMAID_DOCUMENT_CHARS,
  MAX_MERMAID_LINES,
  mermaidDiagramRanges,
  replaceableMermaidDiagrams,
} from "./markdown-diagrams";

function stateFor(doc: string, anchor = 0): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: Math.min(anchor, doc.length) },
    extensions: [markdown({ base: markdownLanguage })],
  });
}

describe("Mermaid fenced diagram ranges", () => {
  it("finds standalone Mermaid fences and keeps their exact source", () => {
    const source = "sequenceDiagram\n  A->>B: 你好";
    const doc = `before\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\nafter`;
    const range = mermaidDiagramRanges(stateFor(doc, doc.length))[0]!;
    expect(range).toEqual({ from: doc.indexOf("```mermaid"), to: doc.lastIndexOf("```") + 3, source });
  });

  it("accepts case-insensitive tilde fences but rejects nested, unclosed and other languages", () => {
    const valid = "~~~MERMAID\ngraph LR\nA-->B\n~~~";
    expect(mermaidDiagramRanges(stateFor(valid, valid.length))).toHaveLength(1);
    expect(mermaidDiagramRanges(stateFor("> ```mermaid\n> graph LR\n> A-->B\n> ```", 40))).toEqual([]);
    expect(mermaidDiagramRanges(stateFor("```mermaid\ngraph LR\nA-->B", 28))).toEqual([]);
    expect(mermaidDiagramRanges(stateFor("```js\ngraph LR\nA-->B\n```", 27))).toEqual([]);
  });

  it("reveals source whenever a selection touches the diagram", () => {
    const doc = "intro\n\n```mermaid\ngraph LR\nA-->B\n```\n\noutro";
    const range = mermaidDiagramRanges(stateFor(doc, doc.length))[0]!;
    expect(replaceableMermaidDiagrams(stateFor(doc, 0))).toHaveLength(1);
    for (const anchor of [range.from, range.from + 15, range.to]) {
      expect(replaceableMermaidDiagrams(stateFor(doc, anchor))).toEqual([]);
    }
  });

  it("keeps oversized diagrams and documents as source", () => {
    const oversized = `\`\`\`mermaid\n${"x".repeat(MAX_MERMAID_CHARS + 1)}\n\`\`\``;
    expect(mermaidDiagramRanges(stateFor(oversized, oversized.length))).toEqual([]);
    const tooManyLines = `\`\`\`mermaid\n${"x\n".repeat(MAX_MERMAID_LINES + 1)}\`\`\``;
    expect(mermaidDiagramRanges(stateFor(tooManyLines, tooManyLines.length))).toEqual([]);
    const prefix = "```mermaid\ngraph LR\nA-->B\n```\n";
    const largeDocument = prefix + "x".repeat(MAX_MERMAID_DOCUMENT_CHARS - prefix.length + 1);
    expect(mermaidDiagramRanges(stateFor(largeDocument, largeDocument.length))).toEqual([]);
  });
});
