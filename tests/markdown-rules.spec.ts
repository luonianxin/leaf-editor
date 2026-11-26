import { expect, test } from "@playwright/test";

test("rules render without swallowing frontmatter, Setext headings, code or tables", async ({ page }) => {
  await page.goto("/");
  const source = "---\ntitle: Leaf\n---\n\nTitle\n---\n\nBefore\n\n---\n\nAfter\n\n```\n---\n```\n\n| A |\n| --- |\n| B |\n\nEnd";
  await page.locator('input[type="file"]').setInputFiles({ name: "rules.md", mimeType: "text/plain", buffer: Buffer.from(source) });
  const editor = page.getByRole("textbox", { name: "文件内容", exact: true });
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.getByRole("tab", { name: "预览模式", exact: true }).click();
  await expect(editor.getByRole("separator", { name: "分隔线" })).toHaveCount(1);
  await expect(editor).toContainText("title: Leaf");
  await expect(page.locator(".cm-md-heading-2")).toContainText("Title");
  await expect(page.locator(".cm-md-table-widget table")).toHaveCount(1);
  await page.getByRole("tab", { name: "源码模式", exact: true }).click();
  await expect(editor.getByRole("separator")).toHaveCount(0);
  expect(await editor.locator(".cm-line").allTextContents()).toEqual(source.split("\n"));
});
