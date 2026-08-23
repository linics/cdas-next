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
  "01-ready.png",
  "02-approval.png",
  "03-published.png",
  "04-release.png",
] as const;
const readinessCodes = [
  "AGENT_MARKER",
  "AGENT_PUBLIC_HTTPS",
  "AGENT_AI_ENABLED",
  "AGENT_AI_ACK",
  "AGENT_GATEWAY_KEY",
  "AGENT_MODEL",
  "AGENT_APPROVAL_SECRET",
  "AGENT_CLERK_TEST",
  "AGENT_IDENTITIES",
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
  "TEACHER_IDENTITY_EXISTS",
  "STUDENT_IDENTITY_EXISTS",
  "TEACHER_TICKET_REVOKED",
  "STUDENT_TICKET_REVOKED",
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
      ticketsRevoked: true,
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
        classroom: "CREATED",
        membership: "CREATED",
      },
      ...boundary(),
    },
    browser: {
      schema: "staging-agent-acceptance-browser.v1",
      status: "PASS",
      startedAt: "2026-08-23T05:00:00.000Z",
      completedAt: "2026-08-23T05:01:00.000Z",
      checks: checks(screenshotNames.map((_, index) => `SCREENSHOT_${index + 1}`)),
      screenshots: Object.fromEntries(
        screenshotNames.map((name, index) => [
          name,
          String(index + 1).repeat(64),
        ]),
      ),
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
      verification: true,
    });
  });

  it.each([
    ["readiness", "checks"],
    ["gate", "bindingMac"],
    ["identity", "ticketsRevoked"],
    ["immediateHealth", "checks"],
    ["bootstrap", "resources"],
    ["browser", "checks"],
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
      "04-release.png"
    ];
    expect(evaluateAgentAcceptanceEvidence(missing, marker).browser).toBe(false);

    const malformed = structuredClone(exactEvidence()) as Record<
      keyof AgentAcceptanceEvidenceSet,
      Record<string, unknown>
    >;
    (malformed.browser.screenshots as Record<string, unknown>)[
      "01-ready.png"
    ] = "not-a-sha256";
    expect(evaluateAgentAcceptanceEvidence(malformed, marker).browser).toBe(
      false,
    );
  });
});
