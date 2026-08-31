import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  acceptanceNamespace,
  acceptanceOtherStudentDisplayName,
  acceptanceOtherTeacherDisplayName,
  acceptanceStudentDisplayName,
  acceptanceTeacherDisplayName,
  deriveAcceptanceUuid,
  evaluateAcceptanceReadiness,
  redactAcceptanceText,
  stableAcceptanceErrorCode,
} from "./contracts";
import {
  createAcceptanceGate,
  isAcceptanceGate,
  isCoreAcceptanceGate,
} from "./gate";
import { createSourceFingerprint } from "../source-fingerprint";
import {
  isExactPassingApplicationEvidence,
  isPassingImmediateHealthEvidence,
} from "./immediate-health";
import {
  isPassingBootstrapEvidence,
  isPassingIdentityEvidence,
} from "./prerequisites";

const marker = "cdas-staging-12345678-1";

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    STAGING_RUN_MARKER: marker,
    STAGING_BASE_URL: "https://cdas-next-preview123-linics1.vercel.app",
    STAGING_VERCEL_PROJECT_NAME: "cdas-next",
    STAGING_DEPLOYMENT_PROTECTION_REQUIRED: "1",
    AI_PROVIDER_DISABLED: "1",
    STAGING_AUTH_MODE: "postgres-local-v1",
    STAGING_TEST_PRIMARY_SCHOOL_CODE: "SCHABC23",
    STAGING_TEST_SECONDARY_SCHOOL_CODE: "SCHDEF45",
    STAGING_TEST_TEACHER_STAFF_NO: "T-001",
    STAGING_TEST_STUDENT_NO: "000001",
    STAGING_TEST_OTHER_STUDENT_NO: "000002",
    STAGING_TEST_OTHER_TEACHER_STAFF_NO: "T-002",
    STAGING_ACCEPTANCE_TEST_TEACHER_NAME: acceptanceTeacherDisplayName,
    STAGING_ACCEPTANCE_TEST_STUDENT_NAME: acceptanceStudentDisplayName,
    STAGING_ACCEPTANCE_TEST_OTHER_STUDENT_NAME: acceptanceOtherStudentDisplayName,
    STAGING_ACCEPTANCE_TEST_OTHER_TEACHER_NAME: acceptanceOtherTeacherDisplayName,
    STAGING_VERCEL_AUTOMATION_BYPASS_SECRET: "A".repeat(32),
    GITHUB_RUN_ID: "12345678",
    GITHUB_RUN_ATTEMPT: "1",
    CDAS_DEPLOYMENT_ID: "a".repeat(40),
    CDAS_SOURCE_FINGERPRINT: "b".repeat(64),
    STAGING_ACCEPTANCE_WRITES_ATTESTED: "true",
    STAGING_ACCEPTANCE_LOCAL_AUTH_ATTESTED: "true",
    STAGING_ACCEPTANCE_RETENTION_ATTESTED: "true",
    ...overrides,
  };
}

describe("staging synthetic acceptance contracts", () => {
  it("derives a stable, unique-looking version-5 classroom namespace", () => {
    const one = deriveAcceptanceUuid(marker, "classroom");
    expect(one).toBe(deriveAcceptanceUuid(marker, "classroom"));
    expect(one).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(one).not.toBe(deriveAcceptanceUuid("cdas-staging-87654321-1", "classroom"));
    expect(acceptanceNamespace(marker).classroomName).toContain(marker);
  });

  it("fails closed for missing attestation, invalid local identity, local base URL, or enabled AI", () => {
    for (const invalid of [
      { STAGING_ACCEPTANCE_WRITES_ATTESTED: undefined },
      { STAGING_AUTH_MODE: "" },
      { STAGING_BASE_URL: "http://localhost:3000" },
      { STAGING_VERCEL_PROJECT_NAME: "invalid_project" },
      { STAGING_DEPLOYMENT_PROTECTION_REQUIRED: "" },
      { STAGING_BASE_URL: "https://other-preview.vercel.app" },
      { AI_PROVIDER_DISABLED: "0" },
      { STAGING_TEST_OTHER_STUDENT_NO: "000001" },
      { STAGING_TEST_OTHER_TEACHER_STAFF_NO: "T-001" },
      { STAGING_ACCEPTANCE_TEST_OTHER_STUDENT_NAME: "Wrong name" },
      { STAGING_ACCEPTANCE_TEST_OTHER_TEACHER_NAME: "Wrong name" },
      { STAGING_VERCEL_AUTOMATION_BYPASS_SECRET: "not-valid" },
    ]) {
      expect(evaluateAcceptanceReadiness(environment(invalid)).status).toBe("FAIL");
    }
    expect(evaluateAcceptanceReadiness(environment()).status).toBe("PASS");
  });

  it("redacts forbidden connection, credential, cookie, ticket, and AI key shapes", () => {
    const output = redactAcceptanceText("postgresql://user:pass@db/x Bearer abc Cookie session=x pk_test_secret sk_test_secret ticket=abc DEEPSEEK_API_KEY=secret STAGING_VERCEL_AUTOMATION_BYPASS_SECRET=secret x-vercel-protection-bypass: secret x-vercel-protection-bypass secret");
    expect(output).not.toContain("postgresql://");
    expect(output).not.toContain("pk_test_secret");
    expect(output).not.toContain("ticket=abc");
    expect(output).not.toContain("STAGING_VERCEL_AUTOMATION_BYPASS_SECRET=secret");
    expect(output).not.toContain("x-vercel-protection-bypass: secret");
    expect(output).not.toContain("x-vercel-protection-bypass secret");
    expect(output).toContain("[REDACTED_DATABASE_URL]");
  });

  it("never converts arbitrary errors into an artifact-visible detail", () => {
    expect(stableAcceptanceErrorCode(new Error("EXPECTED_CODE"))).toBe("EXPECTED_CODE");
    expect(stableAcceptanceErrorCode(new Error("postgresql://secret"))).toBe("STAGING_ACCEPTANCE_INTERNAL_ERROR");
  });

  it("requires an exact HMAC-bound same-run gate shape", async () => {
    const sourceFingerprint = createSourceFingerprint();
    const input = environment({
      CDAS_SOURCE_FINGERPRINT: sourceFingerprint,
      DATABASE_URL: "postgresql://u:p@runtime-pooler.example.test/staging_cdas?sslmode=require&pgbouncer=true",
      DIRECT_URL: "postgresql://u:p@direct.example.test/staging_cdas?sslmode=require",
      STAGING_DATABASE_NAME: "staging_cdas",
      STAGING_HEALTH_PROOF_SECRET: "x".repeat(32),
    });
    const generated = await createAcceptanceGate(input, {});
    const passing = { ...generated, decision: "GO" as const, checks: generated.checks.map((check) => ({ ...check, status: "PASS" as const })) };
    expect(isAcceptanceGate(passing, input)).toBe(true);
    expect(isAcceptanceGate({ ...passing, extra: true }, input)).toBe(false);
    expect(isAcceptanceGate(passing, { ...input, DIRECT_URL: "postgresql://u:p@other.example.test/staging_cdas?sslmode=require" })).toBe(false);
    expect(isAcceptanceGate(passing, { ...input, STAGING_ACCEPTANCE_WRITES_ATTESTED: "false" })).toBe(false);
    expect(isAcceptanceGate(passing, { ...input, STAGING_TEST_OTHER_STUDENT_NO: "000003" })).toBe(false);
    expect(isAcceptanceGate(passing, { ...input, STAGING_ACCEPTANCE_TEST_OTHER_STUDENT_NAME: "Changed Other Student" })).toBe(false);
    expect(isAcceptanceGate(passing, { ...input, STAGING_TEST_OTHER_TEACHER_STAFF_NO: "T-003" })).toBe(false);
    expect(isAcceptanceGate(passing, { ...input, STAGING_ACCEPTANCE_TEST_OTHER_TEACHER_NAME: "Changed Other Teacher" })).toBe(false);
    expect(isAcceptanceGate(passing, { ...input, STAGING_VERCEL_AUTOMATION_BYPASS_SECRET: "B".repeat(32) })).toBe(false);
    expect(isAcceptanceGate(passing, { ...input, STAGING_VERCEL_PROJECT_NAME: "other-project" })).toBe(false);
    expect(isAcceptanceGate(passing, { ...input, STAGING_DEPLOYMENT_PROTECTION_REQUIRED: "" })).toBe(false);
    expect(isCoreAcceptanceGate(passing, { ...input, DIRECT_URL: "postgresql://u:p@other.example.test/staging_cdas?sslmode=require" })).toBe(false);
    expect(isCoreAcceptanceGate({ ...passing, coreBindingMac: "0".repeat(64) }, input)).toBe(false);
    expect(isCoreAcceptanceGate(passing, { ...input, STAGING_VERCEL_AUTOMATION_BYPASS_SECRET: "B".repeat(32) })).toBe(true);
    expect(isAcceptanceGate(passing, { ...input, STAGING_VERCEL_AUTOMATION_BYPASS_SECRET: "B".repeat(32) })).toBe(false);
    expect(isCoreAcceptanceGate({ ...passing, bypassBindingMac: "0".repeat(64) }, input)).toBe(true);
    expect(isAcceptanceGate({ ...passing, bypassBindingMac: "0".repeat(64) }, input)).toBe(false);
  });

  it("accepts only exact immediate application health evidence bound to this run", () => {
    const applicationChecks = [
      "APPLICATION_DEPLOYMENT_ACCESS_MODE_VERIFIED",
      "APPLICATION_HEALTH_HTTP_200",
      "APPLICATION_HEALTH_NO_STORE",
      "APPLICATION_HEALTH_EXACT_BODY",
      "APPLICATION_DEPLOYMENT_ID_MATCHES",
      "APPLICATION_CONFIGURATION_PROOF_MATCHES",
      "APPLICATION_SOURCE_FINGERPRINT_MATCHES",
    ].map((code) => ({ code, status: "PASS" }));
    const application = {
      schema: "staging-application.v1",
      status: "PASS",
      checks: applicationChecks,
      stagingSyntheticDecision: "GO",
      realStudentDataAllowed: false,
      productionDecision: "NO_GO",
    };
    expect(isExactPassingApplicationEvidence(application)).toBe(true);
    const immediate = {
      schema: "staging-synthetic-acceptance-immediate-health.v1",
      status: "PASS",
      runMarker: marker,
      githubRunId: "12345678",
      githubRunAttempt: "1",
      deploymentId: "a".repeat(40),
      sourceFingerprint: "b".repeat(64),
      checks: applicationChecks,
      realStudentDataAllowed: false,
      productionDecision: "NO_GO",
    };
    expect(isPassingImmediateHealthEvidence(immediate, environment())).toBe(true);
    expect(isPassingImmediateHealthEvidence(immediate, environment({ GITHUB_RUN_ATTEMPT: "2" }))).toBe(false);
  });

  it("requires coherent identity and bootstrap prerequisite evidence", () => {
    const identity = {
      schema: "staging-synthetic-acceptance-identity.v1",
      status: "PASS",
      checks: [
        "TEACHER_LOCAL_AUTHENTICATES",
        "STUDENT_LOCAL_AUTHENTICATES",
        "OTHER_STUDENT_LOCAL_AUTHENTICATES",
        "OTHER_TEACHER_LOCAL_AUTHENTICATES",
        "WRONG_SCHOOL_INVALID_CREDENTIALS",
        "DISABLED_ACCOUNT_ACCOUNT_DISABLED",
        "DISABLED_SCHOOL_SCHOOL_DISABLED",
      ].map((code) => ({ code, status: "PASS" })),
      sessionsRevoked: true,
      realStudentDataAllowed: false,
      productionDecision: "NO_GO",
    };
    expect(isPassingIdentityEvidence(identity)).toBe(true);
    expect(isPassingIdentityEvidence({ ...identity, sessionsRevoked: false })).toBe(false);

    const bootstrap = {
      schema: "staging-synthetic-acceptance-bootstrap.v1",
      status: "PASS",
      namespace: { marker, classroomDerived: true },
      collisionProbe: "ABSENT",
      resources: {
        teacher: "EXISTING",
        student: "EXISTING",
        otherStudent: "EXISTING",
        otherTeacher: "EXISTING",
        classroom: "CREATED",
        membership: "CREATED",
        otherMembership: "CREATED",
      },
      realStudentDataAllowed: false,
      productionDecision: "NO_GO",
    };
    expect(isPassingBootstrapEvidence(bootstrap, environment())).toBe(true);
    expect(isPassingBootstrapEvidence(undefined, environment())).toBe(false);
    expect(isPassingBootstrapEvidence({ ...bootstrap, resources: { ...bootstrap.resources, classroom: "EXISTING" } }, environment())).toBe(false);
  });

  it("orders identity before the final health proof and proof before bootstrap", () => {
    const workflow = readFileSync(
      ".github/workflows/staging-synthetic-acceptance.yml",
      "utf8",
    );
    const identity = workflow.indexOf("id: identity");
    const immediateHealth = workflow.indexOf("id: immediate-health");
    const immediateEvidence = workflow.indexOf("id: immediate-evidence");
    const bootstrap = workflow.indexOf("id: bootstrap");
    expect(identity).toBeGreaterThanOrEqual(0);
    expect(identity).toBeLessThan(immediateHealth);
    expect(immediateHealth).toBeLessThan(immediateEvidence);
    expect(immediateEvidence).toBeLessThan(bootstrap);
    const bootstrapStep = workflow.slice(bootstrap, workflow.indexOf("- name: Run real browser", bootstrap));
    expect(bootstrapStep).toContain("if: ${{ steps.immediate-evidence.outcome == 'success' }}");
    expect(bootstrapStep).not.toContain("steps.identity.outcome");
    expect(
      workflow.match(/STAGING_VERCEL_AUTOMATION_BYPASS_SECRET:/gu),
    ).toHaveLength(7);
    expect(
      workflow.match(/STAGING_BASE_URL: \$\{\{ secrets\.STAGING_BASE_URL \}\}/gu),
    ).toHaveLength(11);
    expect(workflow).not.toContain("STAGING_BASE_URL: ${{ vars.STAGING_BASE_URL }}");
    expect(
      workflow.match(/STAGING_VERCEL_PROJECT_NAME: \$\{\{ vars\.STAGING_VERCEL_PROJECT_NAME \}\}/gu),
    ).toHaveLength(11);
    expect(
      workflow.match(/STAGING_DEPLOYMENT_PROTECTION_REQUIRED: "1"/gu),
    ).toHaveLength(2);
    const preflight = workflow.slice(
      workflow.indexOf("id: preflight"),
      workflow.indexOf("- name: Build production application"),
    );
    expect(preflight).not.toContain("STAGING_TEST_OTHER_STUDENT_PASSWORD");
    expect(preflight).not.toContain("STAGING_TEST_OTHER_TEACHER_PASSWORD");
    expect(preflight).not.toContain("STAGING_VERCEL_AUTOMATION_BYPASS_SECRET");
    const build = workflow.slice(
      workflow.indexOf("- name: Build production application"),
      workflow.indexOf("- name: Verify external PostgreSQL metadata"),
    );
    const database = workflow.slice(
      workflow.indexOf("- name: Verify external PostgreSQL metadata"),
      workflow.indexOf("- name: Verify Prisma schema drift"),
    );
    const schema = workflow.slice(
      workflow.indexOf("- name: Verify Prisma schema drift"),
      workflow.indexOf("- name: Verify remote health contract"),
    );
    const artifact = workflow.slice(
      workflow.indexOf("- name: Preserve sanitized staging readiness evidence"),
      workflow.indexOf("- name: Enforce staging Go/No-Go decision"),
    );
    for (const leastPrivilegeRegion of [build, database, schema, artifact]) {
      expect(leastPrivilegeRegion).not.toContain(
        "STAGING_VERCEL_AUTOMATION_BYPASS_SECRET",
      );
    }
    const identityStep = workflow.slice(
      workflow.indexOf("id: identity"),
      workflow.indexOf("id: immediate-health"),
    );
    const bootstrapStepSecretScope = workflow.slice(
      workflow.indexOf("id: bootstrap"),
      workflow.indexOf("id: browser"),
    );
    const verifyStep = workflow.slice(
      workflow.indexOf("id: verify"),
      workflow.indexOf("id: final"),
    );
    for (const databaseOrIdentityStep of [identityStep, bootstrapStepSecretScope, verifyStep]) {
      expect(databaseOrIdentityStep).not.toContain(
        "STAGING_VERCEL_AUTOMATION_BYPASS_SECRET",
      );
    }
    const sameRunGateAssertion = workflow.slice(
      workflow.indexOf("- name: Enforce same-run acceptance gate"),
      workflow.indexOf("\n\n  acceptance:"),
    );
    expect(sameRunGateAssertion).toContain('AI_PROVIDER_DISABLED: "1"');
    expect(sameRunGateAssertion).toContain(
      "STAGING_VERCEL_AUTOMATION_BYPASS_SECRET:",
    );
  });
});
