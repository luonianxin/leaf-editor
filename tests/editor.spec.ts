import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("each tab keeps its undo history and cancelled close keeps text", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "文件内容", exact: true });
  await editor.click();
  await page.keyboard.insertText("第一份文档\nHello Leaf");
  await page.getByRole("button", { name: "＋ 新建", exact: true }).click();
  await editor.click();
  await page.keyboard.insertText("第二份文档");
  await page.getByRole("tab", { name: "未命名 1未保存", exact: true }).click();
  await expect(editor).toContainText("第一份文档");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(editor).toHaveText("");
  await page.getByRole("tab", { name: "未命名 2未保存", exact: true }).click();
  await expect(editor).toHaveText("第二份文档");
  await page.getByRole("button", { name: "关闭 未命名 2", exact: true }).click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(editor).toHaveText("第二份文档");
  await page.getByRole("button", { name: "关闭 未命名 2", exact: true }).click();
  await page.getByRole("button", { name: "放弃修改", exact: true }).click();
  await expect(page.getByRole("tablist", { name: "文件标签" }).getByRole("tab")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("browser import and export preserve BOM and CRLF without pretending to save the original", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "中文.txt", mimeType: "text/plain", buffer: Buffer.from("﻿第一行\r\n第二行", "utf8"),
  });
  const editor = page.getByRole("textbox", { name: "文件内容", exact: true });
  await expect(editor).toContainText("第一行");
  await expect(page.getByRole("combobox", { name: "文件编码" })).toHaveAttribute("data-value", "utf8Bom");
  await expect(page.getByRole("combobox", { name: "换行符" })).toHaveAttribute("data-value", "crlf");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n第三行");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const download = await pending;
  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  expect(bytes.toString("utf8")).toBe("﻿第一行\r\n第二行\r\n第三行");
  await expect(page.getByRole("tablist", { name: "文件标签" }).getByRole("tab")).toContainText("●");
  await expect(page.getByRole("contentinfo")).toContainText("原文的未保存状态仍保留");
});

test("status menus open upward, selection remains visible when blurred, and outline jumps to headings", async ({ page }) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "文件内容", exact: true });
  await editor.click();
  await page.keyboard.insertText("# Title\nintro\n\n## Details\nbody");
  await page.getByRole("combobox", { name: "语法语言" }).click();
  const languageList = page.getByRole("listbox", { name: "语法语言" });
  const triggerBox = await page.getByRole("combobox", { name: "语法语言" }).boundingBox();
  const menuBox = await languageList.boundingBox();
  expect(triggerBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(triggerBox!.y + 1);
  await page.screenshot({ path: "artifacts/status-menu-upward.png" });
  await languageList.getByRole("option", { name: "Markdown", exact: true }).click();

  await editor.click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.down("Shift");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Shift");
  await page.getByRole("tab", { name: "大纲", exact: true }).click();
  await expect(page.getByRole("button", { name: "跳转到第 4 行 Details", exact: true })).toBeVisible();
  const selectionStyle = await page.locator(".cm-selectionBackground").first().evaluate((element) => getComputedStyle(element).backgroundColor);
  const activeLineStyle = await page.locator(".cm-activeLine").evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(selectionStyle).not.toBe("rgba(0, 0, 0, 0)");
  expect(selectionStyle).not.toBe(activeLineStyle);
  await page.screenshot({ path: "artifacts/outline-selection.png" });
  await page.getByRole("button", { name: "跳转到第 4 行 Details", exact: true }).click();
  await expect(page.getByRole("contentinfo")).toContainText("行 4, 列 1");
});

test("find/replace, theme, and narrow layouts work without horizontal page overflow", async ({ page }) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "文件内容", exact: true });
  await editor.click();
  await page.keyboard.insertText('const value = "Hello";\nHello again');
  await page.getByRole("combobox", { name: "语法语言" }).click();
  const languageList = page.getByRole("listbox", { name: "语法语言" });
  await languageList.getByRole("option", { name: "JavaScript", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "语法语言" })).toHaveAttribute("data-value", "javascript");
  await page.getByRole("button", { name: "查找", exact: true }).click();
  await page.getByRole("textbox", { name: "查找内容", exact: true }).fill("Hello");
  await page.getByRole("textbox", { name: "替换为", exact: true }).fill("你好");
  await page.getByRole("button", { name: "全部替换", exact: true }).click();
  await page.getByRole("button", { name: "关闭查找", exact: true }).click();
  await expect(editor).toHaveText('const value = "你好";你好 again');
  await page.getByRole("button", { name: "切换深色主题" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: "artifacts/editor-dark.png" });
  await page.getByRole("button", { name: "切换浅色主题" }).click();
  await page.screenshot({ path: "artifacts/editor-light.png" });
  await page.setViewportSize({ width: 680, height: 460 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(editor).toBeVisible();
});
