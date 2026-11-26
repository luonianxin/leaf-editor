import { createHash } from "node:crypto";

export function verifyBuildRecord(record, inputs) {
  if (!inputs.version || record.version !== inputs.version) {
    throw new Error("Release version does not match its build record; rebuild before packaging.");
  }
  for (const [name, field] of [["binary", "binarySha256"], ["cargoLock", "cargoLockSha256"], ["pnpmLock", "pnpmLockSha256"]]) {
    const actual = createHash("sha256").update(inputs[name]).digest("hex");
    if (actual !== record[field]) throw new Error(`Release ${name} does not match its build record; rebuild before packaging.`);
  }
  if (record.target !== "x86_64-pc-windows-msvc" || !record.features?.includes("custom-protocol") || !record.rustflags?.includes("target-feature=+crt-static")) {
    throw new Error("Portable Release requires the recorded Windows x64 target, embedded custom protocol and static CRT flags.");
  }
}
