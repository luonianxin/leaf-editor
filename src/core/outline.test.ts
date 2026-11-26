import { describe, expect, it } from "vitest";
import { buildOutline, MAX_OUTLINE_CHARS } from "./outline";

describe("buildOutline", () => {
  it("extracts Markdown headings but ignores fenced examples", () => {
    expect(buildOutline("# Title\ntext\n```md\n## ignored\n```\n### Details", "markdown")).toEqual([
      { id: "1:heading:Title", label: "Title", line: 1, level: 1, kind: "heading" },
      { id: "6:heading:Details", label: "Details", line: 6, level: 3, kind: "heading" },
    ]);
  });

  it("extracts TypeScript declarations, arrow functions, and indented methods", () => {
    const outline = buildOutline("export class Workspace {\n  async open(path: string) {\n  }\n}\nconst save = async () => {};\ntype Id = string;", "typescript");
    expect(outline.map(({ label, line, level }) => ({ label, line, level }))).toEqual([
      { label: "class Workspace", line: 1, level: 1 },
      { label: "open", line: 2, level: 2 },
      { label: "save", line: 5, level: 1 },
      { label: "type Id", line: 6, level: 1 },
    ]);
  });

  it("keeps JSON and YAML key indentation as outline levels", () => {
    expect(buildOutline('{\n  "editor": {\n    "fontSize": 14\n  }\n}', "json").map((entry) => [entry.label, entry.line, entry.level])).toEqual([
      ["editor", 2, 2], ["fontSize", 3, 3],
    ]);
    expect(buildOutline("server:\n  host: localhost\n  routes:\n    - path: /health", "yaml").map((entry) => [entry.label, entry.line, entry.level])).toEqual([
      ["server", 1, 1], ["host", 2, 2], ["routes", 3, 2], ["path", 4, 3],
    ]);
  });

  it("returns no outline for unsupported or oversized content", () => {
    expect(buildOutline("plain text", "text")).toEqual([]);
    expect(buildOutline("#".repeat(MAX_OUTLINE_CHARS + 1), "markdown")).toEqual([]);
  });
});
