import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  outputDir: "artifacts/playwright",
  use: {
    baseURL: process.env.LEAF_TEST_URL ?? "http://127.0.0.1:1470",
    channel: "chrome",
    viewport: { width: 1120, height: 760 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  // scripts/test-e2e.mjs owns the actual server. Never reuse an unrelated listener.
});
