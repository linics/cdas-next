import { createHash } from "node:crypto";

import { isSafeStagingRunMarker, stagingAiAcknowledgement } from "../contracts";
import {
  isAllowedVercelPreviewBaseUrl,
  isValidVercelAutomationBypassSecret,
  isValidVercelProjectName,
} from "../preview-protection";

export type AgentAcceptanceEnvironment = Readonly<
  Record<string, string | undefined>
>;
export type AgentCheck = Readonly<{ code: string; status: "PASS" | "FAIL" }>;

export const agentAcceptanceTeacherDisplayName =
  "CDAS Staging Synthetic Teacher";
export const agentAcceptanceStudentDisplayName =
  "CDAS Staging Synthetic Student";
export const agentAcceptanceOtherStudentDisplayName =
  "CDAS Staging Synthetic Other Student";
export const agentAcceptanceOtherTeacherDisplayName =
  "CDAS Staging Synthetic Other Teacher";
export const agentAcceptanceEditedSummary = "固定合成验收摘要（教师人工修订）";
export const agentAcceptanceEvidenceText =
  "Synthetic Agent acceptance text evidence.";
export const agentAcceptanceFeedbackText =
  "Synthetic Agent acceptance teacher feedback.";

export const agentAcceptanceAttestations = [
  "STAGING_SYNTHETIC_ONLY_ATTESTED",
  "STAGING_LOCAL_AUTH_ATTESTED",
  "STAGING_DATABASE_ISOLATION_ATTESTED",
  "STAGING_HOSTING_ACCESS_ATTESTED",
  "STAGING_ROLLBACK_OWNER_ATTESTED",
  "STAGING_RETENTION_ATTESTED",
  "STAGING_AGENT_WRITES_ATTESTED",
  "STAGING_AGENT_LOCAL_SESSIONS_ATTESTED",
  "STAGING_AGENT_MODEL_COST_ATTESTED",
  "STAGING_AGENT_RETENTION_ATTESTED",
  "STAGING_AGENT_RUN_MODEL_ATTESTED",
  "STAGING_AGENT_IDENTITIES_RESERVED_ATTESTED",
] as const;

const text = (environment: AgentAcceptanceEnvironment, key: string): string =>
  environment[key]?.trim() ?? "";

const check = (code: string, condition: boolean): AgentCheck => ({
  code,
  status: condition ? "PASS" : "FAIL",
});

export function agentAcceptanceNamespace(marker: string) {
  if (
    !isSafeStagingRunMarker(marker) ||
    !marker.startsWith("cdas-staging-agent-")
  ) {
    throw new Error("STAGING_AGENT_ACCEPTANCE_MARKER_INVALID");
  }
  const bytes = createHash("sha256")
    .update(`cdas-staging-agent-acceptance-v1\0${marker}\0classroom`, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return {
    marker,
    classroomId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
      12,
      16,
    )}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    classroomName: `CDAS staging Agent ${marker}`,
    activityTitle: `CDAS staging Agent acceptance ${marker}`,
  } as const;
}

function validSchoolCode(value: string): boolean {
  return /^SCH[A-HJ-NP-Z2-9]{5}$/u.test(value);
}

function validStaffNo(value: string): boolean {
  return /^[A-Z0-9][A-Z0-9-]{0,31}$/u.test(value);
}

function validStudentNo(value: string): boolean {
  return /^\d{6,32}$/u.test(value);
}

export function evaluateAgentAcceptanceReadiness(
  environment: AgentAcceptanceEnvironment,
) {
  const projectName = text(environment, "STAGING_VERCEL_PROJECT_NAME");
  const schools = [
    text(environment, "STAGING_TEST_PRIMARY_SCHOOL_CODE"),
    text(environment, "STAGING_TEST_SECONDARY_SCHOOL_CODE"),
    text(environment, "STAGING_TEST_DISABLED_SCHOOL_CODE"),
  ];
  const staffNumbers = [
    text(environment, "STAGING_TEST_TEACHER_STAFF_NO"),
    text(environment, "STAGING_TEST_OTHER_TEACHER_STAFF_NO"),
    text(environment, "STAGING_TEST_DISABLED_SCHOOL_TEACHER_STAFF_NO"),
  ];
  const studentNumbers = [
    text(environment, "STAGING_TEST_STUDENT_NO"),
    text(environment, "STAGING_TEST_OTHER_STUDENT_NO"),
    text(environment, "STAGING_TEST_DISABLED_ACCOUNT_STUDENT_NO"),
  ];
  const passwords = [
    "STAGING_TEST_TEACHER_PASSWORD",
    "STAGING_TEST_STUDENT_PASSWORD",
    "STAGING_TEST_OTHER_STUDENT_PASSWORD",
    "STAGING_TEST_OTHER_TEACHER_PASSWORD",
    "STAGING_TEST_DISABLED_ACCOUNT_PASSWORD",
    "STAGING_TEST_DISABLED_SCHOOL_TEACHER_PASSWORD",
  ];
  const checks = [
    check("AGENT_MARKER", (() => {
      try {
        return agentAcceptanceNamespace(text(environment, "STAGING_RUN_MARKER"))
          .marker.length > 0;
      } catch {
        return false;
      }
    })()),
    check(
      "AGENT_VERCEL_PREVIEW",
      isValidVercelProjectName(projectName) &&
        isAllowedVercelPreviewBaseUrl(
          text(environment, "STAGING_BASE_URL"),
          projectName,
        ),
    ),
    check(
      "AGENT_DEPLOYMENT_PROTECTION",
      text(environment, "STAGING_DEPLOYMENT_PROTECTION_REQUIRED") === "1",
    ),
    check(
      "AGENT_VERCEL_BYPASS",
      isValidVercelAutomationBypassSecret(
        text(environment, "STAGING_VERCEL_AUTOMATION_BYPASS_SECRET"),
      ),
    ),
    check("AGENT_AI_ENABLED", text(environment, "AI_PROVIDER_DISABLED") === "0"),
    check(
      "AGENT_AI_ACK",
      text(environment, "STAGING_AI_ACK") === stagingAiAcknowledgement,
    ),
    check(
      "AGENT_DEEPSEEK_KEY",
      Buffer.byteLength(text(environment, "DEEPSEEK_API_KEY"), "utf8") >= 16,
    ),
    check(
      "AGENT_MODEL",
      /^deepseek-[a-z0-9][a-z0-9._:-]*$/u.test(text(environment, "AI_MODEL")),
    ),
    check(
      "AGENT_APPROVAL_SECRET",
      Buffer.byteLength(text(environment, "AI_TOOL_APPROVAL_SECRET"), "utf8") >=
        32,
    ),
    check(
      "AGENT_AUTH_MODE",
      text(environment, "STAGING_AUTH_MODE") === "postgres-local-v1",
    ),
    check(
      "AGENT_SCHOOLS",
      schools.every(validSchoolCode) && new Set(schools).size === schools.length,
    ),
    check("AGENT_STAFF_NUMBERS", staffNumbers.every(validStaffNo)),
    check("AGENT_STUDENT_NUMBERS", studentNumbers.every(validStudentNo)),
    check(
      "AGENT_IDENTITIES_DISTINCT",
      new Set([...staffNumbers, ...studentNumbers]).size ===
        staffNumbers.length + studentNumbers.length,
    ),
    check(
      "AGENT_NEGATIVE_FIXTURES_DISTINCT",
      !schools.slice(0, 2).includes(schools[2] ?? "") &&
        !studentNumbers.slice(0, 2).includes(studentNumbers[2] ?? ""),
    ),
    ...passwords.map((name) =>
      check(`AGENT_${name}_PRESENT`, text(environment, name).length >= 10),
    ),
    check(
      "AGENT_FIXED_DISPLAY_NAMES",
      text(environment, "STAGING_ACCEPTANCE_TEST_TEACHER_NAME") ===
        agentAcceptanceTeacherDisplayName &&
        text(environment, "STAGING_ACCEPTANCE_TEST_STUDENT_NAME") ===
        agentAcceptanceStudentDisplayName &&
        text(environment, "STAGING_ACCEPTANCE_TEST_OTHER_STUDENT_NAME") ===
        agentAcceptanceOtherStudentDisplayName &&
        text(environment, "STAGING_ACCEPTANCE_TEST_OTHER_TEACHER_NAME") ===
        agentAcceptanceOtherTeacherDisplayName,
    ),
    check(
      "AGENT_RUN_METADATA",
      /^[1-9][0-9]*$/u.test(text(environment, "GITHUB_RUN_ID")) &&
        /^[1-9][0-9]*$/u.test(text(environment, "GITHUB_RUN_ATTEMPT")) &&
        /^[a-f0-9]{40}$/u.test(text(environment, "CDAS_DEPLOYMENT_ID")) &&
        /^[a-f0-9]{64}$/u.test(text(environment, "CDAS_SOURCE_FINGERPRINT")),
    ),
    ...agentAcceptanceAttestations.map((name) =>
      check(name, text(environment, name) === "true"),
    ),
  ];
  return {
    schema: "staging-agent-acceptance-readiness.v1" as const,
    status: checks.every((item) => item.status === "PASS")
      ? ("PASS" as const)
      : ("FAIL" as const),
    checks,
    realStudentDataAllowed: false as const,
    productionDecision: "NO_GO" as const,
  };
}

export function stableAgentAcceptanceError(error: unknown): string {
  const message = error instanceof Error ? error.message : "STAGING_AGENT_ACCEPTANCE_INTERNAL";
  return /^[A-Z0-9_]{3,120}$/u.test(message)
    ? message
    : "STAGING_AGENT_ACCEPTANCE_INTERNAL";
}

export function redactAgentAcceptanceText(input: string): string {
  return input
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/giu, "[REDACTED_DATABASE_URL]")
    .replace(/\b(?:pk|sk)_(?:test|live)_[A-Za-z0-9_-]+\b/gu, "[REDACTED_PROVIDER_KEY]")
    .replace(/\b(?:Bearer|Cookie)\s+[^\s"']+/giu, "$1 [REDACTED]")
    .replace(/\b(?:token|password)=[A-Za-z0-9._-]+/giu, "$1=[REDACTED]")
    .replace(
      /\b(?:DEEPSEEK_API_KEY|AI_TOOL_APPROVAL_SECRET|STAGING_VERCEL_AUTOMATION_BYPASS_SECRET)=[^\s"']+/gu,
      "$1=[REDACTED]",
    );
}
