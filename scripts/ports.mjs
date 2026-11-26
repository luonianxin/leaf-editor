import net from "node:net";

export function parsePort(value, fallback = 1430) {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(String(value))) throw new Error("端口必须是 1–65535 的整数");
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("端口必须是 1–65535 的整数");
  return port;
}

export async function portAvailable(port) {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") resolve(false);
      else reject(error);
    });
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

export async function findAvailablePort(preferred = 1430, attempts = 100) {
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = preferred + offset;
    if (port > 65535) break;
    if (await portAvailable(port)) return port;
  }
  throw new Error(`从 ${preferred} 开始没有找到可用端口；可通过 LEAF_PORT 指定其他范围。不会结束占用端口的程序。`);
}
