import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  agentAcceptanceNamespace,
  agentAcceptanceOtherStudentDisplayName,
  agentAcceptanceOtherTeacherDisplayName,
  agentAcceptanceStudentDisplayName,
  agentAcceptanceTeacherDisplayName,
  evaluateAgentAcceptanceReadiness,
  redactAgentAcceptanceText,
} from "./contracts";
import { createAgentGate, isAgentGate } from "./gate";
import { isPassingAgentIdentityEvidence } from "./prerequisites";

const marker = "cdas-staging-agent-12345678-1";

function environment(extra: Record<string, string | undefined> = {}) {
  return {
    STAGING_RUN_MARKER: marker,
    STAGING_BASE_URL: "https://cdas-next-agent-linics1.vercel.app",
    STAGING_VERCEL_PROJECT_NAME: "cdas-next",
    STAGING_DEPLOYMENT_PROTECTION_REQUIRED: "1",
    STAGING_VERCEL_AUTOMATION_BYPASS_SECRET: "V".repeat(32),
    STAGING_AUTH_MODE: "postgres-local-v1",
    AI_PROVIDER_DISABLED: "0",
    STAGING_AI_ACK: "synthetic-data-cost-approved",
    DEEPSEEK_API_KEY: "deepseek-key-012345",
    AI_MODEL: "deepseek-v4-flash",
    AI_TOOL_APPROVAL_SECRET: "a".repeat(32),
    STAGING_TEST_PRIMARY_SCHOOL_CODE: "SCHABC23",
    STAGING_TEST_SECONDARY_SCHOOL_CODE: "SCHDEF45",
    STAGING_TEST_DISABLED_SCHOOL_CODE: "SCHGHJ67",
    STAGING_TEST_TEACHER_STAFF_NO: "T-001",
    STAGING_TEST_STUDENT_NO: "000001",
    STAGING_TEST_OTHER_STUDENT_NO: "000002",
    STAGING_TEST_OTHER_TEACHER_STAFF_NO: "T-002",
    STAGING_TEST_DISABLED_ACCOUNT_STUDENT_NO: "000003",
    STAGING_TEST_DISABLED_SCHOOL_TEACHER_STAFF_NO: "T-003",
    STAGING_TEST_TEACHER_PASSWORD: "Cdas-teacher-password9",
    STAGING_TEST_STUDENT_PASSWORD: "Cdas-student-password9",
    STAGING_TEST_OTHER_STUDENT_PASSWORD: "Cdas-other-student9",
    STAGING_TEST_OTHER_TEACHER_PASSWORD: "Cdas-other-teacher9",
    STAGING_TEST_DISABLED_ACCOUNT_PASSWORD: "Cdas-disabled-account9",
    STAGING_TEST_DISABLED_SCHOOL_TEACHER_PASSWORD: "Cdas-disabled-school9",
    STAGING_ACCEPTANCE_TEST_TEACHER_NAME: agentAcceptanceTeacherDisplayName,
    STAGING_ACCEPTANCE_TEST_STUDENT_NAME: agentAcceptanceStudentDisplayName,
    STAGING_ACCEPTANCE_TEST_OTHER_STUDENT_NAME:
      agentAcceptanceOtherStudentDisplayName,
    STAGING_ACCEPTANCE_TEST_OTHER_TEACHER_NAME:
      agentAcceptanceOtherTeacherDisplayName,
    GITHUB_RUN_ID: "12345678",
    GITHUB_RUN_ATTEMPT: "1",
    CDAS_DEPLOYMENT_ID: "a".repeat(40),
    CDAS_SOURCE_FINGERPRINT: "b".repeat(64),
    STAGING_HEALTH_PROOF_SECRET: "h".repeat(32),
    DATABASE_URL: "postgresql://u:p@staging-pooler.example.test/staging",
    DIRECT_URL: "postgresql://u:p@staging.example.test/staging",
    STAGING_DATABASE_NAME: "staging",
    STAGING_SYNTHETIC_ONLY_ATTESTED: "true",
    STAGING_LOCAL_AUTH_ATTESTED: "true",
    STAGING_DATABASE_ISOLATION_ATTESTED: "true",
    STAGING_HOSTING_ACCESS_ATTESTED: "true",
    STAGING_ROLLBACK_OWNER_ATTESTED: "true",
    STAGING_RETENTION_ATTESTED: "true",
    STAGING_AGENT_WRITES_ATTESTED: "true",
    STAGING_AGENT_LOCAL_SESSIONS_ATTESTED: "true",
    STAGING_AGENT_MODEL_COST_ATTESTED: "true",
    STAGING_AGENT_RETENTION_ATTESTED: "true",
    STAGING_AGENT_RUN_MODEL_ATTESTED: "true",
    STAGING_AGENT_IDENTITIES_RESERVED_ATTESTED: "true",
    ...extra,
  };
}

describe("agent acceptance contracts", () => {
  it("derives a unique marker namespace and fails readiness closed", () => {
    expect(agentAcceptanceNamespace(marker).classroomId).toMatch(
      /-5[0-9a-f]{3}-[89ab]/u,
    );
    expect(evaluateAgentAcceptanceReadiness(environment()).status).toBe("PASS");
    expect(
      evaluateAgentAcceptanceReadiness(
        environment({ DEEPSEEK_API_KEY: "short" }),
      ).status,
    ).toBe("FAIL");
    expect(
      evaluateAgentAcceptanceReadiness(
        environment({ STAGING_AGENT_IDENTITIES_RESERVED_ATTESTED: "false" }),
      ).status,
    ).toBe("FAIL");
    expect(
      evaluateAgentAcceptanceReadiness(
        environment({ STAGING_TEST_OTHER_STUDENT_NO: "000001" }),
      ).status,
    ).toBe("FAIL");
  });

  it("binds non-password configuration without serializing credentials", async () => {
    const actual = environment();
    const source = (await import("../source-fingerprint")).createSourceFingerprint();
    const candidate = await createAgentGate(
      { ...actual, CDAS_SOURCE_FINGERPRINT: source },
      {
        schema: "staging-go-no-go.v1",
        decision: "GO",
        stagingSyntheticDecision: "GO",
        realStudentDataAllowed: false,
        productionDecision: "NO_GO",
        checks: [],
      },
    );
    const gate = {
      ...candidate,
      decision: "GO" as const,
      checks: candidate.checks.map((check) => ({
        ...check,
        status: "PASS" as const,
      })),
    };
    const boundEnvironment = { ...actual, CDAS_SOURCE_FINGERPRINT: source };
    expect(isAgentGate(gate, boundEnvironment)).toBe(true);
    expect(
      isAgentGate(gate, { ...boundEnvironment, AI_MODEL: "deepseek-other" }),
    ).toBe(false);
    expect(JSON.stringify(gate)).not.toContain(actual.STAGING_TEST_TEACHER_PASSWORD);
  });

  it("redacts forbidden connection, credential, cookie, and AI key shapes", () => {
    const output = redactAgentAcceptanceText(
      "postgresql://a:b@x password=secret Bearer abc Cookie session=x sk_test_value",
    );
    expect(output).not.toContain("postgresql://");
    expect(output).not.toContain("password=secret");
    expect(output).not.toContain("sk_test_value");
  });

  it("keeps secrets scoped to the protected gate and action steps", () => {
    const workflow = readFileSync(
      ".github/workflows/staging-agent-acceptance.yml",
      "utf8",
    );
    expect(workflow).not.toContain("NEXT_PUBLIC_");
    expect(workflow).not.toContain("PROVIDER_SECRET_");
    expect(workflow).not.toContain("issue-teacher-");
    expect(workflow).toContain("STAGING_TEST_TEACHER_PASSWORD");
    expect(workflow).toContain("STAGING_VERCEL_AUTOMATION_BYPASS_SECRET");
    expect(workflow).toContain('STAGING_DEPLOYMENT_PROTECTION_REQUIRED: "1"');
    const bootstrapStart = workflow.indexOf("id: bootstrap");
    const bootstrapEnd = workflow.indexOf(
      "run: pnpm staging:agent:bootstrap",
      bootstrapStart,
    );
    const bootstrapStep = workflow.slice(bootstrapStart, bootstrapEnd);
    expect(bootstrapStep).toContain("STAGING_TEST_TEACHER_PASSWORD");
    expect(bootstrapStep).not.toContain("DEEPSEEK_API_KEY");
    expect(bootstrapStep).not.toContain("AI_TOOL_APPROVAL_SECRET");
    expect(bootstrapStep).not.toContain("STAGING_VERCEL_AUTOMATION_BYPASS_SECRET");
    const order = [
      "id: agent-gate",
      "id: chromium",
      "id: immediate-health",
      "id: bootstrap",
      "id: identity",
      "id: browser",
      "id: cleanup",
      "id: verify",
    ].map((id) => workflow.indexOf(id));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((left, right) => left - right));
  });

  it("requires strict identity evidence before browser execution", () => {
    const codes = [
      "TEACHER_LOCAL_AUTHENTICATES",
      "STUDENT_LOCAL_AUTHENTICATES",
      "OTHER_STUDENT_LOCAL_AUTHENTICATES",
      "OTHER_TEACHER_LOCAL_AUTHENTICATES",
      "DISABLED_ACCOUNT_IS_REJECTED",
      "DISABLED_SCHOOL_IS_REJECTED",
      "CROSS_SCHOOL_IDENTIFIER_REJECTED",
    ];
    const identity = {
      schema: "staging-agent-acceptance-identity.v1",
      status: "PASS",
      checks: codes.map((code) => ({ code, status: "PASS" })),
      directSessionsRevoked: true,
      realStudentDataAllowed: false,
      productionDecision: "NO_GO",
    };
    expect(isPassingAgentIdentityEvidence(identity)).toBe(true);
    expect(
      isPassingAgentIdentityEvidence({ ...identity, status: "FAIL" }),
    ).toBe(false);
    const incomplete = structuredClone(identity);
    incomplete.checks.pop();
    expect(isPassingAgentIdentityEvidence(incomplete)).toBe(false);
    const swapped = structuredClone(identity);
    [swapped.checks[4], swapped.checks[5]] = [
      swapped.checks[5],
      swapped.checks[4],
    ];
    expect(isPassingAgentIdentityEvidence(swapped)).toBe(false);
    expect(
      isPassingAgentIdentityEvidence({
        ...identity,
        directSessionsRevoked: false,
      }),
    ).toBe(false);
  });
});
