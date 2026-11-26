import type { Extension } from "@codemirror/state";

export type LanguageId = "text" | "javascript" | "typescript" | "json" | "markdown" | "html" | "xml" | "yaml" | "sql";
export const LANGUAGES: { value: LanguageId; label: string }[] = [
  { value: "text", label: "纯文本" }, { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" }, { value: "json", label: "JSON" },
  { value: "markdown", label: "Markdown" }, { value: "html", label: "HTML" },
  { value: "xml", label: "XML" }, { value: "yaml", label: "YAML" }, { value: "sql", label: "SQL" },
];

export function languageFor(name: string): LanguageId {
  const extension = name.split(".").at(-1)?.toLowerCase();
  if (["js", "mjs", "cjs", "jsx"].includes(extension ?? "")) return "javascript";
  if (["ts", "tsx"].includes(extension ?? "")) return "typescript";
  if (["json", "jsonc"].includes(extension ?? "")) return "json";
  if (["md", "markdown"].includes(extension ?? "")) return "markdown";
  if (["html", "htm", "vue", "svelte"].includes(extension ?? "")) return "html";
  if (["xml", "svg"].includes(extension ?? "")) return "xml";
  if (["yaml", "yml"].includes(extension ?? "")) return "yaml";
  return extension === "sql" ? "sql" : "text";
}

export async function loadLanguage(language: LanguageId): Promise<Extension> {
  switch (language) {
    case "javascript": return (await import("@codemirror/lang-javascript")).javascript({ jsx: true });
    case "typescript": return (await import("@codemirror/lang-javascript")).javascript({ typescript: true, jsx: true });
    case "json": return (await import("@codemirror/lang-json")).json();
    case "markdown": return (await import("@codemirror/lang-markdown")).markdown();
    case "html": return (await import("@codemirror/lang-html")).html();
    case "xml": return (await import("@codemirror/lang-xml")).xml();
    case "yaml": return (await import("@codemirror/lang-yaml")).yaml();
    case "sql": return (await import("@codemirror/lang-sql")).sql();
    default: return [];
  }
}
