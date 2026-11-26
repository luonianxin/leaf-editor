import { history, undo } from "@codemirror/commands";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { buildGfmTable, markdownFormatTransaction, type MarkdownFormatAction, type MarkdownFormatOptions } from "./markdown-formatting";

function apply(doc: string, action: MarkdownFormatAction, selection = EditorSelection.cursor(0), options: MarkdownFormatOptions = {}): EditorState {
  const state = EditorState.create({ doc, selection });
  return state.update(markdownFormatTransaction(state, action, options)).state;
}

describe("Markdown formatting transactions", () => {
  it("wraps Unicode selections and places an empty cursor inside inline templates", () => {
    const bold = apply("中文", "bold", EditorSelection.range(0, 2));
    expect(bold.doc.toString()).toBe("**中文**");
    expect(bold.selection.main).toMatchObject({ anchor: 2, head: 4 });

    const empty = apply("", "bold");
    expect(empty.doc.toString()).toBe("****");
    expect(empty.selection.main.head).toBe(2);

    expect(apply("Leaf", "italic", EditorSelection.range(0, 4)).doc.toString()).toBe("*Leaf*");
    expect(apply("Leaf", "strikethrough", EditorSelection.range(0, 4)).doc.toString()).toBe("~~Leaf~~");

    const code = apply("a`b", "inlineCode", EditorSelection.range(0, 3));
    expect(code.doc.toString()).toBe("``a`b``");
    expect(code.sliceDoc(code.selection.main.from, code.selection.main.to)).toBe("a`b");
  });

  it("formats complete selected lines without filling blank lines", () => {
    const heading = apply("alpha\n\nbeta", "heading1", EditorSelection.range(1, 11));
    expect(heading.doc.toString()).toBe("# alpha\n\n# beta");
    expect(apply("title", "heading2", EditorSelection.cursor(2)).doc.toString()).toBe("## title");

    const ordered = apply("alpha\n\nbeta", "orderedList", EditorSelection.range(0, 11));
    expect(ordered.doc.toString()).toBe("1. alpha\n\n2. beta");

    const unordered = apply("1. alpha\n  + beta", "unorderedList", EditorSelection.range(0, 17));
    expect(unordered.doc.toString()).toBe("- alpha\n  - beta");
  });

  it("replaces heading levels idempotently and prefixes quotations", () => {
    const heading = apply("## Existing", "heading1", EditorSelection.cursor(5));
    expect(heading.doc.toString()).toBe("# Existing");
    const unchanged = heading.update(markdownFormatTransaction(heading, "heading1"));
    expect(unchanged.docChanged).toBe(false);

    const quote = apply("first\nsecond", "blockquote", EditorSelection.range(0, 12));
    expect(quote.doc.toString()).toBe("> first\n> second");
  });

  it("creates editable link and image syntax without navigating or loading resources", () => {
    const link = apply("Leaf", "link", EditorSelection.range(0, 4));
    expect(link.doc.toString()).toBe("[Leaf](https://)");
    expect(link.sliceDoc(link.selection.main.from, link.selection.main.to)).toBe("https://");

    const image = apply("", "image");
    expect(image.doc.toString()).toBe("![图片说明](路径)");
    expect(image.sliceDoc(image.selection.main.from, image.selection.main.to)).toBe("图片说明");
  });

  it("inserts separated horizontal rules and bounded GFM table templates", () => {
    const rule = apply("before\nafter", "horizontalRule", EditorSelection.cursor(9));
    expect(rule.doc.toString()).toBe("before\n\n---\n\nafter");

    const table = apply("", "table", EditorSelection.cursor(0), { tableRows: 2, tableColumns: 3 });
    expect(table.doc.toString()).toBe("| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n|   |   |   |\n|   |   |   |");
    expect(table.sliceDoc(table.selection.main.from, table.selection.main.to)).toBe("列 1");

    expect(buildGfmTable(99, 99).markdown.split("\n")).toHaveLength(12);
  });

  it("uses a longer fence for selected code containing backticks", () => {
    const code = apply("const fence = ```;", "codeBlock", EditorSelection.range(0, 18));
    expect(code.doc.toString()).toBe("````\nconst fence = ```;\n````");
    expect(code.sliceDoc(code.selection.main.from, code.selection.main.to)).toBe("const fence = ```;");
  });

  it("formats multiple selections in one transaction and remains one-step undoable", () => {
    let state = EditorState.create({
      doc: "one two",
      selection: EditorSelection.create([EditorSelection.range(0, 3), EditorSelection.range(4, 7)]),
      extensions: [EditorState.allowMultipleSelections.of(true), history()],
    });
    const transaction = state.update({
      ...markdownFormatTransaction(state, "bold"),
      annotations: Transaction.userEvent.of("input.format"),
    });
    state = transaction.state;
    expect(state.doc.toString()).toBe("**one** **two**");

    expect(undo({ state, dispatch: (next) => { state = next.state; } })).toBe(true);
    expect(state.doc.toString()).toBe("one two");
  });
});
