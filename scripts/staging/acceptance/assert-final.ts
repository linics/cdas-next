import { readFile } from "node:fs/promises";
import path from "node:path";

import { isAcceptanceGate } from "./gate";
import { isPassingImmediateHealthEvidence } from "./immediate-health";
import { writeAcceptanceArtifact } from "./output";
import { isPassingBrowserEvidence } from "./browser-evidence-contract";
import {
  isPassingBootstrapEvidence,
  isPassingIdentityEvidence,
} from "./prerequisites";

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length === keys.length && keys.every((key) => key in (value as object));
}

async function passingEvidence(value: unknown, marker: string, directory: string): Promise<boolean> {
  return isPassingBrowserEvidence(value, marker, directory, process.env);
}

function passingVerify(value: unknown): boolean {
  const codes = ["NAMESPACE_CLASSROOM_AND_MEMBERSHIPS_EXACT", "MEMBERSHIP_HISTORY_INTENTS_AND_AUDITS_EXACT", "RELEASE_GROUP_MEMBERS_ROLES_AND_AUDIT_EXACT", "MANUAL_PHASED_GROUP_RELEASE_FEEDBACK_CLOSED", "VERSIONED_PHASE_SUBMISSIONS_AND_CHECKPOINTS_EXACT", "PRIVATE_ATTACHMENT_READY_AND_FORMALIZED", "STRUCTURED_FEEDBACK_AND_INTENT_EXACT", "EVIDENCE_BOUND_EVALUATION_AND_INTENT_EXACT", "SNAPSHOT_INTENTS_AUDITS_AND_STALE_CLOSE_REJECTION", "GROUPMATE_SHARED_HISTORY_EXACT"];
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
