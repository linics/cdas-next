import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import { isAcceptanceGate } from "./gate";
import { isPassingImmediateHealthEvidence } from "./immediate-health";
import { writeAcceptanceArtifact } from "./output";
import {
  isPassingBootstrapEvidence,
  isPassingIdentityEvidence,
} from "./prerequisites";

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length === keys.length && keys.every((key) => key in (value as object));
}

async function passingEvidence(value: unknown, marker: string, directory: string): Promise<boolean> {
  const keys = ["schema", "status", "runMarker", "githubRunId", "githubRunAttempt", "deploymentId", "sourceFingerprint", "fixtureNamespace", "generatedAt", "checks", "artifactSha256", "realStudentDataAllowed", "productionDecision"];
  if (!exactObject(value, keys) || value.schema !== "staging-synthetic-acceptance-evidence.v1" || value.status !== "PASS" || value.runMarker !== marker || value.githubRunId !== process.env.GITHUB_RUN_ID || value.githubRunAttempt !== process.env.GITHUB_RUN_ATTEMPT || value.deploymentId !== process.env.CDAS_DEPLOYMENT_ID || value.sourceFingerprint !== process.env.CDAS_SOURCE_FINGERPRINT || value.realStudentDataAllowed !== false || value.productionDecision !== "NO_GO" || typeof value.generatedAt !== "string" || Number.isNaN(Date.parse(value.generatedAt))) return false;
  if (!exactObject(value.fixtureNamespace, ["classroomDerived", "marker"]) || value.fixtureNamespace.classroomDerived !== true || value.fixtureNamespace.marker !== marker) return false;
  const expectedChecks = ["STUDENT_TEACHER_RESOURCE_HIDDEN", "STUDENT_FEEDBACK_VISIBLE", "STALE_STUDENT_WRITE_REJECTED_AFTER_CLOSE", "CLOSED_STUDENT_READONLY"];
  const evidenceChecks: unknown[] = Array.isArray(value.checks) ? value.checks : [];
  if (evidenceChecks.length !== expectedChecks.length || !evidenceChecks.every((item) => exactObject(item, ["code", "status"]) && item.status === "PASS") || new Set(evidenceChecks.map((item) => (item as Record<string, unknown>).code)).size !== expectedChecks.length || !expectedChecks.every((code) => evidenceChecks.some((item) => (item as Record<string, unknown>).code === code))) return false;
  if (!exactObject(value.artifactSha256, ["01-draft-ready.png", "02-published.png", "03-student-submitted.png", "04-teacher-feedback.png", "05-teacher-closed.png", "06-student-closed-readonly.png"])) return false;
  for (const [name, hash] of Object.entries(value.artifactSha256)) {
    if (typeof hash !== "string" || !/^[a-f0-9]{64}$/u.test(hash)) return false;
    try {
      const actual = createHash("sha256").update(await readFile(path.join(directory, name))).digest("hex");
      if (actual !== hash) return false;
    } catch { return false; }
  }
  return true;
}

function passingVerify(value: unknown): boolean {
  const codes = ["NAMESPACE_CLASSROOM_AND_MEMBERSHIP_EXACT", "MANUAL_DRAFT_RELEASE_SUBMISSION_FEEDBACK_CLOSED", "SNAPSHOT_INTENTS_AUDITS_AND_STALE_CLOSE_REJECTION"];
  if (!exactObject(value, ["schema", "status", "checks", "readOnlyTransaction", "realStudentDataAllowed", "productionDecision"]) || value.schema !== "staging-synthetic-acceptance-verify.v1" || value.status !== "PASS" || value.readOnlyTransaction !== true || value.realStudentDataAllowed !== false || value.productionDecision !== "NO_GO") return false;
  const verifyChecks: unknown[] = Array.isArray(value.checks) ? value.checks : [];
  return verifyChecks.length === codes.length && verifyChecks.every((check) => exactObject(check, ["code", "status"]) && check.status === "PASS") && new Set(verifyChecks.map((item) => (item as Record<string, unknown>).code)).size === codes.length && codes.every((code) => verifyChecks.some((item) => (item as Record<string, unknown>).code === code));
}

async function main(): Promise<void> {
  const marker = process.env.STAGING_RUN_MARKER?.trim() ?? "";
  const directory = path.join(process.cwd(), "output", "staging-acceptance", marker);
  const [gate, immediateHealth, identity, bootstrap, evidence, verify] = await Promise.all([
    "gate.json",
    "immediate-health.json",
    "identity.json",
    "bootstrap.json",
    "evidence.json",
    "verify.json",
  ].map(async (name) => JSON.parse(await readFile(path.join(directory, name), "utf8")) as unknown));
  const checks = [
    { code: "SAME_RUN_GATE_GO", status: isAcceptanceGate(gate, process.env) ? "PASS" : "FAIL" },
    { code: "IMMEDIATE_APPLICATION_HEALTH", status: isPassingImmediateHealthEvidence(immediateHealth, process.env) ? "PASS" : "FAIL" },
    { code: "CLERK_IDENTITIES_AND_TICKETS", status: isPassingIdentityEvidence(identity) ? "PASS" : "FAIL" },
    { code: "ADDITIVE_BOOTSTRAP_EVIDENCE", status: isPassingBootstrapEvidence(bootstrap, process.env) ? "PASS" : "FAIL" },
    { code: "BROWSER_EVIDENCE", status: await passingEvidence(evidence, marker, directory) ? "PASS" : "FAIL" },
    { code: "READ_ONLY_NAMESPACE_VERIFY", status: passingVerify(verify) ? "PASS" : "FAIL" },
  ];
  const status = checks.every((check) => check.status === "PASS") ? "PASS" : "FAIL";
  await writeAcceptanceArtifact(marker, "final.json", { schema: "staging-synthetic-acceptance-final.v1", status, checks, realStudentDataAllowed: false, productionDecision: "NO_GO" });
  process.stdout.write(`${JSON.stringify({ schema: "staging-synthetic-acceptance-final.v1", status })}\n`);
  if (status !== "PASS") process.exitCode = 1;
}

void main().catch(async () => {
  const marker = process.env.STAGING_RUN_MARKER?.trim() ?? "";
  try { await writeAcceptanceArtifact(marker, "final.json", { schema: "staging-synthetic-acceptance-final.v1", status: "FAIL", checks: [{ code: "STAGING_ACCEPTANCE_FINAL_INTERNAL_ERROR", status: "FAIL" }], realStudentDataAllowed: false, productionDecision: "NO_GO" }); } catch { /* fail closed */ }
  process.stdout.write('{"schema":"staging-synthetic-acceptance-final.v1","status":"FAIL"}\n');
  process.exitCode = 1;
});
