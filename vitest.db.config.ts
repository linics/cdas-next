import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(
        new URL("./src/test/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    fileParallelism: false,
    include: [
      "src/server/bootstrap/*.integration.test.ts",
      "src/server/commands/*.integration.test.ts",
      "src/server/queries/*.integration.test.ts",
      "scripts/staging/*.integration.test.ts",
    ],
    setupFiles: ["./src/test/require-test-database.ts"],
  },
});
