import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Real-model suites cost money and need a provider key, so they never run in
    // `pnpm test`. Invoke them by name: `pnpm test:real-model-injection`.
    exclude: [
      ...configDefaults.exclude,
      "**/*.integration.test.ts",
      "**/*.real-model.test.ts",
    ],
  },
});
