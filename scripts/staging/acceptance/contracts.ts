import { createHash } from "node:crypto";

import { isSafeStagingRunMarker, type CheckStatus, type StagingCheck } from "../contracts";
import { isPublicHostname } from "../../../src/server/staging/deployment-proof";

export type AcceptanceEnvironment = Readonly<Record<string, string | undefined>>;

export type AcceptanceCheck = Readonly<{ code: string; status: CheckStatus; present?: boolean }>;

export type AcceptanceReadiness = Readonly<{
  schema: "staging-synthetic-acceptance-readiness.v1";
  status: "PASS" | "FAIL";
  checks: readonly AcceptanceCheck[];
  realStudentDataAllowed: false;
  productionDecision: "NO_GO";
}>;

export const acceptanceAttestations = [
  "STAGING_ACCEPTANCE_WRITES_ATTESTED",
  "STAGING_ACCEPTANCE_CLERK_TOKENS_ATTESTED",
  "STAGING_ACCEPTANCE_RETENTION_ATTESTED",
] as const;

export const acceptanceTeacherDisplayName =
  "CDAS Staging Synthetic Teacher";
export const acceptanceStudentDisplayName =
  "CDAS Staging Synthetic Student";

export type AcceptanceNamespace = Readonly<{
  marker: string;
  classroomId: string;
  classroomName: string;
  activityTitle: string;
  activitySummary: string;
  evidenceText: string;
  feedbackText: string;
}>;

function value(environment: AcceptanceEnvironment, name: string): string {
  return environment[name]?.trim() ?? "";
}

function check(code: string, condition: boolean, present?: boolean): AcceptanceCheck {
  return present === undefined
    ? { code, status: condition ? "PASS" : "FAIL" }
    : { code, status: condition ? "PASS" : "FAIL", present };
}

function isRemoteHttpsRoot(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      Boolean(url.hostname) &&
      isPublicHostname(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.pathname === "" || url.pathname === "/")
    );
  } catch {
    return false;
  }
}

function isPositiveInteger(raw: string): boolean {
  return /^[1-9][0-9]*$/u.test(raw);
}

/**
 * Deterministically derives an RFC 4122 variant UUID using SHA-256.  The
 * version nibble is deliberately 5 so the value is visibly name-derived,
 * while SHA-256 avoids adding a UUID dependency to an operator-only script.
 */
export function deriveAcceptanceUuid(marker: string, purpose: string): string {
  if (!isSafeStagingRunMarker(marker) || !/^[a-z0-9-]{1,80}$/u.test(purpose)) {
    throw new Error("STAGING_ACCEPTANCE_NAMESPACE_INVALID");
  }
  const bytes = createHash("sha256")
    .update("cdas-staging-synthetic-acceptance-v1\0", "utf8")
    .update(marker, "utf8")
    .update("\0", "utf8")
    .update(purpose, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function acceptanceNamespace(marker: string): AcceptanceNamespace {
  if (!isSafeStagingRunMarker(marker)) {
    throw new Error("STAGING_ACCEPTANCE_MARKER_INVALID");
  }
  return {
    marker,
    classroomId: deriveAcceptanceUuid(marker, "classroom"),
    classroomName: `CDAS staging synthetic ${marker}`,
    activityTitle: `CDAS staging acceptance ${marker}`,
    activitySummary: `Synthetic-only acceptance evidence for ${marker}.`,
    evidenceText: `Synthetic text evidence for ${marker}.`,
    feedbackText: `Synthetic teacher feedback for ${marker}.`,
  };
}

export function evaluateAcceptanceReadiness(environment: AcceptanceEnvironment): AcceptanceReadiness {
  const marker = value(environment, "STAGING_RUN_MARKER");
  const baseUrl = value(environment, "STAGING_BASE_URL");
  const checks: AcceptanceCheck[] = [
    check("STAGING_ACCEPTANCE_MARKER", isSafeStagingRunMarker(marker), Boolean(marker)),
    check("STAGING_ACCEPTANCE_BASE_URL", isRemoteHttpsRoot(baseUrl), Boolean(baseUrl)),
    check("STAGING_ACCEPTANCE_AI_DISABLED", value(environment, "AI_PROVIDER_DISABLED") === "1"),
    check("STAGING_ACCEPTANCE_TEST_CLERK_INSTANCE", /^pk_test_[A-Za-z0-9_-]{10,}$/u.test(value(environment, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")), Boolean(value(environment, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"))),
    check("STAGING_ACCEPTANCE_TEST_CLERK_SECRET", /^sk_test_[A-Za-z0-9_-]{10,}$/u.test(value(environment, "CLERK_SECRET_KEY")), Boolean(value(environment, "CLERK_SECRET_KEY"))),
    check("STAGING_ACCEPTANCE_TEACHER_SUBJECT", /^user_[A-Za-z0-9]+$/u.test(value(environment, "STAGING_TEST_TEACHER_CLERK_ID")), Boolean(value(environment, "STAGING_TEST_TEACHER_CLERK_ID"))),
    check("STAGING_ACCEPTANCE_STUDENT_SUBJECT", /^user_[A-Za-z0-9]+$/u.test(value(environment, "STAGING_TEST_STUDENT_CLERK_ID")), Boolean(value(environment, "STAGING_TEST_STUDENT_CLERK_ID"))),
    check("STAGING_ACCEPTANCE_SUBJECTS_DISTINCT", value(environment, "STAGING_TEST_TEACHER_CLERK_ID") !== "" && value(environment, "STAGING_TEST_TEACHER_CLERK_ID") !== value(environment, "STAGING_TEST_STUDENT_CLERK_ID")),
    check("STAGING_ACCEPTANCE_TEACHER_NAME", value(environment, "STAGING_ACCEPTANCE_TEST_TEACHER_NAME") === acceptanceTeacherDisplayName, Boolean(value(environment, "STAGING_ACCEPTANCE_TEST_TEACHER_NAME"))),
    check("STAGING_ACCEPTANCE_STUDENT_NAME", value(environment, "STAGING_ACCEPTANCE_TEST_STUDENT_NAME") === acceptanceStudentDisplayName, Boolean(value(environment, "STAGING_ACCEPTANCE_TEST_STUDENT_NAME"))),
    check("STAGING_ACCEPTANCE_GITHUB_RUN", isPositiveInteger(value(environment, "GITHUB_RUN_ID")), Boolean(value(environment, "GITHUB_RUN_ID"))),
    check("STAGING_ACCEPTANCE_GITHUB_ATTEMPT", isPositiveInteger(value(environment, "GITHUB_RUN_ATTEMPT")), Boolean(value(environment, "GITHUB_RUN_ATTEMPT"))),
    check("STAGING_ACCEPTANCE_DEPLOYMENT_SHA", /^[a-f0-9]{40}$/u.test(value(environment, "CDAS_DEPLOYMENT_ID")), Boolean(value(environment, "CDAS_DEPLOYMENT_ID"))),
    check("STAGING_ACCEPTANCE_SOURCE_FINGERPRINT", /^[a-f0-9]{64}$/u.test(value(environment, "CDAS_SOURCE_FINGERPRINT")), Boolean(value(environment, "CDAS_SOURCE_FINGERPRINT"))),
    ...acceptanceAttestations.map((name) => check(name, value(environment, name) === "true", Boolean(value(environment, name)))),
  ];
  const status = checks.every((item) => item.status === "PASS") ? "PASS" : "FAIL";
  return { schema: "staging-synthetic-acceptance-readiness.v1", status, checks, realStudentDataAllowed: false, productionDecision: "NO_GO" };
}

export function stableAcceptanceErrorCode(error: unknown): string {
  const code = error instanceof Error ? error.message : "STAGING_ACCEPTANCE_INTERNAL_ERROR";
  return /^[A-Z0-9_]{3,120}$/u.test(code) ? code : "STAGING_ACCEPTANCE_INTERNAL_ERROR";
}

export function redactAcceptanceText(value: string): string {
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/giu, "[REDACTED_DATABASE_URL]")
    .replace(/\b(?:pk|sk)_(?:test|live)_[A-Za-z0-9_-]+\b/gu, "[REDACTED_CLERK_KEY]")
    .replace(/\b(?:Bearer|Cookie)\s+[^\s"']+/giu, "$1 [REDACTED]")
    .replace(/\b(?:ticket|token)=?[A-Za-z0-9._-]+/giu, "$1=[REDACTED]")
    .replace(/\b(?:AI_GATEWAY_API_KEY|AI_TOOL_APPROVAL_SECRET)=[^\s"']+/gu, "$1=[REDACTED]");
}

export function asStagingChecks(checks: readonly AcceptanceCheck[]): readonly StagingCheck[] {
  return checks.map((item) => ({ ...item }));
}
