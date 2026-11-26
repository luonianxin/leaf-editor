import { copyFile, cp, lstat, mkdir, readFile, readdir, stat, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { basename, join, resolve } from "node:path";
import { root } from "./frontend.mjs";
import { verifyPortableExecutable } from "./windows-pe.mjs";
import { main as collectLicenses } from "./licenses.mjs";
import { verifyBuildRecord } from "./build-record.mjs";

if (process.platform !== "win32") throw new Error("此脚本生成 Windows 便携 ZIP，请在 Windows 上运行。");
const metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const binary = resolve(process.argv[2] ?? join(process.env.CARGO_TARGET_DIR ?? join(root, "src-tauri/target"), "x86_64-pc-windows-msvc/release/leaf-editor.exe"));
await access(binary, constants.R_OK);
const executable = await verifyPortableExecutable(binary);
const releaseDirectory = resolve(binary, "..");
const buildRecord = JSON.parse(await readFile(join(releaseDirectory, "leaf-build.json"), "utf8"));
verifyBuildRecord(buildRecord, {
  binary: await readFile(binary),
  cargoLock: await readFile(join(root, "src-tauri/Cargo.lock")),
  pnpmLock: await readFile(join(root, "pnpm-lock.yaml")),
  version: metadata.version,
});
let licenseInventory;
try { licenseInventory = await collectLicenses({ root, buildRecord }); }
catch (error) {
  if (error.result) console.error(error.result.unresolved.join("\n"));
  throw error;
}
const releases = join(root, "releases");
await mkdir(releases, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15).replace("T", "-");
const baseName = `Leaf-${metadata.version}-windows-x64-portable`;
let name = baseName;
try { await access(join(releases, name)); name = `${baseName}-${stamp}`; } catch { /* New release destination. */ }
const output = join(releases, name);
await mkdir(output);
await copyFile(binary, join(output, "Leaf.exe"));
// WebView2's loader may be either statically linked or emitted next to the executable.
for (const entry of await readdir(releaseDirectory)) if (/^WebView2Loader\.dll$/i.test(entry)) await copyFile(join(releaseDirectory, entry), join(output, entry));
await writeFile(join(output, "portable.flag"), "Leaf portable mode: keep webview data next to the application.\n");
await mkdir(join(output, "data"));
for (const file of ["LICENSE", "NOTICE", "CHANGELOG.md"]) await copyFile(join(root, file), join(output, file));
await copyFile(join(root, "../NOTICE"), join(output, "NOTICE-DBX"));
await copyFile(join(root, "licenses/README.md"), join(output, "LICENSE-COLLECTION.md"));
await writeFile(join(output, "build-info.json"), JSON.stringify({ version: metadata.version, target: buildRecord.target, rustc: buildRecord.rustc, vcToolsVersion: buildRecord.vcToolsVersion, windowsSdkVersion: buildRecord.windowsSdkVersion, rustflags: buildRecord.rustflags, features: buildRecord.features, cargoLockSha256: buildRecord.cargoLockSha256, pnpmLockSha256: buildRecord.pnpmLockSha256, binarySha256: buildRecord.binarySha256, builtAt: buildRecord.builtAt }, null, 2));
await writeFile(join(output, "使用说明.txt"), `轻页 Leaf ${metadata.version} 免安装版\r\n` + "\r\n1. 将整个文件夹解压到可写目录（不要直接在 ZIP 内运行）。\r\n2. 双击 Leaf.exe；可打开/拖入文本文件，也可点“打开目录”浏览工作区。目录树按需读取，单击文件夹展开/折叠，单击文件立即打开；首版不递归进入符号链接。\r\n3. 左侧可切换“文件 / 大纲”；大纲支持常见标题、类、函数、键和数据库对象，单击项目可跳转到对应行。\r\n4. 右下角编码、换行和语言菜单向上展开；选中文本在编辑器失焦后仍保留可见高亮。\r\n5. 关闭应用后不预热、不驻留。界面内嵌，不启动 HTTP 服务，不占用 1430 等开发端口。\r\n6. 主题和 WebView 缓存保存在 data\\webview；备份/移动时可带上 data。\r\n7. 需要系统已有 Microsoft Edge WebView2 Runtime。Windows 11 通常已有；本包不内置数百 MB 的 Runtime。\r\n8. 这是未签名的早期版本；先用副本验证。不要关闭 Windows 安全保护来运行本程序。\r\n9. 最大文本文件 16 MiB；超过 2 MiB 跳过语法与大纲解析；混合换行保存前须选择 LF/CRLF；UTF-16 保存带 BOM。\r\n10. 正常关闭保护不等于崩溃恢复。重要编辑请及时保存。\r\n\r\n快捷键：Ctrl+N 新建，Ctrl+O 打开文件，Ctrl+Shift+O 打开目录，Ctrl+S 保存，Ctrl+Shift+S 另存，Ctrl+F 查找替换，Ctrl+G 跳行。\r\n", "utf8");
await writeFile(join(output, "THIRD-PARTY-LICENSES.txt"), licenseInventory.text, "utf8");
const sourceEntries = licenseInventory.entries.filter(entry => entry.sourceAvailability);
const sourceNotes = ["Leaf third-party Source Code Form", "", "The following unmodified locked MPL-2.0 crate sources are included in this folder. You may inspect, modify and redistribute their Source Code Form under MPL-2.0; Leaf does not restrict those rights. Each source folder includes the original notices and the complete license. No source build scripts are executed by Leaf or by this packaging step.", ""];
for (const entry of sourceEntries) {
  const source = entry.sourceAvailability;
  const destination = join(output, source.destination);
  await cp(source.directory, destination, { recursive: true, force: false, errorOnExist: true, filter: async file => {
    const info = await lstat(file);
    if (info.isSymbolicLink()) throw new Error(`Unexpected symlink in third-party Source Code Form: ${file}`);
    return !["target", ".git"].includes(basename(file));
  } });
  await copyFile(join(root, "licenses/Mozilla-MPL-2.0.txt"), join(destination, "LEAF-LICENSE-MPL-2.0.txt"), constants.COPYFILE_EXCL);
  sourceNotes.push(`${entry.name} ${entry.version}: ${source.destination}`, `Upstream source: https://crates.io/crates/${entry.name}/${entry.version}`, "");
}
await writeFile(join(output, "THIRD-PARTY-SOURCES.txt"), `${sourceNotes.join("\n")}\n`, "utf8");
const files = [];
async function packageFiles(folder, prefix = "") {
  for (const entry of await readdir(folder)) {
    const file = join(folder, entry);
    const relative = prefix ? `${prefix}/${entry}` : entry;
    const info = await stat(file);
    if (info.isDirectory()) { await packageFiles(file, relative); continue; }
    const bytes = await readFile(file);
    files.push({ file: relative, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
}
await packageFiles(output);
await writeFile(join(output, "manifest.json"), JSON.stringify({ product: "Leaf", version: metadata.version, architecture: executable.architecture, runtime: "system WebView2", listeningPorts: false, signed: false, executable: { subsystem: "windows-gui", imports: executable.imports, staticCrt: true }, licenses: { collectedPackages: licenseInventory.entries.length, unresolved: licenseInventory.unresolved.length, pnpmLockfileSha256: licenseInventory.lockfileSha256, legalAudit: false }, createdAt: new Date().toISOString(), files }, null, 2));
const zip = join(releases, `${name}.zip`);
execFileSync("powershell.exe", ["-NoProfile", "-File", join(root, "scripts/zip-portable.ps1"), "-Source", output, "-Destination", zip], { stdio: "inherit" });
const bytes = await readFile(zip);
const hash = createHash("sha256").update(bytes).digest("hex");
await writeFile(`${zip}.sha256`, `${hash}  ${name}.zip\n`);
console.log(JSON.stringify({ folder: output, zip, sizeMiB: Math.round(bytes.length / 1024 / 1024 * 100) / 100, sha256: hash }, null, 2));
