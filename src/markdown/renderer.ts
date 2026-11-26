import { Marked, type Tokens } from "marked";

// JavaScript string.length counts UTF-16 code units, not encoded bytes.
export const MAX_MARKDOWN_PREVIEW_CHARS = 512 * 1024;

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeExternalUrl(raw: unknown): string | undefined {
  const value = String(raw ?? "").trim();
  if (!value || /^[\\/]{2}/.test(value) || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function renderInline(renderer: { parser: { parseInline(tokens: Tokens.Generic[]): string } }, tokens: Tokens.Generic[]): string {
  return renderer.parser.parseInline(tokens);
}

function renderBlocks(renderer: { parser: { parse(tokens: Tokens.Generic[]): string } }, tokens: Tokens.Generic[]): string {
  return renderer.parser.parse(tokens);
}

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag): string {
      return escapeHtml(text);
    },
    link({ href, title, tokens }: Tokens.Link): string {
      const label = renderInline(this, tokens);
      const safe = safeExternalUrl(href);
      if (!safe) return label;
      // No anchor or href: middle-click and context menus must also stay inert.
      const tooltip = `${title ? `${title} — ` : ""}${safe}（预览中不打开链接）`;
      return `<span class="link" title="${escapeHtml(tooltip)}">${label}</span>`;
    },
    image({ text }: Tokens.Image): string {
      return `<span class="markdown-image-placeholder" role="img" aria-label="${escapeHtml(text || "图片")}">图片：${escapeHtml(text || "未加载图片")}</span>`;
    },
    code({ text, lang }: Tokens.Code): string {
      const language = lang ? ` data-language="${escapeHtml(lang)}"` : "";
      return `<pre class="markdown-code-block"${language}><code>${escapeHtml(text)}</code></pre>`;
    },
    blockquote({ tokens }: Tokens.Blockquote): string {
      return `<blockquote>${renderBlocks(this, tokens)}</blockquote>`;
    },
  },
});

export function renderMarkdownPreview(source: string): string {
  if (!source.trim()) return "";
  if (source.length > MAX_MARKDOWN_PREVIEW_CHARS) {
    throw new Error("文档超过 524,288 个 UTF-16 代码单元，已暂停实时预览");
  }
  return marked.parse(source) as string;
}
