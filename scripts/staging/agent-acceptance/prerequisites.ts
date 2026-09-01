import { readFile } from "node:fs/promises";
import path from "node:path";

import { expectedEvidenceChecks } from "../decision";
import type { AgentAcceptanceEnvironment } from "./contracts";
import { isAgentGate } from "./gate";
import { agentOutputDirectory } from "./output";

const identityCodes = [
  "TEACHER_LOCAL_AUTHENTICATES",
  "STUDENT_LOCAL_AUTHENTICATES",
  "OTHER_STUDENT_LOCAL_AUTHENTICATES",
  "OTHER_TEACHER_LOCAL_AUTHENTICATES",
  "DISABLED_ACCOUNT_IS_REJECTED",
  "DISABLED_SCHOOL_IS_REJECTED",
  "CROSS_SCHOOL_IDENTIFIER_REJECTED",
] as const;

const bootstrapResourceKeys = [
  "teacher",
  "student",
  "otherStudent",
  "otherTeacher",
  "classroom",
  "membership",
  "otherMembership",
] as const;

type Evidence = Record<string, unknown>;

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
    actual.every((key, index) => key === expected[index])
  );
}

function exactPassingChecks(
  value: unknown,
  codes: readonly string[],
  ordered = false,
): boolean {
  if (!Array.isArray(value) || value.length !== codes.length) return false;
  const expected = new Set(codes);
  const seen = new Set<string>();
  return value.every((candidate, index) => {
    const check = evidenceObject(candidate);
    const code = typeof check?.code === "string" ? check.code : "";
    if (
      !check ||
      !exactKeys(check, ["code", "status"]) ||
      !expected.has(code) ||
      seen.has(code) ||
      check.status !== "PASS" ||
      (ordered && code !== codes[index])
    ) {
      return false;
    }
    seen.add(code);
    return true;
  });
}

export function isPassingAgentIdentityEvidence(value: unknown): boolean {
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
      evidence.realStudentDataAllowed === false &&
      evidence.productionDecision === "NO_GO" &&
      exactPassingChecks(evidence.checks, identityCodes, true),
  );
}

export function isPassingAgentBootstrapEvidence(
  value: unknown,
  marker?: string,
): boolean {
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
      namespace.classroomDerived === true &&
      (marker === undefined || namespace.marker === marker) &&
      (evidence.collisionProbe === "ABSENT" ||
        evidence.collisionProbe === "MATCHING") &&
      resources &&
      exactKeys(resources, bootstrapResourceKeys) &&
      bootstrapResourceKeys.every(
        (key) => resources[key] === "CREATED" || resources[key] === "EXISTING",
      ) &&
      evidence.realStudentDataAllowed === false &&
      evidence.productionDecision === "NO_GO",
  );
}

function isPassingImmediateHealthEvidence(value: unknown): boolean {
  const evidence = evidenceObject(value);
  const codes = expectedEvidenceChecks["staging-application.v1"];
  return Boolean(
    evidence &&
      exactKeys(evidence, [
        "schema",
        "status",
        "checks",
        "realStudentDataAllowed",
        "productionDecision",
      ]) &&
      evidence.schema === "staging-agent-acceptance-immediate-health.v1" &&
      evidence.status === "PASS" &&
      evidence.realStudentDataAllowed === false &&
      evidence.productionDecision === "NO_GO" &&
      exactPassingChecks(evidence.checks, codes),
  );
}

async function readArtifact(
  environment: AgentAcceptanceEnvironment,
  name: string,
): Promise<unknown> {
  const marker = environment.STAGING_RUN_MARKER?.trim() ?? "";
  return JSON.parse(
    await readFile(path.join(agentOutputDirectory(marker), name), "utf8"),
  ) as unknown;
}

export async function assertAgentGatePrerequisites(
  environment: AgentAcceptanceEnvironment,
): Promise<void> {
  const gate = await readArtifact(environment, "gate.json");
  if (!isAgentGate(gate, environment)) {
    throw new Error("STAGING_AGENT_ACCEPTANCE_GATE_NOT_GO");
  }
}

export async function assertAgentBootstrapPrerequisites(
  environment: AgentAcceptanceEnvironment,
): Promise<void> {
  await assertAgentGatePrerequisites(environment);
  if (
    !isPassingImmediateHealthEvidence(
      await readArtifact(environment, "immediate-health.json"),
    )
  ) {
    throw new Error("STAGING_AGENT_ACCEPTANCE_PREWRITE_NOT_GO");
  }
}

export async function assertAgentIdentityPrerequisites(
  environment: AgentAcceptanceEnvironment,
): Promise<void> {
  await assertAgentBootstrapPrerequisites(environment);
  if (
    !isPassingAgentBootstrapEvidence(
      await readArtifact(environment, "bootstrap.json"),
      environment.STAGING_RUN_MARKER?.trim(),
    )
  ) {
    throw new Error("STAGING_AGENT_ACCEPTANCE_BOOTSTRAP_NOT_GO");
  }
}

export async function assertAgentBrowserPrerequisites(
  environment: AgentAcceptanceEnvironment,
): Promise<void> {
  await assertAgentIdentityPrerequisites(environment);
  if (
    !isPassingAgentIdentityEvidence(
      await readArtifact(environment, "identity.json"),
    )
  ) {
    throw new Error("STAGING_AGENT_ACCEPTANCE_IDENTITY_NOT_GO");
  }
}
