import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("trial compose configuration", () => {
  it("loads application secrets from the configured private runtime environment", async () => {
    const compose = await readFile(new URL("./compose.yaml", import.meta.url), "utf8");

    expect(compose).toContain(
      "- ${TRIAL_RUNTIME_ENV_FILE:?TRIAL_RUNTIME_ENV_FILE is required}",
    );
  });

  it("normalizes the shell entrypoint before the Linux image runs it", async () => {
    const dockerfile = await readFile(new URL("./Dockerfile", import.meta.url), "utf8");

    expect(dockerfile).toContain("sed -i 's/\\r$//' deploy/trial/entrypoint.sh");
  });
});
