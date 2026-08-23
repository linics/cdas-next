import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  agentAcceptanceNamespace,
  agentAcceptanceStudentDisplayName,
  agentAcceptanceTeacherDisplayName,
  evaluateAgentAcceptanceReadiness,
  redactAgentAcceptanceText,
} from "./contracts";
import { createAgentGate, isAgentGate } from "./gate";
import { issueAgentTeacherTicket } from "./ticket";

const marker = "cdas-staging-agent-12345678-1";

function environment(extra: Record<string, string | undefined> = {}) {
  return {
    STAGING_RUN_MARKER: marker,
    STAGING_BASE_URL: "https://staging.example.test",
    AI_PROVIDER_DISABLED: "0",
    STAGING_AI_ACK: "synthetic-data-cost-approved",
    DEEPSEEK_API_KEY: "deepseek-key-012345",
    AI_MODEL: "deepseek-v4-flash-vision-exp",
    AI_TOOL_APPROVAL_SECRET: "a".repeat(32),
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_0123456789abcdef",
    CLERK_SECRET_KEY: "sk_test_0123456789abcdef",
    STAGING_TEST_TEACHER_CLERK_ID: "user_Teacher123",
    STAGING_TEST_STUDENT_CLERK_ID: "user_Student123",
    STAGING_ACCEPTANCE_TEST_TEACHER_NAME:
      agentAcceptanceTeacherDisplayName,
    STAGING_ACCEPTANCE_TEST_STUDENT_NAME:
      agentAcceptanceStudentDisplayName,
    GITHUB_RUN_ID: "12345678",
    GITHUB_RUN_ATTEMPT: "1",
    CDAS_DEPLOYMENT_ID: "a".repeat(40),
    CDAS_SOURCE_FINGERPRINT: "b".repeat(64),
    STAGING_HEALTH_PROOF_SECRET: "h".repeat(32),
    DATABASE_URL:
      "postgresql://u:p@staging-pooler.example.test/staging?sslmode=require",
    DIRECT_URL:
      "postgresql://u:p@staging.example.test/staging?sslmode=require",
    STAGING_DATABASE_NAME: "staging",
    STAGING_SYNTHETIC_ONLY_ATTESTED: "true",
    STAGING_CLERK_INSTANCE_ATTESTED: "true",
    STAGING_DATABASE_ISOLATION_ATTESTED: "true",
    STAGING_HOSTING_ACCESS_ATTESTED: "true",
    STAGING_ROLLBACK_OWNER_ATTESTED: "true",
    STAGING_RETENTION_ATTESTED: "true",
    STAGING_AGENT_WRITES_ATTESTED: "true",
    STAGING_AGENT_CLERK_TOKENS_ATTESTED: "true",
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
    expect(evaluateAgentAcceptanceReadiness(environment()).status).toBe(
      "PASS",
    );
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
  });

  it("binds secret configuration without serializing it", async () => {
    const actual = environment();
    const source = (await import("../source-fingerprint"))
      .createSourceFingerprint();
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
    const go = {
      ...candidate,
      decision: "GO" as const,
      checks: candidate.checks.map((check) => ({
        ...check,
        status: "PASS" as const,
      })),
    };
    const boundEnvironment = { ...actual, CDAS_SOURCE_FINGERPRINT: source };
    expect(isAgentGate(go, boundEnvironment)).toBe(true);
    expect(
      isAgentGate(go, { ...boundEnvironment, AI_MODEL: "deepseek-v4-pro" }),
    ).toBe(false);
    expect(JSON.stringify(go)).not.toContain(actual.DEEPSEEK_API_KEY);
  });

  it("does not issue a teacher ticket until the exact gate is ready", async () => {
    let calls = 0;
    const client = {
      signInTokens: {
        createSignInToken: async (input: {
          userId: string;
          expiresInSeconds: number;
        }) => {
          calls += 1;
          expect(input.expiresInSeconds).toBe(60);
          return { token: "memory" };
        },
      },
    };
    await expect(
      issueAgentTeacherTicket(
        environment({ AI_PROVIDER_DISABLED: "1" }),
        client,
      ),
    ).rejects.toThrow();
    expect(calls).toBe(0);
    await expect(
      issueAgentTeacherTicket(environment(), client),
    ).resolves.toBe("memory");
  });

  it("redacts evidence and scopes secrets away from action and install steps", () => {
    expect(
      redactAgentAcceptanceText(
        "postgresql://a:b@x ticket=token sk_test_value",
      ),
    ).not.toContain("token");

    const workflow = readFileSync(
      ".github/workflows/staging-agent-acceptance.yml",
      "utf8",
    );
    const jobEnvironmentBlocks = [
      ...workflow.matchAll(/^    env:\n((?:^      [^\n]*\n)*)/gmu),
    ].map((match) => match[1] ?? "");
    expect(jobEnvironmentBlocks).toHaveLength(2);
    expect(jobEnvironmentBlocks.join("\n")).not.toContain("secrets.");
    expect(workflow).not.toMatch(/^\s*uses:\s*[^\s]+@(v\d+|main|master)\s*$/gmu);
    expect(workflow).toContain("STAGING_NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
    expect(workflow).not.toContain("STAGING_CLERK_PUBLISHABLE_KEY");

    expect(workflow.indexOf("id: agent-gate")).toBeLessThan(
      workflow.indexOf("id: chromium"),
    );
    expect(workflow.indexOf("id: identity")).toBeLessThan(
      workflow.indexOf("id: immediate-health"),
    );
    expect(workflow.indexOf("id: immediate-health")).toBeLessThan(
      workflow.indexOf("id: bootstrap"),
    );
    expect(workflow.indexOf("id: bootstrap")).toBeLessThan(
      workflow.indexOf("id: browser"),
    );
    expect(workflow.indexOf("id: browser")).toBeLessThan(
      workflow.indexOf("id: verify"),
    );
  });
});
