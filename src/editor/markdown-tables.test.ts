import { history, redo, undo } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, type Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { renderMarkdownPreview } from "../markdown/renderer";
import { markdownLivePreview, markdownTableDecorations } from "./markdown-live-preview";
import { MAX_TABLE_CHARS, MAX_TABLE_DOCUMENT_CHARS, MAX_TABLE_LINES, markdownTableRanges, replaceableMarkdownTables } from "./markdown-tables";

const table = "| Left | Center | Right |\n| :--- | :---: | ---: |\n| **bold** | `code` | a\\|b |";
function stateFor(doc = `intro\n\n${table}\n\noutro\n`) {
  return EditorState.create({ doc, extensions: [history(), markdown({ base: markdownLanguage }), EditorState.allowMultipleSelections.of(true), markdownLivePreview()] });
}
function blocks(state: EditorState) {
  const result: { from: number; to: number; block: boolean }[] = [];
  state.field(markdownTableDecorations).decorations.between(0, state.doc.length, (from, to, value) => {
    result.push({ from, to, block: value.spec.block });
  });
  return result;
}

describe("Markdown table source ranges and direct block decorations", () => {
  it("locates real GFM tables including escaped pipes, excluding fences and invalid separators", () => {
    const doc = `intro\n\n\`\`\`md\n${table}\n\`\`\`\n\n| fake | table |\n| no | delimiter |\n\n${table}\n`;
    const state = stateFor(doc);
    expect(markdownTableRanges(state)).toEqual([{ from: doc.lastIndexOf(table), to: doc.lastIndexOf(table) + table.length }]);
    expect(blocks(state)).toEqual([{ from: doc.lastIndexOf(table), to: doc.lastIndexOf(table) + table.length, block: true }]);
  });

  it("reveals the entire source for every selection, including boundary cursors and multi-range spans", () => {
    const initial = stateFor(`intro\n\n${table}\n\nbetween\n\n${table}\n\noutro`);
    const ranges = markdownTableRanges(initial);
    expect(blocks(initial)).toHaveLength(2);
    for (const anchor of [ranges[0]!.from, ranges[0]!.to, ranges[0]!.from + 30]) {
      expect(blocks(initial.update({ selection: { anchor } }).state)).toHaveLength(1);
    }
    const selected = initial.update({ selection: EditorSelection.create(ranges.map((range) => EditorSelection.cursor(range.from))) }).state;
    expect(replaceableMarkdownTables(selected)).toEqual([]);
    expect(blocks(selected)).toEqual([]);
    expect(blocks(selected.update({ selection: { anchor: 0 } }).state)).toHaveLength(2);
    const spanning = initial.update({ selection: { anchor: 0, head: initial.doc.length } }).state;
    expect(blocks(spanning)).toEqual([]);
    expect(spanning.doc.toString()).toBe(initial.doc.toString());
  });

  it("updates ranges after edits without changing any source or adding replacement transactions", () => {
    const initial = stateFor();
    const changed = initial.update({ changes: { from: 0, insert: "prefix\n" } }).state;
    expect(blocks(changed)[0]!.from).toBe(blocks(initial)[0]!.from + 7);
    expect(changed.doc.toString()).toBe(`prefix\n${initial.doc.toString()}`);
    const tableStart = markdownTableRanges(changed)[0]!.from;
    const editing = changed.update({ selection: { anchor: tableStart }, changes: { from: tableStart + 2, to: tableStart + 6, insert: "中文" } }).state;
    expect(blocks(editing)).toEqual([]);
    const restored = editing.update({ selection: { anchor: 0 } }).state;
    expect(blocks(restored)).toHaveLength(1);
    expect(restored.doc.toString()).toBe(editing.doc.toString());
  });

  it("keeps source edits in the same undo history across source reveal and preview", () => {
    const original = stateFor();
    const from = markdownTableRanges(original)[0]!.from;
    let state = original.update({ selection: { anchor: from + 2 } }).state;
    state = state.update({ changes: { from: from + 2, insert: "new " } }).state;
    const edited = state.doc.toString();
    state = state.update({ selection: { anchor: 0 } }).state;
    const target = { get state() { return state; }, dispatch: (transaction: Transaction) => { state = transaction.state; } };
    expect(undo(target)).toBe(true);
    expect(state.doc.toString()).toBe(original.doc.toString());
    expect(redo(target)).toBe(true);
    expect(state.doc.toString()).toBe(edited);
  });

  it("keeps nested tables as source instead of consuming quote/list prefixes", () => {
    expect(markdownTableRanges(stateFor(`intro\n\n${table.split("\n").map((line) => `> ${line}`).join("\n")}\n`))).toEqual([]);
  });

  it("enforces document and individual table work limits", () => {
    const prefix = `intro\n\n${table}\n\n`;
    const exact = stateFor(prefix + "x".repeat(MAX_TABLE_DOCUMENT_CHARS - prefix.length));
    expect(markdownTableRanges(exact)).toHaveLength(1);
    expect(markdownTableRanges(stateFor(exact.doc.toString() + "x"))).toEqual([]);
    expect(markdownTableRanges(stateFor(`intro\n\n| a |\n| --- |\n| ${"x".repeat(MAX_TABLE_CHARS)} |`))).toEqual([]);
    expect(markdownTableRanges(stateFor(`intro\n\n| a |\n| --- |\n${"| x |\n".repeat(MAX_TABLE_LINES)}`))).toEqual([]);
  });

  it("uses safe rendering with alignment, inline formatting and no active resources", () => {
    const html = renderMarkdownPreview(`${table}\n| <img src=x onerror=alert(1)> | ![pic](https://example.com/x.png) | [bad](javascript:alert(1)) |`);
    expect(html).toContain('<table>');
    expect(html).toContain('align="left"');
    expect(html).toContain('align="center"');
    expect(html).toContain('align="right"');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('a|b');
    expect(html).toContain('&lt;img');
    expect(html).toContain('markdown-image-placeholder');
    expect(html).not.toMatch(/<(?:img|a|script)\b/);
    expect(html).not.toContain('href=');
  });
});
