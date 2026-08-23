import { describe, expect, it } from "vitest";

import { evaluateHealthResponse } from "./application";

describe("evaluateHealthResponse", () => {
  it("accepts only the exact no-store health contract", () => {
    expect(
      evaluateHealthResponse({
        status: 200,
        cacheControl: "no-store",
        body: { status: "ok", deploymentId: "a".repeat(40), configurationProof: "b".repeat(64), sourceFingerprint: "f".repeat(64) },
        expectedDeploymentId: "a".repeat(40),
        expectedConfigurationProof: "b".repeat(64),
        expectedSourceFingerprint: "f".repeat(64),
      }).status,
    ).toBe("PASS");
  });

  it.each([
    { status: 503, cacheControl: "no-store", body: { status: "ok" } },
    { status: 200, cacheControl: "public, max-age=60", body: { status: "ok" } },
    { status: 200, cacheControl: "no-store", body: { status: "ok", detail: "extra" } },
  ])("fails closed for a non-contract response", (input) => {
    expect(evaluateHealthResponse({ ...input, expectedDeploymentId: "a".repeat(40), expectedConfigurationProof: "b".repeat(64), expectedSourceFingerprint: "f".repeat(64) }).status).toBe("FAIL");
  });
});
