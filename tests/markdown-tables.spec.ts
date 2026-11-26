import { test, expect } from "@playwright/test";

test("GFM tables render safely and source edits keep surrounding bytes and undo", async ({ page }) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (new URL(request.url()).hostname === "example.com") requests.push(request.url()); });
  const source = "# Before\n\n<!-- keep this comment -->\n\n| Name | Value |\n| :--- | ---: |\n| **first** | `42` |\n| ![alt](https://example.com/image.png) | <script>alert(1)</script> |\n\nBetween\n\n| Other | Number |\n| --- | --- |\n| second | 2 |\n\nAfter\n";
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "tables.md", mimeType: "text/plain", buffer: Buffer.from(source) });
  const editor = page.getByRole("textbox", { name: "文件内容", exact: true });
  const modes = page.getByRole("tablist", { name: "Markdown 模式" });
  await modes.getByRole("tab", { name: "预览模式", exact: true }).click();
  const tables = page.locator(".cm-md-table-widget");
  await expect(tables).toHaveCount(2);
  await expect(tables.first().locator("th")).toHaveText(["Name", "Value"]);
  await expect(tables.first().locator("strong")).toHaveText("first");
  await expect(tables.first().locator("code")).toHaveText("42");
  await expect(tables.first().locator("th").last()).toHaveCSS("text-align", /^(?:-webkit-)?right$/);
  await expect(tables.locator("img, script, a")).toHaveCount(0);
  expect(requests).toEqual([]);
  await page.screenshot({ path: "artifacts/markdown-tables-light.png" });
  // Resolve the second widget into its own source, not the first table.
  await tables.last().getByRole("button", { name: "编辑表格源码" }).click();
  await expect(tables).toHaveCount(1);
  await expect(page.getByRole("contentinfo")).toContainText("行 12,");
  await page.keyboard.press("End");
  await page.keyboard.insertText(" ");
  await page.keyboard.press("Control+Home");
  await expect(tables).toHaveCount(2);
  await modes.getByRole("tab", { name: "源码模式", exact: true }).click();
  // Copy reads the actual CM document, including line endings, not rendered DOM text.
  await editor.focus();
  await page.keyboard.press("Control+a");
  const copied = await editor.evaluate(element => {
    let text = "";
    const event = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
    element.dispatchEvent(event);
    text = event.clipboardData?.getData("text/plain") ?? "";
    return text;
  });
  expect(copied.replace(/\r\n/g, "\n")).toBe(source.replace("| Other | Number |", "| Other | Number | "));
  await page.keyboard.press("Control+z");
  await expect(editor).toContainText("Other");
  await modes.getByRole("tab", { name: "预览模式", exact: true }).click();
  await page.keyboard.press("Control+Home");
  await expect(tables).toHaveCount(2);
  await page.getByRole("button", { name: "切换深色主题" }).click();
  await page.screenshot({ path: "artifacts/markdown-tables-dark.png" });
  expect(errors).toEqual([]);
});
