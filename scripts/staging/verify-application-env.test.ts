import { describe, expect, it } from "vitest";
import { shouldLoadLocalStagingEnvironment } from "./verify-application-env";

describe("development infrastructure verifier environment isolation", () => {
  it("does not load local dotenv files only when the explicit internal opt-out is set", () => {
    expect(shouldLoadLocalStagingEnvironment({ CDAS_SKIP_LOCAL_ENV_CONFIG: "1" })).toBe(false);
    expect(shouldLoadLocalStagingEnvironment({})).toBe(true);
  });
});
