import type { CheckStatus, StagingCheck } from "./contracts";

type Evidence = unknown;

export type StagingDecisionInput = Readonly<{
  preflight?: Evidence;
  database?: Evidence;
  application?: Evidence;
  buildOutcome?: string;
  schemaDiffOutcome?: string;
  manualAttestations: Readonly<Record<string, string | undefined>>;
}>;

export const expectedEvidenceChecks = {
  "staging-preflight.v1": [
    "STAGING_RUN_MARKER", "STAGING_SYNTHETIC_DATA_ACK", "NODE_ENV_PRODUCTION",
    "POSTGRES_LOCAL_AUTH_MODE", "STAGING_BASE_URL_HTTPS_REMOTE",
    "STAGING_VERCEL_PROJECT_NAME", "STAGING_DEPLOYMENT_PROTECTION_REQUIRED",
    "DATABASE_URL_REMOTE_POOLED", "DIRECT_URL_REMOTE_DIRECT",
    "DATABASE_URL_TLS_REQUIRED", "DIRECT_URL_TLS_REQUIRED",
    "STAGING_DATABASE_NAME_ACKNOWLEDGED", "DATABASE_RUNTIME_DIRECT_TARGETS_DISTINCT",
    "DATABASE_RUNTIME_DIRECT_CLUSTER_MATCH", "DATABASE_URL_ISOLATED_FROM_TEST_AND_E2E",
    "STAGING_TEST_PRIMARY_SCHOOL_CODE", "STAGING_TEST_SECONDARY_SCHOOL_CODE",
    "STAGING_TEST_TEACHER_STAFF_NO", "STAGING_TEST_STUDENT_NO",
    "STAGING_TEST_OTHER_STUDENT_NO", "STAGING_TEST_OTHER_TEACHER_STAFF_NO",
    "STAGING_TEST_LOCAL_IDENTITIES_DISTINCT", "CDAS_DEPLOYMENT_ID",
    "STAGING_HEALTH_PROOF_SECRET", "AI_PROVIDER_DISABLED_OR_EXPLICITLY_ENABLED",
    "AI_PROVIDER_SYNTHETIC_ACK", "DEEPSEEK_CONFIG_WHEN_ENABLED",
  ],
  "staging-database.v1": [
    ...["DATABASE_EXPECTED_NAME", "POSTGRESQL_17_OR_NEWER", "PRISMA_MIGRATIONS_TABLE_PRESENT", "PRISMA_MIGRATIONS_NO_FAILED_ROWS", "PRISMA_MIGRATIONS_NO_UNKNOWN", "PRISMA_MIGRATIONS_NO_PENDING", "HISTORY_PROTECTION_OBJECTS_PRESENT", "HISTORY_PROTECTION_DEFINITIONS_MATCH"].flatMap((code) => [
      `DATABASE_CONNECTION_1_${code}`,
      `DATABASE_CONNECTION_2_${code}`,
    ]),
    "DATABASE_CLUSTER_SYSTEM_IDENTIFIERS_MATCH",
  ],
  "staging-application.v1": [
    "APPLICATION_DEPLOYMENT_ACCESS_MODE_VERIFIED", "APPLICATION_HEALTH_HTTP_200", "APPLICATION_HEALTH_NO_STORE", "APPLICATION_HEALTH_EXACT_BODY", "APPLICATION_DEPLOYMENT_ID_MATCHES", "APPLICATION_CONFIGURATION_PROOF_MATCHES", "APPLICATION_SOURCE_FINGERPRINT_MATCHES",
  ],
} as const;
export const preflightEvidencePresentCodes = new Set([
  "STAGING_BASE_URL_HTTPS_REMOTE", "STAGING_VERCEL_PROJECT_NAME",
  "DATABASE_URL_REMOTE_POOLED", "DIRECT_URL_REMOTE_DIRECT",
  "DATABASE_URL_TLS_REQUIRED", "DIRECT_URL_TLS_REQUIRED",
  "STAGING_TEST_PRIMARY_SCHOOL_CODE", "STAGING_TEST_SECONDARY_SCHOOL_CODE",
  "STAGING_TEST_TEACHER_STAFF_NO", "STAGING_TEST_STUDENT_NO",
  "STAGING_TEST_OTHER_STUDENT_NO", "STAGING_TEST_OTHER_TEACHER_STAFF_NO",
  "CDAS_DEPLOYMENT_ID", "STAGING_HEALTH_PROOF_SECRET",
  "DEEPSEEK_CONFIG_WHEN_ENABLED",
]);

export type StagingDecision = Readonly<{
  schema: "staging-go-no-go.v1";
  decision: "GO" | "NO_GO";
  stagingSyntheticDecision: "GO" | "NO_GO";
  realStudentDataAllowed: false;
  productionDecision: "NO_GO";
  checks: readonly StagingCheck[];
}>;

const manualAttestations = [
  "STAGING_SYNTHETIC_ONLY_ATTESTED",
  "STAGING_LOCAL_AUTH_ATTESTED",
  "STAGING_DATABASE_ISOLATION_ATTESTED",
  "STAGING_HOSTING_ACCESS_ATTESTED",
  "STAGING_ROLLBACK_OWNER_ATTESTED",
  "STAGING_RETENTION_ATTESTED",
] as const;

function evidenceCheck(
  code: string,
  evidence: Evidence | undefined,
  expectedSchema: keyof typeof expectedEvidenceChecks,
): StagingCheck {
  if (!evidence) {
    return { code, status: "NOT_RUN" };
  }
  return {
    code,
    status: isExactPassingEvidence(evidence, expectedSchema) ? "PASS" : "FAIL",
  };
}

function isExactPassingEvidence(value: Evidence, expectedSchema: keyof typeof expectedEvidenceChecks): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  const expectedKeys = ["checks", "productionDecision", "realStudentDataAllowed", "schema", "stagingSyntheticDecision", "status"];
  if (keys.length !== expectedKeys.length || !expectedKeys.every((key) => keys.includes(key))) return false;
  if (candidate.schema !== expectedSchema || candidate.status !== "PASS" || candidate.stagingSyntheticDecision !== "GO" || candidate.realStudentDataAllowed !== false || candidate.productionDecision !== "NO_GO" || !Array.isArray(candidate.checks)) return false;
  const expectedCodes = expectedEvidenceChecks[expectedSchema];
  const checks = candidate.checks;
  if (checks.length !== expectedCodes.length) return false;
  const seen = new Set<string>();
  return checks.every((check) => {
    if (!check || typeof check !== "object" || Array.isArray(check)) return false;
    const item = check as Record<string, unknown>;
    const requiresPresent = expectedSchema === "staging-preflight.v1" && preflightEvidencePresentCodes.has(item.code as string);
    const keys = Object.keys(item).sort();
    const expectedKeys = requiresPresent ? ["code", "present", "status"] : ["code", "status"];
    if (keys.length !== expectedKeys.length || !expectedKeys.every((key) => keys.includes(key))) return false;
    if (typeof item.code !== "string" || item.status !== "PASS" || seen.has(item.code) || !expectedCodes.includes(item.code as never)) return false;
    if (requiresPresent && typeof item.present !== "boolean") return false;
    seen.add(item.code);
    return true;
  }) && expectedCodes.every((code) => seen.has(code));
}

function workflowCheck(code: string, outcome: string | undefined): StagingCheck {
  if (!outcome) {
    return { code, status: "NOT_RUN" };
  }
  return { code, status: outcome === "success" ? "PASS" : "FAIL" };
}

function manualCheck(name: string, value: string | undefined): StagingCheck {
  return {
    code: name,
    status: value === "true" ? "PASS" : "FAIL",
    present: Boolean(value),
  };
}

export function evaluateStagingDecision(input: StagingDecisionInput): StagingDecision {
  const checks: StagingCheck[] = [
    evidenceCheck("PREFLIGHT_EVIDENCE", input.preflight, "staging-preflight.v1"),
    workflowCheck("APPLICATION_BUILD", input.buildOutcome),
    evidenceCheck("DATABASE_READ_ONLY_EVIDENCE", input.database, "staging-database.v1"),
    workflowCheck("SCHEMA_DIFF", input.schemaDiffOutcome),
    evidenceCheck("APPLICATION_HEALTH_EVIDENCE", input.application, "staging-application.v1"),
    ...manualAttestations.map((name) =>
      manualCheck(name, input.manualAttestations[name]),
    ),
  ];
  const decision = checks.every((check) => check.status === "PASS") ? "GO" : "NO_GO";
  return {
    schema: "staging-go-no-go.v1",
    decision,
    stagingSyntheticDecision: decision,
    realStudentDataAllowed: false,
    productionDecision: "NO_GO",
    checks,
  };
}

export function decisionExitCode(decision: StagingDecision): number {
  return decision.decision === "GO" ? 0 : 1;
}

export function isStagingDecision(value: unknown): value is StagingDecision {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const expectedCodes = ["PREFLIGHT_EVIDENCE", "APPLICATION_BUILD", "DATABASE_READ_ONLY_EVIDENCE", "SCHEMA_DIFF", "APPLICATION_HEALTH_EVIDENCE", ...manualAttestations];
  if (Object.keys(candidate).length !== 6 || !["schema", "decision", "stagingSyntheticDecision", "realStudentDataAllowed", "productionDecision", "checks"].every((key) => key in candidate)) return false;
  if (candidate.schema !== "staging-go-no-go.v1" || (candidate.decision !== "GO" && candidate.decision !== "NO_GO") || candidate.stagingSyntheticDecision !== candidate.decision || candidate.realStudentDataAllowed !== false || candidate.productionDecision !== "NO_GO" || !Array.isArray(candidate.checks) || candidate.checks.length !== expectedCodes.length) return false;
  const seen = new Set<string>();
  const checksValid = candidate.checks.every((check) => {
    if (!check || typeof check !== "object" || Array.isArray(check)) return false;
    const item = check as Record<string, unknown>;
    if (typeof item.code !== "string" || (item.status !== "PASS" && item.status !== "FAIL" && item.status !== "NOT_RUN") || seen.has(item.code) || !expectedCodes.includes(item.code as never)) return false;
    const manual = manualAttestations.includes(item.code as never);
    const keys = Object.keys(item).sort();
    const expectedKeys = manual ? ["code", "present", "status"] : ["code", "status"];
    if (keys.length !== expectedKeys.length || !expectedKeys.every((key) => keys.includes(key))) return false;
    if (manual && (typeof item.present !== "boolean" || item.status === "NOT_RUN" || (item.status === "PASS" && item.present !== true))) return false;
    seen.add(item.code);
    return true;
  }) && expectedCodes.every((code) => seen.has(code));
  return checksValid && (candidate.decision !== "GO" || candidate.checks.every((check) => (check as Record<string, unknown>).status === "PASS"));
}

export const requiredManualAttestations = manualAttestations;

export function isPassingStatus(status: CheckStatus): boolean {
  return status === "PASS";
}
