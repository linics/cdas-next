import { randomInt, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { waterConservationTaskBook } from "../../fixtures/water-conservation";
import { bootstrapLocalClassroom } from "../bootstrap/bootstrap-local-classroom";
import { createDatabaseClient } from "../db/client";
import { getStudentFeedbackWorkspace } from "../queries/feedback-workspace";
import {
  getStudentReleaseWorkspace,
  getTeacherReleaseSubmissions,
} from "../queries/submission-workspace";
import type { CommandContext } from "./command-context";
import { closeActivityRelease } from "./close-activity-release";
import { decideActionIntent } from "./decide-action-intent";
import { prepareCloseActivityIntent } from "./prepare-close-activity-intent";
import { preparePublishActivityIntent } from "./prepare-publish-activity-intent";
import { prepareTeacherFeedbackIntent } from "./prepare-teacher-feedback-intent";
import { publishActivityRelease } from "./publish-activity-release";
import { saveActivityDraft } from "./save-activity-draft";
import { saveSubmissionWorkingCopy } from "./save-submission-working-copy";
import { saveTeacherFeedback } from "./save-teacher-feedback";
import {
  startSubmissionResubmission,
  StartSubmissionResubmissionError,
} from "./start-submission-resubmission";
import { submitSubmissionRevision } from "./submit-submission-revision";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabaseClient(databaseUrl) : null;

const baseTime = new Date("2026-08-20T02:00:00.000Z");

function atMinute(minutes: number): Date {
  return new Date(baseTime.getTime() + minutes * 60_000);
}

function uiContext(actorId: string, minutes: number): CommandContext {
  return {
    actorId,
    source: "UI",
    traceId: randomUUID(),
    clock: () => atMinute(minutes),
  };
}

function idempotencyKey(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

describeWithDatabase("AI-disabled manual first-phase closed loop", () => {
  afterAll(async () => {
    await database?.$disconnect();
  });

  it("moves one real teacher and student from draft through confirmed feedback without an AgentRun", async () => {
    if (!database) {
      throw new Error("TEST_DATABASE_URL is required");
    }

    const suffix = randomUUID().replaceAll("-", "");
    const classroomId = randomUUID();
    const previousProviderState = process.env.AI_PROVIDER_DISABLED;
    process.env.AI_PROVIDER_DISABLED = "1";

    try {
      const provisioned = await bootstrapLocalClassroom(
        database,
        {
          teacherStaffNo: `T-${suffix.slice(0, 8)}`,
          teacherPassword: `Teacher-${suffix.slice(0, 18)}!`,
          studentNo: String(randomInt(100000, 999999)),
          studentPassword: `Student-${suffix.slice(0, 18)}!`,
          teacherDisplayName: "闭环测试教师",
          studentDisplayName: "闭环测试学生",
          classroomId,
          classroomName: "闭环测试班级",
        },
        () => atMinute(0),
      );

      const draft = await saveActivityDraft(
        database,
        uiContext(provisioned.teacher.id, 1),
        {
          draftId: null,
          expectedVersion: null,
          desiredStatus: "READY_FOR_PREVIEW",
          content: {
            ...waterConservationTaskBook,
            submissionMode: "once",
          },
          agentRunId: null,
          idempotencyKey: idempotencyKey("manual_draft"),
        },
      );
      const preparedPublish = await preparePublishActivityIntent(
        database,
        uiContext(provisioned.teacher.id, 2),
        {
          draftId: draft.draftId,
          expectedDraftVersion: draft.version,
          classroomId,
          dueAt: atMinute(60).toISOString(),
          agentRunId: null,
          idempotencyKey: idempotencyKey("manual_publish_prepare"),
        },
      );
      await decideActionIntent(
        database,
        uiContext(provisioned.teacher.id, 3),
        {
          actionIntentId: preparedPublish.actionIntentId,
          decision: "CONFIRM",
        },
      );
      const published = await publishActivityRelease(
        database,
        uiContext(provisioned.teacher.id, 4),
        {
          actionIntentId: preparedPublish.actionIntentId,
          idempotencyKey: idempotencyKey("manual_publish"),
        },
      );

      const visibleRelease = await getStudentReleaseWorkspace(
        database,
        uiContext(provisioned.student.id, 5),
        { releaseId: published.releaseId },
      );
      expect(visibleRelease).toMatchObject({
        access: { canWrite: true },
        release: {
          id: published.releaseId,
          title: waterConservationTaskBook.title,
          classroomName: "闭环测试班级",
          status: "ACTIVE",
        },
        submission: null,
      });

      const workingCopy = await saveSubmissionWorkingCopy(
        database,
        uiContext(provisioned.student.id, 6),
        {
          releaseId: published.releaseId,
          expectedWorkingCopyId: null,
          expectedWorkingVersion: null,
          textEvidence: "我记录了三个洗手台十分钟内的滴水次数，并比较了差异。",
          idempotencyKey: idempotencyKey("manual_evidence_save"),
        },
      );
      const submitted = await submitSubmissionRevision(
        database,
        uiContext(provisioned.student.id, 7),
        {
          releaseId: published.releaseId,
          expectedWorkingCopyId: workingCopy.workingCopyId,
          expectedWorkingVersion: workingCopy.workingVersion,
          idempotencyKey: idempotencyKey("manual_evidence_submit"),
        },
      );

      const teacherSubmissions = await getTeacherReleaseSubmissions(
        database,
        uiContext(provisioned.teacher.id, 8),
        { releaseId: published.releaseId },
      );
      expect(teacherSubmissions.submissions).toEqual([
        expect.objectContaining({
          submissionId: submitted.submissionId,
          student: {
            id: provisioned.student.id,
            displayName: "闭环测试学生",
          },
          currentRevision: expect.objectContaining({
            id: submitted.revisionId,
            revisionNumber: 1,
            feedback: null,
          }),
        }),
      ]);

      const preparedClose = await prepareCloseActivityIntent(
        database,
        uiContext(provisioned.teacher.id, 9),
        {
          releaseId: published.releaseId,
          expectedStatus: "ACTIVE",
          idempotencyKey: idempotencyKey("manual_close_prepare"),
        },
      );
      await decideActionIntent(
        database,
        uiContext(provisioned.teacher.id, 10),
        {
          actionIntentId: preparedClose.actionIntentId,
          decision: "CONFIRM",
        },
      );
      await closeActivityRelease(
        database,
        uiContext(provisioned.teacher.id, 11),
        {
          actionIntentId: preparedClose.actionIntentId,
          idempotencyKey: idempotencyKey("manual_close"),
        },
      );

      const preparedFeedback = await prepareTeacherFeedbackIntent(
        database,
        uiContext(provisioned.teacher.id, 12),
        {
          submissionId: submitted.submissionId,
          expectedSubmissionRevisionId: submitted.revisionId,
          expectedSubmissionRevisionNumber: 1,
          expectedFeedbackVersion: 0,
          body: "观察记录清楚。请再说明滴水次数如何支持你的改进建议。",
          nextStep: "REVISE",
          supportLevel: "FOUNDATION",
          suggestionAgentRunId: null,
          idempotencyKey: idempotencyKey("manual_feedback_prepare"),
        },
      );
      await decideActionIntent(
        database,
        uiContext(provisioned.teacher.id, 13),
        {
          actionIntentId: preparedFeedback.actionIntentId,
          decision: "CONFIRM",
        },
      );
      await saveTeacherFeedback(
        database,
        uiContext(provisioned.teacher.id, 14),
        {
          actionIntentId: preparedFeedback.actionIntentId,
          idempotencyKey: idempotencyKey("manual_feedback_save"),
        },
      );

      const studentFeedback = await getStudentFeedbackWorkspace(
        database,
        uiContext(provisioned.student.id, 15),
        { submissionId: submitted.submissionId },
      );
      expect(studentFeedback.submission.revisions[0]?.feedback).toMatchObject({
        currentVersion: 1,
        teacher: {
          id: provisioned.teacher.id,
          displayName: "闭环测试教师",
        },
        revisions: [
          expect.objectContaining({
            version: 1,
            source: "MANUAL",
            body: "观察记录清楚。请再说明滴水次数如何支持你的改进建议。",
          }),
        ],
      });
      expect(studentFeedback.submission.release.status).toBe("CLOSED");

      const closedWorkspace = await getStudentReleaseWorkspace(
        database,
        uiContext(provisioned.student.id, 16),
        { releaseId: published.releaseId },
      );
      expect(closedWorkspace.access.canWrite).toBe(false);
      await expect(
        startSubmissionResubmission(
          database,
          uiContext(provisioned.student.id, 16),
          {
            releaseId: published.releaseId,
            expectedLatestRevisionNumber: 1,
            idempotencyKey: idempotencyKey("closed_resubmission"),
          },
        ),
      ).rejects.toEqual(
        new StartSubmissionResubmissionError("RELEASE_NOT_ACTIVE"),
      );
      expect(
        await database.agentRun.count({
          where: {
            actorId: {
              in: [provisioned.teacher.id, provisioned.student.id],
            },
          },
        }),
      ).toBe(0);
    } finally {
      if (previousProviderState === undefined) {
        delete process.env.AI_PROVIDER_DISABLED;
      } else {
        process.env.AI_PROVIDER_DISABLED = previousProviderState;
      }
    }
  });
});
