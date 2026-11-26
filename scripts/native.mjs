import { spawn, execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { nativeEnvironment, tauriProcess, waitForChild } from "./native-env.mjs";
import { root } from "./frontend.mjs";

const mode = process.argv[2] ?? "build";
const environment = nativeEnvironment();
let child;
if (mode === "build") child = tauriProcess(["build", "--target", "x86_64-pc-windows-msvc", "--no-bundle", "--features", "custom-protocol", "--", "--locked"], environment);
else if (mode === "test") child = spawn("cargo", ["test", "--locked", "--target", "x86_64-pc-windows-msvc", "--manifest-path", join(root, "src-tauri/Cargo.toml"), "-p", "leaf-file-core"], { cwd: root, env: environment, stdio: "inherit" });
else if (mode === "check") child = spawn("cargo", ["check", "--locked", "--target", "x86_64-pc-windows-msvc", "--manifest-path", join(root, "src-tauri/Cargo.toml"), "--features", "custom-protocol"], { cwd: root, env: environment, stdio: "inherit" });
else throw new Error("用法：node scripts/native.mjs [build|test|check]");
process.exitCode = await waitForChild(child);
if (mode === "build" && process.exitCode === 0) {
  const target = resolve(environment.CARGO_TARGET_DIR ?? join(root, "src-tauri/target"));
  const binary = join(target, "x86_64-pc-windows-msvc/release/leaf-editor.exe");
  const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const build = {
    version: JSON.parse(await readFile(join(root, "package.json"), "utf8")).version,
    binarySha256: sha256(await readFile(binary)),
    cargoLockSha256: sha256(await readFile(join(root, "src-tauri/Cargo.lock"))),
    cargoHome: environment.CARGO_HOME,
    cargoTargetDirectory: target,
    pnpmLockSha256: sha256(await readFile(join(root, "pnpm-lock.yaml"))),
    rustc: execFileSync("rustc", ["-Vv"], { encoding: "utf8", env: environment }).trim(),
    rustSysroot: execFileSync("rustc", ["--print", "sysroot"], { encoding: "utf8", env: environment }).trim(),
    vcToolsVersion: environment.VCToolsVersion?.replace(/[\\/]+$/, ""),
    vcToolsDirectory: environment.VCToolsInstallDir,
    windowsSdkVersion: environment.WindowsSDKVersion?.replace(/[\\/]+$/, ""),
    windowsSdkDirectory: environment.WindowsSdkDir,
    rustflags: environment.RUSTFLAGS,
    target: "x86_64-pc-windows-msvc",
    features: ["custom-protocol"],
    builtAt: new Date().toISOString(),
  };
  await writeFile(join(target, "x86_64-pc-windows-msvc/release/leaf-build.json"), JSON.stringify(build, null, 2));
  console.log(`Leaf Release build record: ${join(target, "x86_64-pc-windows-msvc/release/leaf-build.json")}`);
}
