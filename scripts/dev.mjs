import { startFrontend, closeFrontend } from "./frontend.mjs";
import { nativeEnvironment, tauriProcess, waitForChild } from "./native-env.mjs";
import { parsePort } from "./ports.mjs";

const mode = process.argv[2] ?? "desktop";
if (!["desktop", "web", "preview"].includes(mode)) throw new Error("用法：node scripts/dev.mjs [desktop|web|preview]");
const args = process.argv.slice(3);
const portIndex = args.indexOf("--port");
const preferred = parsePort(portIndex >= 0 ? args[portIndex + 1] : process.env.LEAF_PORT);
// Check the compiler before starting a server that would otherwise linger on failure.
const env = mode === "desktop" ? nativeEnvironment() : undefined;
const { server, url } = await startFrontend(mode, preferred);
let child;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  child?.kill();
  await closeFrontend(server);
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
if (mode === "desktop") {
  try {
    const config = JSON.stringify({ build: { devUrl: url, beforeDevCommand: "" } });
    child = tauriProcess(["dev", "--target", "x86_64-pc-windows-msvc", "--config", config], env);
    process.exitCode = await waitForChild(child);
  } finally { await stop(); }
}
