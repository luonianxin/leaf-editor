import { expect, test } from "@playwright/test";

const sequenceDiagram = `sequenceDiagram
    autonumber
    actor R as 读者
    participant W as 微信公众平台
    participant G as 解锁服务
    participant S as 授权状态（内存+私有文件）
    participant B as 已打开的网页
    R->>W: 取消关注公众号
    W->>G: POST callback（unsubscribe 事件）
    G->>G: 验签并解密，取得发送者 OpenID
    G->>S: 清除该 OpenID 对应的所有会话授权
    G-->>W: success
    alt AI 通识仍在阅读
        B->>G: 定时 30 秒、切章或切回标签时 GET status
        G-->>B: {unlocked:false}
        B-->>R: 恢复短预览并停用完整交互
    else 正式文章仍停留在已展开页
        Note over B,R: 已展开文章不常驻轮询
        R->>B: 刷新、进入另一篇文章或重新触发状态检查
        B->>G: GET status
        G-->>B: {unlocked:false}
        B-->>R: 恢复遮挡
    end`;

async function openMarkdown(page: import("@playwright/test").Page, source: string): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles({
    name: "diagram.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(source),
  });
}

test("Mermaid sequence diagrams render locally and return to their exact source", async ({ page }) => {
  await page.goto("/");
  const source = `# 取消关注后的授权失效\n\n\`\`\`mermaid\n${sequenceDiagram}\n\`\`\`\n\n结束`;
  await openMarkdown(page, source);
  const editor = page.getByRole("textbox", { name: "文件内容", exact: true });
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.getByRole("tab", { name: "预览模式", exact: true }).click();

  const diagram = page.locator(".cm-md-mermaid-widget");
  await expect(diagram).toBeVisible();
  await expect(diagram.locator('svg[role="img"]')).toBeVisible({ timeout: 15_000 });
  await expect(diagram).toContainText("读者");
  await expect(diagram).toContainText("微信公众平台");
  await page.screenshot({ path: "artifacts/markdown-mermaid-sequence.png" });

  await diagram.getByRole("button", { name: "编辑图表源码" }).click();
  await expect(diagram).toHaveCount(0);
  await expect(editor).toContainText("sequenceDiagram");

  await page.getByRole("tab", { name: "源码模式", exact: true }).click();
  expect(await editor.locator(".cm-line").allTextContents()).toEqual(source.split("\n"));
});

test("invalid Mermaid stays readable without breaking the Markdown preview", async ({ page }) => {
  await page.goto("/");
  const source = "before\n\n```mermaid\nsequenceDiagram\nA ->>\n```\n\nafter";
  await openMarkdown(page, source);
  const editor = page.getByRole("textbox", { name: "文件内容", exact: true });
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.getByRole("tab", { name: "预览模式", exact: true }).click();

  const error = page.locator(".cm-md-mermaid-error");
  await expect(error).toBeVisible({ timeout: 15_000 });
  await expect(error).toContainText("Mermaid 语法无效");
  await expect(error).toContainText("sequenceDiagram");
  await expect(editor).toContainText("before");
  await expect(editor).toContainText("after");
});
