import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { build, createServer, preview } from "vite";
import { findAvailablePort, parsePort } from "./ports.mjs";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Bind the real Vite server before telling Tauri/test clients its chosen URL. */
export async function startFrontend(mode = "web", preferred = parsePort(process.env.LEAF_PORT)) {
  if (mode === "test") {
    await build({ root, configFile: resolve(root, "vite.config.ts"), logLevel: "error" });
  }
  let candidate = preferred;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const port = await findAvailablePort(candidate);
    let server;
    try {
      if (mode === "preview" || mode === "test") {
        server = await preview({ root, configFile: resolve(root, "vite.config.ts"), preview: { host: "127.0.0.1", port, strictPort: true }, logLevel: "error" });
      } else {
        server = await createServer({ root, configFile: resolve(root, "vite.config.ts"), server: { host: "127.0.0.1", port, strictPort: true }, logLevel: "error" });
        await server.listen();
      }
      const url = `http://127.0.0.1:${port}`;
      const label = mode === "preview" ? "生产预览" : mode === "test" ? "测试服务" : "开发服务";
      console.log(`[Leaf] ${label}: ${url}${port !== preferred ? `（${preferred} 已占用，保留原服务）` : ""}`);
      return { server, url, port };
    } catch (error) {
      await server?.close?.();
      if (error?.code !== "EADDRINUSE" && !String(error?.message).includes("already in use")) throw error;
      // Another process may win between the probe and listen; retry without killing it.
      candidate = port + 1;
    }
  }
  throw new Error("端口持续被其他进程抢占，请使用 LEAF_PORT 选择不同的起点。");
}

export async function closeFrontend(server) {
  if (server.close) await server.close();
  else if (server.httpServer) await new Promise((resolve) => server.httpServer.close(resolve));
}
