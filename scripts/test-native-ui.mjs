import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { chromium, expect } from "@playwright/test";
import { root } from "./frontend.mjs";
import { findAvailablePort, parsePort } from "./ports.mjs";
import { readFileHexForPoll } from "./native-files.mjs";

if (process.platform !== "win32") throw new Error("Native window verification requires Windows.");
const binary = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Usage: node scripts/test-native-ui.mjs <extracted portable Leaf.exe>");
await access(binary);
await access(join(dirname(binary), "portable.flag"));
const windowScript = join(root, "scripts/native-window.ps1");
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
function windowAction(action, processId = 0) {
  return JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-File", windowScript, "-Action", action, "-ProcessId", String(processId)], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }).replace(/^﻿/, "").trim());
}
assert.equal(windowAction("existing").length, 0, "Close existing Leaf windows before running isolated native verification; the test will not stop them.");
await mkdir(join(root, "artifacts"), { recursive: true });
const artifacts = await mkdtemp(join(root, "artifacts", "native-"));
const fixtures = join(artifacts, "fixtures");
await mkdir(fixtures);
const file = join(fixtures, "中文 sample.txt");
const utf16 = join(fixtures, "UTF16 BE.txt");
const gbk = join(fixtures, "GBK.txt");
const mixed = join(fixtures, "mixed.txt");
const workspaceDirectory = join(fixtures, "workspace");
const nestedDirectory = join(workspaceDirectory, "nested");
const deeperDirectory = join(nestedDirectory, "deeper");
const rootFile = join(workspaceDirectory, "root.txt");
const outlineFile = join(workspaceDirectory, "outline.md");
const nestedFile = join(nestedDirectory, "inside.txt");
const deepFile = join(deeperDirectory, "not-yet-loaded.txt");
const directoryLink = join(workspaceDirectory, "nested-link");
await mkdir(deeperDirectory, { recursive: true });
await writeFile(file, Buffer.from("﻿第一行\r\n第二行", "utf8"));
await writeFile(utf16, Buffer.from([0xfe, 0xff, 0, 65, 0, 13, 0, 10, 0, 66]));
await writeFile(gbk, Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 13, 10]));
await writeFile(mixed, "a\rb\nc\r\nd");
await writeFile(rootFile, "root level");
await writeFile(outlineFile, "# Overview\nintro\n\n## Details\nbody");
await writeFile(nestedFile, "opened from directory tree");
await writeFile(deepFile, "must stay unloaded until deeper is expanded");
await symlink(nestedDirectory, directoryLink, "junction");
const results = { binary, artifacts, startedAt: new Date().toISOString(), checks: [], screenshots: [], limitations: ["CDP is enabled only for this test process by environment, never in the portable executable's default configuration.", "Observed launch-to-editor times include automation overhead and are not a cold-cache benchmark or an EditPlus comparison."] };
const completed = (name, detail) => { results.checks.push({ name, detail }); console.log(`PASS ${name}`); };
function cleanEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(WEBVIEW2_USER_DATA_FOLDER|WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS|WEBVIEW2_REMOTE_DEBUGGING_PORT|LEAF_DATA_DIR)$/i.test(key)) delete env[key];
  return env;
}
let child;
let browser;
let readonly = false;
function launch(args, env = cleanEnvironment()) {
  const process = spawn(binary, args, { cwd: fixtures, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: false });
  const logs = [];
  process.stdout.on("data", (bytes) => logs.push(bytes.toString()));
  process.stderr.on("data", (bytes) => logs.push(bytes.toString()));
  process.once("error", (error) => logs.push(String(error)));
  process.leafLogs = logs;
  return process;
}
async function waitExit(process, timeout = 15000) {
  const until = performance.now() + timeout;
  while (process.exitCode === null && process.signalCode === null && performance.now() < until) await pause(100);
  if (process.exitCode === null && process.signalCode === null) {
    results.exitDiagnostics = { processId: process.pid, state: windowAction("inspect", process.pid), logs: process.leafLogs.join("") };
  }
  assert.ok(process.exitCode !== null || process.signalCode !== null, `Owned process ${process.pid} did not exit.`);
  assert.equal(process.exitCode, 0, `Leaf exit: ${process.leafLogs.join("")}`);
}
function setReadonly(enabled) {
  execFileSync("powershell.exe", ["-NoProfile", "-Command", `$item=Get-Item -LiteralPath $env:LEAF_TEST_FILE; $item.IsReadOnly=$${enabled ? "true" : "false"}`], { env: { ...process.env, LEAF_TEST_FILE: file }, stdio: "pipe" });
  readonly = enabled;
}
async function expectBytes(path, bytes) {
  await expect.poll(() => readFileHexForPoll(path), { timeout: 8000 }).toBe(Buffer.from(bytes).toString("hex"));
}
async function normalPortProbe() {
  child = launch([file]);
  let state;
  const deadline = performance.now() + 25000;
  do {
    await pause(300);
    state = windowAction("inspect", child.pid);
    if (!state.running) throw new Error(`Leaf exited before showing a window: ${child.leafLogs.join("")}`);
  } while ((!state.hasWindow || state.processes.length < 2) && performance.now() < deadline);
  // A native HWND and browser process exist before the embedded frontend is ready.
  // Test closing a loaded editor separately from closing during startup.
  await expect.poll(() => child.leafLogs.join(""), {
    timeout: 45000,
    message: "Normal Release frontend did not report ready before the close probe",
  }).toContain("Leaf ready:");
  await pause(1500);
  state = windowAction("inspect", child.pid);
  results.normalProbeState = state;
  assert.ok(state.running && state.hasWindow, "Normal Release did not remain running with a visible window.");
  assert.ok(state.processes.some((item) => /msedgewebview2/i.test(item.name)), "Normal Release did not create its WebView.");
  assert.deepEqual(state.listeners, [], "Default portable Release or its WebView started a TCP listener.");
  const profile = `${resolve(dirname(binary), "data", "webview").toLowerCase()}\\`;
  const actualProfiles = [...new Set(state.processes.map(item => item.webviewDataDirectory).filter(Boolean))];
  assert.ok(actualProfiles.length > 0 && actualProfiles.every(path => resolve(path).toLowerCase().startsWith(profile)), "Default portable WebView process is not using data/webview beside this executable.");
  results.normalProcessTree = state;
  completed("normal portable Release has no TCP listening port", state.processes.map((item) => item.name));
  windowAction("close", child.pid);
  await waitExit(child);
  const descendants = state.processes.filter(item => item.id !== child.pid).map(item => item.id);
  const shutdownStarted = performance.now();
  const observingShutdown = process.argv.includes("--observe-shutdown");
  await expect.poll(() => {
    results.afterCloseProcesses = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", `$ids=@(${descendants.join(",")}); $remaining=@(Get-Process -Id $ids -ErrorAction SilentlyContinue | Select-Object Id,ProcessName); ConvertTo-Json -InputObject $remaining -Compress`], { encoding: "utf8" }).replace(/^﻿/, "").trim());
    return results.afterCloseProcesses;
  }, { timeout: observingShutdown ? 90000 : 15000, message: "Owned WebView processes did not finish shutting down after Leaf exited" }).toEqual([]);
  const shutdownMs = Math.round(performance.now() - shutdownStarted);
  results.webviewShutdownMs = shutdownMs;
  console.log(`WebView shutdown observed after ${shutdownMs}ms`);
  assert.ok(shutdownMs <= 15000, `Observed WebView cleanup ${shutdownMs}ms exceeds the unchanged 15000ms acceptance limit.`);
  child = undefined;
}
async function openViaSecondInstance(paths) {
  const second = launch(paths);
  await waitExit(second);
}
try {
  if (process.argv.includes("--close-only")) {
    for (let attempt = 0; attempt < 3; attempt += 1) await normalPortProbe();
  } else {
  await normalPortProbe();
  const port = await findAvailablePort(parsePort(process.env.LEAF_NATIVE_TEST_PORT, 1530));
  const endpoint = `http://127.0.0.1:${port}`;
  const env = cleanEnvironment();
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${port}`;
  const launchStarted = performance.now();
  child = launch([workspaceDirectory, file], env);
  const deadline = performance.now() + 30000;
  let endpointReady = false;
  while (performance.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Leaf exited before CDP was ready: ${child.leafLogs.join("")}`);
    try { const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1000) }); endpointReady = response.ok; } catch { /* WebView is still starting. */ }
    if (endpointReady) break;
    await pause(150);
  }
  assert.ok(endpointReady, "The test-only WebView2 CDP endpoint did not start.");
  const debugState = windowAction("inspect", child.pid);
  assert.ok(debugState.listeners.some((item) => item.port === port), "The selected CDP listener is not owned by this Leaf process tree; do not connect to an unrelated service.");
  browser = await chromium.connectOverCDP(endpoint);
  let page;
  await expect.poll(() => {
    page = browser.contexts().flatMap((context) => context.pages()).find((item) => /tauri\.localhost|tauri:\/\/localhost/.test(item.url()));
    return !!page;
  }, { timeout: 20000 }).toBe(true);
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  if (await page.locator("html").getAttribute("data-theme") !== "light") {
    await page.getByRole("button", { name: "切换浅色主题", exact: true }).click();
  }
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const editor = page.getByRole("textbox", { name: "文件内容", exact: true });
  const documentTabs = page.getByRole("tablist", { name: "文件标签" }).getByRole("tab");
  await expect(editor).toContainText("第一行");
  await expect(documentTabs).toHaveCount(1);
  await expect(page.getByRole("combobox", { name: "文件编码" })).toHaveAttribute("data-value", "utf8Bom");
  await expect(page.getByRole("combobox", { name: "换行符" })).toHaveAttribute("data-value", "crlf");
  results.launchToEditorObservedMs = Math.round(performance.now() - launchStarted);
  results.frontendMarks = await page.evaluate(() => performance.getEntriesByType("mark").filter((entry) => entry.name.startsWith("leaf:")).map((entry) => ({ name: entry.name, startTime: entry.startTime })));
  completed("embedded frontend loads a Unicode argv file", { url: page.url(), launchToEditorObservedMs: results.launchToEditorObservedMs });

  // Exercise the actual native IPC-backed picker, not browser fixture adapters.
  await page.getByRole("button", { name: "打开", exact: true }).click();
  let picker = page.getByRole("dialog", { name: "打开文件", exact: true });
  await expect(picker.getByRole("option", { name: /outline.md/ })).toBeVisible();
  await expect(picker.getByRole("option", { name: /nested-link/ })).toHaveAttribute("aria-disabled", "true");
  await picker.getByRole("button", { name: "取消", exact: true }).click();
  await expect(documentTabs).toHaveCount(1);
  await expect(editor).toContainText("第一行");
  await page.getByRole("button", { name: "打开", exact: true }).click();
  picker = page.getByRole("dialog", { name: "打开文件", exact: true });
  await picker.getByRole("option", { name: /root.txt/ }).click();
  await picker.getByRole("option", { name: /outline.md/ }).click();
  await page.screenshot({ path: join(artifacts, "native-path-picker.png") });
  results.screenshots.push(join(artifacts, "native-path-picker.png"));
  await picker.getByRole("button", { name: "打开", exact: true }).click();
  await expect(documentTabs).toHaveCount(3);
  await page.getByRole("button", { name: "关闭 root.txt", exact: true }).click();
  await page.getByRole("button", { name: "关闭 outline.md", exact: true }).click();
  await page.getByRole("toolbar").getByRole("button", { name: "打开目录", exact: true }).click();
  picker = page.getByRole("dialog", { name: "选择文件夹", exact: true });
  await picker.getByRole("option", { name: /文件夹 nested$/ }).dblclick();
  await expect(picker.getByRole("option", { name: /inside.txt/ })).toBeVisible();
  await picker.getByRole("button", { name: "上一级", exact: true }).click();
  await expect(picker.getByRole("option", { name: /root.txt/ })).toBeVisible();
  await picker.getByRole("button", { name: "选择文件夹", exact: true }).click();
  completed("native in-app picker cancels safely, opens multiple files, blocks symlink entries and navigates directories");

  const directoryTree = page.getByRole("tree", { name: "workspace 目录树", exact: true });
  await expect(directoryTree).toBeVisible();
  await expect(directoryTree.getByRole("treeitem", { name: "打开文件 root.txt", exact: true })).toBeVisible();
  const linkNode = directoryTree.getByRole("treeitem", { name: "符号链接 nested-link", exact: true });
  await expect(linkNode).toBeVisible();
  await expect(linkNode).toBeDisabled();
  await expect(directoryTree.getByText("inside.txt", { exact: true })).toHaveCount(0);
  await expect(directoryTree.getByText("not-yet-loaded.txt", { exact: true })).toHaveCount(0);
  await directoryTree.getByRole("treeitem", { name: "展开文件夹 nested", exact: true }).click({ button: "left" });
  const nestedFileNode = directoryTree.getByRole("treeitem", { name: "打开文件 inside.txt", exact: true });
  await expect(nestedFileNode).toBeVisible();
  await expect(directoryTree.getByText("not-yet-loaded.txt", { exact: true })).toHaveCount(0);
  await nestedFileNode.click({ button: "left" });
  await expect(documentTabs).toHaveCount(2);
  await expect(editor).toContainText("opened from directory tree");
  await expect(nestedFileNode).toHaveClass(/menu-active/);
  await page.screenshot({ path: join(artifacts, "native-directory.png") });
  results.screenshots.push(join(artifacts, "native-directory.png"));
  await nestedFileNode.click({ button: "left" });
  await expect(documentTabs).toHaveCount(2);
  completed("directory tree is shallow, blocks symlink traversal, and left-click lazily expands and opens one deduplicated tab");

  await directoryTree.getByRole("treeitem", { name: "打开文件 outline.md", exact: true }).click({ button: "left" });
  await expect(documentTabs).toHaveCount(3);
  await expect(editor).toContainText("Overview");
  const languageTrigger = page.getByRole("combobox", { name: "语法语言" });
  await expect(languageTrigger).toHaveAttribute("data-value", "markdown");
  await languageTrigger.click();
  const languageList = page.getByRole("listbox", { name: "语法语言" });
  const triggerBox = await languageTrigger.boundingBox();
  const menuBox = await languageList.boundingBox();
  assert.ok(triggerBox && menuBox && menuBox.y + menuBox.height <= triggerBox.y + 1, "Status selector did not open upward.");
  await languageList.getByRole("option", { name: "Markdown", exact: true }).click();
  await editor.click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.down("Shift");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Shift");
  await page.getByRole("tab", { name: "大纲", exact: true }).click();
  const detailsOutline = page.getByRole("button", { name: "跳转到第 4 行 Details", exact: true });
  await expect(detailsOutline).toBeVisible();
  const selectionColor = await page.locator(".cm-selectionBackground").first().evaluate((element) => getComputedStyle(element).backgroundColor);
  const activeLineColor = await page.locator(".cm-activeLine").evaluate((element) => getComputedStyle(element).backgroundColor);
  assert.notEqual(selectionColor, "rgba(0, 0, 0, 0)", "Blurred editor selection became invisible.");
  assert.notEqual(selectionColor, activeLineColor, "Blurred editor selection is indistinguishable from the active line.");
  await page.screenshot({ path: join(artifacts, "native-outline-selection.png") });
  results.screenshots.push(join(artifacts, "native-outline-selection.png"));
  await detailsOutline.click();
  await expect(page.getByRole("contentinfo")).toContainText("行 4, 列 1");
  completed("status selectors open upward; blurred selection remains visible; outline click jumps to its line");
  const modes = page.getByRole("contentinfo").getByRole("tablist", { name: "Markdown 模式" });
  await modes.getByRole("tab", { name: "预览模式", exact: true }).click();
  await expect(page.locator(".cm-md-live-preview")).toBeVisible();
  await expect(page.locator(".cm-md-heading-1")).toContainText("Overview");
  await expect(page.getByRole("contentinfo")).toContainText("行 4, 列 1");
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText(" preview edit");
  await expect(editor).toContainText("preview edit");
  await page.keyboard.press("Control+z");
  await expect(editor).not.toContainText("preview edit");
  await page.keyboard.press("Control+y");
  await expect(editor).toContainText("preview edit");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expectBytes(outlineFile, Buffer.from("# Overview\nintro\n\n## Details\nbody preview edit"));
  await page.screenshot({ path: join(artifacts, "native-markdown-preview.png") });
  results.screenshots.push(join(artifacts, "native-markdown-preview.png"));
  await modes.getByRole("tab", { name: "源码模式", exact: true }).click();
  await expect(editor).toContainText("# Overview");
  await expect(editor).toContainText("## Details");
  completed("bottom-left Markdown modes preserve cursor, edit/undo/redo, and save exact source bytes");
  const tableSuffix = "\n\n<!-- preserved -->\n\n| Name | Value |\n| :--- | ---: |\n| **first** | `42` |\n\nBetween\n\n| Other | Count |\n| --- | --- |\n| second | 2 |\n\nAfter\n";
  const tableSource = "# Overview\nintro\n\n## Details\nbody preview edit" + tableSuffix;
  await editor.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText(tableSuffix);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expectBytes(outlineFile, Buffer.from(tableSource));
  await page.keyboard.press("Control+Home");
  await modes.getByRole("tab", { name: "预览模式", exact: true }).click();
  const tableWidgets = page.locator(".cm-md-table-widget");
  await expect(tableWidgets).toHaveCount(2);
  await expect(tableWidgets.first().locator("th")).toHaveText(["Name", "Value"]);
  await expect(tableWidgets.first().locator("th").last()).toHaveCSS("text-align", /^(?:-webkit-)?right$/);
  await tableWidgets.last().getByRole("button", { name: "编辑表格源码" }).click();
  await expect(tableWidgets).toHaveCount(1);
  await page.keyboard.press("End");
  await page.keyboard.insertText(" ");
  await page.keyboard.press("Control+Home");
  await expect(tableWidgets).toHaveCount(2);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expectBytes(outlineFile, Buffer.from(tableSource.replace("| Other | Count |", "| Other | Count | ")));
  await editor.focus();
  await page.keyboard.press("Control+z");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expectBytes(outlineFile, Buffer.from(tableSource));
  await editor.focus();
  await page.keyboard.press("Control+y");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expectBytes(outlineFile, Buffer.from(tableSource.replace("| Other | Count |", "| Other | Count | ")));
  await editor.focus();
  await page.keyboard.press("Control+Home");
  await expect(tableWidgets).toHaveCount(2);
  await page.screenshot({ path: join(artifacts, "native-markdown-tables.png") });
  results.screenshots.push(join(artifacts, "native-markdown-tables.png"));
  completed("native GFM tables render, target the correct source, and preserve surrounding bytes through save/undo/redo");
  await modes.getByRole("tab", { name: "源码模式", exact: true }).click();
  await editor.focus();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Control+2");
  await expect(editor).toContainText("## Overview");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("Leaf");
  await page.keyboard.press("Control+Shift+ArrowLeft");
  await page.keyboard.press("Control+b");
  await expect(editor).toContainText("**Leaf**");
  await page.screenshot({ path: join(artifacts, "native-markdown-toolbar-selection.png") });
  results.screenshots.push(join(artifacts, "native-markdown-toolbar-selection.png"));
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+Home");
  await page.getByRole("toolbar", { name: "Markdown 格式", exact: true }).getByRole("button", { name: "分隔线", exact: true }).click();
  await page.keyboard.press("Control+End");
  await modes.getByRole("tab", { name: "预览模式", exact: true }).click();
  await expect(editor.getByRole("separator", { name: "分隔线" })).toBeVisible();
  await modes.getByRole("tab", { name: "源码模式", exact: true }).click();
  await editor.focus();
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+s");
  completed("native Markdown shortcuts, partial selection and toolbar horizontal rule work with undo");
  await page.getByRole("tab", { name: "文件", exact: true }).click();
  await page.getByRole("button", { name: "关闭 outline.md", exact: true }).click();
  await expect(documentTabs).toHaveCount(2);
  await expect(editor).toContainText("opened from directory tree");

  await page.getByRole("button", { name: "关闭工作区目录", exact: true }).click({ button: "left" });
  await expect(directoryTree).toHaveCount(0);
  await expect(documentTabs).toHaveCount(2);
  await expect(editor).toContainText("opened from directory tree");
  completed("closing the workspace tree keeps files already opened from it");
  await page.getByRole("button", { name: "关闭 inside.txt", exact: true }).click();
  await expect(documentTabs).toHaveCount(1);
  await expect(editor).toContainText("第一行");

  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n第三行");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expectBytes(file, Buffer.from("﻿第一行\r\n第二行\r\n第三行", "utf8"));
  await expect(documentTabs).not.toContainText("●");
  completed("real in-place save preserves UTF-8 BOM and CRLF");
  await page.screenshot({ path: join(artifacts, "native-light.png") });
  results.screenshots.push(join(artifacts, "native-light.png"));

  await writeFile(file, "外部版本\r\n");
  await expect(page.getByRole("button", { name: "重新载入", exact: true })).toBeVisible({ timeout: 10000 });
  await expect(editor).toContainText("第三行");
  await page.getByRole("button", { name: "重新载入", exact: true }).click();
  await expect(editor).toContainText("外部版本");
  completed("native watcher detects external replacement without silently reloading");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("|LOCAL");
  await writeFile(file, Buffer.from("﻿外部冲突\r\n", "utf8"));
  await expect(page.getByRole("button", { name: "重新载入", exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("磁盘文件与预期版本不同");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  assert.deepEqual(await readFile(file), Buffer.from("﻿外部冲突\r\n", "utf8"));
  await expect(editor).toContainText("|LOCAL");
  await expect(documentTabs).toContainText("●");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "覆盖当前磁盘版本", exact: true }).click();
  const localBytes = Buffer.from("外部版本\r\n|LOCAL", "utf8");
  await expectBytes(file, localBytes);
  completed("conflict cancel keeps both disk and editor; explicit overwrite succeeds");

  setReadonly(true);
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("|READONLY");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("read-only");
  assert.deepEqual(await readFile(file), localBytes);
  await expect(editor).toContainText("|READONLY");
  await expect(documentTabs).toContainText("●");
  setReadonly(false);
  await page.getByRole("alert").getByRole("button", { name: "关闭", exact: true }).click();
  completed("read-only native save fails without losing edits or altering original bytes");

  await openViaSecondInstance([utf16, utf16]);
  await expect(documentTabs).toHaveCount(2);
  await expect(page.getByRole("combobox", { name: "文件编码" })).toHaveAttribute("data-value", "utf16be");
  await expect(editor).toContainText("A");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\nC");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expectBytes(utf16, [0xfe, 0xff, 0, 65, 0, 13, 0, 10, 0, 66, 0, 13, 0, 10, 0, 67]);
  assert.equal(windowAction("existing").length, 1, "Second-instance argv created another surviving Leaf process.");
  completed("single instance opens duplicate argv once; UTF-16 BE save is byte exact");

  await openViaSecondInstance(["GBK.txt"]);
  await expect(documentTabs).toHaveCount(3);
  await expect(page.getByRole("combobox", { name: "文件编码" })).toHaveAttribute("data-value", "gbk");
  await expect(editor).toContainText("中文");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("ASCII");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const gbkBytes = Buffer.concat([Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 13, 10]), Buffer.from("ASCII")]);
  await expectBytes(gbk, gbkBytes);
  completed("relative second-instance path opens Chinese GBK and saves exact bytes");
  await unlink(gbk);
  await expect(page.getByText("原文件已被删除，当前内容仍然保留。", { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("原文件已被删除");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await assert.rejects(stat(gbk), { code: "ENOENT" });
  await expect(editor).toContainText("ASCII");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "重新创建", exact: true }).click();
  await expectBytes(gbk, gbkBytes);
  completed("deleted original remains missing until explicit recreate consent");

  await openViaSecondInstance([mixed]);
  await expect(page.getByRole("combobox", { name: "换行符" })).toHaveAttribute("data-value", "mixed");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("混合换行");
  await page.getByRole("button", { name: "使用 LF", exact: true }).click();
  await expectBytes(mixed, Buffer.from("a\nb\nc\nd"));
  completed("mixed newlines require explicit uniform LF choice before save");
  await page.getByRole("button", { name: "切换深色主题", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: join(artifacts, "native-dark.png") });
  results.screenshots.push(join(artifacts, "native-dark.png"));
  windowAction("close", child.pid);
  await expect(page.getByRole("dialog")).toContainText("未保存的修改");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(documentTabs).toHaveCount(4);
  assert.equal(windowAction("inspect", child.pid).running, true);
  completed("real window close cancellation retains dirty documents and the running window");
  await page.getByRole("button", { name: "关闭 中文 sample.txt", exact: true }).click();
  await page.getByRole("button", { name: "放弃修改", exact: true }).click();
  assert.deepEqual(await readFile(file), localBytes);
  // The mixed file is now clean, and the UTF-16/GBK saves are clean. Closing the
  // remaining window should exit without another confirmation dialog.
  assert.deepEqual(pageErrors, [], "Native page raised an uncaught frontend error.");
  assert.deepEqual(consoleErrors, [], "Native page logged a console error.");
  results.consoleErrors = consoleErrors;
  windowAction("close", child.pid);
  await waitExit(child);
  child = undefined;
  await browser.close();
  browser = undefined;
  completed("normal close exits the application without a resident Leaf process");
  assert.equal(windowAction("existing").length, 0);
  const profile = join(dirname(binary), "data", "webview");
  assert.ok((await readdir(profile)).length > 0, "Portable WebView data was not created beside the executable.");
  completed("portable profile is written under the extracted folder data/webview", profile);
  await normalPortProbe();
  }
  results.finishedAt = new Date().toISOString();
  results.passed = true;
} catch (error) {
  results.passed = false;
  results.error = error.stack ?? String(error);
  if (browser) {
    const page = browser.contexts().flatMap(context => context.pages()).find(item => /tauri\.localhost|tauri:\/\/localhost/.test(item.url()));
    if (page) {
      results.failureUi = await page.locator("body").innerText().catch(() => "Page unavailable");
      await page.screenshot({ path: join(artifacts, "native-failure.png") }).catch(() => {});
    }
  }
  console.error(results.error);
  process.exitCode = 1;
} finally {
  if (readonly) setReadonly(false);
  if (child) {
    results.lastProcessLogs = child.leafLogs.join("");
    // Only terminate the process created by this test, never another user's Leaf/service.
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  if (browser) await browser.close().catch(() => {});
  await writeFile(join(artifacts, "results.json"), JSON.stringify(results, null, 2));
  console.log(`Native verification record: ${join(artifacts, "results.json")}`);
}
