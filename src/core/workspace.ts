import type { DocumentTab, FilePort, FileSnapshot, SaveResult } from "./types";

export function pathKey(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\/\/\?\//, "");
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith("//") ? normalized.toLowerCase() : normalized;
}

function documentFrom(snapshot: FileSnapshot, id: string = crypto.randomUUID()): DocumentTab {
  return { id, path: snapshot.path, name: snapshot.name, text: snapshot.text, originalText: snapshot.text, encoding: snapshot.encoding, savedEncoding: snapshot.encoding, lineEnding: snapshot.lineEnding, savedLineEnding: snapshot.lineEnding, version: snapshot.version, dirty: false, busy: false, revision: 0 };
}

export class DocumentWorkspace {
  documents: DocumentTab[] = [];
  activeId?: string;
  private nextUntitled = 1;

  constructor(readonly files: FilePort) {}

  get active(): DocumentTab | undefined {
    return this.documents.find((item) => item.id === this.activeId);
  }

  create(): string {
    const id = crypto.randomUUID();
    this.documents.push({ id, name: `未命名 ${this.nextUntitled++}`, text: "", originalText: "", encoding: "utf8", savedEncoding: "utf8", lineEnding: "lf", savedLineEnding: "lf", dirty: false, busy: false, revision: 0 });
    this.activeId = id;
    return id;
  }

  async open(path: string): Promise<string> {
    let existing = this.documents.find((item) => item.path && pathKey(item.path) === pathKey(path));
    if (!existing) {
      const snapshot = await this.files.read(path);
      existing = this.documents.find((item) => item.path && pathKey(item.path) === pathKey(snapshot.path));
      if (!existing) {
        existing = documentFrom(snapshot);
        this.documents.push(existing);
      }
    }
    this.activeId = existing.id;
    return existing.id;
  }

  edit(id: string, text: string): void {
    const document = this.documents.find((item) => item.id === id);
    if (!document) return;
    document.text = text;
    document.revision += 1;
    document.dirty = this.isDirty(document);
  }

  setFormat(id: string, format: Partial<Pick<DocumentTab, "encoding" | "lineEnding">>): void {
    const document = this.documents.find((item) => item.id === id);
    if (!document) return;
    Object.assign(document, format);
    document.revision += 1;
    document.dirty = this.isDirty(document);
  }

  private isDirty(document: DocumentTab): boolean {
    return document.text !== document.originalText || document.encoding !== document.savedEncoding || document.lineEnding !== document.savedLineEnding;
  }

  /** null version means explicit consent to recreate a missing target, not to overwrite one. */
  async save(id: string, path?: string, overwriteHash?: string | null): Promise<SaveResult> {
    const document = this.documents.find((item) => item.id === id);
    if (!document) throw new Error("Document is closed");
    const target = path ?? document.path;
    if (!target) throw new Error("Choose a save path");
    if (document.lineEnding === "mixed") throw new Error("检测到混合换行，请先选择 LF / CRLF / CR 再保存。");
    if (document.busy) throw new Error("A save is already in progress");
    const captured = { text: document.text, encoding: document.encoding, lineEnding: document.lineEnding };
    document.busy = true;
    try {
      const sameTarget = document.path !== undefined && pathKey(document.path) === pathKey(target);
      const expectedHash = overwriteHash === null ? undefined : overwriteHash ?? (sameTarget ? document.version?.hash : undefined);
      const result = await this.files.save({ path: target, ...captured, expectedHash, expectedMissing: expectedHash === undefined });
      if (result.kind === "written") {
        document.path = result.path;
        document.name = result.path.split(/[\\/]/).at(-1) ?? document.name;
        document.version = result.version;
        document.originalText = captured.text;
        document.savedEncoding = captured.encoding;
        document.savedLineEnding = captured.lineEnding;
        document.external = undefined;
        document.observedVersion = undefined;
        document.ignoredHash = undefined;
        document.dirty = document.text !== captured.text || document.encoding !== captured.encoding || document.lineEnding !== captured.lineEnding;
      }
      return result;
    } finally {
      document.busy = false;
    }
  }

  async refresh(id: string): Promise<void> {
    const document = this.documents.find((item) => item.id === id);
    if (!document?.path || document.busy) return;
    const path = document.path;
    const status = await this.files.status(path);
    if (!this.documents.includes(document) || document.path !== path || document.busy) return;
    if (status.kind === "missing") {
      document.external = "missing";
      document.observedVersion = undefined;
    } else if (status.version.hash !== document.version?.hash && status.version.hash !== document.ignoredHash) {
      document.external = "changed";
      document.observedVersion = status.version;
    } else {
      document.external = undefined;
      document.observedVersion = undefined;
    }
  }

  async reload(id: string, discard = false): Promise<boolean> {
    const document = this.documents.find((item) => item.id === id);
    if (!document?.path || document.busy || (document.dirty && !discard)) return false;
    const revision = document.revision;
    document.busy = true;
    try {
      const snapshot = await this.files.read(document.path);
      if (!this.documents.includes(document) || document.revision !== revision) return false;
      Object.assign(document, documentFrom(snapshot, id), { revision: revision + 1, external: undefined, observedVersion: undefined, ignoredHash: undefined });
      return true;
    } finally {
      document.busy = false;
    }
  }

  close(id: string, discard = false): boolean {
    const document = this.documents.find((item) => item.id === id);
    if (!document || document.busy || (document.dirty && !discard)) return false;
    this.documents = this.documents.filter((item) => item.id !== id);
    if (this.activeId === id) this.activeId = this.documents.at(-1)?.id;
    return true;
  }
}
