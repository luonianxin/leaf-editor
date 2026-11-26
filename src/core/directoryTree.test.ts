import { describe, expect, it, vi } from "vitest";
import { DirectoryTree } from "./directoryTree";
import type { DirectoryListing, DirectoryPort } from "./types";

function listing(root: string, name: string, entries: DirectoryListing["entries"] = []): DirectoryListing {
  return { root, name, entries };
}

describe("DirectoryTree", () => {
  it("loads one level at a time and reuses children after collapse", async () => {
    const list = vi.fn(async (path: string) => path === "C:/project"
      ? listing("C:/project", "project", [
          { path: "C:/project/src", name: "src", kind: "directory" },
          { path: "C:/project/README.md", name: "README.md", kind: "file" },
          { path: "C:/project/link", name: "link", kind: "symlink" },
        ])
      : listing("C:/project/src", "src", [{ path: "C:/project/src/main.ts", name: "main.ts", kind: "file" }]));
    const tree = new DirectoryTree({ list } satisfies DirectoryPort);

    await tree.open("C:/project");
    expect(tree.root?.name).toBe("project");
    expect(tree.root?.children?.map((item) => item.name)).toEqual(["src", "README.md", "link"]);
    const source = tree.root!.children![0];
    expect(source.children).toBeUndefined();

    await tree.toggle(source);
    expect(source.expanded).toBe(true);
    expect(source.children?.map((item) => item.name)).toEqual(["main.ts"]);
    await tree.toggle(source);
    expect(source.expanded).toBe(false);
    await tree.toggle(source);
    expect(source.expanded).toBe(true);
    expect(list).toHaveBeenCalledTimes(2);
    expect(await tree.toggle(tree.root!.children![1])).toBe(false);
    expect(await tree.toggle(tree.root!.children![2])).toBe(false);
  });

  it("does not let a slower previous directory replace the latest workspace", async () => {
    let releaseOld!: (value: DirectoryListing) => void;
    const old = new Promise<DirectoryListing>((resolve) => { releaseOld = resolve; });
    const port: DirectoryPort = { list: (path) => path === "old" ? old : Promise.resolve(listing("new", "new")) };
    const tree = new DirectoryTree(port);

    const first = tree.open("old");
    await tree.open("new");
    releaseOld(listing("old", "old"));
    await first;

    expect(tree.root?.path).toBe("new");
    expect(tree.opening).toBe(false);
  });
});
