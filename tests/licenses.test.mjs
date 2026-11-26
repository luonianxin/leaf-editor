import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectCargo, main, supplementLicenses } from "../scripts/licenses.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "leaf-licenses-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { alpha: "1" } }));
  async function pkg(name, meta = {}, license = "Permission is hereby granted.\n", base = root) {
    const dir = join(base, "node_modules", name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0", license: "MIT", ...meta }));
    if (license !== null) await writeFile(join(dir, "LICENSE"), license.repeat(10));
    return dir;
  }
  await pkg("daisyui"); await pkg("tailwindcss");
  return { root, pkg };
}

test("native graph excludes unreachable and dev-only crates, retains build dependencies and license_file", async t => {
  const { root } = await fixture(t);
  const packages = [];
  for (const name of ["app", "runtime", "build", "dev", "other-platform"]) {
    const dir = join(root, name);
    await mkdir(dir);
    await writeFile(join(dir, "terms.txt"), "Actual native terms");
    packages.push({ id: name, name, version: "1", manifest_path: join(dir, "Cargo.toml"), license: "MIT OR Apache-2.0", license_file: "terms.txt" });
  }
  const result = await collectCargo("unused", "x86_64-pc-windows-msvc", {
    packages, workspace_members: ["app"], resolve: { root: "app", nodes: [
      { id: "app", deps: [
        { pkg: "runtime", dep_kinds: [{ kind: null }] },
        { pkg: "build", dep_kinds: [{ kind: "build" }] },
        { pkg: "dev", dep_kinds: [{ kind: "dev" }] },
      ] },
    ] },
  });
  assert.deepEqual(result.entries.map(x => x.name), ["build", "runtime"]);
  assert.ok(result.entries.every(x => x.files.some(f => f.endsWith("terms.txt"))));
});


test("collects nested runtime dependencies, CSS, notices", async t => {
  const { root, pkg } = await fixture(t);
  const alpha = await pkg("alpha", { dependencies: { beta: "2" } });
  await pkg("beta", { version: "2.0.0" }, "Beta actual license text", alpha);
  await writeFile(join(alpha, "NOTICE.txt"), "Alpha attribution");
  await mkdir(join(alpha, "vendor"));
  await writeFile(join(alpha, "vendor", "COPYING"), "Vendored copyright");
  const result = await main({ root, includeCargo: false });
  assert.equal(result.entries.length, 4);
  assert.match(result.text, /beta 2.0.0/);
  assert.match(result.text, /Beta actual license text/);
  assert.match(result.text, /Alpha attribution/);
  assert.match(result.text, /Vendored copyright/);
  assert.ok(result.entries.some(x => x.name === "daisyui"));
});

test("fails closed on missing package or license text and exposes partial result", async t => {
  const { root, pkg } = await fixture(t);
  await pkg("alpha", { dependencies: { absent: "1" } }, null);
  await assert.rejects(main({ root, includeCargo: false }), error => {
    assert.equal(error.result.complete, false);
    assert.match(error.result.text, /MISSING LICENSE TEXT/);
    assert.ok(error.result.unresolved.some(x => x.includes("absent")));
    return true;
  });
});

test("version-pinned Tauri supplement retains the distributed package copyright", async t => {
  const { root, pkg } = await fixture(t);
  await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { "@tauri-apps/plugin-dialog": "2.7.1" } }));
  const dir = await pkg("@tauri-apps/plugin-dialog", { version: "2.7.1", license: "MIT OR Apache-2.0" }, null);
  await mkdir(join(dir, "dist-js"));
  await writeFile(join(dir, "dist-js/index.js"), "// Copyright 2019-2023 Tauri Programme within The Commons Conservancy\n// SPDX-License-Identifier: MIT\n");
  await writeFile(join(dir, "LICENSE.spdx"), "SPDX-License-Identifier: MIT");
  await mkdir(join(root, "licenses"));
  await writeFile(join(root, "licenses/Tauri-MIT.txt"), "Permission is hereby granted, free of charge. ".repeat(10));
  await writeFile(join(root, "licenses/README.md"), "Evidence for exact package version.");
  const result = await main({ root, includeCargo: false });
  assert.match(result.text, /Copyright 2019-2023 Tauri Programme within The Commons Conservancy/);
  assert.match(result.text, /supplement\/Tauri-MIT.txt/);
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "@tauri-apps/plugin-dialog", version: "2.8.5", license: "MIT" }));
  await assert.rejects(main({ root, includeCargo: false }), /unresolved obligation/);
});

test("honors nonstandard explicitly declared npm license file", async t => {
  const { root, pkg } = await fixture(t);
  const dir = await pkg("alpha", { license: "SEE LICENSE IN legal.txt" }, null);
  await writeFile(join(dir, "legal.txt"), "Actual custom terms".repeat(10));
  const result = await main({ root, includeCargo: false });
  assert.match(result.text, /Actual custom terms/);
  assert.match(result.text, /SEE LICENSE IN legal.txt/);
});

test("missing native terms use only exact reviewed versions, commits and source notices", async t => {
  const { root } = await fixture(t);
  await mkdir(join(root, "licenses"));
  for (const file of ["README.md", "Dropbox-Alloc-BSD-3-Clause.txt", "Mozilla-MPL-2.0.txt", "UNIC-MIT.txt", "UNIC-COPYRIGHT.md", "UNIC-AUTHORS.txt"]) await writeFile(join(root, "licenses", file), "Actual upstream permission and notice text".repeat(10));
  const unicCommit = "5878605364af97a3358368a6eaef02104af2e016";
  const rules = [
    { name: "alloc-stdlib", version: "0.2.4", license: "BSD-3-Clause", repository: "https://github.com/dropbox/rust-alloc-no-stdlib", commit: "ae42d22078b98549e987d2f03d12df7b984fde47" },
    { name: "selectors", version: "0.36.1", license: "MPL-2.0", repository: "https://github.com/servo/stylo", commit: "635e1a19d02960588a00e189bd4bd5bdb150ec3d", source: "lib.rs", marker: "This Source Code Form is subject to the terms of the Mozilla Public" },
    ...["unic-char-property", "unic-char-range", "unic-common", "unic-ucd-ident", "unic-ucd-version"].map(name => ({ name, version: "0.9.0", license: "MIT/Apache-2.0", repository: "https://github.com/open-i18n/rust-unic/", commit: name === "unic-ucd-ident" ? "8a6ce83063d90b91ae2ce59eddb803edd393fca9" : unicCommit, source: "src/lib.rs", marker: name === "unic-ucd-ident" ? "Copyright 2017-2019 The UNIC Project Developers." : "Copyright 2017 The UNIC Project Developers." })),
  ];
  const entries = [];
  for (const rule of rules) {
    const directory = join(root, rule.name);
    await mkdir(directory);
    await writeFile(join(directory, "Cargo.toml"), `repository = "${rule.repository}"\n`);
    await writeFile(join(directory, ".cargo_vcs_info.json"), JSON.stringify({ git: { sha1: rule.commit } }));
    if (rule.source) {
      if (rule.source.startsWith("src/")) await mkdir(join(directory, "src"));
      await writeFile(join(directory, rule.source), rule.marker);
    }
    entries.push({ ...rule, directory, files: [] });
  }
  await supplementLicenses(entries, root);
  assert.ok(entries.every(entry => entry.files.length > 0));
  assert.match(entries.find(entry => entry.name === "unic-ucd-ident").supplementalNotice, /2017-2019/);
  assert.equal(entries.find(entry => entry.name === "selectors").sourceAvailability.destination, "third-party-sources/selectors-0.36.1");
  const newer = entries.map(entry => ({ ...entry, version: "99.0.0", files: [] }));
  await supplementLicenses(newer, root);
  assert.ok(newer.every(entry => entry.files.length === 0));
  for (const entry of entries) await writeFile(join(entry.directory, ".cargo_vcs_info.json"), JSON.stringify({ git: { sha1: "different upstream commit" } }));
  const changed = entries.map(entry => ({ ...entry, files: [] }));
  await supplementLicenses(changed, root);
  assert.ok(changed.every(entry => entry.files.length === 0));
});
