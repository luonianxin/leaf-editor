import { access, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const LICENSE_NAME = /^(?:license|licence|notice|copying|copyright|unlicense)(?:[._ -].*)?$/i;
const LICENSE_DIR = /^(?:licenses?|notices?)$/i;

// Version-pinned supplements preserve the package's own SPDX/copyright notices.
// The full upstream permission text and the reviewed evidence are kept in licenses/.
export async function supplementLicenses(entries, root) {
  const rules = [
    { name: "@tauri-apps/plugin-dialog", version: "2.7.1", notice: "dist-js/index.js", marker: "Copyright 2019-2023 Tauri Programme within The Commons Conservancy" },
    { name: "tauri-plugin", version: "2.6.3", notice: "src/lib.rs", marker: "Copyright 2019-2024 Tauri Programme within The Commons Conservancy" },
  ];
  for (const entry of entries) {
    const rule = rules.find((item) => item.name === entry.name && item.version === entry.version);
    if (!rule || !/(?:^|\s|\()MIT(?:$|\s|\))/.test(entry.license)) continue;
    const source = join(entry.directory, rule.notice);
    if (!(await exists(source))) continue;
    const text = await readFile(source, "utf8");
    if (!text.includes(rule.marker) || !text.includes("SPDX-License-Identifier: MIT")) continue;
    const fullText = join(root, "licenses/Tauri-MIT.txt");
    const decisions = join(root, "licenses/README.md");
    if (!(await exists(fullText)) || !(await exists(decisions))) continue;
    entry.files.push(fullText);
    entry.supplementalNotice = `${rule.marker}\nSPDX-License-Identifier: MIT\nOriginal declaration: ${rule.notice}\nDistribution under the package's offered MIT alternative; full upstream permission text follows.\n`;
  }
  // khroma ships a complete MIT file but omits package.json's license field.
  // Accept only the exact reviewed package/repository/text combination.
  for (const entry of entries) {
    if (entry.name !== "khroma" || entry.version !== "2.1.0" || entry.license !== "UNDECLARED") continue;
    const manifestPath = join(entry.directory, "package.json");
    const licensePath = join(entry.directory, "license");
    if (!(await exists(manifestPath)) || !(await exists(licensePath))) continue;
    const manifest = await readJson(manifestPath);
    const text = await readFile(licensePath, "utf8");
    if (manifest.repository !== "github:fabiospampinato/khroma" ||
        !text.includes("The MIT License (MIT)") ||
        !text.includes("Copyright (c) 2019-present Fabio Spampinato, Andrew Maney") ||
        !text.includes("Permission is hereby granted, free of charge")) continue;
    entry.license = "MIT";
    if (!entry.files.includes(licensePath)) entry.files.push(licensePath);
    entry.supplementalNotice = "Installed package.json omits a license field; the exact package's bundled license file identifies MIT and retains the original copyright and terms.\n";
  }
  const webviewRules = { "webview2-com": "0.38.2", "webview2-com-sys": "0.38.2", "webview2-com-macros": "0.8.1" };
  for (const entry of entries) {
    if (webviewRules[entry.name] !== entry.version || entry.license !== "MIT") continue;
    const terms = join(root, "licenses/WebView2-Rust-MIT.txt");
    const manifest = join(entry.directory, "Cargo.toml");
    if (!(await exists(terms)) || !(await exists(manifest))) continue;
    if (!(await readFile(manifest, "utf8")).includes('repository = "https://github.com/wravery/webview2-rs"')) continue;
    entry.files.push(terms);
    entry.supplementalNotice = "MIT text retrieved from the package's exact recorded wravery/webview2-rs upstream commit; see licenses/README.md. Microsoft SDK/loader terms are separate.\n";
  }
  const unicCommit = "5878605364af97a3358368a6eaef02104af2e016";
  const pinnedRules = [
    { name: "alloc-stdlib", version: "0.2.4", license: "BSD-3-Clause", repository: "https://github.com/dropbox/rust-alloc-no-stdlib", commit: "ae42d22078b98549e987d2f03d12df7b984fde47", terms: ["Dropbox-Alloc-BSD-3-Clause.txt"] },
    { name: "selectors", version: "0.36.1", license: "MPL-2.0", repository: "https://github.com/servo/stylo", commit: "635e1a19d02960588a00e189bd4bd5bdb150ec3d", source: "lib.rs", marker: "This Source Code Form is subject to the terms of the Mozilla Public", terms: ["Mozilla-MPL-2.0.txt"] },
    ...["unic-char-property", "unic-char-range", "unic-common", "unic-ucd-ident", "unic-ucd-version"].map(name => ({ name, version: "0.9.0", license: "MIT/Apache-2.0", repository: "https://github.com/open-i18n/rust-unic/", commit: name === "unic-ucd-ident" ? "8a6ce83063d90b91ae2ce59eddb803edd393fca9" : unicCommit, source: "src/lib.rs", marker: name === "unic-ucd-ident" ? "Copyright 2017-2019 The UNIC Project Developers." : "Copyright 2017 The UNIC Project Developers.", terms: ["UNIC-MIT.txt", "UNIC-COPYRIGHT.md", "UNIC-AUTHORS.txt"] })),
  ];
  for (const entry of entries) {
    const rule = pinnedRules.find(item => item.name === entry.name && item.version === entry.version && item.license === entry.license);
    if (!rule) continue;
    const manifestPath = join(entry.directory, "Cargo.toml");
    const vcsPath = join(entry.directory, ".cargo_vcs_info.json");
    if (!(await exists(manifestPath)) || !(await exists(vcsPath))) continue;
    const manifest = await readFile(manifestPath, "utf8");
    const vcs = await readJson(vcsPath);
    if (vcs.git?.sha1 !== rule.commit || !manifest.includes(`repository = "${rule.repository}"`)) continue;
    const files = rule.terms.map(file => join(root, "licenses", file));
    if (!(await exists(join(root, "licenses/README.md"))) || !(await Promise.all(files.map(exists))).every(Boolean)) continue;
    if (rule.source) {
      const source = join(entry.directory, rule.source);
      if (!(await exists(source)) || !(await readFile(source, "utf8")).includes(rule.marker)) continue;
    }
    entry.files.push(...files.filter(file => !entry.files.includes(file)));
    const notice = [rule.marker, `Exact recorded upstream commit: ${rule.commit}`, "Complete terms and provenance are retained in licenses/README.md."].filter(Boolean);
    if (entry.name.startsWith("unic-")) notice.push("Distributed under the package's offered MIT alternative; the crate's own copyright notice is retained above.");
    if (entry.name === "selectors") {
      entry.sourceAvailability = { directory: entry.directory, destination: `third-party-sources/selectors-${entry.version}`, repository: rule.repository, commit: rule.commit };
      notice.push(`Unmodified Source Code Form is included at ${entry.sourceAvailability.destination}; see THIRD-PARTY-SOURCES.txt.`);
    }
    entry.supplementalNotice = `${notice.join("\n")}\n`;
  }
}

async function exists(file) {
  try { await access(file, constants.R_OK); return true; } catch { return false; }
}

function packagePath(root, name) {
  return join(root, "node_modules", ...name.split("/"));
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function findLicenseFiles(dir) {
  const found = [];
  async function walk(folder, inLicenseDirectory = false) {
    for (const item of await readdir(folder, { withFileTypes: true })) {
      // Never enter dependency stores, build output or symlinks outside a package.
      if (item.isDirectory() && !["node_modules", "target", ".git"].includes(item.name)) {
        await walk(join(folder, item.name), inLicenseDirectory || LICENSE_DIR.test(item.name));
      } else if (item.isFile() && (inLicenseDirectory || LICENSE_NAME.test(item.name))) {
        found.push(join(folder, item.name));
      }
    }
  }
  await walk(dir);
  return found.sort();
}

function packageLicense(packageMeta) {
  if (typeof packageMeta.license === "string") return packageMeta.license;
  if (Array.isArray(packageMeta.licenses)) return packageMeta.licenses.map(x => x.type || x).join(" OR ");
  if (packageMeta.license && typeof packageMeta.license === "object") return packageMeta.license.type || JSON.stringify(packageMeta.license);
  return "UNDECLARED";
}

async function resolvePackage(from, name) {
  let current = from;
  while (true) {
    const candidate = packagePath(current, name);
    if (await exists(join(candidate, "package.json"))) return realpath(candidate);
    const parent = dirname(current);
    if (parent === current) throw new Error(`Cannot resolve ${name} from ${from}`);
    current = parent;
  }
}

async function collectNpm(root, names) {
  const queue = [...new Set(names)].sort().map(name => ({ name, from: root }));
  const seen = new Set();
  const entries = [];
  const missingPackages = [];
  while (queue.length) {
    const { name: requested, from } = queue.shift();
    let dir;
    let meta;
    try { dir = await resolvePackage(from, requested); meta = await readJson(join(dir, "package.json")); }
    catch { missingPackages.push(`${requested} (required by ${from})`); continue; }
    if (seen.has(dir)) continue;
    seen.add(dir);
    const packageName = meta.name || requested;
    const version = meta.version || "UNKNOWN";
    const license = packageLicense(meta);
    const files = await findLicenseFiles(dir);
    const explicit = /^SEE LICENSE IN (.+)$/i.exec(license);
    if (explicit) {
      const file = resolve(dir, explicit[1]);
      if (await exists(file) && !files.includes(file)) files.push(file);
      else if (!files.includes(file)) missingPackages.push(`${packageName}@${version}: declared license file ${explicit[1]} missing`);
    }
    entries.push({ kind: "frontend", id: `npm:${packageName}@${version}`, name: packageName, version, license, directory: dir, files });
    for (const dependency of [meta.dependencies, meta.optionalDependencies]) {
      for (const name of Object.keys(dependency || {})) queue.push({ name, from: dir });
    }
    for (const name of Object.keys(meta.peerDependencies || {})) {
      try { await resolvePackage(dir, name); queue.push({ name, from: dir }); }
      catch { if (!meta.peerDependenciesMeta?.[name]?.optional) missingPackages.push(`${name} (peer of ${packageName}@${version})`); }
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  return { entries, missingPackages };
}

function cargoMetadata(manifest, target, buildRecord) {
  try {
    const env = { ...process.env };
    if (buildRecord?.cargoHome) env.CARGO_HOME = buildRecord.cargoHome;
    if (buildRecord?.cargoTargetDirectory) env.CARGO_TARGET_DIR = buildRecord.cargoTargetDirectory;
    env.CARGO_NET_OFFLINE = "true";
    const output = execFileSync("cargo", ["metadata", "--offline", "--locked", "--features", "custom-protocol", "--format-version", "1", "--filter-platform", target, "--manifest-path", manifest], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"], timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
    return JSON.parse(output);
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    return { error: `cargo metadata --offline failed: ${detail}` };
  }
}

export async function collectCargo(manifest, target, suppliedMetadata, buildRecord) {
  const metadata = suppliedMetadata || cargoMetadata(manifest, target, buildRecord);
  if (metadata.error) return { entries: [], unresolved: [metadata.error] };
  if (!metadata.resolve?.root) return { entries: [], unresolved: ["Cargo metadata has no resolved root"] };
  const nodes = new Map(metadata.resolve.nodes.map(node => [node.id, node]));
  const selected = new Set();
  const queue = [metadata.resolve.root];
  while (queue.length) {
    const id = queue.pop();
    if (selected.has(id)) continue;
    selected.add(id);
    for (const dep of nodes.get(id)?.deps || []) {
      if (dep.dep_kinds.some(kind => kind.kind !== "dev")) queue.push(dep.pkg);
    }
  }
  const workspace = new Set(metadata.workspace_members);
  const entries = [];
  const unresolved = [];
  for (const pkg of metadata.packages || []) {
    if (!selected.has(pkg.id) || workspace.has(pkg.id)) continue;
    const directory = dirname(pkg.manifest_path);
    const files = await findLicenseFiles(directory);
    if (pkg.license_file) {
      const explicit = resolve(directory, pkg.license_file);
      if (await exists(explicit) && !files.includes(explicit)) files.push(explicit);
      else if (!files.includes(explicit)) unresolved.push(`${pkg.name}@${pkg.version}: declared license_file ${pkg.license_file} missing`);
    }
    entries.push({ kind: "native", id: pkg.id, name: pkg.name, version: pkg.version, license: pkg.license || (pkg.license_file ? `SEE LICENSE IN ${pkg.license_file}` : "UNDECLARED"), directory, files });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  return { entries, unresolved };
}

async function render(entries, root, unresolved) {
  const chunks = [
    "Leaf third-party notices",
    "",
    "Generated offline from installed node_modules and Cargo metadata/cache.",
    "This inventory is not a legal audit and may be incomplete if packages or license texts are absent from the local cache.",
    "",
  ];
  for (const entry of entries) {
    chunks.push(`=== ${entry.name} ${entry.version} [${entry.license}] (${entry.kind}) ===`);
    if (entry.supplementalNotice) chunks.push(entry.supplementalNotice);
    if (!entry.files.length) {
      chunks.push(`MISSING LICENSE TEXT: no standard LICENSE/NOTICE/COPYING file found in ${entry.directory}`);
      chunks.push("The package metadata license expression is retained above; obtain/review the corresponding text before distribution.");
    } else {
      for (const file of entry.files) {
        const label = file.startsWith(entry.directory) ? relative(entry.directory, file).replaceAll("\\", "/") : `supplement/${basename(file)}`;
        chunks.push(`--- ${label} ---`);
        chunks.push(await readFile(file, "utf8"));
      }
    }
    chunks.push("");
  }
  if (unresolved.length) {
    chunks.push("=== UNRESOLVED OBLIGATIONS ===", ...unresolved.map(x => `- ${x}`), "");
  }
  return chunks.join("\n");
}

/**
 * Collects the locally installed frontend runtime graph, bundled CSS packages,
 * and offline Cargo packages for the Windows x64 target.
 *
 * Returns { text, entries, unresolved, missingPackages }. Set failOnUnresolved
 * false only when the caller wants an explicitly incomplete inventory.
 */
export async function collectNonCargo(options = {}) {
  const entries = [];
  const unresolved = [];
  const root = resolve(options.root || projectRoot);
  const build = options.buildRecord;
  try {
    const rust = execFileSync("rustc", ["--print", "sysroot"], { encoding: "utf8", timeout: 10000 }).trim();
    const version = execFileSync("rustc", ["-Vv"], { encoding: "utf8", timeout: 10000 }).trim();
    if (!build || build.rustc !== version || resolve(build.rustSysroot) !== resolve(rust)) {
      unresolved.push("A matching Release build record is required to verify Rust standard-library/toolchain notice provenance");
    }
    const directory = join(rust, "share/doc/rust");
    const files = [];
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (item.isFile() && LICENSE_NAME.test(item.name)) files.push(join(directory, item.name));
    }
    const licenseDir = join(directory, "licenses");
    if (await exists(licenseDir)) for (const item of await readdir(licenseDir, { withFileTypes: true })) {
      if (item.isFile()) files.push(join(licenseDir, item.name));
    }
    entries.push({ kind: "toolchain", name: "Rust standard library and distribution notices", version: version.split("\n")[0], license: "SEE COLLECTED DISTRIBUTION NOTICES", directory, files });
    if (!files.some(file => basename(file) === "COPYRIGHT-library.html")) unresolved.push("Rust standard-library consolidated copyright/license inventory unavailable");
  } catch (error) { unresolved.push(`Rust standard-library/toolchain notices unavailable: ${error.message}`); }
  const directory = join(root, "licenses");
  for (const entry of [
    { name: "Microsoft static CRT / Windows SDK references", version: `MSVC ${build?.vcToolsVersion ?? "UNKNOWN"}; SDK ${build?.windowsSdkVersion ?? "UNKNOWN"}`, license: "Microsoft software terms; not an open-source license", files: [join(directory, "MSVC-BuildTools-Terms.txt"), join(directory, "Windows-SDK-License.txt")], supplementalNotice: "Only linker results are included, not a compiler, SDK, standalone .lib, or VC redistributable installer. Full redistribution compliance is not certified by this inventory.\n" },
    { name: "Microsoft WebView2 loader/SDK", version: "1.0.3650.58 (webview2-com-sys 0.38.2)", license: "BSD-style Microsoft SDK package terms", files: [join(directory, "WebView2-SDK-License.txt")], supplementalNotice: "The system WebView2 Runtime is not included. SDK version is recorded in the locked bindings crate changelog.\n" },
  ]) {
    for (const file of entry.files) if (!(await exists(file))) unresolved.push(`${entry.name}: missing collected reference ${basename(file)}`);
    entries.push({ kind: "non-Cargo", directory, ...entry });
  }
  if (!build?.rustflags?.includes("target-feature=+crt-static") || !build?.vcToolsVersion || !build?.windowsSdkVersion) {
    unresolved.push("Release build record must identify static CRT flags, VC Tools and Windows SDK versions");
  }
  return { entries, unresolved };
}

export async function main(options = {}) {
  const root = resolve(options.root || projectRoot);
  const metadata = await readJson(join(root, "package.json"));
  const frontendRoots = [
    ...Object.keys(metadata.dependencies || {}),
    "daisyui",
    "tailwindcss",
  ];
  const npm = await collectNpm(root, frontendRoots);
  let native = { entries: [], unresolved: [] };
  if (options.includeCargo !== false) native = await collectCargo(resolve(options.cargoManifest || join(root, "src-tauri/Cargo.toml")), options.target || "x86_64-pc-windows-msvc", undefined, options.buildRecord);
  await supplementLicenses([...npm.entries, ...native.entries], root);
  const unresolved = [...npm.missingPackages.map(name => `frontend package ${name} could not be resolved from node_modules`), ...npm.entries.filter(e => !e.files.length).map(e => `${e.kind} package ${e.name}@${e.version} has no local license text`)];
  unresolved.push(...native.unresolved);
  const nonCargo = options.includeCargo === false ? { entries: [], unresolved: [] } : await collectNonCargo({ ...options, root });
  unresolved.push(...nonCargo.unresolved);
  const entries = [...npm.entries, ...native.entries, ...nonCargo.entries];
  for (const entry of native.entries) {
    if (entry.license === "MPL-2.0" && !entry.sourceAvailability) {
      entry.sourceAvailability = { directory: entry.directory, destination: `third-party-sources/${entry.name}-${entry.version}` };
    }
  }
  unresolved.push(...native.entries.filter(e => !e.files.length).map(e => `${e.kind} package ${e.name}@${e.version} has no local license text`));
  unresolved.push(...entries.filter(e => e.license === "UNDECLARED").map(e => `${e.kind} package ${e.name}@${e.version} has no declared license; review required`));
  for (const entry of entries) {
    const substantive = [];
    for (const file of entry.files) {
      const text = await readFile(file, "utf8");
      if (!text.trim()) unresolved.push(`${entry.name}@${entry.version}: empty notice/license file ${file}`);
      if (!/^(notice|copyright)(?:[._ -]|$)/i.test(basename(file)) && !/\.spdx$/i.test(file) && text.trim().length > 100) substantive.push(file);
    }
    if (entry.files.length && !substantive.length) unresolved.push(`${entry.name}@${entry.version}: only notices, identifiers or short/nonstandard texts found; full license text requires review`);
  }
  const lockfile = join(root, "pnpm-lock.yaml");
  const lockfileSha256 = await exists(lockfile) ? createHash("sha256").update(await readFile(lockfile)).digest("hex") : null;
  if (!lockfileSha256) unresolved.push("pnpm-lock.yaml missing; installed dependency provenance cannot be recorded");
  const text = await render(entries, root, unresolved);
  const report = `${text}\nInstalled node_modules are the frontend traversal source; lockfile SHA-256: ${lockfileSha256 || "MISSING"}. Lockfile/install agreement is not verified.\nNative inventory includes reachable normal/build dependencies for Windows x64, not an executable-level linkage audit. System WebView2 Runtime is not bundled; Rust standard-library, static MSVC CRT and WebView2 loader/SDK coverage is tracked separately above and is not established by Cargo.lock.\n`;
  if (options.outputPath) {
    await mkdir(dirname(resolve(options.outputPath)), { recursive: true });
    await writeFile(resolve(options.outputPath), report, "utf8");
  }
  const result = { text: report, entries, unresolved, missingPackages: npm.missingPackages, lockfileSha256, complete: unresolved.length === 0 };
  if (options.failOnUnresolved !== false && unresolved.length) {
    const error = new Error(`License inventory has ${unresolved.length} unresolved obligation(s); see the generated report.`);
    error.result = result;
    throw error;
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main({ outputPath: process.argv[2] || join(projectRoot, "THIRD-PARTY-LICENSES.txt") })
    .then(result => console.log(JSON.stringify({ output: process.argv[2] || "THIRD-PARTY-LICENSES.txt", entries: result.entries.length, complete: result.complete, unresolved: result.unresolved.length }, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
