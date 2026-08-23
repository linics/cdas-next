import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  acceptanceNamespace,
  acceptanceStudentDisplayName,
  acceptanceTeacherDisplayName,
  deriveAcceptanceUuid,
  evaluateAcceptanceReadiness,
  redactAcceptanceText,
  stableAcceptanceErrorCode,
} from "./contracts";
import { createAcceptanceGate, isAcceptanceGate } from "./gate";
import { createSourceFingerprint } from "../source-fingerprint";
import {
  isExactPassingApplicationEvidence,
  isPassingImmediateHealthEvidence,
} from "./immediate-health";
import { verifyAcceptanceIdentities } from "./identity";
import { issueAcceptanceTicket } from "./ticket";
import {
  isPassingBootstrapEvidence,
  isPassingIdentityEvidence,
} from "./prerequisites";

const marker = "cdas-staging-12345678-1";

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    STAGING_RUN_MARKER: marker,
    STAGING_BASE_URL: "https://staging.example.test",
    AI_PROVIDER_DISABLED: "1",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_0123456789abcdef",
    CLERK_SECRET_KEY: "sk_test_0123456789abcdef",
    STAGING_TEST_TEACHER_CLERK_ID: "user_TestTeacher123",
    STAGING_TEST_STUDENT_CLERK_ID: "user_TestStudent123",
    STAGING_ACCEPTANCE_TEST_TEACHER_NAME: acceptanceTeacherDisplayName,
    STAGING_ACCEPTANCE_TEST_STUDENT_NAME: acceptanceStudentDisplayName,
    GITHUB_RUN_ID: "12345678",
    GITHUB_RUN_ATTEMPT: "1",
    CDAS_DEPLOYMENT_ID: "a".repeat(40),
    CDAS_SOURCE_FINGERPRINT: "b".repeat(64),
    STAGING_ACCEPTANCE_WRITES_ATTESTED: "true",
    STAGING_ACCEPTANCE_CLERK_TOKENS_ATTESTED: "true",
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

  it("fails closed for missing attestation, live Clerk, local base URL, or enabled AI", () => {
    for (const invalid of [
      { STAGING_ACCEPTANCE_WRITES_ATTESTED: undefined },
      { CLERK_SECRET_KEY: "sk_live_0123456789abcdef" },
      { STAGING_BASE_URL: "http://localhost:3000" },
      { AI_PROVIDER_DISABLED: "0" },
    ]) {
      expect(evaluateAcceptanceReadiness(environment(invalid)).status).toBe("FAIL");
    }
    expect(evaluateAcceptanceReadiness(environment()).status).toBe("PASS");
  });

  it("redacts forbidden connection, credential, cookie, ticket, and AI key shapes", () => {
    const output = redactAcceptanceText("postgresql://user:pass@db/x Bearer abc Cookie session=x pk_test_secret sk_test_secret ticket=abc DEEPSEEK_API_KEY=secret");
    expect(output).not.toContain("postgresql://");
    expect(output).not.toContain("pk_test_secret");
    expect(output).not.toContain("ticket=abc");
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
  });

  it("does not call Clerk before readiness and fixes every ticket at 60 seconds", async () => {
    let calls = 0;
    const client = { signInTokens: { createSignInToken: async (input: { userId: string; expiresInSeconds: number }) => { calls += 1; expect(input).toMatchObject({ userId: "user_TestTeacher123", expiresInSeconds: 60 }); return { token: "in-memory-ticket" }; } } };
    await expect(issueAcceptanceTicket(environment({ AI_PROVIDER_DISABLED: "0" }), "TEACHER", client)).rejects.toThrow("STAGING_ACCEPTANCE_READINESS_FAILED");
    await expect(issueAcceptanceTicket(environment(), "INVALID" as never, client)).rejects.toThrow("STAGING_ACCEPTANCE_TICKET_ROLE_INVALID");
    expect(calls).toBe(0);
    await expect(issueAcceptanceTicket(environment(), "TEACHER", client)).resolves.toBe("in-memory-ticket");
    expect(calls).toBe(1);
  });

  it("verifies both Clerk users and revokes capability tickets before database writes", async () => {
    const created: Array<{ userId: string; expiresInSeconds: number }> = [];
    const revoked: string[] = [];
    const client = {
      users: {
        getUser: async (userId: string) => ({ id: userId }),
      },
      signInTokens: {
        createSignInToken: async (input: { userId: string; expiresInSeconds: number }) => {
          created.push(input);
          return { id: `token-${input.userId}`, token: "ephemeral", userId: input.userId };
        },
        revokeSignInToken: async (tokenId: string) => {
          revoked.push(tokenId);
          return {};
        },
      },
    };
    const checks = await verifyAcceptanceIdentities(environment(), client);
    expect(checks).toHaveLength(4);
    expect(created).toEqual([
      { userId: "user_TestTeacher123", expiresInSeconds: 60 },
      { userId: "user_TestStudent123", expiresInSeconds: 60 },
    ]);
    expect(revoked).toEqual([
      "token-user_TestTeacher123",
      "token-user_TestStudent123",
    ]);
  });

  it("accepts only exact immediate application health evidence bound to this run", () => {
    const applicationChecks = [
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
        "TEACHER_IDENTITY_EXISTS",
        "STUDENT_IDENTITY_EXISTS",
        "TEACHER_TICKET_CAPABILITY",
        "STUDENT_TICKET_CAPABILITY",
      ].map((code) => ({ code, status: "PASS" })),
      ticketsRevoked: true,
      realStudentDataAllowed: false,
      productionDecision: "NO_GO",
    };
    expect(isPassingIdentityEvidence(identity)).toBe(true);
    expect(isPassingIdentityEvidence({ ...identity, ticketsRevoked: false })).toBe(false);

    const bootstrap = {
      schema: "staging-synthetic-acceptance-bootstrap.v1",
      status: "PASS",
      namespace: { marker, classroomDerived: true },
      collisionProbe: "ABSENT",
      resources: {
        teacher: "EXISTING",
        student: "EXISTING",
        classroom: "CREATED",
        membership: "CREATED",
      },
      realStudentDataAllowed: false,
      productionDecision: "NO_GO",
    };
    expect(isPassingBootstrapEvidence(bootstrap, environment())).toBe(true);
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
  });
});
