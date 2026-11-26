import { EditorSelection, type EditorState, type SelectionRange, type Text, type TransactionSpec } from "@codemirror/state";

export type MarkdownFormatAction =
  | "bold"
  | "italic"
  | "strikethrough"
  | "inlineCode"
  | "heading1"
  | "heading2"
  | "blockquote"
  | "unorderedList"
  | "orderedList"
  | "horizontalRule"
  | "codeBlock"
  | "link"
  | "image"
  | "table";

export interface MarkdownFormatOptions {
  tableRows?: number;
  tableColumns?: number;
}

interface RangeChange {
  changes: { from: number; to?: number; insert: string } | readonly { from: number; to?: number; insert: string }[];
  range: SelectionRange;
}

function orientedRange(original: SelectionRange, from: number, to: number): SelectionRange {
  return original.anchor <= original.head ? EditorSelection.range(from, to) : EditorSelection.range(to, from);
}

function wrap(doc: Text, range: SelectionRange, left: string, right: string): RangeChange {
  const selected = doc.sliceString(range.from, range.to);
  if (!selected) {
    const insert = `${left}${right}`;
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(range.from + left.length) };
  }
  const insert = `${left}${selected}${right}`;
  return {
    changes: { from: range.from, to: range.to, insert },
    range: orientedRange(range, range.from + left.length, range.from + left.length + selected.length),
  };
}

function template(range: SelectionRange, insert: string, selectFrom: number, selectTo: number): RangeChange {
  return {
    changes: { from: range.from, to: range.to, insert },
    range: EditorSelection.range(range.from + selectFrom, range.from + selectTo),
  };
}

function inlineCode(doc: Text, range: SelectionRange): RangeChange {
  const selected = doc.sliceString(range.from, range.to);
  if (!selected) return wrap(doc, range, "`", "`");
  const longest = Math.max(0, ...Array.from(selected.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(Math.max(1, longest + 1));
  const pad = /^`|`$|^\s|\s$/.test(selected) ? " " : "";
  const left = `${fence}${pad}`;
  const right = `${pad}${fence}`;
  return wrap(doc, range, left, right);
}

function selectedLineSpan(doc: Text, range: SelectionRange): { from: number; to: number } {
  const fromLine = doc.lineAt(range.from);
  const inclusiveTo = range.to > range.from && range.to === doc.lineAt(range.to).from ? range.to - 1 : range.to;
  const toLine = doc.lineAt(Math.max(range.from, inclusiveTo));
  return { from: fromLine.from, to: toLine.to };
}

function lineFormat(doc: Text, range: SelectionRange, transform: (line: string, index: number) => string): RangeChange {
  const span = selectedLineSpan(doc, range);
  const source = doc.sliceString(span.from, span.to);
  const insert = source.split("\n").map(transform).join("\n");
  const nextRange = range.empty
    ? EditorSelection.cursor(span.from + insert.length)
    : orientedRange(range, span.from, span.from + insert.length);
  return { changes: insert === source ? [] : { from: span.from, to: span.to, insert }, range: nextRange };
}

function heading(level: 1 | 2): (line: string) => string {
  const marker = "#".repeat(level);
  return (line) => {
    if (!line.trim()) return `${marker} `;
    const match = /^(\s{0,3})(?:#{1,6}[ \t]+)?(.*)$/.exec(line);
    return `${match?.[1] ?? ""}${marker} ${match?.[2] ?? line}`;
  };
}

function blockquote(line: string): string {
  if (!line.trim()) return "> ";
  const match = /^(\s{0,3})(?:>[ \t]?)?(.*)$/.exec(line);
  return `${match?.[1] ?? ""}> ${match?.[2] ?? line}`;
}

function unorderedList(line: string): string {
  if (!line.trim()) return "- ";
  const match = /^(\s*)(?:(?:[-+*]|\d+[.)])[ \t]+)?(.*)$/.exec(line);
  return `${match?.[1] ?? ""}- ${match?.[2] ?? line}`;
}

function orderedList(line: string, number: number): string {
  if (!line.trim()) return `${number}. `;
  const match = /^(\s*)(?:(?:[-+*]|\d+[.)])[ \t]+)?(.*)$/.exec(line);
  return `${match?.[1] ?? ""}${number}. ${match?.[2] ?? line}`;
}

function longestBacktickRun(text: string): number {
  return Math.max(0, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
}

function codeBlock(doc: Text, range: SelectionRange): RangeChange {
  const selected = doc.sliceString(range.from, range.to);
  const fence = "`".repeat(Math.max(3, longestBacktickRun(selected) + 1));
  if (!selected) {
    const insert = `${fence}\n\n${fence}`;
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(range.from + fence.length + 1) };
  }
  const suffix = selected.endsWith("\n") ? "" : "\n";
  const insert = `${fence}\n${selected}${suffix}${fence}`;
  return {
    changes: { from: range.from, to: range.to, insert },
    range: orientedRange(range, range.from + fence.length + 1, range.from + fence.length + 1 + selected.length),
  };
}

function blockSpacing(doc: Text, position: number): { before: string; after: string } {
  const beforeText = doc.sliceString(Math.max(0, position - 2), position);
  const afterText = doc.sliceString(position, Math.min(doc.length, position + 2));
  return {
    before: position === 0 || beforeText.endsWith("\n\n") ? "" : beforeText.endsWith("\n") ? "\n" : "\n\n",
    after: position === doc.length || afterText.startsWith("\n\n") ? "" : afterText.startsWith("\n") ? "\n" : "\n\n",
  };
}

function insertBlock(doc: Text, range: SelectionRange, content: string, selection: { from: number; to: number }): RangeChange {
  const position = range.empty ? doc.lineAt(range.head).from : range.from;
  const spacing = blockSpacing(doc, position);
  const insert = `${spacing.before}${content}${spacing.after}`;
  return {
    changes: { from: position, insert },
    range: EditorSelection.range(position + spacing.before.length + selection.from, position + spacing.before.length + selection.to),
  };
}

export function buildGfmTable(rows = 2, columns = 2): { markdown: string; firstHeader: { from: number; to: number } } {
  const rowCount = Math.max(1, Math.min(10, Math.trunc(rows) || 1));
  const columnCount = Math.max(1, Math.min(8, Math.trunc(columns) || 1));
  const headers = Array.from({ length: columnCount }, (_, index) => `列 ${index + 1}`);
  const header = `| ${headers.join(" | ")} |`;
  const separator = `| ${Array.from({ length: columnCount }, () => "---").join(" | ")} |`;
  const body = Array.from({ length: rowCount }, () => `| ${Array.from({ length: columnCount }, () => " ").join(" | ")} |`);
  return { markdown: [header, separator, ...body].join("\n"), firstHeader: { from: 2, to: 2 + headers[0].length } };
}

function formatRange(doc: Text, range: SelectionRange, action: MarkdownFormatAction, options: MarkdownFormatOptions): RangeChange {
  switch (action) {
    case "bold": return wrap(doc, range, "**", "**");
    case "italic": return wrap(doc, range, "*", "*");
    case "strikethrough": return wrap(doc, range, "~~", "~~");
    case "inlineCode": return inlineCode(doc, range);
    case "heading1": return lineFormat(doc, range, (line) => !line.trim() && !range.empty ? line : heading(1)(line));
    case "heading2": return lineFormat(doc, range, (line) => !line.trim() && !range.empty ? line : heading(2)(line));
    case "blockquote": return lineFormat(doc, range, (line) => !line.trim() && !range.empty ? line : blockquote(line));
    case "unorderedList": return lineFormat(doc, range, (line) => !line.trim() && !range.empty ? line : unorderedList(line));
    case "orderedList": {
      let number = 0;
      return lineFormat(doc, range, (line) => !line.trim() && !range.empty ? line : orderedList(line, ++number));
    }
    case "codeBlock": return codeBlock(doc, range);
    case "link": {
      const selected = doc.sliceString(range.from, range.to);
      if (selected) return template(range, `[${selected}](https://)`, selected.length + 3, selected.length + 11);
      return template(range, "[链接文字](https://)", 1, 5);
    }
    case "image": {
      const selected = doc.sliceString(range.from, range.to);
      if (selected) return template(range, `![${selected}](路径)`, selected.length + 4, selected.length + 6);
      return template(range, "![图片说明](路径)", 2, 6);
    }
    case "horizontalRule": return insertBlock(doc, range, "---", { from: 3, to: 3 });
    case "table": {
      const table = buildGfmTable(options.tableRows, options.tableColumns);
      return insertBlock(doc, range, table.markdown, table.firstHeader);
    }
  }
}

export function markdownFormatTransaction(state: EditorState, action: MarkdownFormatAction, options: MarkdownFormatOptions = {}): TransactionSpec {
  return state.changeByRange((range) => formatRange(state.doc, range, action, options));
}
