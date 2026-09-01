import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { isStagingDecision } from "../decision";
import { safeStagingRunDirectory } from "../output";
import { createSourceFingerprint } from "../source-fingerprint";
import {
  agentAcceptanceAttestations,
  evaluateAgentAcceptanceReadiness,
  type AgentAcceptanceEnvironment,
} from "./contracts";
import { writeAgentArtifact } from "./output";

const text = (environment: AgentAcceptanceEnvironment, key: string): string =>
  environment[key]?.trim() ?? "";

// Passwords and model/provider secrets are intentionally not bound here. They
// are process-only inputs and must never be serialized into gate evidence.
const fields = [
  "STAGING_RUN_MARKER",
  "GITHUB_RUN_ID",
  "GITHUB_RUN_ATTEMPT",
  "CDAS_DEPLOYMENT_ID",
  "CDAS_SOURCE_FINGERPRINT",
  "DATABASE_URL",
  "DIRECT_URL",
  "STAGING_AUTH_MODE",
  "STAGING_TEST_PRIMARY_SCHOOL_CODE",
  "STAGING_TEST_SECONDARY_SCHOOL_CODE",
  "STAGING_TEST_DISABLED_SCHOOL_CODE",
  "STAGING_TEST_TEACHER_STAFF_NO",
  "STAGING_TEST_STUDENT_NO",
  "STAGING_TEST_OTHER_STUDENT_NO",
  "STAGING_TEST_OTHER_TEACHER_STAFF_NO",
  "STAGING_TEST_DISABLED_ACCOUNT_STUDENT_NO",
  "STAGING_TEST_DISABLED_SCHOOL_TEACHER_STAFF_NO",
  "STAGING_DATABASE_NAME",
  "STAGING_BASE_URL",
  "STAGING_VERCEL_PROJECT_NAME",
  "STAGING_DEPLOYMENT_PROTECTION_REQUIRED",
  "AI_PROVIDER_DISABLED",
  "AI_MODEL",
  "STAGING_ACCEPTANCE_TEST_TEACHER_NAME",
  "STAGING_ACCEPTANCE_TEST_STUDENT_NAME",
  "STAGING_ACCEPTANCE_TEST_OTHER_STUDENT_NAME",
  "STAGING_ACCEPTANCE_TEST_OTHER_TEACHER_NAME",
  ...agentAcceptanceAttestations,
] as const;

function bindingMac(
  environment: AgentAcceptanceEnvironment,
): string | undefined {
  const secret = text(environment, "STAGING_HEALTH_PROOF_SECRET");
  if (
    Buffer.byteLength(secret, "utf8") < 32 ||
    Buffer.byteLength(secret, "utf8") > 4_096
  ) {
    return undefined;
  }
  const canonical = fields
    .map(
      (key) =>
        `${key.length}:${key}=${Buffer.byteLength(
          text(environment, key),
          "utf8",
        )}:${text(environment, key)}`,
    )
    .join("\n");
  return createHmac("sha256", secret)
    .update("cdas-staging-agent-acceptance-binding-v1\0", "utf8")
    .update(canonical, "utf8")
    .digest("hex");
}

export type AgentGate = Readonly<{
  schema: "staging-agent-acceptance-gate.v1";
  decision: "GO" | "NO_GO";
  marker: string;
  githubRunId: string;
  githubRunAttempt: string;
  deploymentId: string;
  sourceFingerprint: string;
  bindingMac: string;
  checks: readonly { code: string; status: "PASS" | "FAIL" }[];
  realStudentDataAllowed: false;
  productionDecision: "NO_GO";
}>;

export async function createAgentGate(
  environment: AgentAcceptanceEnvironment,
  decision: unknown,
): Promise<AgentGate> {
  const readiness = evaluateAgentAcceptanceReadiness(environment);
  const fingerprint = createSourceFingerprint();
  const binding = bindingMac(environment);
  const checks = [
    {
      code: "SAME_RUN_STAGING_GO",
      status:
        isStagingDecision(decision) && decision.decision === "GO"
          ? ("PASS" as const)
          : ("FAIL" as const),
    },
    {
      code: "AGENT_READINESS",
      status:
        readiness.status === "PASS"
          ? ("PASS" as const)
          : ("FAIL" as const),
    },
    {
      code: "SOURCE_FINGERPRINT",
      status:
        fingerprint === text(environment, "CDAS_SOURCE_FINGERPRINT")
          ? ("PASS" as const)
          : ("FAIL" as const),
    },
    {
      code: "AGENT_BINDING_MAC",
      status: binding ? ("PASS" as const) : ("FAIL" as const),
    },
  ];
  return {
    schema: "staging-agent-acceptance-gate.v1",
    decision: checks.every((item) => item.status === "PASS") ? "GO" : "NO_GO",
    marker: text(environment, "STAGING_RUN_MARKER"),
    githubRunId: text(environment, "GITHUB_RUN_ID"),
    githubRunAttempt: text(environment, "GITHUB_RUN_ATTEMPT"),
    deploymentId: text(environment, "CDAS_DEPLOYMENT_ID"),
    sourceFingerprint: fingerprint,
    bindingMac: binding ?? "",
    checks,
    realStudentDataAllowed: false,
    productionDecision: "NO_GO",
  };
}

export function isAgentGate(
  value: unknown,
  environment: AgentAcceptanceEnvironment,
): value is AgentGate {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const keys = [
    "schema",
    "decision",
    "marker",
    "githubRunId",
    "githubRunAttempt",
    "deploymentId",
    "sourceFingerprint",
    "bindingMac",
    "checks",
    "realStudentDataAllowed",
    "productionDecision",
  ];
  const expected = bindingMac(environment);
  if (
    Object.keys(candidate).length !== keys.length ||
    !keys.every((key) => key in candidate) ||
    candidate.schema !== "staging-agent-acceptance-gate.v1" ||
    candidate.decision !== "GO" ||
    candidate.marker !== text(environment, "STAGING_RUN_MARKER") ||
    candidate.githubRunId !== text(environment, "GITHUB_RUN_ID") ||
    candidate.githubRunAttempt !== text(environment, "GITHUB_RUN_ATTEMPT") ||
    candidate.deploymentId !== text(environment, "CDAS_DEPLOYMENT_ID") ||
    candidate.sourceFingerprint !== text(environment, "CDAS_SOURCE_FINGERPRINT") ||
    candidate.realStudentDataAllowed !== false ||
    candidate.productionDecision !== "NO_GO" ||
    !expected ||
    typeof candidate.bindingMac !== "string" ||
    !/^[a-f0-9]{64}$/u.test(candidate.bindingMac)
  ) {
    return false;
  }
  if (
    !timingSafeEqual(
      Buffer.from(candidate.bindingMac, "hex"),
      Buffer.from(expected, "hex"),
    ) ||
    !Array.isArray(candidate.checks)
  ) {
    return false;
  }
  const codes = [
    "SAME_RUN_STAGING_GO",
    "AGENT_READINESS",
    "SOURCE_FINGERPRINT",
    "AGENT_BINDING_MAC",
  ];
  return (
    candidate.checks.length === codes.length &&
    new Set(
      candidate.checks.map((item) =>
        item && typeof item === "object"
          ? (item as Record<string, unknown>).code
          : "",
      ),
    ).size === codes.length &&
    candidate.checks.every(
      (item) =>
        item &&
        typeof item === "object" &&
        Object.keys(item).length === 2 &&
        codes.includes((item as Record<string, unknown>).code as string) &&
        (item as Record<string, unknown>).status === "PASS",
    )
  );
}

async function main(): Promise<void> {
  const marker = text(process.env, "STAGING_RUN_MARKER");
  let decision: unknown;
  try {
    decision = JSON.parse(
      await readFile(
        path.join(safeStagingRunDirectory(marker), "decision.json"),
        "utf8",
      ),
    ) as unknown;
  } catch {
    decision = undefined;
  }
  const gate = await createAgentGate(process.env, decision);
  await writeAgentArtifact(
    marker,
    "readiness.json",
    evaluateAgentAcceptanceReadiness(process.env),
  );
  await writeAgentArtifact(marker, "gate.json", gate);
  process.stdout.write(
    `${JSON.stringify({ schema: gate.schema, decision: gate.decision })}\n`,
  );
  if (gate.decision !== "GO") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => {
    process.stdout.write(
      '{"schema":"staging-agent-acceptance-gate.v1","decision":"NO_GO"}\n',
    );
    process.exitCode = 1;
  });
}
