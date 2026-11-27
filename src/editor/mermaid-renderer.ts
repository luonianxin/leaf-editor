let mermaidModule: Promise<(typeof import("mermaid"))["default"]> | undefined;
let renderQueue: Promise<unknown> = Promise.resolve();
let diagramId = 0;

function loadMermaid(): Promise<(typeof import("mermaid"))["default"]> {
  mermaidModule ??= import("mermaid").then((module) => module.default);
  return mermaidModule;
}

export function renderMermaidDiagram(source: string, dark: boolean): Promise<string> {
  const task = renderQueue.then(async () => {
    const mermaid = await loadMermaid();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      secure: ["securityLevel", "startOnLoad", "maxTextSize", "maxEdges", "suppressErrorRendering"],
      suppressErrorRendering: true,
      htmlLabels: false,
      maxTextSize: 64 * 1024,
      maxEdges: 500,
      theme: dark ? "dark" : "neutral",
      look: "classic",
      fontFamily: '"Segoe UI", "Microsoft YaHei", system-ui, sans-serif',
    });
    const parsed = await mermaid.parse(source, { suppressErrors: true });
    if (!parsed) throw new Error("Mermaid 语法无效");
    const { svg } = await mermaid.render(`leaf-mermaid-${diagramId += 1}`, source);
    return svg;
  });
  renderQueue = task.then(() => undefined, () => undefined);
  return task;
}
