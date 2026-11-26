import test from "node:test";
import assert from "node:assert/strict";
import { inspectWindowsExecutable } from "../scripts/windows-pe.mjs";

function executable(importName = "KERNEL32.dll") {
  const bytes = Buffer.alloc(1024);
  bytes.write("MZ", 0);
  bytes.writeUInt32LE(0x80, 0x3c);
  bytes.write("PE\0\0", 0x80);
  bytes.writeUInt16LE(0x8664, 0x84);
  bytes.writeUInt16LE(1, 0x86);
  bytes.writeUInt16LE(240, 0x94);
  const optional = 0x98;
  bytes.writeUInt16LE(0x20b, optional);
  bytes.writeUInt16LE(2, optional + 68);
  bytes.writeUInt32LE(16, optional + 108);
  bytes.writeUInt32LE(0x1000, optional + 112 + 8);
  const section = optional + 240;
  bytes.writeUInt32LE(512, section + 8);
  bytes.writeUInt32LE(0x1000, section + 12);
  bytes.writeUInt32LE(512, section + 16);
  bytes.writeUInt32LE(512, section + 20);
  bytes.writeUInt32LE(0x1050, 512 + 12);
  bytes.write(importName, 512 + 80);
  return bytes;
}

test("PE inspection checks x64 GUI and reads DLL imports without executing", () => {
  assert.deepEqual(inspectWindowsExecutable(executable()), { machine: 0x8664, architecture: "x64", subsystem: 2, imports: ["KERNEL32.dll"] });
  assert.deepEqual(inspectWindowsExecutable(executable("VCRUNTIME140.dll")).imports, ["VCRUNTIME140.dll"]);
  assert.deepEqual(inspectWindowsExecutable(executable("ucrtbase.dll")).imports, ["ucrtbase.dll"]);
});
test("malformed and truncated PE input is rejected", () => {
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(100), executable().subarray(0, 700)]) {
    if (bytes.length === 700) bytes.writeUInt32LE(0x1500, 512 + 12);
    assert.throws(() => inspectWindowsExecutable(bytes));
  }
});
