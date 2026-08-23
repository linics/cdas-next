import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createPublishedActivity } from "../../test/fixtures/published-activity";
import { createDatabaseClient } from "../db/client";
import type { CommandContext, CommandSource } from "./command-context";
import { decideActionIntent } from "./decide-action-intent";
import {
  prepareTeacherFeedbackIntent,
  PrepareTeacherFeedbackIntentError,
} from "./prepare-teacher-feedback-intent";
import {
  saveTeacherFeedback,
  SaveTeacherFeedbackError,
} from "./save-teacher-feedback";
import { saveSubmissionWorkingCopy } from "./save-submission-working-copy";
import { startSubmissionResubmission } from "./start-submission-resubmission";
import { submitSubmissionRevision } from "./submit-submission-revision";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabaseClient(databaseUrl) : null;

function commandContext(
  actorId: string,
  now: Date,
  source: CommandSource = "UI",
): CommandContext {
  return { actorId, source, traceId: randomUUID(), clock: () => now };
}

function minutesAfter(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000);
}

async function createFeedbackFixture() {
  if (!database) {
    throw new Error("TEST_DATABASE_URL is required");
  }

  const baseTime = new Date("2026-08-18T12:00:00.000Z");
  const teacherId = randomUUID();
  const otherTeacherId = randomUUID();
  const studentId = randomUUID();
  const classroomId = randomUUID();

  await database.appUser.createMany({
    data: [
      {
        id: teacherId,
        authSubject: `feedback_teacher_${teacherId}`,
        role: "TEACHER",
        displayName: "反馈测试教师",
      },
      {
        id: otherTeacherId,
        authSubject: `feedback_other_teacher_${otherTeacherId}`,
        role: "TEACHER",
        displayName: "其他反馈教师",
      },
      {
        id: studentId,
        authSubject: `feedback_student_${studentId}`,
        role: "STUDENT",
        displayName: "反馈测试学生",
      },
    ],
  });
  await database.classroom.create({
    data: { id: classroomId, name: "反馈测试班级", managerId: teacherId },
  });
  await database.classroomMembership.create({
    data: {
      classroomId,
      studentId,
      joinedAt: minutesAfter(baseTime, -30),
    },
  });
  const published = await createPublishedActivity(database, {
    teacherId,
    classroomId,
    publishedAt: minutesAfter(baseTime, -20),
    content: {
      schemaVersion: 1,
      title: "教师反馈测试活动",
      summary: "验证手写反馈确认",
      learningObjectives: ["使用文本证据"],
      taskInstructions: "提交一项文本证据",
      evidenceRequirements: ["提供文字证据"],
      feedbackCriteria: ["证据清楚"],
    },
  });
  const workingCopy = await saveSubmissionWorkingCopy(
    database,
    commandContext(studentId, minutesAfter(baseTime, -5)),
    {
      releaseId: published.releaseId,
      expectedWorkingCopyId: null,
      expectedWorkingVersion: null,
      textEvidence: "第一版节水观察证据。",
      idempotencyKey: `save_${randomUUID()}`,
    },
  );
  const submissionRevision = await submitSubmissionRevision(
    database,
    commandContext(studentId, baseTime),
    {
      releaseId: published.releaseId,
      expectedWorkingCopyId: workingCopy.workingCopyId,
      expectedWorkingVersion: workingCopy.workingVersion,
      idempotencyKey: `submit_${randomUUID()}`,
    },
  );

  return {
    baseTime,
    teacherId,
    otherTeacherId,
    studentId,
    releaseId: published.releaseId,
    submissionId: submissionRevision.submissionId,
    submissionRevisionId: submissionRevision.revisionId,
  };
}

async function prepareAndConfirm(
  fixture: Awaited<ReturnType<typeof createFeedbackFixture>>,
  options?: {
    body?: string;
    expectedFeedbackVersion?: number;
    prepareMinute?: number;
  },
) {
  const prepareTime = minutesAfter(
    fixture.baseTime,
    options?.prepareMinute ?? 1,
  );
  const input = {
    submissionId: fixture.submissionId,
    expectedSubmissionRevisionId: fixture.submissionRevisionId,
    expectedSubmissionRevisionNumber: 1,
    expectedFeedbackVersion: options?.expectedFeedbackVersion ?? 0,
    body: options?.body ?? "证据清楚，请再说明测量时间。",
    suggestionAgentRunId: null,
    idempotencyKey: `prepare_feedback_${randomUUID()}`,
  };
  const prepared = await prepareTeacherFeedbackIntent(
    database!,
    commandContext(fixture.teacherId, prepareTime),
    input,
  );
  await decideActionIntent(
    database!,
    commandContext(
      fixture.teacherId,
      minutesAfter(prepareTime, 1),
    ),
    { actionIntentId: prepared.actionIntentId, decision: "CONFIRM" },
  );
  return prepared;
}

describeWithDatabase("teacher feedback commands", () => {
  afterAll(async () => {
    await database?.$disconnect();
  });

  it("creates version one, then appends a confirmed edit without rewriting history", async () => {
    const fixture = await createFeedbackFixture();
    const prepareInput = {
      submissionId: fixture.submissionId,
      expectedSubmissionRevisionId: fixture.submissionRevisionId,
      expectedSubmissionRevisionNumber: 1,
      expectedFeedbackVersion: 0,
      body: "  第一版反馈。\r\n请补充测量时间。  ",
      suggestionAgentRunId: null,
      idempotencyKey: `prepare_feedback_${randomUUID()}`,
    };
    const prepared = await prepareTeacherFeedbackIntent(
      database!,
      commandContext(fixture.teacherId, minutesAfter(fixture.baseTime, 1)),
      prepareInput,
    );
    const replayedPrepare = await prepareTeacherFeedbackIntent(
      database!,
      commandContext(fixture.teacherId, minutesAfter(fixture.baseTime, 1)),
      prepareInput,
    );
    expect(replayedPrepare).toEqual(prepared);

    await decideActionIntent(
      database!,
      commandContext(fixture.teacherId, minutesAfter(fixture.baseTime, 2)),
      { actionIntentId: prepared.actionIntentId, decision: "CONFIRM" },
    );
    const first = await saveTeacherFeedback(
      database!,
      commandContext(fixture.teacherId, minutesAfter(fixture.baseTime, 3)),
      {
        actionIntentId: prepared.actionIntentId,
        idempotencyKey: `save_feedback_${randomUUID()}`,
      },
    );
    expect(first.version).toBe(1);

    const secondIntent = await prepareAndConfirm(fixture, {
      body: "第二版反馈：证据完整，结论可以更具体。",
      expectedFeedbackVersion: 1,
      prepareMinute: 4,
    });
    const second = await saveTeacherFeedback(
      database!,
      commandContext(fixture.teacherId, minutesAfter(fixture.baseTime, 6)),
      {
        actionIntentId: secondIntent.actionIntentId,
        idempotencyKey: `save_feedback_${randomUUID()}`,
      },
    );

    expect(second.teacherFeedbackId).toBe(first.teacherFeedbackId);
    expect(second.version).toBe(2);
    const feedback = await database!.teacherFeedback.findUniqueOrThrow({
      where: { id: first.teacherFeedbackId },
      include: { revisions: { orderBy: { version: "asc" } } },
    });
    expect(feedback.version).toBe(2);
    expect(feedback.revisions.map((revision) => revision.body)).toEqual([
      "  第一版反馈。\n请补充测量时间。  ",
      "第二版反馈：证据完整，结论可以更具体。",
    ]);
    expect(feedback.revisions.every((revision) => revision.source === "MANUAL"))
      .toBe(true);

    await expect(
      database!.teacherFeedbackRevision.update({
        where: { id: feedback.revisions[0]!.id },
        data: { body: "不得覆盖" },
      }),
    ).rejects.toThrow(/append-only/);
  });

  it("rejects another teacher at prepare and execution time", async () => {
    const fixture = await createFeedbackFixture();
    const input = {
      submissionId: fixture.submissionId,
      expectedSubmissionRevisionId: fixture.submissionRevisionId,
      expectedSubmissionRevisionNumber: 1,
      expectedFeedbackVersion: 0,
      body: "其他教师无权保存。",
      suggestionAgentRunId: null,
      idempotencyKey: `prepare_feedback_${randomUUID()}`,
    };

    await expect(
      prepareTeacherFeedbackIntent(
        database!,
        commandContext(fixture.otherTeacherId, minutesAfter(fixture.baseTime, 1)),
        input,
      ),
    ).rejects.toEqual(new PrepareTeacherFeedbackIntentError("NOT_FOUND"));

    const prepared = await prepareAndConfirm(fixture);
    await expect(
      saveTeacherFeedback(
        database!,
        commandContext(fixture.otherTeacherId, minutesAfter(fixture.baseTime, 3)),
        {
          actionIntentId: prepared.actionIntentId,
          idempotencyKey: `save_feedback_${randomUUID()}`,
        },
      ),
    ).rejects.toEqual(new SaveTeacherFeedbackError("FORBIDDEN"));
    expect(
      await database!.teacherFeedback.count({
        where: { submissionRevisionId: fixture.submissionRevisionId },
      }),
    ).toBe(0);
  });

  it("refuses a confirmed intent after the student submits a newer revision", async () => {
    const fixture = await createFeedbackFixture();
    const prepared = await prepareAndConfirm(fixture);

    const started = await startSubmissionResubmission(
      database!,
      commandContext(fixture.studentId, minutesAfter(fixture.baseTime, 3)),
      {
        releaseId: fixture.releaseId,
        expectedLatestRevisionNumber: 1,
        idempotencyKey: `restart_${randomUUID()}`,
      },
    );
    const saved = await saveSubmissionWorkingCopy(
      database!,
      commandContext(fixture.studentId, minutesAfter(fixture.baseTime, 4)),
      {
        releaseId: fixture.releaseId,
        expectedWorkingCopyId: started.workingCopyId,
        expectedWorkingVersion: started.workingVersion,
        textEvidence: "第二版证据，补充了测量时间。",
        idempotencyKey: `save_${randomUUID()}`,
      },
    );
    const submitted = await submitSubmissionRevision(
      database!,
      commandContext(fixture.studentId, minutesAfter(fixture.baseTime, 5)),
      {
        releaseId: fixture.releaseId,
        expectedWorkingCopyId: saved.workingCopyId,
        expectedWorkingVersion: saved.workingVersion,
        idempotencyKey: `submit_${randomUUID()}`,
      },
    );
    expect(submitted.revisionNumber).toBe(2);

    await expect(
      saveTeacherFeedback(
        database!,
        commandContext(fixture.teacherId, minutesAfter(fixture.baseTime, 6)),
        {
          actionIntentId: prepared.actionIntentId,
          idempotencyKey: `save_feedback_${randomUUID()}`,
        },
      ),
    ).rejects.toEqual(
      new SaveTeacherFeedbackError("STALE_SUBMISSION_REVISION"),
    );
    expect(
      await database!.teacherFeedback.count({
        where: { submissionRevisionId: fixture.submissionRevisionId },
      }),
    ).toBe(0);
  });

  it("returns one feedback revision for concurrent retries with the same key", async () => {
    const fixture = await createFeedbackFixture();
    const prepared = await prepareAndConfirm(fixture);
    const input = {
      actionIntentId: prepared.actionIntentId,
      idempotencyKey: `save_feedback_${randomUUID()}`,
    };
    const savedAt = minutesAfter(fixture.baseTime, 3);

    const [first, second] = await Promise.all([
      saveTeacherFeedback(
        database!,
        commandContext(fixture.teacherId, savedAt),
        input,
      ),
      saveTeacherFeedback(
        database!,
        commandContext(fixture.teacherId, savedAt),
        input,
      ),
    ]);

    expect(second).toEqual(first);
    expect(
      await database!.teacherFeedbackRevision.count({
        where: { teacherFeedbackId: first.teacherFeedbackId },
      }),
    ).toBe(1);
  });

  it("refuses a confirmed intent whose exact payload hash does not match", async () => {
    const fixture = await createFeedbackFixture();
    const intentId = randomUUID();
    const createdAt = minutesAfter(fixture.baseTime, 1);
    await database!.actionIntent.create({
      data: {
        id: intentId,
        actorId: fixture.teacherId,
        actionName: "save_teacher_feedback",
        payload: {
          schemaVersion: 1,
          submissionId: fixture.submissionId,
          submissionRevisionId: fixture.submissionRevisionId,
          expectedSubmissionRevisionNumber: 1,
          expectedFeedbackVersion: 0,
          body: "哈希不匹配的反馈。",
          suggestionAgentRunId: null,
        },
        payloadHash: "0".repeat(64),
        targetType: "Submission",
        targetId: fixture.submissionId,
        expectedVersion: 1,
        expiresAt: minutesAfter(fixture.baseTime, 10),
        createdAt,
      },
    });
    await decideActionIntent(
      database!,
      commandContext(fixture.teacherId, minutesAfter(fixture.baseTime, 2)),
      { actionIntentId: intentId, decision: "CONFIRM" },
    );

    await expect(
      saveTeacherFeedback(
        database!,
        commandContext(fixture.teacherId, minutesAfter(fixture.baseTime, 3)),
        {
          actionIntentId: intentId,
          idempotencyKey: `save_feedback_${randomUUID()}`,
        },
      ),
    ).rejects.toEqual(new SaveTeacherFeedbackError("INTENT_TAMPERED"));
    expect(
      await database!.teacherFeedback.count({
        where: { submissionRevisionId: fixture.submissionRevisionId },
      }),
    ).toBe(0);
  });

  it("keeps the handwritten path independent of the AI provider", async () => {
    const fixture = await createFeedbackFixture();
    const previous = process.env.AI_PROVIDER_DISABLED;
    process.env.AI_PROVIDER_DISABLED = "1";

    try {
      const prepared = await prepareAndConfirm(fixture, {
        body: "这是教师手写反馈，不依赖模型。",
      });
      const result = await saveTeacherFeedback(
        database!,
        commandContext(fixture.teacherId, minutesAfter(fixture.baseTime, 3)),
        {
          actionIntentId: prepared.actionIntentId,
          idempotencyKey: `save_feedback_${randomUUID()}`,
        },
      );
      const revision =
        await database!.teacherFeedbackRevision.findUniqueOrThrow({
          where: { id: result.teacherFeedbackRevisionId },
        });

      expect(revision.source).toBe("MANUAL");
      expect(revision.agentRunId).toBeNull();
    } finally {
      if (previous === undefined) {
        delete process.env.AI_PROVIDER_DISABLED;
      } else {
        process.env.AI_PROVIDER_DISABLED = previous;
      }
    }
  });

  it.each(["\u200b", "\u00a0", "\u0085", "\ufe0f", "\u{e0100}"])(
    "keeps a database writer from persisting visually empty feedback %j",
    async (body) => {
      const fixture = await createFeedbackFixture();
      const intentId = randomUUID();
      const createdAt = minutesAfter(fixture.baseTime, 1);
      const decidedAt = minutesAfter(fixture.baseTime, 2);
      const executedAt = minutesAfter(fixture.baseTime, 3);

      await database!.actionIntent.create({
        data: {
          id: intentId,
          actorId: fixture.teacherId,
          actionName: "save_teacher_feedback",
          payload: {
            schemaVersion: 1,
            submissionId: fixture.submissionId,
            submissionRevisionId: fixture.submissionRevisionId,
            expectedSubmissionRevisionNumber: 1,
            expectedFeedbackVersion: 0,
            body,
            suggestionAgentRunId: null,
          },
          payloadHash: "f".repeat(64),
          targetType: "Submission",
          targetId: fixture.submissionId,
          expectedVersion: 1,
          expiresAt: minutesAfter(fixture.baseTime, 10),
          createdAt,
        },
      });
      await database!.actionIntent.update({
        where: { id: intentId },
        data: {
          status: "CONFIRMED",
          decidedById: fixture.teacherId,
          decidedAt,
        },
      });
      await database!.actionIntent.update({
        where: { id: intentId },
        data: { status: "EXECUTED", executedAt },
      });

      await expect(
        database!.teacherFeedback.create({
          data: {
            submissionRevisionId: fixture.submissionRevisionId,
            teacherId: fixture.teacherId,
            version: 1,
            createdAt: executedAt,
            updatedAt: executedAt,
            revisions: {
              create: {
                version: 1,
                body,
                bodyHash: "b".repeat(64),
                source: "MANUAL",
                confirmedById: fixture.teacherId,
                actionIntentId: intentId,
                confirmedAt: executedAt,
              },
            },
          },
        }),
      ).rejects.toThrow();
      expect(
        await database!.teacherFeedback.count({
          where: { submissionRevisionId: fixture.submissionRevisionId },
        }),
      ).toBe(0);
    },
  );

  it("accepts exactly 10,000 astral Unicode code points", async () => {
    const fixture = await createFeedbackFixture();
    const body = "👍".repeat(10_000);
    const prepared = await prepareAndConfirm(fixture, { body });
    const result = await saveTeacherFeedback(
      database!,
      commandContext(fixture.teacherId, minutesAfter(fixture.baseTime, 3)),
      {
        actionIntentId: prepared.actionIntentId,
        idempotencyKey: `save_feedback_${randomUUID()}`,
      },
    );
    const revision =
      await database!.teacherFeedbackRevision.findUniqueOrThrow({
        where: { id: result.teacherFeedbackRevisionId },
      });

    expect([...revision.body]).toHaveLength(10_000);
  });
});
