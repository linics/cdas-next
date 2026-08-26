import { describe, expect, it } from "vitest";

import { evaluateStagingDecision, expectedEvidenceChecks, isStagingDecision, requiredManualAttestations } from "./decision";

const passingEvidence = (schema: keyof typeof expectedEvidenceChecks) => ({
  schema,
  status: "PASS" as const,
  stagingSyntheticDecision: "GO",
  realStudentDataAllowed: false,
  productionDecision: "NO_GO",
  checks: expectedEvidenceChecks[schema].map((code) => ({
    code,
    status: "PASS",
    ...(
      schema === "staging-preflight.v1" && ["STAGING_BASE_URL_HTTPS_REMOTE", "STAGING_VERCEL_PROJECT_NAME", "DATABASE_URL_REMOTE_POOLED", "DIRECT_URL_REMOTE_DIRECT", "DATABASE_URL_TLS_REQUIRED", "DIRECT_URL_TLS_REQUIRED", "CLERK_TEST_PUBLISHABLE_KEY", "CLERK_TEST_SECRET_KEY", "STAGING_TEST_TEACHER_CLERK_ID", "STAGING_TEST_STUDENT_CLERK_ID", "CDAS_DEPLOYMENT_ID", "STAGING_HEALTH_PROOF_SECRET", "DEEPSEEK_CONFIG_WHEN_ENABLED"].includes(code)
        ? { present: true }
        : {}
    ),
  })),
});
const allManual = Object.fromEntries(
  requiredManualAttestations.map((name) => [name, "true"]),
);

function passingInput() {
  return {
    preflight: passingEvidence("staging-preflight.v1"),
    database: passingEvidence("staging-database.v1"),
    application: passingEvidence("staging-application.v1"),
    buildOutcome: "success",
    schemaDiffOutcome: "success",
    manualAttestations: allManual,
  };
}

describe("evaluateStagingDecision", () => {
  it("permits only synthetic staging and never production or real student data", () => {
    const result = evaluateStagingDecision(passingInput());

    expect(result.decision).toBe("GO");
    expect(result.stagingSyntheticDecision).toBe("GO");
    expect(result.realStudentDataAllowed).toBe(false);
    expect(result.productionDecision).toBe("NO_GO");
  });

  it.each([
    ["missing preflight", { preflight: undefined }],
    ["failed database", { database: { schema: "staging-database.v1", status: "FAIL" as const } }],
    ["not-run build", { buildOutcome: undefined }],
    ["failed schema diff", { schemaDiffOutcome: "failure" }],
    ["missing health", { application: undefined }],
    ["missing manual attestation", { manualAttestations: { ...allManual, STAGING_RETENTION_ATTESTED: undefined } }],
  ])("returns NO_GO when %s", (_name, override) => {
    expect(evaluateStagingDecision({ ...passingInput(), ...override }).decision).toBe("NO_GO");
  });

  it("rejects truncated and non-producer evidence shapes", () => {
    const truncated = {
      schema: "staging-preflight.v1",
      status: "PASS",
    };
    const missingPresent = passingEvidence("staging-preflight.v1");
    const firstPresent = missingPresent.checks.findIndex((check) => "present" in check);
    missingPresent.checks[firstPresent] = {
      code: missingPresent.checks[firstPresent]!.code,
      status: "PASS",
    };

    expect(evaluateStagingDecision({ ...passingInput(), preflight: truncated }).decision).toBe("NO_GO");
    expect(evaluateStagingDecision({ ...passingInput(), preflight: missingPresent }).decision).toBe("NO_GO");
  });

  it("accepts only the exact nested final-decision shape", () => {
    const decision = evaluateStagingDecision(passingInput());
    const withExtraField = structuredClone(decision) as unknown as {
      checks: Array<Record<string, unknown>>;
    };
    withExtraField.checks[0]!.detail = "forged";
    const emptyChecks = { ...decision, checks: [] };

    expect(isStagingDecision(decision)).toBe(true);
    expect(isStagingDecision(withExtraField)).toBe(false);
    expect(isStagingDecision(emptyChecks)).toBe(false);
  });
});
