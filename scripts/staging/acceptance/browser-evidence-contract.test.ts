import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isPassingBrowserEvidence } from "./browser-evidence-contract";

const marker = "cdas-staging-12345678-1";
const names = [
  "01-draft-ready.png",
  "02-published.png",
  "03-student-submitted.png",
  "04-teacher-feedback.png",
  "05-teacher-closed.png",
  "06-student-closed-readonly.png",
] as const;
const codes = [
  "AI_DISABLED_MANUAL_PATH",
  "TEACHER_SIGN_OUT_AND_RELOGIN",
  "STUDENT_SIGN_OUT_AND_RELOGIN",
  "WRONG_ROLE_STUDENT_ROOT_GUIDANCE",
  "WRONG_ROLE_TEACHER_ROOT_GUIDANCE",
  "STUDENT_TEACHER_RESOURCE_HIDDEN",
  "TEACHER_STUDENT_RESOURCE_HIDDEN",
  "STUDENT_FEEDBACK_VISIBLE",
  "STALE_STUDENT_WRITE_REJECTED_AFTER_CLOSE",
  "CLOSED_STUDENT_READONLY",
  "OTHER_STUDENT_RELEASE_VISIBLE",
  "OTHER_STUDENT_SUBMISSION_CONTENT_HIDDEN",
  "OTHER_STUDENT_SUBMISSION_404",
];
const environment = {
  GITHUB_RUN_ID: "1",
  GITHUB_RUN_ATTEMPT: "1",
  CDAS_DEPLOYMENT_ID: "a".repeat(40),
  CDAS_SOURCE_FINGERPRINT: "b".repeat(64),
};

let directory = "";

afterEach(async () => {
  if (directory) {
    await rm(directory, { recursive: true, force: true });
  }
  directory = "";
});

async function evidence() {
  directory = await mkdtemp(path.join(os.tmpdir(), "cdas-evidence-"));
  const hashes: Record<string, string> = {};
  for (const name of names) {
    await writeFile(path.join(directory, name), name);
    hashes[name] = createHash("sha256").update(name).digest("hex");
  }
  return {
    schema: "staging-synthetic-acceptance-evidence.v1",
    status: "PASS",
    runMarker: marker,
    githubRunId: "1",
    githubRunAttempt: "1",
    deploymentId: "a".repeat(40),
    sourceFingerprint: "b".repeat(64),
    fixtureNamespace: { classroomDerived: true, marker },
    generatedAt: "2026-01-01T00:00:00.000Z",
    checks: codes.map((code) => ({ code, status: "PASS" })),
    artifactSha256: hashes,
    realStudentDataAllowed: false,
    productionDecision: "NO_GO",
  };
}

describe("browser evidence contract", () => {
  it("accepts the exact passing evidence", async () => {
    const value = await evidence();
    await expect(
      isPassingBrowserEvidence(value, marker, directory, environment),
    ).resolves.toBe(true);
  });

  it("requires the exact top-level shape and unique check set", async () => {
    const value = await evidence();
    await expect(
      isPassingBrowserEvidence(
        { ...value, unexpected: true },
        marker,
        directory,
        environment,
      ),
    ).resolves.toBe(false);
    await expect(
      isPassingBrowserEvidence(
        {
          ...value,
          checks: [
            ...value.checks.filter(
              (check) => check.code !== "OTHER_STUDENT_RELEASE_VISIBLE",
            ),
            value.checks.find(
              (check) => check.code === "OTHER_STUDENT_SUBMISSION_404",
            )!,
          ],
        },
        marker,
        directory,
        environment,
      ),
    ).resolves.toBe(false);
    const otherCheck = value.checks.find(
      (check) => check.code === "OTHER_STUDENT_SUBMISSION_404",
    );
    await expect(
      isPassingBrowserEvidence(
        { ...value, checks: value.checks.filter((check) => check !== otherCheck) },
        marker,
        directory,
        environment,
      ),
    ).resolves.toBe(false);
    await expect(
      isPassingBrowserEvidence(
        {
          ...value,
          checks: value.checks.map((check) =>
            check === otherCheck ? { ...check, status: "FAIL" } : check,
          ),
        },
        marker,
        directory,
        environment,
      ),
    ).resolves.toBe(false);
    await expect(
      isPassingBrowserEvidence(
        { ...value, checks: value.checks.slice(1) },
        marker,
        directory,
        environment,
      ),
    ).resolves.toBe(false);
    await expect(
      isPassingBrowserEvidence(
        {
          ...value,
          checks: [...value.checks.slice(0, -1), value.checks[0]],
        },
        marker,
        directory,
        environment,
      ),
    ).resolves.toBe(false);
  });

  it("requires the exact screenshot keys, hashes, and file contents", async () => {
    const value = await evidence();
    await expect(
      isPassingBrowserEvidence(
        {
          ...value,
          artifactSha256: {
            ...value.artifactSha256,
            "extra.png": "0".repeat(64),
          },
        },
        marker,
        directory,
        environment,
      ),
    ).resolves.toBe(false);
    await expect(
      isPassingBrowserEvidence(
        {
          ...value,
          artifactSha256: {
            ...value.artifactSha256,
            [names[0]]: "INVALID",
          },
        },
        marker,
        directory,
        environment,
      ),
    ).resolves.toBe(false);
    await writeFile(path.join(directory, names[0]), "tampered");
    await expect(
      isPassingBrowserEvidence(value, marker, directory, environment),
    ).resolves.toBe(false);
  });
});
