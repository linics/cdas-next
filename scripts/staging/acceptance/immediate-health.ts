import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { expectedEvidenceChecks } from "../decision";
import { safeStagingRunDirectory } from "../output";
import type { AcceptanceEnvironment } from "./contracts";
import { writeAcceptanceArtifact } from "./output";

export type ImmediateHealthEvidence = Readonly<{
  schema: "staging-synthetic-acceptance-immediate-health.v1";
  status: "PASS" | "FAIL";
  runMarker: string;
  githubRunId: string;
  githubRunAttempt: string;
  deploymentId: string;
  sourceFingerprint: string;
  checks: readonly Readonly<{ code: string; status: "PASS" | "FAIL" }>[];
  realStudentDataAllowed: false;
  productionDecision: "NO_GO";
}>;

function text(environment: AcceptanceEnvironment, name: string): string {
  return environment[name]?.trim() ?? "";
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value as object).length === keys.length &&
    keys.every((key) => key in (value as object));
}

export function isExactPassingApplicationEvidence(value: unknown): boolean {
  if (!exactObject(value, ["schema", "status", "checks", "stagingSyntheticDecision", "realStudentDataAllowed", "productionDecision"]) ||
    value.schema !== "staging-application.v1" || value.status !== "PASS" ||
    value.stagingSyntheticDecision !== "GO" || value.realStudentDataAllowed !== false ||
    value.productionDecision !== "NO_GO" || !Array.isArray(value.checks)) {
    return false;
  }
  const expected = expectedEvidenceChecks["staging-application.v1"];
  const checks: unknown[] = value.checks;
  return checks.length === expected.length && expected.every((code) =>
    checks.some((item) => exactObject(item, ["code", "status"]) && item.code === code && item.status === "PASS"),
  ) && new Set(checks.map((item) => exactObject(item, ["code", "status"]) ? item.code : "")).size === expected.length;
}

export function isPassingImmediateHealthEvidence(
  value: unknown,
  environment: AcceptanceEnvironment,
): value is ImmediateHealthEvidence {
  if (!exactObject(value, ["schema", "status", "runMarker", "githubRunId", "githubRunAttempt", "deploymentId", "sourceFingerprint", "checks", "realStudentDataAllowed", "productionDecision"]) ||
    value.schema !== "staging-synthetic-acceptance-immediate-health.v1" || value.status !== "PASS" ||
    value.runMarker !== text(environment, "STAGING_RUN_MARKER") || value.githubRunId !== text(environment, "GITHUB_RUN_ID") ||
    value.githubRunAttempt !== text(environment, "GITHUB_RUN_ATTEMPT") || value.deploymentId !== text(environment, "CDAS_DEPLOYMENT_ID") ||
    value.sourceFingerprint !== text(environment, "CDAS_SOURCE_FINGERPRINT") || value.realStudentDataAllowed !== false ||
    value.productionDecision !== "NO_GO" || !Array.isArray(value.checks)) {
    return false;
  }
  const expected = expectedEvidenceChecks["staging-application.v1"];
  const checks: unknown[] = value.checks;
  return checks.length === expected.length && expected.every((code) =>
    checks.some((item) => exactObject(item, ["code", "status"]) && item.code === code && item.status === "PASS"),
  );
}

export async function main(): Promise<void> {
  const marker = text(process.env, "STAGING_RUN_MARKER");
  let application: unknown;
  try {
    application = JSON.parse(await readFile(path.join(safeStagingRunDirectory(marker), "application.json"), "utf8")) as unknown;
  } catch {
    application = undefined;
  }
  const passing = text(process.env, "STAGING_IMMEDIATE_HEALTH_OUTCOME") === "success" &&
    isExactPassingApplicationEvidence(application);
  const checks = expectedEvidenceChecks["staging-application.v1"].map((code) => ({
    code,
    status: passing ? "PASS" as const : "FAIL" as const,
  }));
  const evidence: ImmediateHealthEvidence = {
    schema: "staging-synthetic-acceptance-immediate-health.v1",
    status: passing ? "PASS" : "FAIL",
    runMarker: marker,
    githubRunId: text(process.env, "GITHUB_RUN_ID"),
    githubRunAttempt: text(process.env, "GITHUB_RUN_ATTEMPT"),
    deploymentId: text(process.env, "CDAS_DEPLOYMENT_ID"),
    sourceFingerprint: text(process.env, "CDAS_SOURCE_FINGERPRINT"),
    checks,
    realStudentDataAllowed: false,
    productionDecision: "NO_GO",
  };
  await writeAcceptanceArtifact(marker, "immediate-health.json", evidence);
  process.stdout.write(`${JSON.stringify({ schema: evidence.schema, status: evidence.status })}\n`);
  if (!passing) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => {
    process.stdout.write('{"schema":"staging-synthetic-acceptance-immediate-health.v1","status":"FAIL"}\n');
    process.exitCode = 1;
  });
}
