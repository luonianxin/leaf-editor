import { expect, test } from "@playwright/test";

async function chooseMarkdown(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("combobox", { name: "语法语言" }).click();
  await page.getByRole("listbox", { name: "语法语言" }).getByRole("option", { name: "Markdown", exact: true }).click();
}

test("Markdown toolbar formats one undo step and renders inserted rules and tables", async ({ page }) => {
  await page.goto("/");
  await chooseMarkdown(page);
  const editor = page.getByRole("textbox", { name: "文件内容", exact: true });
  const toolbar = page.getByRole("toolbar", { name: "Markdown 格式" });
  await expect(toolbar).toBeVisible();

  await editor.click();
  await page.keyboard.insertText("中文 Leaf");
  await page.keyboard.press("Control+Home");
  await page.keyboard.down("Shift");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Shift");
  await toolbar.getByRole("button", { name: "加粗", exact: true }).click();
  await expect(editor).toContainText("**中文** Leaf");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(editor).toContainText("中文 Leaf");
  await expect(editor).not.toContainText("**中文**");
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(editor).toContainText("**中文** Leaf");

  await editor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("before\nafter");
  await page.keyboard.press("Control+End");
  await toolbar.getByRole("button", { name: "分隔线", exact: true }).click();
  await expect(editor).toContainText("---");
  await page.keyboard.press("Control+End");
  await page.getByRole("tab", { name: "预览模式", exact: true }).click();
  await expect(page.getByRole("separator", { name: "分隔线", exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "源码模式", exact: true }).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await toolbar.getByRole("button", { name: "插入表格", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "插入 GFM 表格", exact: true });
  await dialog.getByRole("spinbutton", { name: "表格列数" }).fill("3");
  await dialog.getByRole("spinbutton", { name: "表格数据行数" }).fill("2");
  await dialog.getByRole("button", { name: "插入表格", exact: true }).click();
  await expect(editor).toContainText("| 列 1 | 列 2 | 列 3 |");
  await page.keyboard.press("Control+Home");
  await page.getByRole("tab", { name: "预览模式", exact: true }).click();
  await expect(page.locator(".cm-md-table-widget table")).toBeVisible();
  await expect(page.locator(".cm-md-table-widget th")).toHaveCount(3);
  await page.screenshot({ path: "artifacts/markdown-toolbar-light.png" });

  await page.getByRole("button", { name: "切换深色主题", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: "artifacts/markdown-toolbar-dark.png" });
});

test("Markdown keyboard shortcuts format current lines and partial selections", async ({ page }) => {
  await page.goto("/");
  await chooseMarkdown(page);
  const editor = page.getByRole("textbox", { name: "文件内容", exact: true });
  await editor.click();
  await page.keyboard.insertText("Hello Leaf");
  await page.keyboard.press("Control+1");
  await expect(editor).toHaveText("# Hello Leaf");
  await page.keyboard.press("Control+2");
  await expect(editor).toHaveText("## Hello Leaf");
  await page.keyboard.press("Control+z");
  await expect(editor).toHaveText("# Hello Leaf");
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Control+Shift+ArrowLeft");
  await page.keyboard.press("Control+b");
  await expect(editor).toHaveText("# Hello **Leaf**");
  await page.screenshot({ path: "artifacts/markdown-partial-selection.png" });
  await page.keyboard.press("Control+z");
  await expect(editor).toHaveText("# Hello Leaf");
});

test("narrow Markdown toolbar folds secondary actions and never modifies plain text", async ({ page }) => {
  await page.setViewportSize({ width: 680, height: 460 });
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "文件内容", exact: true });
  await editor.click();
  await page.keyboard.insertText("plain");
  await expect(page.getByRole("toolbar", { name: "Markdown 格式" })).toHaveCount(0);

  await chooseMarkdown(page);
  const toolbar = page.getByRole("toolbar", { name: "Markdown 格式" });
  await expect(toolbar).toBeVisible();
  await toolbar.getByText("更多", { exact: true }).click();
  const menu = page.getByRole("list", { name: "更多 Markdown 格式" });
  await expect(menu.getByRole("button", { name: "链接", exact: true })).toBeVisible();
  await menu.getByRole("button", { name: "链接", exact: true }).click();
  await expect(editor).toContainText("plain[链接文字](https://)");

  await page.getByRole("combobox", { name: "语法语言" }).click();
  await page.getByRole("listbox", { name: "语法语言" }).getByRole("option", { name: "纯文本", exact: true }).click();
  await expect(toolbar).toHaveCount(0);
  await expect(editor).toContainText("plain[链接文字](https://)");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
