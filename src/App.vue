<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { DocumentWorkspace, pathKey } from "./core/workspace";
import { DirectoryTree, type DirectoryNode } from "./core/directoryTree";
import { buildOutline, MAX_OUTLINE_CHARS } from "./core/outline";
import { ENCODINGS, LINE_ENDINGS, type DocumentTab, type Encoding, type LineEnding } from "./core/types";
import { browserFiles, directoryPort, downloadDocument, filePort, isDesktop } from "./platform/files";
import DirectoryTreeNode from "./components/DirectoryTreeNode.vue";
import StatusSelect from "./components/StatusSelect.vue";
import { LANGUAGES, languageFor, type LanguageId } from "./editor/languages";
import type { MarkdownFormatAction, MarkdownFormatOptions } from "./editor/markdown-formatting";

const TextEditor = defineAsyncComponent(() => import("./editor/TextEditor.vue"));
const PathPickerDialog = defineAsyncComponent(() => import("./components/PathPickerDialog.vue"));
const pickerOpen = ref(false);
const pickerMode = ref<"files" | "directory">("files");
const pickerInitialPath = ref("");
const workspace = reactive(new DocumentWorkspace(filePort));
const directoryTree = reactive(new DirectoryTree(directoryPort));
workspace.create();
const active = computed(() => workspace.active);
const documentIds = computed(() => workspace.documents.map((item) => item.id));
const editor = ref<{
  search(): void;
  undo(): void;
  redo(): void;
  focus(): void;
  goToLine(line: number): void;
  formatMarkdown(action: MarkdownFormatAction, options?: MarkdownFormatOptions): "applied" | "composing" | "unchanged";
}>();
const fileInput = ref<HTMLInputElement>();
const theme = ref(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
const wrap = ref(false);
const sidebar = ref(true);
const sidebarView = ref<"files" | "outline">("files");
const markdownMode = ref<"source" | "preview">("source");
const fontSize = ref(14);
const cursor = reactive({ line: 1, column: 1, selected: 0 });
const languageOverrides = reactive(new Map<string, LanguageId>());
const language = computed(() => active.value ? languageOverrides.get(active.value.id) ?? languageFor(active.value.name) : "text");
interface MarkdownTool { action: MarkdownFormatAction; label: string; symbol: string; symbolClass?: string; primary: boolean }
const markdownTools: readonly MarkdownTool[] = [
  { action: "bold", label: "加粗", symbol: "B", symbolClass: "font-bold", primary: true },
  { action: "italic", label: "斜体", symbol: "I", symbolClass: "italic", primary: true },
  { action: "strikethrough", label: "删除线", symbol: "S", symbolClass: "line-through", primary: true },
  { action: "inlineCode", label: "行内代码", symbol: "</>", symbolClass: "font-mono text-[10px]", primary: true },
  { action: "heading1", label: "一级标题", symbol: "H1", symbolClass: "text-[10px] font-semibold", primary: true },
  { action: "heading2", label: "二级标题", symbol: "H2", symbolClass: "text-[10px] font-semibold", primary: true },
  { action: "blockquote", label: "引用", symbol: "❝", primary: true },
  { action: "link", label: "链接", symbol: "↗", primary: false },
  { action: "unorderedList", label: "无序列表", symbol: "•", primary: false },
  { action: "orderedList", label: "有序列表", symbol: "1.", symbolClass: "text-[10px] font-semibold", primary: false },
  { action: "horizontalRule", label: "分隔线", symbol: "—", primary: false },
  { action: "codeBlock", label: "代码块", symbol: "{}", symbolClass: "font-mono text-[10px]", primary: false },
  { action: "image", label: "图片语法", symbol: "▧", primary: false },
  { action: "table", label: "插入表格", symbol: "▦", primary: false },
];
const outline = computed(() => active.value ? buildOutline(active.value.text, language.value) : []);
const lineEndingOptions = computed(() => LINE_ENDINGS.filter((item) => item.value !== "mixed" || active.value?.lineEnding === "mixed"));
const helpShortcuts = computed<[string, string][]>(() => [
  ["新建文件", "Ctrl + N"], ["打开文件", "Ctrl + O"],
  ...(isDesktop ? [["打开目录", "Ctrl + Shift + O"]] as [string, string][] : []),
  ["保存 / 导出", "Ctrl + S"], ["另存为", "Ctrl + Shift + S"], ["关闭标签", "Ctrl + W"],
  ["Markdown 一级 / 二级标题", "Ctrl + 1 / 2"],
  ["Markdown 加粗 / 斜体", "Ctrl + B / I"], ["Markdown 链接", "Ctrl + K"],
  ["查找与替换", "Ctrl + F"], ["跳转到行", "Ctrl + G"], ["撤销 / 重做", "Ctrl + Z / Y"],
]);
const notice = ref("");
const error = ref("");
const dragActive = ref(false);
const busyOpening = ref(false);
const helpOpen = ref(false);
const helpDialog = ref<HTMLDialogElement>();
const goDialog = ref<HTMLDialogElement>();
const markdownMore = ref<HTMLDetailsElement>();
const tableDialog = ref<HTMLDialogElement>();
const tableRows = ref(2);
const tableColumns = ref(2);
const goLine = ref(1);
const readyReported = ref(false);
const editorMounted = ref(false);
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let watcherTimer: ReturnType<typeof setTimeout> | undefined;
let refreshRunning = false;
let refreshAgain = false;
let disposed = false;
let closingWindow = false;
let nativeStarted = false;
const cleanup: (() => void)[] = [];

interface LaunchTargets { files: string[]; directories: string[] }
interface Choice { label: string; value: string; danger?: boolean }
interface Question { title: string; message: string; choices: Choice[]; resolve(value: string): void }
const question = ref<Question>();
const questionDialog = ref<HTMLDialogElement>();
const queuedQuestions: Question[] = [];

function ask(title: string, message: string, choices: Choice[]): Promise<string> {
  return new Promise((resolve) => {
    queuedQuestions.push({ title, message, choices, resolve });
    showNextQuestion();
  });
}
function showNextQuestion(): void {
  if (question.value || !queuedQuestions.length) return;
  question.value = queuedQuestions.shift();
  void nextTick(() => questionDialog.value?.showModal());
}
function answer(value = "cancel"): void {
  const current = question.value;
  question.value = undefined;
  questionDialog.value?.close();
  current?.resolve(value);
  void nextTick(showNextQuestion);
}
function notify(message: string): void {
  notice.value = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.value = ""; }, 5000);
}
function fail(reason: unknown): void { error.value = reason instanceof Error ? reason.message : String(reason); }

function newDocument(): void {
  workspace.create();
  void nextTick(() => editor.value?.focus());
}

async function openPaths(paths: string[]): Promise<void> {
  busyOpening.value = true;
  try {
    for (const path of paths) {
      if (disposed) return;
      try {
        const current = active.value;
        const blank = workspace.documents.length === 1 && current && !current.path && !current.text && !current.dirty ? current.id : undefined;
        await workspace.open(path);
        if (blank) workspace.close(blank);
      } catch (reason) { fail(reason); }
    }
  } finally { busyOpening.value = false; }
}
function showPathPicker(mode: "files" | "directory"): void {
  if (pickerOpen.value) return;
  pickerMode.value = mode;
  pickerInitialPath.value = directoryTree.root?.path ?? "";
  pickerOpen.value = true;
}
async function openFiles(): Promise<void> {
  if (!isDesktop) { fileInput.value?.click(); return; }
  showPathPicker("files");
}
async function acceptPickedPaths(paths: string[]): Promise<void> {
  try {
    if (pickerMode.value === "directory") {
      if (paths[0]) await openDirectoryPath(paths[0]);
    } else await openPaths(paths);
  } catch (reason) { fail(reason); }
}
async function openDirectoryPath(path: string): Promise<void> {
  await directoryTree.open(path);
  sidebar.value = true;
  notify(`已打开目录 ${directoryTree.root?.name ?? ""}`.trim());
}
async function openDirectory(): Promise<void> {
  if (!isDesktop) { fail("浏览器预览不能读取本地目录，请使用桌面版。"); return; }
  showPathPicker("directory");
}
async function openLaunchTargets(targets: LaunchTargets): Promise<void> {
  const directory = targets.directories.at(-1);
  if (directory) {
    try { await openDirectoryPath(directory); }
    catch (reason) { fail(reason); }
  }
  await openPaths(targets.files);
}
async function toggleDirectory(node: DirectoryNode): Promise<void> {
  try { await directoryTree.toggle(node); }
  catch (reason) { fail(reason); }
}
async function openTreeFile(node: DirectoryNode): Promise<void> {
  if (node.kind !== "file") return;
  await openPaths([node.path]);
  void nextTick(() => editor.value?.focus());
}
async function importBrowserFiles(files: FileList | File[]): Promise<void> {
  for (const file of Array.from(files)) {
    try { await openPaths([await browserFiles.import(file)]); }
    catch (reason) { fail(reason); }
  }
}
async function onFileInput(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  if (input.files) await importBrowserFiles(input.files);
  input.value = "";
}
async function onDrop(event: DragEvent): Promise<void> {
  dragActive.value = false;
  if (!isDesktop && event.dataTransfer?.files.length) await importBrowserFiles(event.dataTransfer.files);
}

async function saveDocument(id: string, saveAs = false, explicitTarget?: string): Promise<boolean> {
  const document = workspace.documents.find((item) => item.id === id);
  if (!document || document.busy) return false;
  if (!isDesktop) {
    try {
      downloadDocument(document.name.includes(".") ? document.name : `${document.name}.txt`, document.text, document.encoding, document.lineEnding);
      notify("已导出副本。浏览器不能确认副本写入位置，原文的未保存状态仍保留。");
    } catch (reason) { fail(reason); }
    return false;
  }
  try {
    if (document.lineEnding === "mixed") {
      const ending = await ask("这个文件使用了混合换行", "为避免无意改变文件格式，保存前请选择统一的换行符；取消将保留当前内容。", [
        { label: "取消", value: "cancel" }, { label: "使用 CRLF", value: "crlf" }, { label: "使用 LF", value: "lf" },
      ]);
      if (ending === "cancel") return false;
      workspace.setFormat(id, { lineEnding: ending as LineEnding });
    }
    let target = explicitTarget ?? (saveAs ? undefined : document.path);
    if (!target) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      target = (await save({ title: "保存文本文件", defaultPath: document.path ?? `${document.name}.txt` })) ?? undefined;
      if (!target) return false;
    }
    const other = workspace.documents.find((item) => item.id !== id && item.path && pathKey(item.path) === pathKey(target!));
    if (other) {
      fail("目标文件已在另一个标签中打开。请切换到那个标签，或选择不同的文件名。");
      return false;
    }
    let overwriteHash: string | null | undefined;
    for (;;) {
      const result = await workspace.save(id, target, overwriteHash);
      if (result.kind === "written") {
        notify(`已保存 ${document.name}`);
        return true;
      }
      if (result.kind === "conflict") {
        const choice = await ask("磁盘文件与预期版本不同", `“${document.name}”可能被另一个程序修改，或另存目标已存在。当前编辑内容没有被丢弃。`, [
          { label: "取消", value: "cancel" }, { label: "另存为", value: "saveAs" }, { label: "覆盖当前磁盘版本", value: "overwrite", danger: true },
        ]);
        if (choice === "saveAs") return saveDocument(id, true);
        if (choice !== "overwrite") return false;
        overwriteHash = result.currentVersion.hash;
      } else {
        const choice = await ask("原文件已被删除", "你的编辑内容仍在。可以另存为，或确认在原路径重新创建文件。", [
          { label: "取消", value: "cancel" }, { label: "另存为", value: "saveAs" }, { label: "重新创建", value: "recreate" },
        ]);
        if (choice === "saveAs") return saveDocument(id, true);
        if (choice !== "recreate") return false;
        overwriteHash = null;
      }
    }
  } catch (reason) { fail(reason); return false; }
}
async function saveActive(saveAs = false): Promise<void> { if (active.value) await saveDocument(active.value.id, saveAs); }

async function closeDocument(id: string): Promise<boolean> {
  const document = workspace.documents.find((item) => item.id === id);
  if (!document || document.busy) return false;
  if (document.dirty) {
    const choice = await ask(`关闭“${document.name}”？`, "这个文件有未保存的修改。取消可以继续编辑；放弃修改将关闭这个标签。", [
      { label: "取消", value: "cancel" }, { label: "放弃修改", value: "discard", danger: true }, { label: isDesktop ? "保存并关闭" : "导出副本", value: "save" },
    ]);
    if (choice === "cancel") return false;
    if (choice === "save" && !(await saveDocument(id))) return false;
    if (choice !== "discard" && workspace.documents.find((item) => item.id === id)?.dirty) return false;
    return workspace.close(id, choice === "discard");
  }
  return workspace.close(id);
}
async function reloadDocument(id: string): Promise<void> {
  const document = workspace.documents.find((item) => item.id === id);
  if (!document?.path) return;
  try {
    let discard = false;
    if (document.dirty) {
      const choice = await ask("用磁盘版本替换当前内容？", "当前未保存内容将被替换。你也可以先取消并另存为副本。", [
        { label: "取消", value: "cancel" }, { label: "重新载入", value: "reload", danger: true },
      ]);
      if (choice !== "reload") return;
      discard = true;
    }
    if (await workspace.reload(id, discard)) notify("已从磁盘重新载入");
    else notify("重新载入期间发生了新编辑，已保留当前内容。请重试。");
  } catch (reason) { fail(reason); }
}
function keepLocal(document: DocumentTab): void {
  document.ignoredHash = document.observedVersion?.hash;
  document.external = undefined;
  notify("保留当前内容；保存时仍会检查磁盘冲突。");
}

async function refreshAll(): Promise<void> {
  if (!isDesktop || disposed) return;
  if (refreshRunning) { refreshAgain = true; return; }
  refreshRunning = true;
  try {
    do {
      refreshAgain = false;
      for (const document of [...workspace.documents]) {
        if (!document.path || disposed) continue;
        try { await workspace.refresh(document.id); }
        catch (reason) { console.warn("文件检查失败，可手动重试", reason); }
      }
    } while (refreshAgain && !disposed);
  } finally { refreshRunning = false; }
}
function scheduleRefresh(): void { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => void refreshAll(), 250); }

function toggleTheme(): void {
  theme.value = theme.value === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = theme.value;
  try { localStorage.setItem("leaf:theme", theme.value); } catch { /* No preference storage required. */ }
}
function showGoToLine(): void { goLine.value = cursor.line; goDialog.value?.showModal(); }
function editorAction(action: "search" | "undo" | "redo" | "goToLine", line = 1): void {
  if (action === "goToLine") editor.value?.goToLine(line);
  else editor.value?.[action]();
}
function goToLine(): void { if (Number.isFinite(goLine.value)) editorAction("goToLine", goLine.value); goDialog.value?.close(); }
function jumpToOutline(line: number): void { editorAction("goToLine", line); }
function setEncoding(encoding: Encoding): void { if (active.value) workspace.setFormat(active.value.id, { encoding }); }
function setLineEnding(lineEnding: LineEnding): void { if (active.value) workspace.setFormat(active.value.id, { lineEnding }); }
function setLanguage(next: LanguageId): void { if (active.value) languageOverrides.set(active.value.id, next); }
function canPreviewMarkdown(): boolean { return language.value === "markdown"; }
function canFormatMarkdown(): boolean { return !!active.value && language.value === "markdown" && !active.value.busy; }
function applyMarkdownFormat(action: MarkdownFormatAction, options?: MarkdownFormatOptions): void {
  markdownMore.value && (markdownMore.value.open = false);
  if (!canFormatMarkdown()) return;
  const result = editor.value?.formatMarkdown(action, options);
  if (result === "composing") notify("输入法组合尚未结束，完成当前输入后再应用格式。");
}
function runMarkdownTool(action: MarkdownFormatAction): void {
  if (action === "table") showTableDialog();
  else applyMarkdownFormat(action);
}
function showTableDialog(): void {
  if (!canFormatMarkdown()) return;
  tableRows.value = 2;
  tableColumns.value = 2;
  if (markdownMore.value) markdownMore.value.open = false;
  tableDialog.value?.showModal();
}
function insertMarkdownTable(): void {
  applyMarkdownFormat("table", { tableRows: tableRows.value, tableColumns: tableColumns.value });
  tableDialog.value?.close();
}
function setMarkdownMode(mode: "source" | "preview"): void {
  if (mode === "preview" && !canPreviewMarkdown()) return;
  markdownMode.value = mode;
  void nextTick(() => editor.value?.focus());
}
function showHelp(): void { helpOpen.value = true; void nextTick(() => helpDialog.value?.showModal()); }
async function openExample(): Promise<void> {
  const text = "# 给专注留一点空间\n\n这是轻页，一个只关心本地文件的编辑器。\n\n- 打开即编辑，不启动数据库或扫描插件。\n- 每个标签保留自己的撤销历史。\n- 保存前检查外部修改，不静默覆盖。\n\n```javascript\nconst message = '你好，轻页';\nconsole.log(message);\n```\n\n试试 Ctrl + F 查找，或点击右下角选择语言。\n";
  if (isDesktop) { const id = workspace.create(); workspace.edit(id, text); languageOverrides.set(id, "markdown"); }
  else await openPaths([await browserFiles.add("欢迎使用.md", text)]);
}

async function reportReady(): Promise<void> {
  if (readyReported.value || !editorMounted.value || !isDesktop || !nativeStarted) return;
  readyReported.value = true;
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const { invoke } = await import("@tauri-apps/api/core");
  try { await invoke("report_editor_ready", { frontendMs: performance.now() }); }
  catch (reason) { console.warn("Startup timing report unavailable", reason); }
}
function editorReady(): void { editorMounted.value = true; void reportReady(); }

function keyboard(event: KeyboardEvent): void {
  if (event.isComposing || (!event.ctrlKey && !event.metaKey) || event.altKey) return;
  if (question.value || pickerOpen.value || helpDialog.value?.open || goDialog.value?.open || tableDialog.value?.open) return;
  const key = event.key.toLowerCase();
  if (["n", "o", "s", "w", "g"].includes(key)) {
    event.preventDefault();
    if (key === "n") newDocument();
    if (key === "o") void (event.shiftKey && isDesktop ? openDirectory() : openFiles());
    if (key === "s") void saveActive(event.shiftKey);
    if (key === "w" && active.value) void closeDocument(active.value.id);
    if (key === "g") showGoToLine();
  }
}
function beforeUnload(event: BeforeUnloadEvent): void {
  if (workspace.documents.some((item) => item.dirty || item.busy)) { event.preventDefault(); event.returnValue = ""; }
}

watch(() => workspace.documents.map((item) => item.path).filter((path): path is string => !!path), (paths) => {
  if (!isDesktop) return;
  clearTimeout(watcherTimer);
  watcherTimer = setTimeout(() => {
    void import("@tauri-apps/api/core").then(({ invoke }) => invoke("set_watched_files", { paths })).catch(() => notify("文件监听暂不可用，切回窗口或手动检查仍可发现外部修改。"));
  }, 150);
});
watch(() => [active.value?.name, active.value?.dirty], () => {
  if (isDesktop) void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().setTitle(`${active.value?.dirty ? "● " : ""}${active.value?.name ?? "轻页"} · Leaf`)).catch(() => {});
});
watch(() => [active.value?.id, language.value], () => {
  if (!canPreviewMarkdown()) markdownMode.value = "source";
});

onMounted(async () => {
  window.addEventListener("keydown", keyboard);
  window.addEventListener("focus", scheduleRefresh);
  window.addEventListener("beforeunload", beforeUnload);
  cleanup.push(() => window.removeEventListener("keydown", keyboard), () => window.removeEventListener("focus", scheduleRefresh), () => window.removeEventListener("beforeunload", beforeUnload));
  if (!isDesktop) return;
  try {
    const [{ listen }, { invoke }, { getCurrentWindow }] = await Promise.all([import("@tauri-apps/api/event"), import("@tauri-apps/api/core"), import("@tauri-apps/api/window")]);
    cleanup.push(await listen<LaunchTargets>("launch-targets", (event) => void openLaunchTargets(event.payload)));
    cleanup.push(await listen<string[]>("files-changed", scheduleRefresh));
    cleanup.push(await getCurrentWindow().onDragDropEvent((event) => {
      dragActive.value = event.payload.type === "enter" || event.payload.type === "over";
      if (event.payload.type === "drop") { dragActive.value = false; void openPaths(event.payload.paths); }
    }));
    cleanup.push(await getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      if (closingWindow) return;
      closingWindow = true;
      try {
        for (const item of [...workspace.documents]) if (!(await closeDocument(item.id))) return;
        // A new document/launch can arrive while confirmation or a save is awaited.
        if (workspace.documents.length) return;
        // Remove browser unload guard only after all content was handled explicitly.
        window.removeEventListener("beforeunload", beforeUnload);
        await getCurrentWindow().destroy();
      } finally { closingWindow = false; }
    }));
    await openLaunchTargets(await invoke<LaunchTargets>("take_launch_targets"));
    nativeStarted = true;
    void reportReady();
  } catch (reason) { fail(reason); }
});
onBeforeUnmount(() => {
  disposed = true;
  cleanup.forEach((stop) => stop());
  clearTimeout(noticeTimer); clearTimeout(refreshTimer); clearTimeout(watcherTimer);
  question.value?.resolve("cancel"); queuedQuestions.forEach((item) => item.resolve("cancel"));
});
</script>

<template>
  <div class="flex h-dvh min-h-0 flex-col overflow-hidden bg-base-100 text-base-content" @dragover.prevent="dragActive = true" @dragleave.self="dragActive = false" @drop.prevent="onDrop">
    <input ref="fileInput" type="file" multiple hidden aria-label="选择文本文件" @change="onFileInput" />
    <header class="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-base-300/70 px-4 sm:px-5">
      <div class="flex min-w-0 items-center gap-3">
        <img src="/leaf.svg" alt="" class="size-7" />
        <div class="flex items-baseline gap-2"><h1 class="text-sm font-semibold tracking-wide">轻页</h1><span class="text-xs text-base-content/45">Leaf</span></div>
        <span class="ml-2 hidden border-l border-base-300 pl-4 text-[11px] text-base-content/45 md:block">本地文件，专注编辑</span>
      </div>
      <div class="flex items-center gap-1.5">
        <span v-if="!isDesktop" class="mr-2 hidden text-[11px] text-base-content/50 sm:inline">浏览器预览 · 保存为副本</span>
        <button class="btn btn-ghost btn-sm btn-square" :aria-label="theme === 'light' ? '切换深色主题' : '切换浅色主题'" @click="toggleTheme">{{ theme === 'light' ? '◐' : '◑' }}</button>
        <button class="btn btn-ghost btn-sm btn-square text-xs" aria-label="快捷键帮助" @click="showHelp">?</button>
      </div>
    </header>

    <div class="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-base-300/70 px-3 sm:px-4" role="toolbar" aria-label="文件和编辑操作">
      <div class="flex items-center gap-1">
        <button class="btn btn-ghost btn-sm gap-1.5 text-xs" title="新建 Ctrl+N" @click="newDocument"><span class="text-base leading-none">＋</span>新建</button>
        <button class="btn btn-ghost btn-sm gap-1.5 text-xs" title="打开 Ctrl+O" :disabled="busyOpening" @click="openFiles"><svg viewBox="0 0 20 20" class="size-4" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2.5 6h5l2-2H15a1.5 1.5 0 0 1 1.5 1.5V8M3 7.5h14l-2 9H3z" /></svg>打开</button>
        <button v-if="isDesktop" class="btn btn-ghost btn-sm btn-square gap-1.5 text-xs md:w-auto md:px-3" title="打开目录 Ctrl+Shift+O" :disabled="directoryTree.opening" aria-label="打开目录" @click="openDirectory"><svg viewBox="0 0 20 20" class="size-4" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2.5 5.5h5l2-2H15a1.5 1.5 0 0 1 1.5 1.5v11H2.5z" /><path d="M10 8v5M7.5 10.5h5" /></svg><span class="hidden md:inline">打开目录</span></button>
        <button class="btn btn-sm ml-1 gap-1.5 text-xs" title="保存 Ctrl+S" :disabled="!active || active.busy" @click="saveActive()"><svg viewBox="0 0 20 20" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 3h10l3 3v11H3V3zM6 3v5h7V3M6 17v-6h8v6" /></svg>{{ isDesktop ? '保存' : '导出' }}</button>
        <button class="btn btn-ghost btn-sm text-xs hidden sm:inline-flex" title="另存为 Ctrl+Shift+S" :disabled="!active || active.busy" @click="saveActive(true)">另存为</button>
        <span class="mx-2 h-4 border-l border-base-300" />
        <button class="btn btn-ghost btn-sm btn-square text-base" aria-label="撤销" title="撤销 Ctrl+Z" :disabled="!active" @click="editorAction('undo')">↶</button>
        <button class="btn btn-ghost btn-sm btn-square text-base" aria-label="重做" title="重做 Ctrl+Y" :disabled="!active" @click="editorAction('redo')">↷</button>
        <button class="btn btn-ghost btn-sm text-xs" title="查找和替换 Ctrl+F" :disabled="!active" @click="editorAction('search')">查找</button>
      </div>
      <div class="flex items-center gap-1">
        <button class="btn btn-ghost btn-sm text-xs hidden sm:inline-flex" :aria-pressed="wrap" @click="wrap = !wrap">{{ wrap ? '✓ 自动换行' : '自动换行' }}</button>
        <button class="btn btn-ghost btn-sm btn-square" aria-label="切换文件列表" :aria-pressed="sidebar" @click="sidebar = !sidebar"><svg viewBox="0 0 20 20" class="size-4" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2.5" y="3" width="15" height="14" rx="2" /><path d="M7 3v14" /></svg></button>
      </div>
    </div>

    <div v-if="active && canPreviewMarkdown()" class="flex h-10 shrink-0 items-center gap-1 border-b border-base-300/70 bg-base-200/30 px-3 sm:px-4" role="toolbar" aria-label="Markdown 格式">
      <span class="mr-1 hidden shrink-0 text-[10px] font-semibold tracking-[0.12em] text-base-content/40 sm:inline">MARKDOWN</span>
      <button
        v-for="tool in markdownTools.filter((item) => item.primary)"
        :key="tool.action"
        type="button"
        class="btn btn-ghost btn-xs btn-square shrink-0"
        :aria-label="tool.label"
        :title="tool.label"
        :disabled="active.busy"
        @mousedown.prevent
        @click="runMarkdownTool(tool.action)"
      ><span :class="tool.symbolClass">{{ tool.symbol }}</span></button>
      <span class="mx-1 h-4 shrink-0 border-l border-base-300" />
      <div class="hidden items-center gap-1 lg:flex">
        <button
          v-for="tool in markdownTools.filter((item) => !item.primary)"
          :key="tool.action"
          type="button"
          class="btn btn-ghost btn-xs btn-square"
          :aria-label="tool.label"
          :title="tool.label"
          :disabled="active.busy"
          @mousedown.prevent="tool.action !== 'table'"
          @click="runMarkdownTool(tool.action)"
        ><span :class="tool.symbolClass">{{ tool.symbol }}</span></button>
      </div>
      <details ref="markdownMore" class="dropdown dropdown-end ml-auto lg:hidden">
        <summary class="btn btn-ghost btn-xs px-2 text-[10px]">更多</summary>
        <ul class="menu dropdown-content z-30 mt-1 w-40 rounded-box border border-base-300 bg-base-100 p-1 shadow-lg" aria-label="更多 Markdown 格式">
          <li v-for="tool in markdownTools.filter((item) => !item.primary)" :key="tool.action">
            <button type="button" class="gap-3 text-xs" :aria-label="tool.label" :disabled="active.busy" @click="runMarkdownTool(tool.action)"><span class="flex w-5 justify-center" :class="tool.symbolClass">{{ tool.symbol }}</span>{{ tool.label }}</button>
          </li>
        </ul>
      </details>
    </div>

    <div v-if="error" role="alert" class="alert alert-error rounded-none border-0 py-2 text-xs sm:alert-horizontal">
      <span class="min-w-0 flex-1 break-words">{{ error }}</span><button class="btn btn-ghost btn-xs" @click="error = ''">关闭</button>
    </div>

    <main class="flex min-h-0 flex-1">
      <aside v-if="sidebar" class="hidden w-60 shrink-0 flex-col border-r border-base-300/70 bg-base-200/40 md:flex" aria-label="导航侧栏">
        <div class="flex h-10 shrink-0 items-end justify-between border-b border-base-300/60 px-2">
          <div role="tablist" aria-label="侧栏视图" class="tabs tabs-border tabs-xs h-full">
            <button role="tab" class="tab h-full px-3 text-[11px]" :class="{ 'tab-active': sidebarView === 'files' }" :aria-selected="sidebarView === 'files'" @click="sidebarView = 'files'">文件</button>
            <button role="tab" class="tab h-full px-3 text-[11px]" :class="{ 'tab-active': sidebarView === 'outline' }" :aria-selected="sidebarView === 'outline'" @click="sidebarView = 'outline'">大纲</button>
          </div>
          <div v-if="sidebarView === 'files'" class="mb-1.5 flex items-center gap-0.5">
            <button v-if="isDesktop" class="btn btn-ghost btn-xs btn-square" aria-label="打开目录" title="打开目录 Ctrl+Shift+O" :disabled="directoryTree.opening" @click="openDirectory"><span v-if="directoryTree.opening" class="loading loading-spinner loading-xs" /><span v-else aria-hidden="true">＋</span></button>
            <button v-if="directoryTree.root" class="btn btn-ghost btn-xs btn-square text-base-content/45" aria-label="关闭工作区目录" title="关闭工作区目录（不会关闭已打开文件）" @click="directoryTree.close">×</button>
          </div>
        </div>

        <template v-if="sidebarView === 'files'">
          <div class="min-h-0 flex-1 overflow-auto px-1.5 pb-2 pt-1.5">
            <ul v-if="directoryTree.root" role="tree" :aria-label="`${directoryTree.root.name} 目录树`" class="menu menu-xs block w-full p-0">
              <DirectoryTreeNode :node="directoryTree.root" :active-path="active?.path" @toggle="toggleDirectory" @open="openTreeFile" />
            </ul>
            <button v-else-if="isDesktop" class="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-md border border-dashed border-base-300 px-3 py-2 text-left text-[11px] text-base-content/45 hover:border-primary/40 hover:text-base-content" @click="openDirectory">
              <span aria-hidden="true">＋</span><span>打开目录以浏览文件</span>
            </button>
            <p v-else class="px-3 py-2 text-[10px] leading-5 text-base-content/35">浏览器预览不能读取本地目录。</p>

            <div class="mt-2 flex h-8 items-center justify-between border-t border-base-300/60 px-2 pt-1">
              <h2 class="text-[10px] font-semibold tracking-[0.16em] text-base-content/50">打开的文件</h2>
              <span class="text-[10px] tabular-nums text-base-content/35">{{ workspace.documents.length }}</span>
            </div>
            <ul class="menu menu-xs block w-full p-0" aria-label="已打开文件">
              <li v-for="item in workspace.documents" :key="item.id">
                <button :class="{ 'menu-active': item.id === active?.id }" class="h-8 gap-2 rounded-md px-2" :title="item.path ?? '尚未保存到磁盘'" @click="workspace.activeId = item.id">
                  <svg viewBox="0 0 16 18" class="h-3.5 w-3 shrink-0 text-base-content/40" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="M3 1.5h6l4 4v11H3zM9 1.5v4h4" /></svg>
                  <span class="min-w-0 flex-1 truncate text-xs">{{ item.name }}</span><span v-if="item.dirty" class="text-[10px] text-primary" aria-label="未保存">●</span>
                </button>
              </li>
            </ul>
          </div>
        </template>

        <template v-else>
          <div class="min-h-0 flex-1 overflow-auto px-1.5 py-2">
            <div v-if="!active" class="px-3 py-8 text-center text-[11px] leading-5 text-base-content/40">打开文档后显示大纲</div>
            <div v-else-if="active.text.length > MAX_OUTLINE_CHARS" class="px-3 py-8 text-center text-[11px] leading-5 text-base-content/40">文件超过 2 MiB，已跳过大纲解析</div>
            <ul v-else-if="outline.length" class="menu menu-xs block w-full p-0" :aria-label="`${active.name} 大纲`">
              <li v-for="entry in outline" :key="entry.id">
                <button class="h-8 rounded-md pr-2 text-left" :style="{ paddingLeft: `${8 + (entry.level - 1) * 12}px` }" :aria-label="`跳转到第 ${entry.line} 行 ${entry.label}`" :title="`第 ${entry.line} 行`" @click="jumpToOutline(entry.line)">
                  <span class="flex size-4 shrink-0 items-center justify-center rounded text-[9px] font-semibold text-primary/75" aria-hidden="true">{{ entry.kind === 'heading' ? '#' : entry.kind === 'key' ? '{}' : entry.kind === 'database' ? 'DB' : 'ƒ' }}</span>
                  <span class="min-w-0 flex-1 truncate text-xs">{{ entry.label }}</span>
                  <span class="text-[9px] tabular-nums text-base-content/30">{{ entry.line }}</span>
                </button>
              </li>
            </ul>
            <div v-else class="px-3 py-8 text-center text-[11px] leading-5 text-base-content/40">当前语言没有可显示的大纲项<br /><span class="text-[10px] text-base-content/30">支持标题、类、函数、键与数据库对象</span></div>
          </div>
          <div class="shrink-0 border-t border-base-300/70 px-3 py-2.5 text-[10px] text-base-content/40">
            <span v-if="outline.length">{{ outline.length }} 个大纲项 · 点击跳转</span><span v-else>大纲随当前文档更新</span>
          </div>
        </template>
      </aside>

      <section class="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="编辑工作区">
        <div v-if="workspace.documents.length" class="flex h-11 shrink-0 items-stretch overflow-x-auto border-b border-base-300/70 bg-base-200/25" role="tablist" aria-label="文件标签">
          <div v-for="item in workspace.documents" :key="item.id" class="group flex shrink-0 items-center border-r border-base-300/60" :class="item.id === active?.id ? 'bg-base-100' : 'text-base-content/55'">
            <button role="tab" :id="`tab-${item.id}`" :aria-controls="'document-panel'" :aria-selected="item.id === active?.id" :tabindex="item.id === active?.id ? 0 : -1" class="tab h-full gap-2 px-4 text-xs" :class="{ 'tab-active': item.id === active?.id }" :title="item.path" @click="workspace.activeId = item.id" @keydown.left.prevent="workspace.activeId = workspace.documents[(workspace.documents.indexOf(item) - 1 + workspace.documents.length) % workspace.documents.length]?.id" @keydown.right.prevent="workspace.activeId = workspace.documents[(workspace.documents.indexOf(item) + 1) % workspace.documents.length]?.id">
              <span class="max-w-44 truncate">{{ item.name }}</span><span v-if="item.dirty" class="text-[9px] text-primary" aria-label="未保存">●</span>
            </button>
            <button class="btn btn-ghost btn-xs btn-square mr-2 text-base-content/35 hover:text-base-content" :aria-label="`关闭 ${item.name}`" :disabled="item.busy" @click="closeDocument(item.id)">×</button>
          </div>
          <button class="btn btn-ghost btn-sm btn-square my-auto ml-2 text-base-content/40" aria-label="新建标签" @click="newDocument">＋</button>
        </div>

        <div v-if="active?.external" class="flex flex-wrap items-center gap-3 border-b border-warning/25 bg-warning/10 px-4 py-2 text-xs" role="status">
          <span class="flex-1">{{ active.external === 'missing' ? '原文件已被删除，当前内容仍然保留。' : '磁盘文件已被其他程序修改，当前内容未被替换。' }}</span>
          <button v-if="active.external === 'changed'" class="btn btn-xs" @click="reloadDocument(active.id)">重新载入</button>
          <button class="btn btn-ghost btn-xs" @click="keepLocal(active)">保留当前内容</button>
          <button class="btn btn-ghost btn-xs" @click="saveActive(true)">另存为</button>
        </div>

        <div id="document-panel" class="relative min-h-0 flex-1" role="tabpanel" :aria-labelledby="active ? `tab-${active.id}` : undefined">
          <Suspense v-if="active">
            <TextEditor ref="editor" :document="active" :document-ids="documentIds" :language="language" :dark="theme === 'dark'" :wrap="wrap" :font-size="fontSize" :visual-markdown="markdownMode === 'preview'" @change="(id, text) => workspace.edit(id, text)" @cursor="(line, column, selected) => Object.assign(cursor, { line, column, selected })" @ready="editorReady" />
            <template #fallback><div class="flex h-full items-center justify-center gap-2 text-xs text-base-content/45"><span class="loading loading-spinner loading-xs" />正在载入编辑核心</div></template>
          </Suspense>
          <div v-if="!active" class="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
            <img src="/leaf.svg" alt="" class="size-12 opacity-70" /><h2 class="text-lg font-medium">给专注留一点空间</h2><p class="text-sm text-base-content/50">新建一个文件，或把文本文件拖到这里。</p>
            <div class="flex gap-2"><button class="btn btn-sm" @click="newDocument">新建文件</button><button class="btn btn-ghost btn-sm" @click="openFiles">打开文件</button><button v-if="isDesktop" class="btn btn-ghost btn-sm" @click="openDirectory">打开目录</button></div>
            <button class="btn btn-link btn-xs text-base-content/45" @click="openExample">打开示例文档</button>
          </div>
          <div v-if="active && !active.text && markdownMode === 'source'" class="pointer-events-none absolute left-20 top-5 max-w-sm select-none text-xs leading-7 text-base-content/25">
            从这里开始记录。<br /><span class="text-[11px]">Ctrl + O 打开文件 · Ctrl + S {{ isDesktop ? '保存' : '导出副本' }}</span>
          </div>
          <div v-if="dragActive" class="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-box border-2 border-dashed border-primary/50 bg-base-100/95 text-sm">松开以打开文本文件</div>
        </div>
      </section>
    </main>

    <footer class="flex h-8 shrink-0 items-center justify-between gap-2 border-t border-base-300/70 bg-base-200/30 px-3 text-[10px] text-base-content/55 sm:px-4" aria-label="文件状态">
      <div class="flex min-w-0 items-center gap-3">
        <div v-if="active && canPreviewMarkdown()" role="tablist" aria-label="Markdown 模式" class="tabs tabs-border h-7 shrink-0">
          <button role="tab" class="tab h-7 px-2 text-[10px]" :class="{ 'tab-active': markdownMode === 'source' }" :aria-selected="markdownMode === 'source'" title="显示完整 Markdown 标记" @click="setMarkdownMode('source')">源码模式</button>
          <button role="tab" class="tab h-7 px-2 text-[10px]" :class="{ 'tab-active': markdownMode === 'preview' }" :aria-selected="markdownMode === 'preview'" title="可编辑的即时预览" @click="setMarkdownMode('preview')">预览模式</button>
        </div>
        <span v-if="notice" class="truncate text-base-content/75" role="status">{{ notice }}</span>
        <template v-else><span class="max-w-64 truncate" :title="active?.path">{{ active?.path ? (isDesktop ? active.path : '浏览器文件 · 原位保存不可用') : '尚未保存到磁盘' }}</span><span v-if="active?.dirty" class="hidden text-primary/80 sm:inline">有未保存修改</span></template>
        <button v-if="isDesktop && active?.path" class="shrink-0 text-base-content/50 hover:text-base-content" title="检查磁盘文件是否被其他程序修改" @click="refreshAll">检查磁盘</button>
        <span v-if="active?.encoding === 'utf16le' || active?.encoding === 'utf16be'" class="hidden shrink-0 text-base-content/45 md:inline">UTF-16 保存带 BOM</span>
      </div>
      <div v-if="active" class="flex shrink-0 items-center gap-2 sm:gap-4">
        <button class="hidden tabular-nums hover:text-base-content sm:inline" title="跳转到行 Ctrl+G" @click="showGoToLine">行 {{ cursor.line }}, 列 {{ cursor.column }}<span v-if="cursor.selected"> · 选中 {{ cursor.selected }}</span></button>
        <StatusSelect :model-value="active.encoding" :options="ENCODINGS" label="文件编码" :disabled="active.busy" @update:model-value="setEncoding" />
        <StatusSelect :model-value="active.lineEnding" :options="lineEndingOptions" label="换行符" :disabled="active.busy" @update:model-value="setLineEnding" />
        <div class="hidden sm:block"><StatusSelect :model-value="language" :options="LANGUAGES" label="语法语言" @update:model-value="setLanguage" /></div>
      </div>
    </footer>

    <PathPickerDialog v-if="isDesktop && pickerOpen" v-model:open="pickerOpen" :mode="pickerMode" :initial-path="pickerInitialPath" @select="acceptPickedPaths" />
    <dialog ref="tableDialog" class="modal" aria-labelledby="table-title">
      <form method="dialog" class="modal-box max-w-sm" @submit.prevent="insertMarkdownTable">
        <h2 id="table-title" class="text-base font-semibold">插入 GFM 表格</h2>
        <p class="mt-2 text-xs leading-5 text-base-content/55">生成可继续编辑的 Markdown 源码；预览模式会使用现有安全表格渲染。</p>
        <div class="mt-5 grid grid-cols-2 gap-3">
          <label class="text-xs text-base-content/65">列数<input v-model.number="tableColumns" class="input input-sm mt-1.5 w-full" type="number" min="1" max="8" required aria-label="表格列数" /></label>
          <label class="text-xs text-base-content/65">数据行数<input v-model.number="tableRows" class="input input-sm mt-1.5 w-full" type="number" min="1" max="10" required aria-label="表格数据行数" /></label>
        </div>
        <div class="modal-action"><button type="button" class="btn btn-ghost btn-sm" @click="tableDialog?.close()">取消</button><button type="submit" class="btn btn-sm">插入表格</button></div>
      </form>
      <form method="dialog" class="modal-backdrop"><button aria-label="取消插入表格">关闭</button></form>
    </dialog>
    <dialog ref="questionDialog" class="modal" aria-labelledby="question-title" @cancel.prevent="answer('cancel')">
      <div v-if="question" class="modal-box max-w-md border border-base-300">
        <h2 id="question-title" class="text-base font-semibold">{{ question.title }}</h2><p class="mt-3 whitespace-pre-line text-sm leading-6 text-base-content/65">{{ question.message }}</p>
        <form method="dialog" class="modal-action flex-wrap" @submit.prevent="answer('cancel')"><button v-for="choice in question.choices" :key="choice.value" type="button" class="btn btn-sm" :class="{ 'btn-error btn-outline': choice.danger }" @click="answer(choice.value)">{{ choice.label }}</button></form>
      </div>
    </dialog>
    <dialog ref="goDialog" class="modal" aria-labelledby="go-title"><form method="dialog" class="modal-box max-w-xs" @submit.prevent="goToLine"><h2 id="go-title" class="text-sm font-semibold">跳转到行</h2><input v-model.number="goLine" type="number" min="1" class="input input-sm mt-4 w-full" aria-label="行号" autofocus /><div class="modal-action"><button type="button" class="btn btn-ghost btn-sm" @click="goDialog?.close()">取消</button><button class="btn btn-sm" type="submit">跳转</button></div></form></dialog>
    <dialog ref="helpDialog" class="modal" aria-labelledby="help-title" @close="helpOpen = false">
      <form v-if="helpOpen" method="dialog" class="modal-box max-w-md"><h2 id="help-title" class="text-base font-semibold">轻页 · 快捷键</h2><div class="mt-5 space-y-3 text-sm"><div v-for="[label, shortcut] in helpShortcuts" :key="label" class="flex items-center justify-between"><span class="text-base-content/65">{{ label }}</span><kbd class="kbd kbd-sm text-[11px]">{{ shortcut }}</kbd></div></div><p class="mt-5 text-xs leading-5 text-base-content/45">macOS 可使用 Command。浏览器会占用部分系统快捷键，桌面版没有这层限制。首版不做崩溃恢复，请及时保存重要内容。</p><div class="modal-action"><button class="btn btn-sm">知道了</button></div></form>
    </dialog>
  </div>
</template>
