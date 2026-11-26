import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { root } from "./frontend.mjs";

const require = createRequire(import.meta.url);
export function nativeEnvironment() {
  let environment = { ...process.env };
  if (process.platform === "win32") {
    const output = execFileSync("powershell.exe", ["-NoProfile", "-File", join(root, "scripts/windows-build-env.ps1")], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    const captured = JSON.parse(output.replace(/^﻿/, "").trim());
    // Windows environment names are case insensitive, but Node objects are not.
    for (const [key, value] of Object.entries(captured)) {
      for (const previous of Object.keys(environment)) if (previous.toLowerCase() === key.toLowerCase()) delete environment[previous];
      environment[key] = value;
    }
    environment.RUSTFLAGS = `${process.env.RUSTFLAGS ?? ""} -C target-feature=+crt-static -C link-arg=/STACK:2097152`.trim();
  }
  environment.CARGO_BUILD_JOBS = process.env.CARGO_BUILD_JOBS ?? "2";
  return environment;
}

export function tauriProcess(args, env = nativeEnvironment()) {
  return spawn(process.execPath, [require.resolve("@tauri-apps/cli/tauri.js"), ...args], { cwd: root, env, stdio: "inherit", windowsHide: false });
}
export function waitForChild(child) {
  return new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0))); });
}
