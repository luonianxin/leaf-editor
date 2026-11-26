import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { root } from "./frontend.mjs";

if (process.platform !== "win32" || !process.argv[2]) throw new Error("Usage on Windows: node scripts/test-native-profile.mjs <portable Leaf.exe>");
const binary = resolve(process.argv[2]);
await access(join(dirname(binary), "portable.flag"));
const inspect = (action, id = 0) => JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-File", join(root, "scripts/native-window.ps1"), "-Action", action, "-ProcessId", String(id)], { encoding: "utf8" }).trim());
assert.equal(inspect("existing").length, 0, "This check will not close an existing Leaf window.");
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^(WEBVIEW2_USER_DATA_FOLDER|WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS|WEBVIEW2_REMOTE_DEBUGGING_PORT|LEAF_DATA_DIR)$/i.test(key)) delete env[key];
const child = spawn(binary, [], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
let logs = "";
child.stderr.on("data", bytes => { logs += bytes; });
try {
  let state;
  for (let i = 0; i < 15; i++) {
    await delay(200);
    state = inspect("inspect", child.pid);
    if (state.hasWindow && state.processes.some(item => /msedgewebview2/i.test(item.name))) break;
  }
  assert.ok(state.hasWindow, logs || "No Leaf window");
  await delay(1000);
  state = inspect("inspect", child.pid);
  const profile = join(dirname(binary), "data", "webview");
  const files = await readdir(profile);
  const runtimeProfiles = [...new Set(state.processes.map(item => item.webviewDataDirectory).filter(Boolean))];
  console.log(JSON.stringify({ expectedProfile: profile, runtimeProfiles, profileEntries: files.length, listeners: state.listeners }, null, 2));
  assert.ok(files.length > 0, "Portable WebView data must be written beside this executable.");
  assert.ok(runtimeProfiles.length > 0 && runtimeProfiles.every(path => resolve(path).toLowerCase().startsWith(`${resolve(profile).toLowerCase()}\\`)), "The actual WebView process must use this portable profile.");
  assert.deepEqual(state.listeners, [], "Normal portable launch must not create a TCP listener.");
  console.log("PASS real portable profile");
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    inspect("close", child.pid);
    for (let i = 0; i < 50 && child.exitCode === null; i++) await delay(100);
    if (child.exitCode === null) child.kill();
  }
}
