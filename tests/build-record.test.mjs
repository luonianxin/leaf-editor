import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { verifyBuildRecord } from "../scripts/build-record.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const inputs = { binary: Buffer.from("Release binary"), cargoLock: Buffer.from("Cargo lock"), pnpmLock: Buffer.from("pnpm lock"), version: "0.2.0" };
const record = { version: inputs.version, binarySha256: hash(inputs.binary), cargoLockSha256: hash(inputs.cargoLock), pnpmLockSha256: hash(inputs.pnpmLock), target: "x86_64-pc-windows-msvc", features: ["custom-protocol"], rustflags: "-C target-feature=+crt-static" };

test("portable provenance requires matching version, binary and both current lockfiles", () => {
  assert.doesNotThrow(() => verifyBuildRecord(record, inputs));
  for (const key of Object.keys(inputs)) assert.throws(() => verifyBuildRecord(record, { ...inputs, [key]: key === "version" ? "0.1.0" : Buffer.from("changed") }), new RegExp(key));
  assert.throws(() => verifyBuildRecord({ ...record, version: undefined }, inputs), /version/);
  assert.throws(() => verifyBuildRecord(record, { ...inputs, version: undefined }), /version/);
});

test("portable provenance rejects missing embedded protocol or static CRT flags", () => {
  for (const invalid of [{ target: "i686-pc-windows-msvc" }, { features: [] }, { rustflags: "" }]) {
    assert.throws(() => verifyBuildRecord({ ...record, ...invalid }, inputs), /Windows x64/);
  }
});
