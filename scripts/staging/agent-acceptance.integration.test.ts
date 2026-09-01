import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { waterConservationTaskBook } from "../../src/fixtures/water-conservation";

import {
  finishActivityAssistantRun,
  startActivityAssistantRun,
} from "../../src/server/assistant/agent-run-lifecycle";
import {
  bootstrapLocalStaging,
  stagingLocalIdentifier,
} from "../../src/server/bootstrap/bootstrap-local-staging";
import type {
  CommandContext,
  CommandSource,
} from "../../src/server/commands/command-context";
import { decideActionIntent } from "../../src/server/commands/decide-action-intent";
import { closeActivityRelease } from "../../src/server/commands/close-activity-release";
import { prepareCloseActivityIntent } from "../../src/server/commands/prepare-close-activity-intent";
import { preparePublishActivityIntent } from "../../src/server/commands/prepare-publish-activity-intent";
import { prepareTeacherFeedbackIntent } from "../../src/server/commands/prepare-teacher-feedback-intent";
import { publishActivityRelease } from "../../src/server/commands/publish-activity-release";
import { saveActivityDraft } from "../../src/server/commands/save-activity-draft";
import {
  saveSubmissionWorkingCopy,
  SaveSubmissionWorkingCopyError,
} from "../../src/server/commands/save-submission-working-copy";
import { saveTeacherFeedback } from "../../src/server/commands/save-teacher-feedback";
import { startSubmissionResubmission } from "../../src/server/commands/start-submission-resubmission";
import { submitSubmissionRevision } from "../../src/server/commands/submit-submission-revision";
import { createDatabaseClient } from "../../src/server/db/client";
import {
  agentAcceptanceEditedSummary,
  agentAcceptanceEvidenceText,
  agentAcceptanceFeedbackText,
  agentAcceptanceNamespace,
  agentAcceptanceOtherStudentDisplayName,
  agentAcceptanceOtherTeacherDisplayName,
  agentAcceptanceStudentDisplayName,
  agentAcceptanceTeacherDisplayName,
} from "./agent-acceptance/contracts";
import { cleanupAgentSessions } from "./agent-acceptance/cleanup";
import {
  evaluateAgentVerification,
  fullLoopVerificationSql,
  verificationSql,
  type VerificationRow,
} from "./agent-acceptance/verify";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabaseClient(databaseUrl) : null;

const model = "openai/test-agent";
const windowStartedAt = new Date("2026-08-23T05:00:00.000Z");
const windowCompletedAt = new Date("2026-08-23T05:01:00.000Z");
const generatedContent = {
  summary: "模型生成的合成活动摘要",
  learningObjectives: ["辨识合成资料中的证据"],
  taskInstructions: "阅读资料并提交你的判断依据",
  evidenceRequirements: ["一段非空合成文本"],
  feedbackCriteria: ["证据是否支持判断"],
} as const;

function generatedTaskBook(
  title: string,
  summary: string = generatedContent.summary,
) {
  return {
    ...waterConservationTaskBook,
    submissionMode: "once" as const,
    title,
    topic: "学生辨识合成证据",
    summary,
    taskInstructions: generatedContent.taskInstructions,
  };
}

function context(
  actorId: string,
  source: CommandSource,
  now: Date,
): CommandContext {
  return {
    actorId,
    source,
    traceId: randomUUID(),
    clock: () => now,
  };
}

function idempotencyKey(kind: "draft" | "prepare" | "publish"): string {
  const digest = createHash("sha256").update(randomUUID()).digest("hex");
  return `assistant_${kind}_${digest.slice(0, 40)}`;
}

async function queryVerification(input: {
  classroomId: string;
  classroomName: string;
  activityTitle: string;
  teacherSubject: string;
  studentSubject: string;
  otherStudentSubject: string;
  otherTeacherSubject: string;
}): Promise<VerificationRow> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const result = await client.query<VerificationRow>(verificationSql, [
      input.classroomId,
      input.classroomName,
      input.activityTitle,
      input.teacherSubject,
      input.studentSubject,
      model,
      windowStartedAt.toISOString(),
      windowCompletedAt.toISOString(),
      agentAcceptanceEditedSummary,
      input.otherStudentSubject,
    ]);
    const fullLoop = await client.query<VerificationRow>(
      fullLoopVerificationSql,
      [
        input.classroomId,
        input.activityTitle,
        input.teacherSubject,
        input.studentSubject,
        input.otherStudentSubject,
        input.otherTeacherSubject,
        agentAcceptanceEvidenceText,
        agentAcceptanceFeedbackText,
      ],
    );
    await client.query("ROLLBACK");
    if (!result.rows[0]) throw new Error("AGENT_VERIFICATION_ROW_REQUIRED");
    if (!fullLoop.rows[0]) throw new Error("AGENT_LOOP_VERIFICATION_ROW_REQUIRED");
    return { ...result.rows[0], ...fullLoop.rows[0] };
  } finally {
    await client.end();
  }
}

describeWithDatabase("staging Agent acceptance read-only verifier", () => {
  afterAll(async () => database?.$disconnect());

  it("accepts only one marker draft and exactly four session runs", async () => {
    if (!database) throw new Error("TEST_DATABASE_URL is required");

    const marker = `cdas-staging-agent-${randomUUID().replaceAll("-", "")}`;
    const namespace = agentAcceptanceNamespace(marker);
    const suffix = randomUUID().replaceAll("-", "");
    const primarySchoolCode = "SCHABC23";
    const secondarySchoolCode = "SCHDEF45";
    const teacherStaffNo = `T-${suffix.slice(0, 8)}`;
    const numericSuffix = [...suffix]
      .map((character) => character.charCodeAt(0) % 10)
      .join("")
      .slice(0, 7);
    const studentNo = `1${numericSuffix}`;
    const otherStudentNo = `2${numericSuffix}`;
    const otherTeacherStaffNo = `U-${suffix.slice(0, 8)}`;
    const teacherSubject = stagingLocalIdentifier({
      schoolCode: primarySchoolCode,
      role: "TEACHER",
      staffNo: teacherStaffNo,
    });
    const studentSubject = stagingLocalIdentifier({
      schoolCode: primarySchoolCode,
      role: "STUDENT",
      studentNo,
    });
    const otherStudentSubject = stagingLocalIdentifier({
      schoolCode: primarySchoolCode,
      role: "STUDENT",
      studentNo: otherStudentNo,
    });
    const otherTeacherSubject = stagingLocalIdentifier({
      schoolCode: secondarySchoolCode,
      role: "TEACHER",
      staffNo: otherTeacherStaffNo,
    });
    const stagingPassword = `agent-${suffix}-password`;
    await bootstrapLocalStaging(database, {
      schools: [
        { code: primarySchoolCode, name: "Agent integration school A", status: "ACTIVE" },
        { code: secondarySchoolCode, name: "Agent integration school B", status: "ACTIVE" },
      ],
      identities: [
        {
          schoolCode: primarySchoolCode,
          identifier: teacherSubject,
          password: stagingPassword,
          displayName: agentAcceptanceTeacherDisplayName,
          role: "TEACHER",
          staffNo: teacherStaffNo,
        },
        {
          schoolCode: primarySchoolCode,
          identifier: studentSubject,
          password: stagingPassword,
          displayName: agentAcceptanceStudentDisplayName,
          role: "STUDENT",
          studentNo,
        },
        {
          schoolCode: primarySchoolCode,
          identifier: otherStudentSubject,
          password: stagingPassword,
          displayName: agentAcceptanceOtherStudentDisplayName,
          role: "STUDENT",
          studentNo: otherStudentNo,
        },
        {
          schoolCode: secondarySchoolCode,
          identifier: otherTeacherSubject,
          password: stagingPassword,
          displayName: agentAcceptanceOtherTeacherDisplayName,
          role: "TEACHER",
          staffNo: otherTeacherStaffNo,
        },
      ],
      classroom: {
        id: namespace.classroomId,
        name: namespace.classroomName,
        teacherIdentifier: teacherSubject,
        studentIdentifiers: [studentSubject, otherStudentSubject],
      },
    }, () => windowStartedAt);
    const ids = await Promise.all(
      [teacherSubject, studentSubject, otherStudentSubject, otherTeacherSubject].map(
        async (identifier) => {
          const credential = await database.localCredential.findUnique({
            where: { identifier },
            select: { userId: true },
          });
          if (!credential) throw new Error("AGENT_LOCAL_CREDENTIAL_REQUIRED");
          return credential.userId;
        },
      ),
    );
    const resources = {
      teacher: { id: ids[0] as string },
      student: { id: ids[1] as string },
      otherStudent: { id: ids[2] as string },
      otherTeacher: { id: ids[3] as string },
    };

    const run1 = await startActivityAssistantRun(
      database,
      context(
        resources.teacher.id,
        "UI",
        new Date("2026-08-23T05:00:05.000Z"),
      ),
      { model },
    );
    await finishActivityAssistantRun(
      database,
      context(
        resources.teacher.id,
        "AGENT",
        new Date("2026-08-23T05:00:06.000Z"),
      ),
      { agentRunId: run1.id, status: "SUCCEEDED", failureCode: null },
    );

    const run2 = await startActivityAssistantRun(
      database,
      context(
        resources.teacher.id,
        "UI",
        new Date("2026-08-23T05:00:10.000Z"),
      ),
      { model },
    );
    const saved = await saveActivityDraft(
      database,
      context(
        resources.teacher.id,
        "AGENT",
        new Date("2026-08-23T05:00:12.000Z"),
      ),
      {
        draftId: null,
        expectedVersion: null,
        desiredStatus: "READY_FOR_PREVIEW",
        content: generatedTaskBook(namespace.activityTitle),
        agentRunId: run2.id,
        idempotencyKey: idempotencyKey("draft"),
      },
    );
    const manuallySaved = await saveActivityDraft(
      database,
      context(
        resources.teacher.id,
        "UI",
        new Date("2026-08-23T05:00:15.000Z"),
      ),
      {
        draftId: saved.draftId,
        expectedVersion: 1,
        desiredStatus: "READY_FOR_PREVIEW",
        content: generatedTaskBook(
          namespace.activityTitle,
          agentAcceptanceEditedSummary,
        ),
        agentRunId: null,
        idempotencyKey: `save_activity_draft_${randomUUID()}`,
      },
    );

    const run3 = await startActivityAssistantRun(
      database,
      context(
        resources.teacher.id,
        "UI",
        new Date("2026-08-23T05:00:20.000Z"),
      ),
      { model },
    );
    await finishActivityAssistantRun(
      database,
      context(
        resources.teacher.id,
        "AGENT",
        new Date("2026-08-23T05:00:25.000Z"),
      ),
      { agentRunId: run3.id, status: "SUCCEEDED", failureCode: null },
    );

    const run4 = await startActivityAssistantRun(
      database,
      context(
        resources.teacher.id,
        "UI",
        new Date("2026-08-23T05:00:30.000Z"),
      ),
      { model },
    );
    const prepared = await preparePublishActivityIntent(
      database,
      context(
        resources.teacher.id,
        "AGENT",
        new Date("2026-08-23T05:00:35.000Z"),
      ),
      {
        draftId: manuallySaved.draftId,
        expectedDraftVersion: 2,
        classroomId: namespace.classroomId,
        dueAt: null,
        agentRunId: run4.id,
        idempotencyKey: idempotencyKey("prepare"),
      },
    );
    await decideActionIntent(
      database,
      context(
        resources.teacher.id,
        "UI",
        new Date("2026-08-23T05:00:40.000Z"),
      ),
      { actionIntentId: prepared.actionIntentId, decision: "CONFIRM" },
    );
    const published = await publishActivityRelease(
      database,
      context(
        resources.teacher.id,
        "AGENT",
        new Date("2026-08-23T05:00:45.000Z"),
      ),
      {
        actionIntentId: prepared.actionIntentId,
        idempotencyKey: idempotencyKey("publish"),
      },
    );

    const workingCopy = await saveSubmissionWorkingCopy(
      database,
      context(
        resources.student.id,
        "UI",
        new Date("2026-08-23T05:00:46.000Z"),
      ),
      {
        releaseId: published.releaseId,
        expectedWorkingCopyId: null,
        expectedWorkingVersion: null,
        textEvidence: agentAcceptanceEvidenceText,
        idempotencyKey: `agent_loop_save_${randomUUID()}`,
      },
    );
    const submitted = await submitSubmissionRevision(
      database,
      context(
        resources.student.id,
        "UI",
        new Date("2026-08-23T05:00:47.000Z"),
      ),
      {
        releaseId: published.releaseId,
        expectedWorkingCopyId: workingCopy.workingCopyId,
        expectedWorkingVersion: workingCopy.workingVersion,
        idempotencyKey: `agent_loop_submit_${randomUUID()}`,
      },
    );
    const preparedFeedback = await prepareTeacherFeedbackIntent(
      database,
      context(
        resources.teacher.id,
        "UI",
        new Date("2026-08-23T05:00:48.000Z"),
      ),
      {
        submissionId: submitted.submissionId,
        expectedSubmissionRevisionId: submitted.revisionId,
        expectedSubmissionRevisionNumber: 1,
        expectedFeedbackVersion: 0,
        body: agentAcceptanceFeedbackText,
        nextStep: "REVISE",
        supportLevel: "FOUNDATION",
        suggestionAgentRunId: null,
        idempotencyKey: `agent_loop_feedback_prepare_${randomUUID()}`,
      },
    );
    await decideActionIntent(
      database,
      context(
        resources.teacher.id,
        "UI",
        new Date("2026-08-23T05:00:49.000Z"),
      ),
      { actionIntentId: preparedFeedback.actionIntentId, decision: "CONFIRM" },
    );
    await saveTeacherFeedback(
      database,
      context(
        resources.teacher.id,
        "UI",
        new Date("2026-08-23T05:00:50.000Z"),
      ),
      {
        actionIntentId: preparedFeedback.actionIntentId,
        idempotencyKey: `agent_loop_feedback_save_${randomUUID()}`,
      },
    );
    const resubmission = await startSubmissionResubmission(
      database,
      context(
        resources.student.id,
        "UI",
        new Date("2026-08-23T05:00:51.000Z"),
      ),
      {
        releaseId: published.releaseId,
        expectedLatestRevisionNumber: 1,
        idempotencyKey: `agent_loop_resubmit_${randomUUID()}`,
      },
    );
    const preparedClose = await prepareCloseActivityIntent(
      database,
      context(
        resources.teacher.id,
        "UI",
        new Date("2026-08-23T05:00:52.000Z"),
      ),
      {
        releaseId: published.releaseId,
        expectedStatus: "ACTIVE",
        idempotencyKey: `agent_loop_close_prepare_${randomUUID()}`,
      },
    );
    await decideActionIntent(
      database,
      context(
        resources.teacher.id,
        "UI",
        new Date("2026-08-23T05:00:53.000Z"),
      ),
      { actionIntentId: preparedClose.actionIntentId, decision: "CONFIRM" },
    );
    await closeActivityRelease(
      database,
      context(
        resources.teacher.id,
        "UI",
        new Date("2026-08-23T05:00:54.000Z"),
      ),
      {
        actionIntentId: preparedClose.actionIntentId,
        idempotencyKey: `agent_loop_close_${randomUUID()}`,
      },
    );
    await expect(
      saveSubmissionWorkingCopy(
        database,
        context(
          resources.student.id,
          "UI",
          new Date("2026-08-23T05:00:55.000Z"),
        ),
        {
          releaseId: published.releaseId,
          expectedWorkingCopyId: resubmission.workingCopyId,
          expectedWorkingVersion: resubmission.workingVersion,
          textEvidence: `${agentAcceptanceEvidenceText} stale write after close`,
          idempotencyKey: `agent_loop_stale_save_${randomUUID()}`,
        },
      ),
    ).rejects.toEqual(new SaveSubmissionWorkingCopyError("RELEASE_NOT_ACTIVE"));

    const scope = {
      classroomId: namespace.classroomId,
      classroomName: namespace.classroomName,
      activityTitle: namespace.activityTitle,
      teacherSubject,
      studentSubject,
      otherStudentSubject,
      otherTeacherSubject,
    };
    const passing = evaluateAgentVerification(await queryVerification(scope));
    expect(passing.every((candidate) => candidate.status === "PASS")).toBe(
      true,
    );

    await saveActivityDraft(
      database,
      context(
        resources.teacher.id,
        "UI",
        new Date("2026-08-23T05:00:47.000Z"),
      ),
      {
        draftId: null,
        expectedVersion: null,
        desiredStatus: "EDITING",
        content: generatedTaskBook(namespace.activityTitle),
        agentRunId: null,
        idempotencyKey: `manual_duplicate_${randomUUID()}`,
      },
    );

    const duplicateDraft = evaluateAgentVerification(
      await queryVerification(scope),
    );
    expect(duplicateDraft).toContainEqual({
      code: "EXACT_SEALED_DRAFT_AND_REVISIONS",
      status: "FAIL",
    });
    expect(duplicateDraft).toContainEqual({
      code: "EXACT_FOUR_AGENT_RUNS",
      status: "PASS",
    });

    const extraRun = await startActivityAssistantRun(
      database,
      context(
        resources.teacher.id,
        "UI",
        new Date("2026-08-23T05:00:50.000Z"),
      ),
      { model },
    );
    await finishActivityAssistantRun(
      database,
      context(
        resources.teacher.id,
        "AGENT",
        new Date("2026-08-23T05:00:55.000Z"),
      ),
      { agentRunId: extraRun.id, status: "SUCCEEDED", failureCode: null },
    );

    const tampered = evaluateAgentVerification(await queryVerification(scope));
    expect(tampered).toContainEqual({
      code: "EXACT_FOUR_AGENT_RUNS",
      status: "FAIL",
    });
  });

  it("atomically revokes exactly six configured synthetic identities", async () => {
    if (!database) throw new Error("TEST_DATABASE_URL is required");
    const marker = randomUUID().replaceAll("-", "");
    const schoolAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const schoolChars = [...marker]
      .map(
        (character) =>
          schoolAlphabet[character.charCodeAt(0) % schoolAlphabet.length],
      )
      .join("");
    const schoolA = `SCH${schoolChars.slice(0, 5)}`;
    const schoolB = `SCH${schoolChars.slice(5, 10)}`;
    const disabledSchool = `SCH${schoolChars.slice(10, 15)}`;
    const digits = [...marker]
      .map((character) => character.charCodeAt(0) % 10)
      .join("");
    const teacherNo = `T-${digits.slice(0, 6)}`;
    const otherTeacherNo = `U-${digits.slice(6, 12)}`;
    const disabledTeacherNo = `V-${digits.slice(12, 18)}`;
    const studentNo = `1${digits.slice(0, 7)}`;
    const otherStudentNo = `2${digits.slice(7, 14)}`;
    const disabledStudentNo = `3${digits.slice(14, 21)}`;
    const teacher = stagingLocalIdentifier({
      schoolCode: schoolA,
      role: "TEACHER",
      staffNo: teacherNo,
    });
    const student = stagingLocalIdentifier({
      schoolCode: schoolA,
      role: "STUDENT",
      studentNo,
    });
    const otherStudent = stagingLocalIdentifier({
      schoolCode: schoolA,
      role: "STUDENT",
      studentNo: otherStudentNo,
    });
    const otherTeacher = stagingLocalIdentifier({
      schoolCode: schoolB,
      role: "TEACHER",
      staffNo: otherTeacherNo,
    });
    const disabledStudent = stagingLocalIdentifier({
      schoolCode: schoolB,
      role: "STUDENT",
      studentNo: disabledStudentNo,
    });
    const disabledTeacher = stagingLocalIdentifier({
      schoolCode: disabledSchool,
      role: "TEACHER",
      staffNo: disabledTeacherNo,
    });
    const configured = [
      teacher,
      student,
      otherStudent,
      otherTeacher,
      disabledStudent,
      disabledTeacher,
    ];
    const password = `cleanup-${marker}-password`;
    await bootstrapLocalStaging(
      database,
      {
        schools: [
          { code: schoolA, name: `Cleanup A ${marker}`, status: "ACTIVE" },
          { code: schoolB, name: `Cleanup B ${marker}`, status: "ACTIVE" },
          {
            code: disabledSchool,
            name: `Cleanup C ${marker}`,
            status: "DISABLED",
          },
        ],
        identities: [
          {
            schoolCode: schoolA,
            identifier: teacher,
            password,
            displayName: `Cleanup teacher ${marker}`,
            role: "TEACHER",
            staffNo: teacherNo,
          },
          {
            schoolCode: schoolA,
            identifier: student,
            password,
            displayName: `Cleanup student ${marker}`,
            role: "STUDENT",
            studentNo,
          },
          {
            schoolCode: schoolA,
            identifier: otherStudent,
            password,
            displayName: `Cleanup other student ${marker}`,
            role: "STUDENT",
            studentNo: otherStudentNo,
          },
          {
            schoolCode: schoolB,
            identifier: otherTeacher,
            password,
            displayName: `Cleanup other teacher ${marker}`,
            role: "TEACHER",
            staffNo: otherTeacherNo,
          },
          {
            schoolCode: schoolB,
            identifier: disabledStudent,
            password,
            displayName: `Cleanup disabled student ${marker}`,
            role: "STUDENT",
            studentNo: disabledStudentNo,
          },
          {
            schoolCode: disabledSchool,
            identifier: disabledTeacher,
            password,
            displayName: `Cleanup disabled teacher ${marker}`,
            role: "TEACHER",
            staffNo: disabledTeacherNo,
          },
        ],
        classroom: {
          id: randomUUID(),
          name: `Cleanup classroom ${marker}`,
          teacherIdentifier: teacher,
          studentIdentifiers: [student, otherStudent],
        },
      },
      () => windowStartedAt,
    );
    const users = await database.localCredential.findMany({
      where: { identifier: { in: configured } },
      select: { userId: true },
    });
    for (const user of users) {
      await database.authSession.create({
        data: {
          userId: user.userId,
          tokenHash: createHash("sha256")
            .update(randomUUID())
            .digest("hex"),
          expiresAt: new Date("2026-08-23T06:00:00.000Z"),
          createdAt: windowStartedAt,
        },
      });
    }
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await expect(
        cleanupAgentSessions(client, [...configured.slice(0, 5), "missing:identity"]),
      ).rejects.toThrow("STAGING_AGENT_ACCEPTANCE_CLEANUP_IDENTITIES_MISSING");
      const unchanged = await database.authSession.count({
        where: { userId: { in: users.map((user) => user.userId) }, revokedAt: null },
      });
      expect(unchanged).toBe(6);
      await expect(cleanupAgentSessions(client, configured)).resolves.toEqual({
        targetCount: 6,
        revokedCount: 6,
        remainingCount: 0,
      });
      const remaining = await database.authSession.count({
        where: { userId: { in: users.map((user) => user.userId) }, revokedAt: null },
      });
      expect(remaining).toBe(0);
    } finally {
      await client.end();
    }
  });
});
