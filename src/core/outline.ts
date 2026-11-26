import type { LanguageId } from "../editor/languages";

export type OutlineKind = "heading" | "symbol" | "key" | "element" | "database";

export interface OutlineItem {
  id: string;
  label: string;
  line: number;
  level: number;
  kind: OutlineKind;
}

export const MAX_OUTLINE_CHARS = 2 * 1024 * 1024;
const MAX_OUTLINE_ITEMS = 500;

function item(label: string, line: number, level: number, kind: OutlineKind): OutlineItem {
  return { id: `${line}:${kind}:${label}`, label: label.trim(), line, level: Math.max(1, Math.min(level, 8)), kind };
}

function markdownOutline(lines: string[]): OutlineItem[] {
  const result: OutlineItem[] = [];
  let fenced = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) result.push(item(match[2], index + 1, match[1].length, "heading"));
  }
  return result;
}

function scriptOutline(lines: string[]): OutlineItem[] {
  const result: OutlineItem[] = [];
  const reserved = new Set(["if", "for", "while", "switch", "catch", "with"]);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const declaration = /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?(class|interface|enum|function|type)\s+([$A-Z_a-z][$\w]*)/.exec(line);
    if (declaration) {
      result.push(item(`${declaration[1]} ${declaration[2]}`, index + 1, 1, "symbol"));
      continue;
    }
    const arrow = /^\s*(?:export\s+)?(?:const|let|var)\s+([$A-Z_a-z][$\w]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[$A-Z_a-z][$\w]*)\s*=>/.exec(line);
    if (arrow) {
      result.push(item(arrow[1], index + 1, 1, "symbol"));
      continue;
    }
    const method = /^(\s+)(?:public\s+|private\s+|protected\s+|static\s+|async\s+|get\s+|set\s+)*([$A-Z_a-z][$\w]*)\s*\([^;]*\)\s*(?::[^=]+)?\s*\{?\s*$/.exec(line);
    if (method && !reserved.has(method[2])) result.push(item(method[2], index + 1, 2, "symbol"));
  }
  return result;
}

function keyedOutline(lines: string[], language: "json" | "yaml"): OutlineItem[] {
  const result: OutlineItem[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = language === "json"
      ? /^(\s*)"([^"\\]+)"\s*:/.exec(line)
      : /^(\s*)(?:-\s+)?([A-Za-z_][\w .-]*)\s*:/.exec(line);
    if (!match) continue;
    const indent = match[1].replace(/\t/g, "  ").length;
    result.push(item(match[2], index + 1, Math.floor(indent / 2) + 1, "key"));
  }
  return result;
}

function markupOutline(lines: string[]): OutlineItem[] {
  const result: OutlineItem[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const heading = /<h([1-6])(?:\s[^>]*)?>([^<]+)<\/h\1>/i.exec(line);
    if (heading) {
      result.push(item(heading[2].replace(/&[^;]+;/g, " ").trim(), index + 1, Number(heading[1]), "heading"));
      continue;
    }
    const identified = /<([A-Za-z][\w:-]*)\b[^>]*\bid=["']([^"']+)["']/i.exec(line);
    if (identified) result.push(item(`${identified[1]}#${identified[2]}`, index + 1, 1, "element"));
  }
  return result;
}

function sqlOutline(lines: string[]): OutlineItem[] {
  const result: OutlineItem[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*create\s+(?:or\s+replace\s+)?(table|view|function|procedure|trigger)\s+(?:if\s+not\s+exists\s+)?([\w.[\]"`]+)/i.exec(lines[index]);
    if (match) result.push(item(`${match[1].toUpperCase()} ${match[2]}`, index + 1, 1, "database"));
  }
  return result;
}

export function buildOutline(text: string, language: LanguageId): OutlineItem[] {
  if (!text || text.length > MAX_OUTLINE_CHARS) return [];
  const lines = text.split("\n");
  let result: OutlineItem[];
  switch (language) {
    case "markdown": result = markdownOutline(lines); break;
    case "javascript":
    case "typescript": result = scriptOutline(lines); break;
    case "json": result = keyedOutline(lines, "json"); break;
    case "yaml": result = keyedOutline(lines, "yaml"); break;
    case "html":
    case "xml": result = markupOutline(lines); break;
    case "sql": result = sqlOutline(lines); break;
    default: result = [];
  }
  return result.slice(0, MAX_OUTLINE_ITEMS);
}
