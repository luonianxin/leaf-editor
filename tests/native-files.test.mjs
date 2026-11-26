import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect } from "@playwright/test";
import { readFileHexForPoll } from "../scripts/native-files.mjs";

test("native byte assertion waits for asynchronously recreated files", async t => {
  const folder = await mkdtemp(join(tmpdir(), "leaf-native-poll-"));
  const file = join(folder, "recreated.txt");
  const publishing = delay(200).then(() => writeFile(file, "restored"));
  t.after(async () => { await publishing; await rm(folder, { recursive: true, force: true }); });
  await expect.poll(() => readFileHexForPoll(file), { timeout: 2000, intervals: [25, 50, 100] }).toBe(Buffer.from("restored").toString("hex"));
  assert.equal((await readFile(file)).toString(), "restored");
});

test("native byte assertion distinguishes missing from empty and propagates other errors", async t => {
  const folder = await mkdtemp(join(tmpdir(), "leaf-native-poll-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  assert.equal(await readFileHexForPoll(join(folder, "absent.txt")), null);
  const file = join(folder, "empty.txt");
  await writeFile(file, "");
  assert.equal(await readFileHexForPoll(file), "");
  const directory = join(folder, "directory");
  await mkdir(directory);
  await assert.rejects(readFileHexForPoll(directory), error => error.code !== "ENOENT");
});
