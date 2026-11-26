import { readFile } from "node:fs/promises";

export async function readFileHexForPoll(path) {
  try { return (await readFile(path)).toString("hex"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
