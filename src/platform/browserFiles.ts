import type { Encoding, FileSnapshot, LineEnding } from "../core/types";
import { MAX_FILE_BYTES } from "../core/types";

export function normalizeText(text: string): { text: string; lineEnding: LineEnding } {
  const crlf = text.includes("\r\n");
  const remainder = text.replaceAll("\r\n", "");
  const lf = remainder.includes("\n");
  const cr = remainder.includes("\r");
  const count = Number(crlf) + Number(lf) + Number(cr);
  return { text: text.replace(/\r\n?|\n/g, "\n"), lineEnding: count > 1 ? "mixed" : crlf ? "crlf" : cr ? "cr" : "lf" };
}

export async function browserSnapshot(path: string, name: string, bytes: Uint8Array, modifiedMs = Date.now()): Promise<FileSnapshot> {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error("首版最多打开 16 MiB 文件，请使用专门的大文件工具。");
  let encoding: Encoding = "utf8";
  let data = bytes;
  let label = "utf-8";
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) { encoding = "utf8Bom"; data = bytes.slice(3); }
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = "utf16le"; label = "utf-16le"; data = bytes.slice(2); }
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = "utf16be"; label = "utf-16be"; data = bytes.slice(2); }
  let decoded: string;
  try { decoded = new TextDecoder(label, { fatal: true }).decode(data); }
  catch {
    if (encoding !== "utf8") throw new Error("文件编码无效，无法安全解码。");
    encoding = "gbk";
    decoded = new TextDecoder("gbk", { fatal: true }).decode(bytes);
  }
  if (decoded.includes("\0")) throw new Error("文件含有 NUL 字节，可能是二进制文件，未打开。");
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { path, name, ...normalizeText(decoded), encoding, version: { hash, sizeBytes: bytes.byteLength, modifiedMs } };
}

export function encodeDownload(text: string, encoding: Encoding, lineEnding: LineEnding): Uint8Array {
  if (lineEnding === "mixed") throw new Error("请先选择 LF / CRLF / CR 换行再导出。");
  if (encoding === "gbk") throw new Error("浏览器预览不支持安全写出 GBK，请使用桌面版，或明确选择 UTF-8 后导出。");
  const ending = lineEnding === "crlf" ? "\r\n" : lineEnding === "cr" ? "\r" : "\n";
  const content = text.replace(/\r\n?|\n/g, ending);
  if (encoding === "utf16le" || encoding === "utf16be") {
    const output = new Uint8Array(2 + content.length * 2);
    output.set(encoding === "utf16le" ? [0xff, 0xfe] : [0xfe, 0xff]);
    const view = new DataView(output.buffer);
    for (let index = 0; index < content.length; index += 1) view.setUint16(2 + index * 2, content.charCodeAt(index), encoding === "utf16le");
    return output;
  }
  const bytes = new TextEncoder().encode(content);
  if (encoding === "utf8") return bytes;
  const output = new Uint8Array(bytes.length + 3);
  output.set([0xef, 0xbb, 0xbf]);
  output.set(bytes, 3);
  return output;
}
