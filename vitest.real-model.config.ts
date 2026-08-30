import { defineConfig } from "vitest/config";

/**
 * Suites that call a real provider. Separated from `vitest.config.ts` because
 * they cost money and need a key, so they must never be picked up by the
 * default run — while still being a test rather than a script, since they need
 * to mock `server-only` to reach the prompt builders they exercise.
 */
export default defineConfig({
  test: {
    include: ["**/*.real-model.test.ts"],
    testTimeout: 300_000,
  },
});
