import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  evaluateStagingPreflight,
  stagingAiAcknowledgement,
  stagingDataAcknowledgement,
} from "./contracts";
import { resolveStagingRunDirectory } from "./output";

const validEnvironment = {
  STAGING_RUN_MARKER: "cdas-staging-20260823-abcdef12",
  STAGING_DATA_ACK: stagingDataAcknowledgement,
  NODE_ENV: "production",
  STAGING_BASE_URL: "https://staging.cdas.example",
  DATABASE_URL:
    "postgresql://runtime:secret@project-pooler.example.com:5432/cdas_next_staging?sslmode=require",
  DIRECT_URL:
    "postgresql://direct:secret@project.example.com:5432/cdas_next_staging?sslmode=require",
  STAGING_DATABASE_NAME: "cdas_next_staging",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_abcdefghijklmnopqrstuv",
  CLERK_SECRET_KEY: "sk_test_abcdefghijklmnopqrstuv",
  STAGING_TEST_TEACHER_CLERK_ID: "user_teacher012345",
  STAGING_TEST_STUDENT_CLERK_ID: "user_student012345",
  AI_PROVIDER_DISABLED: "1",
  CDAS_DEPLOYMENT_ID: "a".repeat(40),
  STAGING_HEALTH_PROOF_SECRET: "h".repeat(32),
} as const;

describe("evaluateStagingPreflight", () => {
  it("accepts an isolated synthetic-only staging configuration", () => {
    const result = evaluateStagingPreflight(validEnvironment);

    expect(result.status).toBe("PASS");
    expect(result.stagingSyntheticDecision).toBe("GO");
    expect(result.realStudentDataAllowed).toBe(false);
    expect(result.productionDecision).toBe("NO_GO");
  });

  it.each([
    ["missing acknowledgement", { STAGING_DATA_ACK: "" }, "STAGING_SYNTHETIC_DATA_ACK"],
    ["http URL", { STAGING_BASE_URL: "http://staging.cdas.example" }, "STAGING_BASE_URL_HTTPS_REMOTE"],
    ["loopback URL", { STAGING_BASE_URL: "https://localhost" }, "STAGING_BASE_URL_HTTPS_REMOTE"],
    ["URL query", { STAGING_BASE_URL: "https://staging.cdas.example/?debug=1" }, "STAGING_BASE_URL_HTTPS_REMOTE"],
    ["live clerk", { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_abcdefghijklmnopqrstuv" }, "CLERK_TEST_PUBLISHABLE_KEY"],
    ["missing Clerk key", { CLERK_SECRET_KEY: "" }, "CLERK_TEST_SECRET_KEY"],
    ["same Clerk identity", { STAGING_TEST_STUDENT_CLERK_ID: "user_teacher012345" }, "STAGING_TEST_CLERK_IDS_DISTINCT"],
    ["local runtime database", { DATABASE_URL: "postgresql://runtime:secret@localhost:5432/cdas_next_staging?pgbouncer=true" }, "DATABASE_URL_REMOTE_POOLED"],
    ["reserved database", { STAGING_DATABASE_NAME: "postgres", DATABASE_URL: "postgresql://runtime:secret@project-pooler.example.com:5432/postgres?pgbouncer=true", DIRECT_URL: "postgresql://direct:secret@project.example.com:5432/postgres" }, "STAGING_DATABASE_NAME_ACKNOWLEDGED"],
    ["test overlap", { TEST_DATABASE_URL: "postgresql://test:secret@project-pooler.example.com:5432/cdas_next_staging?pgbouncer=true" }, "DATABASE_URL_ISOLATED_FROM_TEST_AND_E2E"],
    ["E2E overlap", { E2E_DATABASE_URL: "postgresql://e2e:secret@project.example.com:5432/cdas_next_staging?sslmode=require" }, "DATABASE_URL_ISOLATED_FROM_TEST_AND_E2E"],
    ["same runtime and direct target", { DIRECT_URL: "postgresql://direct:secret@project-pooler.example.com:5432/cdas_next_staging" }, "DATABASE_RUNTIME_DIRECT_TARGETS_DISTINCT"],
    ["runtime URL without TLS", { DATABASE_URL: "postgresql://runtime:secret@project-pooler.example.com:5432/cdas_next_staging?pgbouncer=true" }, "DATABASE_URL_TLS_REQUIRED"],
    ["oversized health proof secret", { STAGING_HEALTH_PROOF_SECRET: "h".repeat(4_097) }, "STAGING_HEALTH_PROOF_SECRET"],
    ["unacknowledged database", { STAGING_DATABASE_NAME: "other_staging" }, "STAGING_DATABASE_NAME_ACKNOWLEDGED"],
    ["private base hostname", { STAGING_BASE_URL: "https://127.0.0.2" }, "STAGING_BASE_URL_HTTPS_REMOTE"],
    ["localhost trailing dot", { STAGING_BASE_URL: "https://localhost." }, "STAGING_BASE_URL_HTTPS_REMOTE"],
    ["private database hostname", { DATABASE_URL: "postgresql://runtime:secret@10.0.0.1/cdas_next_staging?sslmode=require&pgbouncer=true" }, "DATABASE_URL_REMOTE_POOLED"],
    ["different cluster", { DIRECT_URL: "postgresql://direct:secret@other.example.com/cdas_next_staging?sslmode=require" }, "DATABASE_RUNTIME_DIRECT_CLUSTER_MATCH"],
    ["missing Vercel project in protected mode", { STAGING_DEPLOYMENT_PROTECTION_REQUIRED: "1" }, "STAGING_VERCEL_PROJECT_NAME"],
    ["custom staging domain in protected mode", { STAGING_DEPLOYMENT_PROTECTION_REQUIRED: "1" }, "STAGING_BASE_URL_HTTPS_REMOTE"],
    ["wrong Vercel project in protected mode", { STAGING_DEPLOYMENT_PROTECTION_REQUIRED: "1", STAGING_VERCEL_PROJECT_NAME: "cdas-next", STAGING_BASE_URL: "https://other-preview.vercel.app" }, "STAGING_BASE_URL_HTTPS_REMOTE"],
    ["invalid deployment protection mode", { STAGING_DEPLOYMENT_PROTECTION_REQUIRED: "true" }, "STAGING_DEPLOYMENT_PROTECTION_REQUIRED"],
  ])("fails closed for %s", (_name, override, code) => {
    const result = evaluateStagingPreflight({ ...validEnvironment, ...override });

    expect(result.status).toBe("FAIL");
    expect(result.stagingSyntheticDecision).toBe("NO_GO");
    expect(result.checks).toContainEqual(expect.objectContaining({ code, status: "FAIL" }));
  });

  it("permits absent AI secrets when AI is disabled", () => {
    const result = evaluateStagingPreflight(validEnvironment);

    expect(result.checks).toContainEqual(
      expect.objectContaining({ code: "DEEPSEEK_CONFIG_WHEN_ENABLED", status: "PASS", present: false }),
    );
  });

  it("requires an explicit synthetic and cost acknowledgement for enabled AI", () => {
    const missingAck = evaluateStagingPreflight({
      ...validEnvironment,
      AI_PROVIDER_DISABLED: "0",
    });
    const enabled = evaluateStagingPreflight({
      ...validEnvironment,
      AI_PROVIDER_DISABLED: "0",
      STAGING_AI_ACK: stagingAiAcknowledgement,
      DEEPSEEK_API_KEY: "deepseek-key-that-is-not-recorded",
      AI_MODEL: "deepseek-v4-flash",
      AI_TOOL_APPROVAL_SECRET: "a".repeat(32),
    });

    expect(missingAck.status).toBe("FAIL");
    expect(enabled.status).toBe("PASS");
  });

  it("does not serialize URLs, secrets, or Clerk user IDs into preflight evidence", () => {
    const result = evaluateStagingPreflight(validEnvironment);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("project-pooler.example.com");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("user_teacher012345");
  });

  it("requires the Vercel allowlist only when protected mode is explicitly enabled", () => {
    expect(evaluateStagingPreflight({
      ...validEnvironment,
      STAGING_DEPLOYMENT_PROTECTION_REQUIRED: "1",
      STAGING_BASE_URL: "https://cdas-next-preview123-linics1.vercel.app",
      STAGING_VERCEL_PROJECT_NAME: "cdas-next",
    }).status).toBe("PASS");
    const missingProject = evaluateStagingPreflight({
      ...validEnvironment,
      STAGING_DEPLOYMENT_PROTECTION_REQUIRED: "1",
    });
    expect(missingProject.status).toBe("FAIL");
    expect(missingProject.checks).toContainEqual(
      expect.objectContaining({ code: "STAGING_VERCEL_PROJECT_NAME", status: "FAIL" }),
    );
  });

  it("keeps generic Go/No-Go and Agent workflows free of protected-mode secrets", () => {
    for (const workflow of [
      ".github/workflows/staging-go-no-go.yml",
      ".github/workflows/staging-agent-acceptance.yml",
    ]) {
      const source = readFileSync(workflow, "utf8");
      expect(source).not.toContain("STAGING_DEPLOYMENT_PROTECTION_REQUIRED");
      expect(source).not.toContain("STAGING_VERCEL_AUTOMATION_BYPASS_SECRET");
    }
  });
});

describe("staging artifact paths", () => {
  it("accepts only a safe staging marker", () => {
    expect(resolveStagingRunDirectory("cdas-staging-20260823-abcdef12")).toContain(
      "output/staging/cdas-staging-20260823-abcdef12",
    );
    expect(() => resolveStagingRunDirectory("../../outside")).toThrow(
      "STAGING_RUN_MARKER_INVALID",
    );
  });
});
