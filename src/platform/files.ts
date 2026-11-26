import type { DirectoryListing, DirectoryPort, FilePort, FileSnapshot, Encoding, SaveRequest, SaveResult, FileStatus } from "../core/types";
import { MAX_FILE_BYTES } from "../core/types";
import { browserSnapshot, encodeDownload } from "./browserFiles";

export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

class DesktopFiles implements FilePort {
  async read(path: string, encoding?: Encoding): Promise<FileSnapshot> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("read_text_file", { path, encoding: encoding ?? null });
  }
  async status(path: string): Promise<FileStatus> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("get_text_file_status", { path });
  }
  async save(request: SaveRequest): Promise<SaveResult> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("save_text_file", { request });
  }
}

class DesktopDirectories implements DirectoryPort {
  async list(path: string): Promise<DirectoryListing> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("list_directory", { path });
  }
}

class BrowserDirectories implements DirectoryPort {
  async list(): Promise<DirectoryListing> {
    throw new Error("浏览器预览不能读取本地目录，请使用桌面版。");
  }
}

class BrowserFiles implements FilePort {
  private snapshots = new Map<string, FileSnapshot>();
  async import(file: File): Promise<string> {
    if (file.size > MAX_FILE_BYTES) throw new Error("首版最多打开 16 MiB 文件。");
    const path = `browser:/${crypto.randomUUID()}/${file.name}`;
    const snapshot = await browserSnapshot(path, file.name, new Uint8Array(await file.arrayBuffer()), file.lastModified);
    this.snapshots.set(path, snapshot);
    return path;
  }
  async add(name: string, text: string): Promise<string> {
    const path = `browser:/${crypto.randomUUID()}/${name}`;
    this.snapshots.set(path, await browserSnapshot(path, name, new TextEncoder().encode(text)));
    return path;
  }
  async read(path: string): Promise<FileSnapshot> {
    const snapshot = this.snapshots.get(path);
    if (!snapshot) throw new Error("浏览器中的文件已不可用，请重新打开。");
    return { ...snapshot };
  }
  async status(path: string): Promise<FileStatus> {
    const snapshot = this.snapshots.get(path);
    return snapshot ? { kind: "present", version: snapshot.version } : { kind: "missing" };
  }
  async save(): Promise<SaveResult> {
    throw new Error("浏览器预览不能覆盖原文件。请导出副本，或使用桌面版原位保存。");
  }
}

export const browserFiles = new BrowserFiles();
export const filePort: FilePort = isDesktop ? new DesktopFiles() : browserFiles;
export const directoryPort: DirectoryPort = isDesktop ? new DesktopDirectories() : new BrowserDirectories();

export async function getStartDirectory(): Promise<string> {
  if (!isDesktop) throw new Error("浏览器预览不能访问用户主目录，请使用桌面版。");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("get_start_directory");
}

export function downloadDocument(name: string, text: string, encoding: Encoding, lineEnding: import("../core/types").LineEnding): void {
  const bytes = encodeDownload(text, encoding, lineEnding);
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
