import { readFile } from "node:fs/promises";

/** Read the PE header/import names without loading or executing a binary. */
export function inspectWindowsExecutable(bytes) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  function requireRange(offset, length) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + length > bytes.length) throw new Error("Truncated or invalid Windows PE file.");
  }
  requireRange(0, 64);
  if (bytes.toString("ascii", 0, 2) !== "MZ") throw new Error("Not a Windows executable (MZ header missing).");
  const pe = bytes.readUInt32LE(0x3c);
  requireRange(pe, 24);
  if (bytes.toString("ascii", pe, pe + 4) !== "PE\0\0") throw new Error("PE signature missing.");
  const machine = bytes.readUInt16LE(pe + 4);
  const sectionCount = bytes.readUInt16LE(pe + 6);
  const optionalSize = bytes.readUInt16LE(pe + 20);
  const optional = pe + 24;
  requireRange(optional, optionalSize);
  const magic = bytes.readUInt16LE(optional);
  if (magic !== 0x20b) throw new Error("Only PE32+ (64-bit) executables are supported.");
  if (optionalSize < 128) throw new Error("Incomplete PE32+ optional header.");
  const subsystem = bytes.readUInt16LE(optional + 68);
  const directories = bytes.readUInt32LE(optional + 108);
  const sectionTable = optional + optionalSize;
  requireRange(sectionTable, sectionCount * 40);
  const sections = [];
  for (let i = 0; i < sectionCount; i += 1) {
    const entry = sectionTable + i * 40;
    sections.push({ virtualSize: bytes.readUInt32LE(entry + 8), virtualAddress: bytes.readUInt32LE(entry + 12), rawSize: bytes.readUInt32LE(entry + 16), rawOffset: bytes.readUInt32LE(entry + 20) });
  }
  function rvaOffset(rva) {
    const section = sections.find((item) => rva >= item.virtualAddress && rva - item.virtualAddress < Math.max(item.virtualSize, item.rawSize));
    if (!section || rva - section.virtualAddress >= section.rawSize) throw new Error("PE import points outside a stored section.");
    const offset = section.rawOffset + rva - section.virtualAddress;
    requireRange(offset, 1);
    return offset;
  }
  function dllName(rva) {
    const offset = rvaOffset(rva);
    const end = bytes.indexOf(0, offset);
    if (end < offset || end - offset > 512) throw new Error("Invalid PE DLL import name.");
    return bytes.toString("ascii", offset, end);
  }
  function directory(index) {
    if (directories <= index) return 0;
    const offset = optional + 112 + index * 8;
    if (offset + 8 > optional + optionalSize) throw new Error("Incomplete PE data directories.");
    return bytes.readUInt32LE(offset);
  }
  const imports = [];
  const importRva = directory(1);
  if (importRva) {
    let offset = rvaOffset(importRva);
    for (let count = 0; ; count += 1, offset += 20) {
      if (count >= 4096) throw new Error("Invalid PE import descriptor list.");
      requireRange(offset, 20);
      if (bytes.subarray(offset, offset + 20).every((value) => value === 0)) break;
      imports.push(dllName(bytes.readUInt32LE(offset + 12)));
    }
  }
  const delayRva = directory(13);
  if (delayRva) {
    let offset = rvaOffset(delayRva);
    for (let count = 0; ; count += 1, offset += 32) {
      if (count >= 4096) throw new Error("Invalid PE delayed import descriptor list.");
      requireRange(offset, 32);
      if (bytes.subarray(offset, offset + 32).every((value) => value === 0)) break;
      if ((bytes.readUInt32LE(offset) & 1) !== 1) throw new Error("Unsupported VA-based delayed imports.");
      imports.push(dllName(bytes.readUInt32LE(offset + 4)));
    }
  }
  return { machine, architecture: machine === 0x8664 ? "x64" : machine === 0xaa64 ? "arm64" : `0x${machine.toString(16)}`, subsystem, imports: [...new Set(imports)].sort((a, b) => a.localeCompare(b)) };
}

export async function verifyPortableExecutable(path) {
  const pe = inspectWindowsExecutable(await readFile(path));
  if (pe.architecture !== "x64" || pe.subsystem !== 2) throw new Error("Portable Leaf must be a Windows x64 GUI executable.");
  const redistributables = pe.imports.filter((name) => /^(?:vcruntime|msvcp|concrt|msvcr|vccorlib|ucrtbase|api-ms-win-crt-)/i.test(name));
  if (redistributables.length) throw new Error(`Portable binary still needs the Visual C++ redistributable: ${redistributables.join(", ")}. Rebuild with static CRT.`);
  return pe;
}
