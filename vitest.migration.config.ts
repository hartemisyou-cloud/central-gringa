import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Each SQL suite boots PostgreSQL WASM. Bound workers to avoid competing
  // cold starts exhausting the host during the complete migration check.
  test: { environment: "node", maxWorkers: 2, testTimeout: 15000, hookTimeout: 30000 },
});
