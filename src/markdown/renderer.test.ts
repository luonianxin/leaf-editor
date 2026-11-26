import { describe, expect, it } from "vitest";
import { MAX_MARKDOWN_PREVIEW_CHARS, renderMarkdownPreview } from "./renderer";

describe("renderMarkdownPreview", () => {
  it("renders GFM structure and fenced code from the source", () => {
    const html = renderMarkdownPreview("# Title\n\n- one\n- two\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst answer = 42;\n```");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<table>");
    expect(html).toContain("data-language=\"ts\"");
    expect(html).toContain("const answer = 42;");
  });

  it("escapes raw HTML and never creates an executable element", () => {
    const html = renderMarkdownPreview('<script>alert(1)</script><img src="x" onerror="alert(2)"><iframe src="x"></iframe>');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<iframe");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps only explicit HTTP(S) links and turns images into placeholders", () => {
    const html = renderMarkdownPreview("[safe](https://example.com) [bad](javascript:alert(1)) ![diagram](./diagram.png) ![remote](https://example.com/a.png)");
    expect(html).toContain('class="link" title="https://example.com/（预览中不打开链接）"');
    expect(html).not.toContain("href=");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<img");
    expect(html).toContain("图片：diagram");
    expect(html).toContain("图片：remote");
  });

  it("keeps every link form inert and escapes tooltip attributes", () => {
    const html = renderMarkdownPreview(`[relative](./file.md) [local](file:///C:/secret) [protocol](//example.com) [http](http://example.com 'a " title') <https://example.com>`);
    expect(html).not.toMatch(/<(?:a|img)\b|\s(?:href|target)=/);
    expect(html).not.toContain("file:///C:/secret");
    expect(html).not.toContain("./file.md");
    expect(html).toContain("http://example.com/");
    expect(html).toContain("&quot;");
    expect(html.match(/class="link"/g)).toHaveLength(2);
  });

  it("measures the limit in UTF-16 code units, not bytes or code points", () => {
    expect(() => renderMarkdownPreview("界".repeat(MAX_MARKDOWN_PREVIEW_CHARS))).not.toThrow();
    expect(() => renderMarkdownPreview("😀".repeat(MAX_MARKDOWN_PREVIEW_CHARS / 2))).not.toThrow();
    expect(() => renderMarkdownPreview("😀".repeat(MAX_MARKDOWN_PREVIEW_CHARS / 2) + "x")).toThrow("524,288 个 UTF-16 代码单元");
    expect(() => renderMarkdownPreview("x".repeat(MAX_MARKDOWN_PREVIEW_CHARS + 1))).toThrow("UTF-16");
  });
});
