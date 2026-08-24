import { createHash } from "node:crypto";

import { isSafeStagingRunMarker, stagingAiAcknowledgement } from "../contracts";
import { isPublicHostname } from "../../../src/server/staging/deployment-proof";

export type AgentAcceptanceEnvironment = Readonly<Record<string, string | undefined>>;
export type AgentCheck = Readonly<{ code: string; status: "PASS" | "FAIL" }>;

export const agentAcceptanceTeacherDisplayName = "CDAS Staging Synthetic Teacher";
export const agentAcceptanceStudentDisplayName = "CDAS Staging Synthetic Student";
export const agentAcceptanceActivityContent = {
  summary: "固定合成验收摘要",
  learningObjectives: ["识别合成证据"],
  taskInstructions: "提交固定合成内容",
  evidenceRequirements: ["合成文本"],
  feedbackCriteria: ["固定标准"],
} as const;
export const agentAcceptanceEditedSummary = "固定合成验收摘要（教师人工修订）";
export const agentAcceptanceAttestations = [
  "STAGING_SYNTHETIC_ONLY_ATTESTED", "STAGING_CLERK_INSTANCE_ATTESTED",
  "STAGING_DATABASE_ISOLATION_ATTESTED", "STAGING_HOSTING_ACCESS_ATTESTED",
  "STAGING_ROLLBACK_OWNER_ATTESTED", "STAGING_RETENTION_ATTESTED",
  "STAGING_AGENT_WRITES_ATTESTED", "STAGING_AGENT_CLERK_TOKENS_ATTESTED",
  "STAGING_AGENT_MODEL_COST_ATTESTED", "STAGING_AGENT_RETENTION_ATTESTED",
  "STAGING_AGENT_RUN_MODEL_ATTESTED", "STAGING_AGENT_IDENTITIES_RESERVED_ATTESTED",
] as const;

const text = (e: AgentAcceptanceEnvironment, key: string) => e[key]?.trim() ?? "";
const check = (code: string, value: boolean): AgentCheck => ({ code, status: value ? "PASS" : "FAIL" });

export function agentAcceptanceNamespace(marker: string) {
  if (!isSafeStagingRunMarker(marker) || !marker.startsWith("cdas-staging-agent-")) throw new Error("STAGING_AGENT_ACCEPTANCE_MARKER_INVALID");
  const bytes = createHash("sha256").update(`cdas-staging-agent-acceptance-v1\0${marker}\0classroom`, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return {
    marker,
    classroomId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    classroomName: `CDAS staging Agent ${marker}`,
    activityTitle: `CDAS staging Agent acceptance ${marker}`,
  } as const;
}

export function isAgentAcceptancePublicHttps(raw: string): boolean {
  try { const url = new URL(raw); return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && (url.pathname === "" || url.pathname === "/") && isPublicHostname(url.hostname); } catch { return false; }
}

export function evaluateAgentAcceptanceReadiness(environment: AgentAcceptanceEnvironment) {
  const checks = [
    check("AGENT_MARKER", (() => { try { return agentAcceptanceNamespace(text(environment, "STAGING_RUN_MARKER")).marker.length > 0; } catch { return false; } })()),
    check("AGENT_PUBLIC_HTTPS", isAgentAcceptancePublicHttps(text(environment, "STAGING_BASE_URL"))),
    check("AGENT_AI_ENABLED", text(environment, "AI_PROVIDER_DISABLED") === "0"),
    check("AGENT_AI_ACK", text(environment, "STAGING_AI_ACK") === stagingAiAcknowledgement),
    check("AGENT_DEEPSEEK_KEY", Buffer.byteLength(text(environment, "DEEPSEEK_API_KEY"), "utf8") >= 16),
    check("AGENT_MODEL", /^deepseek-[a-z0-9][a-z0-9._:-]*$/u.test(text(environment, "AI_MODEL"))),
    check("AGENT_APPROVAL_SECRET", Buffer.byteLength(text(environment, "AI_TOOL_APPROVAL_SECRET"), "utf8") >= 32),
    check("AGENT_CLERK_TEST", /^pk_test_[A-Za-z0-9_-]{10,}$/u.test(text(environment, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")) && /^sk_test_[A-Za-z0-9_-]{10,}$/u.test(text(environment, "CLERK_SECRET_KEY"))),
    check("AGENT_IDENTITIES", /^user_[A-Za-z0-9]+$/u.test(text(environment, "STAGING_TEST_TEACHER_CLERK_ID")) && /^user_[A-Za-z0-9]+$/u.test(text(environment, "STAGING_TEST_STUDENT_CLERK_ID")) && text(environment, "STAGING_TEST_TEACHER_CLERK_ID") !== text(environment, "STAGING_TEST_STUDENT_CLERK_ID")),
    check("AGENT_FIXED_DISPLAY_NAMES", text(environment, "STAGING_ACCEPTANCE_TEST_TEACHER_NAME") === agentAcceptanceTeacherDisplayName && text(environment, "STAGING_ACCEPTANCE_TEST_STUDENT_NAME") === agentAcceptanceStudentDisplayName),
    check("AGENT_RUN_METADATA", /^[1-9][0-9]*$/u.test(text(environment, "GITHUB_RUN_ID")) && /^[1-9][0-9]*$/u.test(text(environment, "GITHUB_RUN_ATTEMPT")) && /^[a-f0-9]{40}$/u.test(text(environment, "CDAS_DEPLOYMENT_ID")) && /^[a-f0-9]{64}$/u.test(text(environment, "CDAS_SOURCE_FINGERPRINT"))),
    ...agentAcceptanceAttestations.map((name) => check(name, text(environment, name) === "true")),
  ];
  return { schema: "staging-agent-acceptance-readiness.v1" as const, status: checks.every((item) => item.status === "PASS") ? "PASS" as const : "FAIL" as const, checks, realStudentDataAllowed: false as const, productionDecision: "NO_GO" as const };
}

export function stableAgentAcceptanceError(error: unknown): string {
  const message = error instanceof Error ? error.message : "STAGING_AGENT_ACCEPTANCE_INTERNAL";
  return /^[A-Z0-9_]{3,120}$/u.test(message) ? message : "STAGING_AGENT_ACCEPTANCE_INTERNAL";
}

export function redactAgentAcceptanceText(input: string): string {
  return input.replace(/postgres(?:ql)?:\/\/[^\s"']+/giu, "[REDACTED_DATABASE_URL]").replace(/\b(?:pk|sk)_(?:test|live)_[A-Za-z0-9_-]+\b/gu, "[REDACTED_CLERK_KEY]").replace(/\b(?:Bearer|Cookie)\s+[^\s"']+/giu, "$1 [REDACTED]").replace(/\b(?:ticket|token)=[A-Za-z0-9._-]+/giu, "$1=[REDACTED]").replace(/\b(?:DEEPSEEK_API_KEY|AI_TOOL_APPROVAL_SECRET)=[^\s"']+/gu, "$1=[REDACTED]");
}
