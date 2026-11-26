import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { findAvailablePort, parsePort } from "../scripts/ports.mjs";

test("occupied ports are skipped without interrupting their owner", async () => {
  const occupied = net.createServer((connection) => connection.end("owner still running"));
  await new Promise((resolve) => occupied.listen({ host: "127.0.0.1", port: 0 }, resolve));
  const port = occupied.address().port;
  try {
    const selected = await findAvailablePort(port);
    assert.notEqual(selected, port);
    const message = await new Promise((resolve, reject) => {
      const client = net.connect({ host: "127.0.0.1", port });
      let result = "";
      client.on("data", (data) => { result += data; });
      client.on("end", () => resolve(result));
      client.on("error", reject);
    });
    assert.equal(message, "owner still running");
  } finally { await new Promise((resolve) => occupied.close(resolve)); }
});
test("port parsing rejects invalid values instead of silently targeting another service", () => {
  assert.equal(parsePort(undefined), 1430);
  assert.equal(parsePort("32000"), 32000);
  for (const value of ["0", "65536", "1430junk", "1.5", "-1"]) assert.throws(() => parsePort(value));
});
