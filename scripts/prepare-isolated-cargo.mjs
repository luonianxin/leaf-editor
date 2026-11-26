import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { root } from "./frontend.mjs";

const source = process.env.CARGO_HOME ?? join(process.env.USERPROFILE, ".cargo");
await mkdir(join(root, "artifacts"), { recursive: true });
const base = await mkdtemp(join(root, "artifacts", "isolated-build-"));
const cargoHome = join(base, "cargo-home");
const target = join(base, "target");
await mkdir(cargoHome);
// Snapshot only lockfile-listed packages into a fresh cache; the shared cache
// can contain the whole DBX database workspace and need not be copied in full.
const lockfile = await readFile(join(root, "src-tauri/Cargo.lock"), "utf8");
const packages = new Set([...lockfile.matchAll(/\[\[package\]\]\r?\nname = "([^"]+)"\r?\nversion = "([^"]+)"/g)].map((match) => `${match[1]}-${match[2]}`));
for (const name of ["cache", "src", "index"]) {
  const parent = join(source, "registry", name);
  for (const registry of await readdir(parent)) {
    await cp(join(parent, registry), join(cargoHome, "registry", name, registry), {
      recursive: true,
      filter: (path) => {
        const relative = path.slice(join(parent, registry).length).replaceAll("\\", "/").replace(/^\//, "");
        if (!relative) return true;
        if (name === "index") return !/(?:^|\/)(?:\.package-cache(?:-mutate)?|\.global-cache|\.last-use)$/.test(relative);
        const packageName = relative.split("/")[0].replace(/\.crate$/, "");
        return packages.has(packageName);
      },
    });
  }
}
const rustc = execFileSync("rustc", ["-Vv"], { encoding: "utf8" }).trim();
const record = { cargoHome, target, source, rustc, createdAt: new Date().toISOString() };
await writeFile(join(base, "environment.json"), JSON.stringify(record, null, 2));
await writeFile(join(root, "artifacts", "native-build-env.json"), JSON.stringify(record, null, 2));
console.log(JSON.stringify(record, null, 2));
