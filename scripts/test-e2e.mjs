import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { startFrontend, closeFrontend, root } from "./frontend.mjs";
import { waitForChild } from "./native-env.mjs";
import { parsePort } from "./ports.mjs";

const require = createRequire(import.meta.url);
const { server, url } = await startFrontend("test", parsePort(process.env.LEAF_TEST_PORT, 1470));
const child = spawn(process.execPath, [require.resolve("@playwright/test/cli"), "test", ...process.argv.slice(2)], { cwd: root, env: { ...process.env, LEAF_TEST_URL: url }, stdio: "inherit" });
const stop = () => { child.kill(); void closeFrontend(server); };
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try { process.exitCode = await waitForChild(child); }
finally { await closeFrontend(server); }
