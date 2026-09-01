import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { expectedEvidenceChecks } from "../decision";
import { agentAcceptanceAttestations } from "./contracts";
import { agentOutputDirectory, writeAgentArtifact } from "./output";
import { agentVerificationCodes } from "./verify";

const screenshots = [
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
] as const;
const gateCodes = [
  "SAME_RUN_STAGING_GO",
  "AGENT_READINESS",
  "SOURCE_FINGERPRINT",
  "AGENT_BINDING_MAC",
] as const;
const identityCodes = [
  "TEACHER_LOCAL_AUTHENTICATES",
  "STUDENT_LOCAL_AUTHENTICATES",
  "OTHER_STUDENT_LOCAL_AUTHENTICATES",
  "OTHER_TEACHER_LOCAL_AUTHENTICATES",
  "DISABLED_ACCOUNT_IS_REJECTED",
  "DISABLED_SCHOOL_IS_REJECTED",
  "CROSS_SCHOOL_IDENTIFIER_REJECTED",
] as const;

type Evidence = Readonly<Record<string, unknown>>;
export type AgentAcceptanceEvidenceSet = Readonly<{
  readiness: unknown;
  gate: unknown;
  identity: unknown;
  immediateHealth: unknown;
  bootstrap: unknown;
  browser: unknown;
  cleanup: unknown;
  verification: unknown;
}>;

function evidenceObject(value: unknown): Evidence | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Evidence)
    : undefined;
}

function exactKeys(value: Evidence, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    expected.every((key, index) => actual[index] === key)
  );
}

function hasCommonBoundary(value: Evidence): boolean {
  return (
    value.realStudentDataAllowed === false &&
    value.productionDecision === "NO_GO"
  );
}

function exactPassingChecks(
  value: unknown,
  expectedCodes: readonly string[],
): boolean {
  if (!Array.isArray(value) || value.length !== expectedCodes.length) {
    return false;
  }
  const expected = new Set(expectedCodes);
  const seen = new Set<string>();
  return value.every((candidate) => {
    const check = evidenceObject(candidate);
    if (
      !check ||
      !exactKeys(check, ["code", "status"]) ||
      typeof check.code !== "string" ||
      !expected.has(check.code) ||
      seen.has(check.code) ||
      check.status !== "PASS"
    ) {
      return false;
    }
    seen.add(check.code);
    return true;
  });
}

function exactPassingChecksInOrder(
  value: unknown,
  expectedCodes: readonly string[],
): boolean {
  if (!exactPassingChecks(value, expectedCodes) || !Array.isArray(value)) {
    return false;
  }
  return value.every(
    (candidate, index) =>
      evidenceObject(candidate)?.code === expectedCodes[index],
  );
}

function exactStatusEvidence(
  value: unknown,
  schema: string,
  codes: readonly string[],
): Evidence | undefined {
  const evidence = evidenceObject(value);
  if (
    !evidence ||
    !exactKeys(evidence, [
      "schema",
      "status",
      "checks",
      "realStudentDataAllowed",
      "productionDecision",
    ]) ||
    evidence.schema !== schema ||
    evidence.status !== "PASS" ||
    !hasCommonBoundary(evidence) ||
    !exactPassingChecks(evidence.checks, codes)
  ) {
    return undefined;
  }
  return evidence;
}

function validSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function validUtcInstant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function passingReadiness(value: unknown): boolean {
  return Boolean(
    exactStatusEvidence(
      value,
      "staging-agent-acceptance-readiness.v1",
      readinessCodes,
    ),
  );
}

function passingGate(value: unknown, marker: string): boolean {
  const evidence = evidenceObject(value);
  return Boolean(
    evidence &&
      exactKeys(evidence, [
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
      ]) &&
      evidence.schema === "staging-agent-acceptance-gate.v1" &&
      evidence.decision === "GO" &&
      evidence.marker === marker &&
      typeof evidence.githubRunId === "string" &&
      /^[1-9][0-9]*$/u.test(evidence.githubRunId) &&
      typeof evidence.githubRunAttempt === "string" &&
      /^[1-9][0-9]*$/u.test(evidence.githubRunAttempt) &&
      typeof evidence.deploymentId === "string" &&
      /^[a-f0-9]{40}$/u.test(evidence.deploymentId) &&
      validSha256(evidence.sourceFingerprint) &&
      validSha256(evidence.bindingMac) &&
      exactPassingChecks(evidence.checks, gateCodes) &&
      hasCommonBoundary(evidence),
  );
}

function passingIdentity(value: unknown): boolean {
  const evidence = evidenceObject(value);
  return Boolean(
    evidence &&
      exactKeys(evidence, [
        "schema",
        "status",
        "checks",
        "directSessionsRevoked",
        "realStudentDataAllowed",
        "productionDecision",
      ]) &&
      evidence.schema === "staging-agent-acceptance-identity.v1" &&
      evidence.status === "PASS" &&
      evidence.directSessionsRevoked === true &&
      exactPassingChecksInOrder(evidence.checks, identityCodes) &&
      hasCommonBoundary(evidence),
  );
}

function passingImmediateHealth(value: unknown): boolean {
  return Boolean(
    exactStatusEvidence(
      value,
      "staging-agent-acceptance-immediate-health.v1",
      expectedEvidenceChecks["staging-application.v1"],
    ),
  );
}

function passingBootstrap(value: unknown, marker: string): boolean {
  const evidence = evidenceObject(value);
  const namespace = evidenceObject(evidence?.namespace);
  const resources = evidenceObject(evidence?.resources);
  return Boolean(
    evidence &&
      exactKeys(evidence, [
        "schema",
        "status",
        "namespace",
        "collisionProbe",
        "resources",
        "realStudentDataAllowed",
        "productionDecision",
      ]) &&
      evidence.schema === "staging-agent-acceptance-bootstrap.v1" &&
      evidence.status === "PASS" &&
      namespace &&
      exactKeys(namespace, ["marker", "classroomDerived"]) &&
      namespace.marker === marker &&
      namespace.classroomDerived === true &&
      (evidence.collisionProbe === "ABSENT" ||
        evidence.collisionProbe === "MATCHING") &&
      resources &&
      exactKeys(resources, [
        "teacher",
        "student",
        "otherStudent",
        "otherTeacher",
        "classroom",
        "membership",
        "otherMembership",
      ]) &&
      Object.values(resources).every(
        (status) => status === "CREATED" || status === "EXISTING",
      ) &&
      hasCommonBoundary(evidence),
  );
}

function passingBrowser(value: unknown): boolean {
  const evidence = evidenceObject(value);
  const recorded = evidenceObject(evidence?.screenshots);
  return Boolean(
    evidence &&
      exactKeys(evidence, [
        "schema",
        "status",
        "startedAt",
        "completedAt",
        "checks",
        "screenshots",
        "realStudentDataAllowed",
        "productionDecision",
      ]) &&
      evidence.schema === "staging-agent-acceptance-browser.v1" &&
      evidence.status === "PASS" &&
      validUtcInstant(evidence.startedAt) &&
      validUtcInstant(evidence.completedAt) &&
      Date.parse(evidence.startedAt) < Date.parse(evidence.completedAt) &&
      exactPassingChecks(
        evidence.checks,
        [
          ...browserCodes,
          ...screenshots.map((_, index) => `SCREENSHOT_${index + 1}`),
        ],
      ) &&
      recorded &&
      exactKeys(recorded, screenshots) &&
      screenshots.every((name) => validSha256(recorded[name])) &&
      hasCommonBoundary(evidence),
  );
}

function passingCleanup(value: unknown): boolean {
  const evidence = evidenceObject(value);
  return Boolean(
    evidence &&
      exactKeys(evidence, [
        "schema",
        "status",
        "targetCount",
        "revokedCount",
        "remainingCount",
        "realStudentDataAllowed",
        "productionDecision",
      ]) &&
      evidence.schema === "staging-agent-acceptance-cleanup.v1" &&
      evidence.status === "PASS" &&
      evidence.targetCount === 6 &&
      typeof evidence.revokedCount === "number" &&
      evidence.revokedCount >= 0 &&
      evidence.remainingCount === 0 &&
      hasCommonBoundary(evidence),
  );
}

function passingVerification(value: unknown): boolean {
  return Boolean(
    exactStatusEvidence(
      value,
      "staging-agent-acceptance-verify.v1",
      agentVerificationCodes,
    ),
  );
}

export function evaluateAgentAcceptanceEvidence(
  evidence: AgentAcceptanceEvidenceSet,
  marker: string,
): Readonly<Record<keyof AgentAcceptanceEvidenceSet, boolean>> {
  return {
    readiness: passingReadiness(evidence.readiness),
    gate: passingGate(evidence.gate, marker),
    identity: passingIdentity(evidence.identity),
    immediateHealth: passingImmediateHealth(evidence.immediateHealth),
    bootstrap: passingBootstrap(evidence.bootstrap, marker),
    browser: passingBrowser(evidence.browser),
    cleanup: passingCleanup(evidence.cleanup),
    verification: passingVerification(evidence.verification),
  };
}

async function readEvidence(
  directory: string,
  name: string,
): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path.join(directory, name), "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

async function screenshotHashes(
  directory: string,
): Promise<Record<string, string> | undefined> {
  try {
    return Object.fromEntries(
      await Promise.all(
        screenshots.map(async (name) => [
          name,
          createHash("sha256")
            .update(await readFile(path.join(directory, name)))
            .digest("hex"),
        ]),
      ),
    );
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const marker = process.env.STAGING_RUN_MARKER?.trim() ?? "";
  const directory = agentOutputDirectory(marker);
  const [
    readiness,
    gate,
    identity,
    immediateHealth,
    bootstrap,
    browser,
    cleanup,
    verification,
  ] = await Promise.all([
    readEvidence(directory, "readiness.json"),
    readEvidence(directory, "gate.json"),
    readEvidence(directory, "identity.json"),
    readEvidence(directory, "immediate-health.json"),
    readEvidence(directory, "bootstrap.json"),
    readEvidence(directory, "browser.json"),
    readEvidence(directory, "cleanup.json"),
    readEvidence(directory, "verify.json"),
  ]);

  const validations = evaluateAgentAcceptanceEvidence(
    {
      readiness,
      gate,
      identity,
      immediateHealth,
    bootstrap,
    browser,
    cleanup,
    verification,
    },
    marker,
  );
  const expectedHashes = await screenshotHashes(directory);
  const recorded = evidenceObject(evidenceObject(browser)?.screenshots);
  const exactScreenshotIndex = Boolean(
    expectedHashes &&
      recorded &&
      screenshots.every((name) => recorded[name] === expectedHashes[name]),
  );
  const allRequiredEvidence = Object.values(validations).every(Boolean);
  const status = allRequiredEvidence && exactScreenshotIndex ? "PASS" : "FAIL";

  await writeAgentArtifact(marker, "final.json", {
    schema: "staging-agent-acceptance-final.v1",
    status,
    checks: [
      {
        code: "ALL_REQUIRED_EVIDENCE",
        status: allRequiredEvidence ? "PASS" : "FAIL",
      },
      {
        code: "SCREENSHOT_HASHES",
        status: exactScreenshotIndex ? "PASS" : "FAIL",
      },
    ],
    realStudentDataAllowed: false,
    productionDecision: "NO_GO",
  });
  process.stdout.write(
    `${JSON.stringify({ schema: "staging-agent-acceptance-final.v1", status })}\n`,
  );
  if (status !== "PASS") process.exitCode = 1;
}

async function writeFailure(): Promise<void> {
  const marker = process.env.STAGING_RUN_MARKER?.trim() ?? "";
  try {
    await writeAgentArtifact(marker, "final.json", {
      schema: "staging-agent-acceptance-final.v1",
      status: "FAIL",
      checks: [
        { code: "ALL_REQUIRED_EVIDENCE", status: "FAIL" },
        { code: "SCREENSHOT_HASHES", status: "FAIL" },
      ],
      realStudentDataAllowed: false,
      productionDecision: "NO_GO",
    });
  } catch {
    // Invalid marker/output paths must remain a hard failure.
  }
  process.stdout.write(
    '{"schema":"staging-agent-acceptance-final.v1","status":"FAIL"}\n',
  );
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(writeFailure);
}
