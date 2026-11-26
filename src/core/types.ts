export type Encoding = "utf8" | "utf8Bom" | "utf16le" | "utf16be" | "gbk";
export type LineEnding = "lf" | "crlf" | "cr" | "mixed";

export interface FileVersion {
  hash: string;
  sizeBytes: number;
  modifiedMs: number;
}

export interface FileSnapshot {
  path: string;
  name: string;
  text: string;
  encoding: Encoding;
  lineEnding: LineEnding;
  version: FileVersion;
}

export interface SaveRequest {
  path: string;
  text: string;
  encoding: Encoding;
  lineEnding: LineEnding;
  expectedHash?: string;
  expectedMissing: boolean;
}

export type SaveResult =
  | { kind: "written"; path: string; version: FileVersion }
  | { kind: "conflict"; currentVersion: FileVersion }
  | { kind: "missing" };

export type FileStatus = { kind: "present"; version: FileVersion } | { kind: "missing" };

export type DirectoryEntryKind = "directory" | "file" | "symlink";

export interface DirectoryEntry {
  path: string;
  name: string;
  kind: DirectoryEntryKind;
}

export interface DirectoryListing {
  root: string;
  name: string;
  entries: DirectoryEntry[];
}

export interface DirectoryPort {
  list(path: string): Promise<DirectoryListing>;
}

/** Desktop and browser adapters share this content-safety seam. */
export interface FilePort {
  read(path: string, encoding?: Encoding): Promise<FileSnapshot>;
  status(path: string): Promise<FileStatus>;
  save(request: SaveRequest): Promise<SaveResult>;
}

export interface DocumentTab {
  id: string;
  path?: string;
  name: string;
  text: string;
  originalText: string;
  encoding: Encoding;
  savedEncoding: Encoding;
  lineEnding: LineEnding;
  savedLineEnding: LineEnding;
  version?: FileVersion;
  dirty: boolean;
  busy: boolean;
  revision: number;
  external?: "changed" | "missing";
  observedVersion?: FileVersion;
  ignoredHash?: string;
}

export const MAX_FILE_BYTES = 16 * 1024 * 1024;

export const ENCODINGS: { value: Encoding; label: string }[] = [
  { value: "utf8", label: "UTF-8" },
  { value: "utf8Bom", label: "UTF-8 BOM" },
  { value: "utf16le", label: "UTF-16 LE" },
  { value: "utf16be", label: "UTF-16 BE" },
  { value: "gbk", label: "GBK" },
];

export const LINE_ENDINGS: { value: LineEnding; label: string }[] = [
  { value: "lf", label: "LF" },
  { value: "crlf", label: "CRLF" },
  { value: "cr", label: "CR" },
  { value: "mixed", label: "混合换行（保存前需选择）" },
];
