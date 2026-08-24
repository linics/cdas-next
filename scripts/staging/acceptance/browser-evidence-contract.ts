import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const checks = [
  "VERCEL_PROTECTION_BYPASS_SCOPED",
  "AI_DISABLED_MANUAL_PATH",
  "TEACHER_GROUP_CONFIGURED",
  "GROUPMATE_SHARED_PHASE_WRITE",
  "STUDENT_PRIVATE_ATTACHMENT_UPLOAD_AND_DOWNLOAD",
  "SEQUENTIAL_PHASE_EXECUTION",
  "TEACHER_FORMAL_ATTACHMENT_DOWNLOAD",
  "WRONG_ROLE_STUDENT_ROOT_GUIDANCE",
  "WRONG_ROLE_TEACHER_ROOT_GUIDANCE",
  "STUDENT_TEACHER_RESOURCE_HIDDEN",
  "TEACHER_STUDENT_RESOURCE_HIDDEN",
  "STUDENT_FEEDBACK_VISIBLE",
  "STRUCTURED_FORMATIVE_FEEDBACK_VISIBLE",
  "STALE_STUDENT_WRITE_REJECTED_AFTER_CLOSE",
  "CLOSED_STUDENT_READONLY",
  "GROUPMATE_SHARED_SUBMISSION_VISIBLE",
  "GROUPMATE_SHARED_FEEDBACK_VISIBLE",
  "GROUPMATE_SHARED_ATTACHMENT_DOWNLOAD",
  "GROUPMATE_TEACHER_SUBMISSION_404",
  "OTHER_TEACHER_RELEASE_404",
  "OTHER_TEACHER_SUBMISSION_404",
  "CLOSED_STUDENT_ATTACHMENT_READABLE",
  "TEACHER_MEMBER_END_AND_REJOIN",
] as const;

const screenshots = [
  "01-draft-ready.png",
  "02-published.png",
  "03-student-submitted.png",
  "04-teacher-feedback.png",
  "05-teacher-closed.png",
  "06-student-closed-readonly.png",
] as const;

function exact(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as object).length === keys.length &&
    keys.every((key) => key in (value as object))
  );
}

export async function isPassingBrowserEvidence(
  value: unknown,
  marker: string,
  directory: string,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<boolean> {
  const keys = [
    "schema",
    "status",
    "runMarker",
    "githubRunId",
    "githubRunAttempt",
    "deploymentId",
    "sourceFingerprint",
    "fixtureNamespace",
    "generatedAt",
    "checks",
    "artifactSha256",
    "realStudentDataAllowed",
    "productionDecision",
  ];
  if (
    !exact(value, keys) ||
    value.schema !== "staging-synthetic-acceptance-evidence.v1" ||
    value.status !== "PASS" ||
    value.runMarker !== marker ||
    value.githubRunId !== environment.GITHUB_RUN_ID ||
    value.githubRunAttempt !== environment.GITHUB_RUN_ATTEMPT ||
    value.deploymentId !== environment.CDAS_DEPLOYMENT_ID ||
    value.sourceFingerprint !== environment.CDAS_SOURCE_FINGERPRINT ||
    value.realStudentDataAllowed !== false ||
    value.productionDecision !== "NO_GO" ||
    typeof value.generatedAt !== "string" ||
    Number.isNaN(Date.parse(value.generatedAt))
  ) {
    return false;
  }
  if (
    !exact(value.fixtureNamespace, ["classroomDerived", "marker"]) ||
    value.fixtureNamespace.classroomDerived !== true ||
    value.fixtureNamespace.marker !== marker ||
    !Array.isArray(value.checks) ||
    !exact(value.artifactSha256, screenshots)
  ) {
    return false;
  }

  const evidenceChecks: unknown[] = value.checks;
  if (
    evidenceChecks.length !== checks.length ||
    new Set(
      evidenceChecks.map((item) =>
        item && typeof item === "object"
          ? (item as Record<string, unknown>).code
          : "",
      ),
    ).size !== checks.length ||
    !evidenceChecks.every(
      (item) => exact(item, ["code", "status"]) && item.status === "PASS",
    ) ||
    !checks.every((code) =>
      evidenceChecks.some(
        (item) => (item as Record<string, unknown>).code === code,
      ),
    )
  ) {
    return false;
  }

  for (const name of screenshots) {
    const hash = value.artifactSha256[name];
    if (typeof hash !== "string" || !/^[a-f0-9]{64}$/u.test(hash)) {
      return false;
    }
    try {
      const actual = createHash("sha256")
        .update(await readFile(path.join(directory, name)))
        .digest("hex");
      if (actual !== hash) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}
