import { readFile } from "node:fs/promises";
import { createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { isStagingDecision } from "../decision";
import { isSafeStagingRunMarker } from "../contracts";
import { safeStagingRunDirectory } from "../output";
import { createSourceFingerprint } from "../source-fingerprint";
import { evaluateAcceptanceReadiness, type AcceptanceEnvironment } from "./contracts";
import { writeAcceptanceArtifact } from "./output";

export type AcceptanceGate = Readonly<{
  schema: "staging-synthetic-acceptance-gate.v1";
  decision: "GO" | "NO_GO";
  marker: string;
  githubRunId: string;
  githubRunAttempt: string;
  deploymentId: string;
  sourceFingerprint: string;
  coreBindingMac: string;
  bypassBindingMac: string;
  checks: readonly Readonly<{ code: string; status: "PASS" | "FAIL" }>[];
  realStudentDataAllowed: false;
  productionDecision: "NO_GO";
}>;

function text(environment: AcceptanceEnvironment, name: string): string { return environment[name]?.trim() ?? ""; }

const coreBindingFields = [
  "STAGING_RUN_MARKER", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "CDAS_DEPLOYMENT_ID", "CDAS_SOURCE_FINGERPRINT",
  "DATABASE_URL", "DIRECT_URL", "STAGING_AUTH_MODE",
  "STAGING_TEST_PRIMARY_SCHOOL_CODE", "STAGING_TEST_SECONDARY_SCHOOL_CODE", "STAGING_TEST_TEACHER_STAFF_NO", "STAGING_TEST_STUDENT_NO", "STAGING_TEST_OTHER_STUDENT_NO", "STAGING_TEST_OTHER_TEACHER_STAFF_NO", "STAGING_DATABASE_NAME", "STAGING_BASE_URL", "STAGING_VERCEL_PROJECT_NAME", "STAGING_DEPLOYMENT_PROTECTION_REQUIRED", "AI_PROVIDER_DISABLED",
  "STAGING_ACCEPTANCE_WRITES_ATTESTED", "STAGING_ACCEPTANCE_LOCAL_AUTH_ATTESTED", "STAGING_ACCEPTANCE_RETENTION_ATTESTED",
  "STAGING_ACCEPTANCE_TEST_TEACHER_NAME", "STAGING_ACCEPTANCE_TEST_STUDENT_NAME", "STAGING_ACCEPTANCE_TEST_OTHER_STUDENT_NAME", "STAGING_ACCEPTANCE_TEST_OTHER_TEACHER_NAME",
] as const;

const fullBindingFields = [
  ...coreBindingFields,
  "STAGING_VERCEL_AUTOMATION_BYPASS_SECRET",
] as const;

function bindingMac(
  environment: AcceptanceEnvironment,
  fields: readonly string[],
  domain: string,
): string | undefined {
  const secret = text(environment, "STAGING_HEALTH_PROOF_SECRET");
  if (Buffer.byteLength(secret, "utf8") < 32 || Buffer.byteLength(secret, "utf8") > 4_096) return undefined;
  const canonical = fields.map((name) => `${name.length}:${name}=${Buffer.byteLength(text(environment, name), "utf8")}:${text(environment, name)}`).join("\n");
  return createHmac("sha256", secret).update(domain, "utf8").update(canonical, "utf8").digest("hex");
}

function coreBindingMac(environment: AcceptanceEnvironment): string | undefined {
  return bindingMac(environment, coreBindingFields, "cdas-staging-acceptance-core-binding-v1\0");
}

function bypassBindingMac(environment: AcceptanceEnvironment): string | undefined {
  return bindingMac(environment, fullBindingFields, "cdas-staging-acceptance-bypass-binding-v1\0");
}

function macMatches(actual: unknown, expected: string | undefined): boolean {
  if (typeof actual !== "string" || !/^[a-f0-9]{64}$/u.test(actual) || !expected) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

export async function createAcceptanceGate(environment: AcceptanceEnvironment, decision: unknown): Promise<AcceptanceGate> {
  const readiness = evaluateAcceptanceReadiness(environment);
  const marker = text(environment, "STAGING_RUN_MARKER");
  const sourceFingerprint = createSourceFingerprint();
  const coreMac = coreBindingMac(environment);
  const bypassMac = bypassBindingMac(environment);
  const checks = [
    { code: "SAME_RUN_STAGING_DECISION_GO", status: isStagingDecision(decision) && decision.decision === "GO" ? "PASS" as const : "FAIL" as const },
    { code: "ACCEPTANCE_READINESS", status: readiness.status === "PASS" ? "PASS" as const : "FAIL" as const },
    { code: "SOURCE_FINGERPRINT_MATCHES_ENVIRONMENT", status: sourceFingerprint === text(environment, "CDAS_SOURCE_FINGERPRINT") ? "PASS" as const : "FAIL" as const },
    { code: "CORE_CONFIGURATION_BINDING_PRESENT", status: coreMac ? "PASS" as const : "FAIL" as const },
    { code: "BYPASS_CONFIGURATION_BINDING_PRESENT", status: bypassMac ? "PASS" as const : "FAIL" as const },
  ];
  const accepted = checks.every((item) => item.status === "PASS");
  return {
    schema: "staging-synthetic-acceptance-gate.v1",
    decision: accepted ? "GO" : "NO_GO",
    marker,
    githubRunId: text(environment, "GITHUB_RUN_ID"),
    githubRunAttempt: text(environment, "GITHUB_RUN_ATTEMPT"),
    deploymentId: text(environment, "CDAS_DEPLOYMENT_ID"),
    sourceFingerprint,
    coreBindingMac: coreMac ?? "",
    bypassBindingMac: bypassMac ?? "",
    checks,
    realStudentDataAllowed: false,
    productionDecision: "NO_GO",
  };
}

export function isCoreAcceptanceGate(value: unknown, environment: AcceptanceEnvironment): value is AcceptanceGate {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const gate = value as Record<string, unknown>;
  const expected = ["schema", "decision", "marker", "githubRunId", "githubRunAttempt", "deploymentId", "sourceFingerprint", "coreBindingMac", "bypassBindingMac", "checks", "realStudentDataAllowed", "productionDecision"];
  const expectedCheckCodes = ["SAME_RUN_STAGING_DECISION_GO", "ACCEPTANCE_READINESS", "SOURCE_FINGERPRINT_MATCHES_ENVIRONMENT", "CORE_CONFIGURATION_BINDING_PRESENT", "BYPASS_CONFIGURATION_BINDING_PRESENT"];
  if (!(Object.keys(gate).length === expected.length && expected.every((key) => key in gate) &&
    gate.schema === "staging-synthetic-acceptance-gate.v1" && gate.decision === "GO" &&
    isSafeStagingRunMarker(text(environment, "STAGING_RUN_MARKER")) && gate.marker === text(environment, "STAGING_RUN_MARKER") && gate.githubRunId === text(environment, "GITHUB_RUN_ID") &&
    gate.githubRunAttempt === text(environment, "GITHUB_RUN_ATTEMPT") && gate.deploymentId === text(environment, "CDAS_DEPLOYMENT_ID") &&
    gate.sourceFingerprint === text(environment, "CDAS_SOURCE_FINGERPRINT") && macMatches(gate.coreBindingMac, coreBindingMac(environment)) &&
    typeof gate.bypassBindingMac === "string" && /^[a-f0-9]{64}$/u.test(gate.bypassBindingMac) &&
    gate.realStudentDataAllowed === false && gate.productionDecision === "NO_GO" && Array.isArray(gate.checks))) {
    return false;
  }
  const checks: unknown[] = gate.checks;
  return checks.length === expectedCheckCodes.length && new Set(checks.map((item) => item && typeof item === "object" ? (item as Record<string, unknown>).code : "")).size === expectedCheckCodes.length && expectedCheckCodes.every((code) => checks.some((item) => item && typeof item === "object" && (item as Record<string, unknown>).code === code)) && checks.every((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const check = item as Record<string, unknown>;
      return Object.keys(check).length === 2 && typeof check.code === "string" && check.status === "PASS";
    });
}

export function isAcceptanceGate(value: unknown, environment: AcceptanceEnvironment): value is AcceptanceGate {
  return isCoreAcceptanceGate(value, environment) && macMatches(
    (value as AcceptanceGate).bypassBindingMac,
    bypassBindingMac(environment),
  );
}

export async function main(): Promise<void> {
  const marker = text(process.env, "STAGING_RUN_MARKER");
  let decision: unknown;
  try {
    decision = JSON.parse(await readFile(path.join(safeStagingRunDirectory(marker), "decision.json"), "utf8")) as unknown;
  } catch {
    decision = undefined;
  }
  const gate = await createAcceptanceGate(process.env, decision);
  await writeAcceptanceArtifact(marker, "readiness.json", evaluateAcceptanceReadiness(process.env));
  await writeAcceptanceArtifact(marker, "gate.json", gate);
  process.stdout.write(`${JSON.stringify({ schema: gate.schema, decision: gate.decision })}\n`);
  if (gate.decision !== "GO") process.exitCode = 1;
}

async function runCli(): Promise<void> {
  await main().catch(async () => {
  const marker = text(process.env, "STAGING_RUN_MARKER");
  try { await writeAcceptanceArtifact(marker, "gate.json", { schema: "staging-synthetic-acceptance-gate.v1", decision: "NO_GO", realStudentDataAllowed: false, productionDecision: "NO_GO", checks: [{ code: "STAGING_ACCEPTANCE_GATE_INTERNAL_ERROR", status: "FAIL" }] }); } catch { /* no unsafe fallback path */ }
  process.stdout.write('{"schema":"staging-synthetic-acceptance-gate.v1","decision":"NO_GO"}\n');
  process.exitCode = 1;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCli();
}
