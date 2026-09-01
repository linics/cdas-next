import { describe, expect, it } from "vitest";

import { expectedEvidenceChecks } from "../decision";
import {
  evaluateAgentAcceptanceEvidence,
  type AgentAcceptanceEvidenceSet,
} from "./assert-final";
import { agentAcceptanceAttestations } from "./contracts";
import { agentVerificationCodes } from "./verify";

const marker = "cdas-staging-agent-12345678-1";
const screenshotNames = [
  "01-draft-proposal.png",
  "02-draft-preview.png",
  "03-publish-approval.png",
  "04-published.png",
  "05-student-submitted.png",
  "06-teacher-feedback.png",
  "07-teacher-closed.png",
  "08-student-closed-readonly.png",
] as const;
const browserCodes = [
  "VERCEL_PROTECTION_BYPASS_SCOPED",
  "STUDENT_TEACHER_RESOURCE_HIDDEN",
  "OTHER_TEACHER_RELEASE_404",
  "OTHER_TEACHER_SUBMISSION_404",
  "OTHER_STUDENT_RELEASE_VISIBLE",
  "OTHER_STUDENT_SUBMISSION_CONTENT_HIDDEN",
  "OTHER_STUDENT_SUBMISSION_404",
  "STUDENT_FEEDBACK_VISIBLE",
  "STRUCTURED_FORMATIVE_FEEDBACK_VISIBLE",
  "STALE_STUDENT_WRITE_REJECTED_AFTER_CLOSE",
  "CLOSED_STUDENT_READONLY",
  "TEACHER_STUDENT_RESOURCE_HIDDEN",
] as const;
const readinessCodes = [
  "AGENT_MARKER",
  "AGENT_VERCEL_PREVIEW",
  "AGENT_DEPLOYMENT_PROTECTION",
  "AGENT_VERCEL_BYPASS",
  "AGENT_AI_ENABLED",
  "AGENT_AI_ACK",
  "AGENT_DEEPSEEK_KEY",
  "AGENT_MODEL",
  "AGENT_APPROVAL_SECRET",
  "AGENT_AUTH_MODE",
  "AGENT_SCHOOLS",
  "AGENT_STAFF_NUMBERS",
  "AGENT_STUDENT_NUMBERS",
  "AGENT_IDENTITIES_DISTINCT",
  "AGENT_NEGATIVE_FIXTURES_DISTINCT",
  "AGENT_STAGING_TEST_TEACHER_PASSWORD_PRESENT",
  "AGENT_STAGING_TEST_STUDENT_PASSWORD_PRESENT",
  "AGENT_STAGING_TEST_OTHER_STUDENT_PASSWORD_PRESENT",
  "AGENT_STAGING_TEST_OTHER_TEACHER_PASSWORD_PRESENT",
  "AGENT_STAGING_TEST_DISABLED_ACCOUNT_PASSWORD_PRESENT",
  "AGENT_STAGING_TEST_DISABLED_SCHOOL_TEACHER_PASSWORD_PRESENT",
  "AGENT_FIXED_DISPLAY_NAMES",
  "AGENT_RUN_METADATA",
  ...agentAcceptanceAttestations,
];
const gateCodes = [
  "SAME_RUN_STAGING_GO",
  "AGENT_READINESS",
  "SOURCE_FINGERPRINT",
  "AGENT_BINDING_MAC",
];
const identityCodes = [
  "TEACHER_LOCAL_AUTHENTICATES",
  "STUDENT_LOCAL_AUTHENTICATES",
  "OTHER_STUDENT_LOCAL_AUTHENTICATES",
  "OTHER_TEACHER_LOCAL_AUTHENTICATES",
  "DISABLED_ACCOUNT_IS_REJECTED",
  "DISABLED_SCHOOL_IS_REJECTED",
  "CROSS_SCHOOL_IDENTIFIER_REJECTED",
];

function checks(codes: readonly string[]) {
  return codes.map((code) => ({ code, status: "PASS" }));
}

function boundary() {
  return {
    realStudentDataAllowed: false,
    productionDecision: "NO_GO",
  };
}

function exactEvidence(): AgentAcceptanceEvidenceSet {
  return {
    readiness: {
      schema: "staging-agent-acceptance-readiness.v1",
      status: "PASS",
      checks: checks(readinessCodes),
      ...boundary(),
    },
    gate: {
      schema: "staging-agent-acceptance-gate.v1",
      decision: "GO",
      marker,
      githubRunId: "12345678",
      githubRunAttempt: "1",
      deploymentId: "a".repeat(40),
      sourceFingerprint: "b".repeat(64),
      bindingMac: "c".repeat(64),
      checks: checks(gateCodes),
      ...boundary(),
    },
    identity: {
      schema: "staging-agent-acceptance-identity.v1",
      status: "PASS",
      checks: checks(identityCodes),
      directSessionsRevoked: true,
      ...boundary(),
    },
    immediateHealth: {
      schema: "staging-agent-acceptance-immediate-health.v1",
      status: "PASS",
      checks: checks(expectedEvidenceChecks["staging-application.v1"]),
      ...boundary(),
    },
    bootstrap: {
      schema: "staging-agent-acceptance-bootstrap.v1",
      status: "PASS",
      namespace: { marker, classroomDerived: true },
      collisionProbe: "ABSENT",
      resources: {
        teacher: "CREATED",
        student: "CREATED",
        otherStudent: "CREATED",
        otherTeacher: "CREATED",
        classroom: "CREATED",
        membership: "CREATED",
        otherMembership: "CREATED",
      },
      ...boundary(),
    },
    browser: {
      schema: "staging-agent-acceptance-browser.v1",
      status: "PASS",
      startedAt: "2026-08-23T05:00:00.000Z",
      completedAt: "2026-08-23T05:01:00.000Z",
      checks: checks([
        ...browserCodes,
        ...screenshotNames.map((_, index) => `SCREENSHOT_${index + 1}`),
      ]),
      screenshots: Object.fromEntries(
        screenshotNames.map((name, index) => [
          name,
          String(index + 1).repeat(64),
        ]),
      ),
      ...boundary(),
    },
    cleanup: {
      schema: "staging-agent-acceptance-cleanup.v1",
      status: "PASS",
      targetCount: 6,
      revokedCount: 6,
      remainingCount: 0,
      ...boundary(),
    },
    verification: {
      schema: "staging-agent-acceptance-verify.v1",
      status: "PASS",
      checks: checks(agentVerificationCodes),
      ...boundary(),
    },
  };
}

describe("Agent acceptance final evidence", () => {
  it("accepts only the complete exact PASS contract", () => {
    expect(evaluateAgentAcceptanceEvidence(exactEvidence(), marker)).toEqual({
      readiness: true,
      gate: true,
      identity: true,
      immediateHealth: true,
      bootstrap: true,
      browser: true,
      cleanup: true,
      verification: true,
    });
  });

  it.each([
    ["readiness", "checks"],
    ["gate", "bindingMac"],
    ["identity", "directSessionsRevoked"],
    ["immediateHealth", "checks"],
    ["bootstrap", "resources"],
    ["browser", "checks"],
    ["cleanup", "remainingCount"],
    ["verification", "checks"],
  ] as const)("rejects %s when %s is missing", (artifact, key) => {
    const evidence = structuredClone(exactEvidence()) as Record<
      keyof AgentAcceptanceEvidenceSet,
      Record<string, unknown>
    >;
    delete evidence[artifact][key];
    expect(evaluateAgentAcceptanceEvidence(evidence, marker)[artifact]).toBe(
      false,
    );
  });

  it.each([
    "readiness",
    "gate",
    "identity",
    "immediateHealth",
    "browser",
    "verification",
  ] as const)("rejects %s with an incomplete check set", (artifact) => {
    const evidence = structuredClone(exactEvidence()) as Record<
      keyof AgentAcceptanceEvidenceSet,
      Record<string, unknown>
    >;
    (evidence[artifact].checks as unknown[]).pop();
    expect(evaluateAgentAcceptanceEvidence(evidence, marker)[artifact]).toBe(
      false,
    );
  });

  it("rejects a missing screenshot or malformed screenshot hash", () => {
    const missing = structuredClone(exactEvidence()) as Record<
      keyof AgentAcceptanceEvidenceSet,
      Record<string, unknown>
    >;
    delete (missing.browser.screenshots as Record<string, unknown>)[
      "08-student-closed-readonly.png"
    ];
    expect(evaluateAgentAcceptanceEvidence(missing, marker).browser).toBe(false);

    const malformed = structuredClone(exactEvidence()) as Record<
      keyof AgentAcceptanceEvidenceSet,
      Record<string, unknown>
    >;
    (malformed.browser.screenshots as Record<string, unknown>)[
      "01-draft-proposal.png"
    ] = "not-a-sha256";
    expect(evaluateAgentAcceptanceEvidence(malformed, marker).browser).toBe(
      false,
    );
  });

  it("keeps disabled-account and disabled-school failures distinct", () => {
    const evidence = structuredClone(exactEvidence()) as Record<
      keyof AgentAcceptanceEvidenceSet,
      Record<string, unknown>
    >;
    const identityChecks = evidence.identity.checks as Array<
      Record<string, unknown>
    >;
    identityChecks[4].code = "DISABLED_SCHOOL_IS_REJECTED";
    identityChecks[5].code = "DISABLED_ACCOUNT_IS_REJECTED";
    expect(evaluateAgentAcceptanceEvidence(evidence, marker).identity).toBe(
      false,
    );
  });
});
