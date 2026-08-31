import { readFile } from "node:fs/promises";
import path from "node:path";

import type { AcceptanceEnvironment } from "./contracts";
import { isAcceptanceGate, isCoreAcceptanceGate } from "./gate";
import { isPassingImmediateHealthEvidence } from "./immediate-health";
import { isPassingBrowserEvidence } from "./browser-evidence-contract";

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value as object).length === keys.length &&
    keys.every((key) => key in (value as object));
}

export function isPassingIdentityEvidence(value: unknown): boolean {
  const codes = [
    "TEACHER_LOCAL_AUTHENTICATES",
    "STUDENT_LOCAL_AUTHENTICATES",
    "OTHER_STUDENT_LOCAL_AUTHENTICATES",
    "OTHER_TEACHER_LOCAL_AUTHENTICATES",
    "WRONG_SCHOOL_INVALID_CREDENTIALS",
    "DISABLED_ACCOUNT_ACCOUNT_DISABLED",
    "DISABLED_SCHOOL_SCHOOL_DISABLED",
  ];
  if (!exactObject(value, ["schema", "status", "checks", "sessionsRevoked", "realStudentDataAllowed", "productionDecision"]) ||
    value.schema !== "staging-synthetic-acceptance-identity.v1" || value.status !== "PASS" ||
    value.sessionsRevoked !== true || value.realStudentDataAllowed !== false ||
    value.productionDecision !== "NO_GO" || !Array.isArray(value.checks)) {
    return false;
  }
  const checks: unknown[] = value.checks;
  return checks.length === codes.length && codes.every((code) =>
    checks.some((item) => exactObject(item, ["code", "status"]) && item.code === code && item.status === "PASS"),
  );
}

export function isPassingBootstrapEvidence(
  value: unknown,
  environment: AcceptanceEnvironment,
): boolean {
  if (!exactObject(value, ["schema", "status", "namespace", "collisionProbe", "resources", "realStudentDataAllowed", "productionDecision"]) ||
    value.schema !== "staging-synthetic-acceptance-bootstrap.v1" || value.status !== "PASS" ||
    value.realStudentDataAllowed !== false || value.productionDecision !== "NO_GO" ||
    !exactObject(value.namespace, ["marker", "classroomDerived"]) ||
    value.namespace.marker !== environment.STAGING_RUN_MARKER?.trim() || value.namespace.classroomDerived !== true ||
    (value.collisionProbe !== "ABSENT" && value.collisionProbe !== "MATCHING") ||
    !exactObject(value.resources, ["teacher", "student", "otherStudent", "otherTeacher", "classroom", "membership", "otherMembership"])) {
    return false;
  }
  const statuses = Object.values(value.resources);
  if (!statuses.every((status) => status === "CREATED" || status === "EXISTING")) return false;
  return value.collisionProbe === "MATCHING"
    ? statuses.every((status) => status === "EXISTING")
    : value.resources.classroom === "CREATED" && value.resources.membership === "CREATED" && value.resources.otherMembership === "CREATED";
}

async function readArtifact(directory: string, name: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(directory, name), "utf8")) as unknown;
}

export async function assertPreWritePrerequisites(
  environment: AcceptanceEnvironment,
): Promise<void> {
  const marker = environment.STAGING_RUN_MARKER?.trim() ?? "";
  const directory = path.join(process.cwd(), "output", "staging-acceptance", marker);
  const [gate, immediateHealth] = await Promise.all([
    readArtifact(directory, "gate.json"),
    readArtifact(directory, "immediate-health.json"),
  ]);
  if (!isCoreAcceptanceGate(gate, environment) ||
    !isPassingImmediateHealthEvidence(immediateHealth, environment)) {
    throw new Error("STAGING_ACCEPTANCE_PREWRITE_GATE_NOT_GO");
  }
}

/** Identity lookup/ticket-revoke has no database write. It is intentionally
 * allowed after the same-run gate but before the final deployment proof, so
 * the last health proof is immediately adjacent to the first database write. */
export async function assertIdentityPrerequisites(
  environment: AcceptanceEnvironment,
): Promise<void> {
  const marker = environment.STAGING_RUN_MARKER?.trim() ?? "";
  const gate = await readArtifact(
    path.join(process.cwd(), "output", "staging-acceptance", marker),
    "gate.json",
  );
  if (!isCoreAcceptanceGate(gate, environment)) {
    throw new Error("STAGING_ACCEPTANCE_GATE_NOT_GO");
  }
}

export async function assertBootstrapPrerequisites(
  environment: AcceptanceEnvironment,
): Promise<void> {
  await assertPreWritePrerequisites(environment);
  const marker = environment.STAGING_RUN_MARKER?.trim() ?? "";
  const identity = await readArtifact(
    path.join(process.cwd(), "output", "staging-acceptance", marker),
    "identity.json",
  );
  if (!isPassingIdentityEvidence(identity)) {
    throw new Error("STAGING_ACCEPTANCE_IDENTITY_NOT_VERIFIED");
  }
}

export async function assertBrowserPrerequisites(
  environment: AcceptanceEnvironment,
): Promise<void> {
  await assertBootstrapPrerequisites(environment);
  const marker = environment.STAGING_RUN_MARKER?.trim() ?? "";
  const bootstrap = await readArtifact(
    path.join(process.cwd(), "output", "staging-acceptance", marker),
    "bootstrap.json",
  );
  if (!isPassingBootstrapEvidence(bootstrap, environment)) {
    throw new Error("STAGING_ACCEPTANCE_BOOTSTRAP_NOT_VERIFIED");
  }
  const gate = await readArtifact(
    path.join(process.cwd(), "output", "staging-acceptance", marker),
    "gate.json",
  );
  if (!isAcceptanceGate(gate, environment)) {
    throw new Error("STAGING_ACCEPTANCE_GATE_NOT_GO");
  }
}

export async function assertPostBrowserPrerequisites(
  environment: AcceptanceEnvironment,
): Promise<void> {
  await assertBootstrapPrerequisites(environment);
  const marker = environment.STAGING_RUN_MARKER?.trim() ?? "";
  const directory = path.join(process.cwd(), "output", "staging-acceptance", marker);
  const [gate, bootstrap, browser] = await Promise.all([
    readArtifact(directory, "gate.json"),
    readArtifact(directory, "bootstrap.json"),
    readArtifact(directory, "evidence.json"),
  ]);
  if (!isCoreAcceptanceGate(gate, environment) ||
    !isPassingBootstrapEvidence(bootstrap, environment) ||
    !(await isPassingBrowserEvidence(browser, marker, directory, environment))) {
    throw new Error("STAGING_ACCEPTANCE_POST_BROWSER_NOT_GO");
  }
}
