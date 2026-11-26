import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { activeLineRanges, imagePlaceholderLabel, rangeTouchesActiveLine } from "./markdown-live-preview";

describe("Markdown live preview helpers", () => {
  it("treats every line touched by cursors and selections as active", () => {
    const state = EditorState.create({
      doc: "first\nsecond\nthird\nfourth",
      selection: EditorSelection.create([
        EditorSelection.range(2, 14),
        EditorSelection.cursor(25),
      ], 1),
      extensions: EditorState.allowMultipleSelections.of(true),
    });

    expect(activeLineRanges(state)).toEqual([
      { from: 0, to: 25 },
    ]);
    expect(rangeTouchesActiveLine(6, 8, activeLineRanges(state))).toBe(true);
    expect(rangeTouchesActiveLine(26, 27, activeLineRanges(state))).toBe(false);
  });

  it("builds a bounded text-only label from image alt text", () => {
    expect(imagePlaceholderLabel("![safe alt](https://example.com/image.png)")).toBe("Image: safe alt");
    expect(imagePlaceholderLabel("![](https://example.com/image.png)")).toBe("Image");
    expect(imagePlaceholderLabel(`![${"a".repeat(100)}](x)`)).toHaveLength(87);
  });
});
