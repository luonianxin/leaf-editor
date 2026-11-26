import { expect, test, type Page } from "@playwright/test";

// Real App + desktop adapters; only the Tauri IPC boundary is replaced.
// api/core.invoke delegates to __TAURI_INTERNALS__.invoke in Tauri API 2.11.
async function installDesktop(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const calls: { command: string; path?: string }[] = [];
    const root = "C:/picker";
    const folder = `${root}/folder`;
    const file = (name: string) => ({ name, path: `${root}/${name}`, kind: "file" });
    const listings = {
      [root]: { root, name: "picker", parent: "C:/", entries: [
        { name: "folder", path: folder, kind: "directory" },
        file("alpha.txt"), file("beta.txt"),
        { name: "shortcut", path: `${root}/shortcut`, kind: "symlink" },
      ] },
      [folder]: { root: folder, name: "folder", parent: root, entries: [
        { name: "nested", path: `${folder}/nested`, kind: "directory" },
        { name: "inside.txt", path: `${folder}/inside.txt`, kind: "file" },
      ] },
    };
    let callbackId = 0;
    Object.assign(window, {
      pickerCalls: calls,
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
        transformCallback: () => ++callbackId,
        unregisterCallback: () => {},
        invoke: async (command: string, args: { path?: string } = {}) => {
          calls.push({ command, path: args.path });
          if (command === "get_start_directory") return root;
          if (command === "take_launch_targets") return { files: [], directories: [] };
          if (command === "list_directory") {
            const result = listings[args.path as keyof typeof listings];
            if (!result) throw new Error(`Unexpected directory read: ${args.path}`);
            return result;
          }
          if (command === "read_text_file") return {
            path: args.path, name: args.path?.split("/").at(-1), text: `Content of ${args.path}`,
            encoding: "utf8", lineEnding: "lf", version: { hash: "fixture", sizeBytes: 20, modifiedMs: 1 },
          };
          if (command === "get_text_file_status") return { kind: "present", version: { hash: "fixture", sizeBytes: 20, modifiedMs: 1 } };
          if (command === "plugin:event|listen") return ++callbackId;
          if (["plugin:event|unlisten", "plugin:window|set_title", "set_watched_files", "report_editor_ready"].includes(command)) return null;
          throw new Error(`Unexpected IPC command: ${command}`);
        },
      },
    });
  });
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "文件内容", exact: true })).toBeVisible();
}

async function reads(page: Page, command: string): Promise<(string | undefined)[]> {
  return page.evaluate((name) => (window as unknown as { pickerCalls: { command: string; path?: string }[] }).pickerCalls
    .filter((call) => call.command === name).map((call) => call.path), command);
}

test("cancel keeps the document; folder browsing is shallow and symlinks are disabled", async ({ page }) => {
  await installDesktop(page);
  const editor = page.getByRole("textbox", { name: "文件内容", exact: true });
  await editor.fill("keep this unsaved document");
  await page.getByRole("button", { name: "打开", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "打开文件" });
  await expect(dialog.getByRole("option").filter({ hasText: "alpha.txt" })).toBeVisible();
  await page.screenshot({ path: "artifacts/path-picker.png", animations: "disabled" });
  expect(await reads(page, "list_directory")).toEqual(["C:/picker"]);
  const link = dialog.getByRole("option").filter({ hasText: "shortcut" });
  await expect(link).toHaveAttribute("aria-disabled", "true");
  await link.click({ force: true });
  await expect(link).toHaveAttribute("aria-selected", "false");
  await dialog.getByRole("option").filter({ hasText: "folder" }).dblclick();
  await expect(dialog.getByRole("option").filter({ hasText: "inside.txt" })).toBeVisible();
  expect(await reads(page, "list_directory")).toEqual(["C:/picker", "C:/picker/folder"]);
  expect(await reads(page, "read_text_file")).toEqual([]);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(editor).toHaveText("keep this unsaved document");
  await expect(page.getByRole("tablist", { name: "文件标签" }).getByRole("tab")).toHaveCount(1);
});

test("file multi-selection opens both files as real document tabs", async ({ page }) => {
  await installDesktop(page);
  await page.getByRole("button", { name: "打开", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "打开文件" });
  for (const name of ["alpha.txt", "beta.txt"]) {
    const option = dialog.getByRole("option").filter({ hasText: name });
    await option.click();
    await expect(option).toHaveAttribute("aria-selected", "true");
  }
  expect(await reads(page, "read_text_file")).toEqual([]);
  await dialog.getByRole("button", { name: "打开", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "alpha.txt", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "beta.txt", exact: true })).toBeVisible();
  expect(await reads(page, "read_text_file")).toEqual(["C:/picker/alpha.txt", "C:/picker/beta.txt"]);
});

test("directory confirmation mounts a shallow workspace tree without opening documents", async ({ page }) => {
  await installDesktop(page);
  await page.getByRole("button", { name: "打开目录", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "选择文件夹" });
  await dialog.getByRole("option").filter({ hasText: "folder" }).click();
  await dialog.getByRole("button", { name: "选择文件夹", exact: true }).click();
  const tree = page.getByRole("tree", { name: "folder 目录树" });
  await expect(tree).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: "打开文件 inside.txt" })).toBeVisible();
  expect(await reads(page, "list_directory")).toEqual(["C:/picker", "C:/picker/folder"]);
  expect(await reads(page, "read_text_file")).toEqual([]);
  await expect(page.getByRole("tablist", { name: "文件标签" }).getByRole("tab")).toHaveCount(1);
});
