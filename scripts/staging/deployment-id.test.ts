import { describe, expect, it } from "vitest";

import { buildDeploymentId } from "./deployment-id";

describe("build deployment identity", () => {
  it("prefers an explicit build identity", () => {
    expect(buildDeploymentId({
      CDAS_DEPLOYMENT_ID: "explicit",
      VERCEL_GIT_COMMIT_SHA: "vercel-sha",
    })).toBe("explicit");
  });

  it("uses Vercel's Git SHA when an explicit identity is absent", () => {
    expect(buildDeploymentId({ VERCEL_GIT_COMMIT_SHA: "vercel-sha" })).toBe("vercel-sha");
  });

  it("does not invent a runtime fallback", () => {
    expect(buildDeploymentId({})).toBe("");
  });
});
