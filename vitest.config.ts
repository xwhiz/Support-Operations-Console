import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/setup.ts"],
    // DB-touching test files truncate the shared test DB, so don't run files in
    // parallel. (Concurrency tests fire concurrent ops WITHIN a single test.)
    fileParallelism: false,
    hookTimeout: 60000,
    testTimeout: 30000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
