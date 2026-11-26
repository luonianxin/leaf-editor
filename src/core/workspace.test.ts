import { describe, expect, it } from "vitest";
import { DocumentWorkspace } from "./workspace";
import type { FilePort } from "./types";

const unusedFiles: FilePort = {
  read: async () => { throw new Error("No file was opened"); },
  status: async () => ({ kind: "missing" }),
  save: async () => { throw new Error("No save was requested"); },
};

describe("document operations protect unsaved content", () => {
  it("refuses to close an edited document without explicit discard", () => {
    const workspace = new DocumentWorkspace(unusedFiles);
    const id = workspace.create();
    workspace.edit(id, "尚未保存的中文\nsecond line");
    expect(workspace.active?.dirty).toBe(true);
    expect(workspace.close(id)).toBe(false);
    expect(workspace.active?.text).toBe("尚未保存的中文\nsecond line");
    expect(workspace.close(id, true)).toBe(true);
    expect(workspace.documents).toHaveLength(0);
  });

  it("keeps the document dirty and intact when a save fails", async () => {
    const workspace = new DocumentWorkspace({
      ...unusedFiles,
      save: async () => { throw new Error("Disk is full"); },
    });
    const id = workspace.create();
    workspace.edit(id, "不能丢失");
    await expect(workspace.save(id, "C:/notes.txt")).rejects.toThrow("Disk is full");
    expect(workspace.active?.text).toBe("不能丢失");
    expect(workspace.active?.dirty).toBe(true);
    expect(workspace.active?.originalText).toBe("");
    expect(workspace.active?.busy).toBe(false);
  });

  it("marks only the captured content saved when typing continues during a save", async () => {
    let finish: (() => void) | undefined;
    const workspace = new DocumentWorkspace({
      ...unusedFiles,
      save: async () => {
        await new Promise<void>((resolve) => { finish = resolve; });
        return { kind: "written", path: "C:/notes.txt", version: { hash: "saved-v1", sizeBytes: 6, modifiedMs: 100 } };
      },
    });
    const id = workspace.create();
    workspace.edit(id, "first");
    const pending = workspace.save(id, "C:/notes.txt");
    workspace.edit(id, "first\nsecond");
    finish?.();
    await pending;
    expect(workspace.active?.originalText).toBe("first");
    expect(workspace.active?.text).toBe("first\nsecond");
    expect(workspace.active?.dirty).toBe(true);
    expect(workspace.active?.version?.hash).toBe("saved-v1");
    expect(workspace.active?.path).toBe("C:/notes.txt");
  });

  it("opens the same Windows path once without replacing its unsaved text", async () => {
    const workspace = new DocumentWorkspace({
      ...unusedFiles,
      read: async () => ({ path: "C:/Work/notes.txt", name: "notes.txt", text: "disk", encoding: "utf8", lineEnding: "crlf", version: { hash: "disk-v1", sizeBytes: 4, modifiedMs: 1 } }),
    });
    const id = await workspace.open("C:/Work/notes.txt");
    workspace.edit(id, "my local edit");
    expect(await workspace.open("c:\\work\\notes.txt")).toBe(id);
    expect(workspace.documents).toHaveLength(1);
    expect(workspace.active?.text).toBe("my local edit");
  });

  it("requires explicit consent before overwriting a save-as target", async () => {
    let saves = 0;
    const workspace = new DocumentWorkspace({
      ...unusedFiles,
      save: async (request) => {
        saves += 1;
        if (request.expectedMissing) return { kind: "conflict", currentVersion: { hash: "existing", sizeBytes: 8, modifiedMs: 1 } };
        if (request.expectedHash !== "existing") throw new Error("No overwrite consent");
        return { kind: "written", path: request.path, version: { hash: "new", sizeBytes: 4, modifiedMs: 2 } };
      },
    });
    const id = workspace.create();
    workspace.edit(id, "mine");
    expect((await workspace.save(id, "C:/existing.txt")).kind).toBe("conflict");
    expect(saves).toBe(1);
    expect(workspace.active?.dirty).toBe(true);
    expect(workspace.active?.path).toBeUndefined();
    expect((await workspace.save(id, "C:/existing.txt", "existing")).kind).toBe("written");
    expect(workspace.active?.dirty).toBe(false);
  });

  it("detects external changes without silently replacing local edits", async () => {
    let diskText = "original";
    let diskHash = "v1";
    const workspace = new DocumentWorkspace({
      ...unusedFiles,
      read: async () => ({ path: "C:/notes.txt", name: "notes.txt", text: diskText, encoding: "utf8", lineEnding: "lf", version: { hash: diskHash, sizeBytes: diskText.length, modifiedMs: 1 } }),
      status: async () => ({ kind: "present", version: { hash: diskHash, sizeBytes: diskText.length, modifiedMs: 2 } }),
    });
    const id = await workspace.open("C:/notes.txt");
    workspace.edit(id, "local edit");
    diskText = "external edit";
    diskHash = "v2";
    await workspace.refresh(id);
    expect(workspace.active?.text).toBe("local edit");
    expect(workspace.active?.external).toBe("changed");
    expect(await workspace.reload(id)).toBe(false);
    expect(await workspace.reload(id, true)).toBe(true);
    expect(workspace.active?.text).toBe("external edit");
    expect(workspace.active?.dirty).toBe(false);
  });

  it("treats encoding and newline changes as unsaved and rejects mixed-newline saves", async () => {
    let saveCalls = 0;
    const workspace = new DocumentWorkspace({ ...unusedFiles, save: async () => { saveCalls += 1; return { kind: "written", path: "C:/note.txt", version: { hash: "x", sizeBytes: 1, modifiedMs: 1 } }; } });
    const id = workspace.create();
    workspace.setFormat(id, { encoding: "gbk", lineEnding: "crlf" });
    expect(workspace.active?.dirty).toBe(true);
    workspace.edit(id, "");
    expect(workspace.active?.dirty).toBe(true);
    workspace.setFormat(id, { lineEnding: "mixed" });
    await expect(workspace.save(id, "C:/note.txt")).rejects.toThrow("混合换行");
    expect(saveCalls).toBe(0);
    expect(workspace.active?.dirty).toBe(true);
  });

  it("recreates a deleted original only after explicit new-file consent", async () => {
    const workspace = new DocumentWorkspace({
      ...unusedFiles,
      read: async () => ({ path: "C:/deleted.txt", name: "deleted.txt", text: "disk", encoding: "utf8", lineEnding: "lf", version: { hash: "old", sizeBytes: 4, modifiedMs: 1 } }),
      save: async (request) => request.expectedMissing
        ? { kind: "written", path: request.path, version: { hash: "new", sizeBytes: 4, modifiedMs: 2 } }
        : { kind: "missing" },
    });
    const id = await workspace.open("C:/deleted.txt");
    workspace.edit(id, "mine");
    expect((await workspace.save(id)).kind).toBe("missing");
    expect(workspace.active?.dirty).toBe(true);
    expect((await workspace.save(id, undefined, null)).kind).toBe("written");
    expect(workspace.active?.dirty).toBe(false);
  });

  it("gives new tabs distinct names and does not switch away when closing an inactive tab", () => {
    const workspace = new DocumentWorkspace(unusedFiles);
    const first = workspace.create();
    const second = workspace.create();
    const third = workspace.create();
    expect(workspace.documents.map((item) => item.name)).toEqual(["未命名 1", "未命名 2", "未命名 3"]);
    workspace.activeId = second;
    expect(workspace.close(first)).toBe(true);
    expect(workspace.activeId).toBe(second);
    expect(workspace.close(third)).toBe(true);
    expect(workspace.activeId).toBe(second);
  });

  it("does not allow a document to close while its save is still writing", async () => {
    let finish: (() => void) | undefined;
    const workspace = new DocumentWorkspace({ ...unusedFiles, save: async (request) => {
      await new Promise<void>((resolve) => { finish = resolve; });
      return { kind: "written", path: request.path, version: { hash: "done", sizeBytes: 1, modifiedMs: 1 } };
    } });
    const id = workspace.create();
    workspace.edit(id, "x");
    const pending = workspace.save(id, "C:/x.txt");
    expect(workspace.close(id, true)).toBe(false);
    finish?.();
    await pending;
  });

  it("clears a stale external-change warning after explicitly saving the observed version", async () => {
    const workspace = new DocumentWorkspace({
      ...unusedFiles,
      read: async () => ({ path: "C:/note.txt", name: "note.txt", text: "disk", encoding: "utf8", lineEnding: "lf", version: { hash: "old", sizeBytes: 4, modifiedMs: 1 } }),
      status: async () => ({ kind: "present", version: { hash: "external", sizeBytes: 8, modifiedMs: 2 } }),
      save: async (request) => ({ kind: "written", path: request.path, version: { hash: "saved", sizeBytes: 4, modifiedMs: 3 } }),
    });
    const id = await workspace.open("C:/note.txt");
    workspace.edit(id, "mine");
    await workspace.refresh(id);
    expect(workspace.active?.external).toBe("changed");
    await workspace.save(id, undefined, "external");
    expect(workspace.active?.external).toBeUndefined();
    expect(workspace.active?.observedVersion).toBeUndefined();
    expect(workspace.active?.dirty).toBe(false);
  });
});
