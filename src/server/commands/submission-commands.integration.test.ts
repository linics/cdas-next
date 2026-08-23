import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createPublishedActivity } from "../../test/fixtures/published-activity";
import { createDatabaseClient } from "../db/client";
import type { CommandContext } from "./command-context";
import {
  saveSubmissionWorkingCopy,
  SaveSubmissionWorkingCopyError,
} from "./save-submission-working-copy";
import {
  startSubmissionResubmission,
  StartSubmissionResubmissionError,
} from "./start-submission-resubmission";
import {
  submitSubmissionRevision,
  SubmitSubmissionRevisionError,
} from "./submit-submission-revision";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabaseClient(databaseUrl) : null;

function commandContext(actorId: string, now: Date): CommandContext {
  return {
    actorId,
    source: "UI",
    traceId: randomUUID(),
    clock: () => now,
  };
}

async function createSubmissionFixture(options?: { dueAt?: Date | null }) {
  if (!database) {
    throw new Error("TEST_DATABASE_URL is required");
  }

  const now = new Date("2026-08-18T12:00:00.000Z");
  const publishedAt = new Date("2026-08-18T10:00:00.000Z");
  const teacherId = randomUUID();
  const studentId = randomUUID();
  const nonmemberId = randomUUID();
  const classroomId = randomUUID();

  await database.appUser.createMany({
    data: [
      {
        id: teacherId,
        authSubject: `teacher_${teacherId}`,
        role: "TEACHER",
        displayName: "提交测试教师",
      },
      {
        id: studentId,
        authSubject: `student_${studentId}`,
        role: "STUDENT",
        displayName: "提交测试学生",
      },
      {
        id: nonmemberId,
        authSubject: `student_${nonmemberId}`,
        role: "STUDENT",
        displayName: "非成员学生",
      },
    ],
  });
  await database.classroom.create({
    data: { id: classroomId, name: "提交测试班级", managerId: teacherId },
  });
  await database.classroomMembership.create({
    data: {
      classroomId,
      studentId,
      joinedAt: new Date("2026-08-18T09:00:00.000Z"),
    },
  });
  const published = await createPublishedActivity(database, {
    teacherId,
    classroomId,
    publishedAt,
    dueAt:
      options?.dueAt === undefined
        ? new Date("2026-08-18T11:00:00.000Z")
        : options.dueAt,
    content: {
      schemaVersion: 1,
      title: "文本提交测试活动",
      summary: "验证学生文本证据提交",
      learningObjectives: ["使用文本证据说明观察结果"],
      taskInstructions: "提交一段可核验的文本证据",
      evidenceRequirements: ["提供一段文字证据"],
      feedbackCriteria: ["证据清楚"],
    },
  });

  return {
    now,
    teacherId,
    studentId,
    nonmemberId,
    releaseId: published.releaseId,
  };
}

async function saveInitialText(
  fixture: Awaited<ReturnType<typeof createSubmissionFixture>>,
  textEvidence: string,
) {
  return saveSubmissionWorkingCopy(
    database!,
    commandContext(fixture.studentId, fixture.now),
    {
      releaseId: fixture.releaseId,
      expectedWorkingCopyId: null,
      expectedWorkingVersion: null,
      textEvidence,
      idempotencyKey: `save_${randomUUID()}`,
    },
  );
}

describeWithDatabase("submission text commands", () => {
  afterAll(async () => {
    await database?.$disconnect();
  });

  it("requires a current student membership for every save", async () => {
    const fixture = await createSubmissionFixture();
    const input = {
      releaseId: fixture.releaseId,
      expectedWorkingCopyId: null,
      expectedWorkingVersion: null,
      textEvidence: "无权写入的证据",
      idempotencyKey: `save_${randomUUID()}`,
    };

    await expect(
      saveSubmissionWorkingCopy(
        database!,
        commandContext(fixture.nonmemberId, fixture.now),
        input,
      ),
    ).rejects.toEqual(new SaveSubmissionWorkingCopyError("NOT_FOUND"));

    await expect(
      saveSubmissionWorkingCopy(
        database!,
        commandContext(fixture.teacherId, fixture.now),
        { ...input, idempotencyKey: `save_${randomUUID()}` },
      ),
    ).rejects.toEqual(new SaveSubmissionWorkingCopyError("FORBIDDEN"));

    expect(
      await database!.submission.count({
        where: { releaseId: fixture.releaseId },
      }),
    ).toBe(0);
  });

  it("keeps a historical member's working copy readable but rejects every write command", async () => {
    const fixture = await createSubmissionFixture({ dueAt: null });
    const initial = await saveInitialText(fixture, "第一版历史证据");
    await submitSubmissionRevision(
      database!,
      commandContext(fixture.studentId, fixture.now),
      {
        releaseId: fixture.releaseId,
        expectedWorkingCopyId: initial.workingCopyId,
        expectedWorkingVersion: initial.workingVersion,
        idempotencyKey: `submit_${randomUUID()}`,
      },
    );
    const workingCopy = await startSubmissionResubmission(
      database!,
      commandContext(fixture.studentId, fixture.now),
      {
        releaseId: fixture.releaseId,
        expectedLatestRevisionNumber: 1,
        idempotencyKey: `restart_${randomUUID()}`,
      },
    );
    const endedMembership = await database!.classroomMembership.updateMany({
      where: { studentId: fixture.studentId, endedAt: null },
      data: { endedAt: fixture.now },
    });
    expect(endedMembership.count).toBe(1);

    await expect(
      saveSubmissionWorkingCopy(
        database!,
        commandContext(fixture.studentId, fixture.now),
        {
          releaseId: fixture.releaseId,
          expectedWorkingCopyId: workingCopy.workingCopyId,
          expectedWorkingVersion: workingCopy.workingVersion,
          textEvidence: "历史成员不得修改此工作草稿",
          idempotencyKey: `save_${randomUUID()}`,
        },
      ),
    ).rejects.toEqual(new SaveSubmissionWorkingCopyError("NOT_FOUND"));
    await expect(
      submitSubmissionRevision(
        database!,
        commandContext(fixture.studentId, fixture.now),
        {
          releaseId: fixture.releaseId,
          expectedWorkingCopyId: workingCopy.workingCopyId,
          expectedWorkingVersion: workingCopy.workingVersion,
          idempotencyKey: `submit_${randomUUID()}`,
        },
      ),
    ).rejects.toEqual(new SubmitSubmissionRevisionError("NOT_FOUND"));
    await expect(
      startSubmissionResubmission(
        database!,
        commandContext(fixture.studentId, fixture.now),
        {
          releaseId: fixture.releaseId,
          expectedLatestRevisionNumber: 1,
          idempotencyKey: `restart_${randomUUID()}`,
        },
      ),
    ).rejects.toEqual(new StartSubmissionResubmissionError("NOT_FOUND"));

    expect(
      await database!.submissionWorkingCopy.findUniqueOrThrow({
        where: { id: workingCopy.workingCopyId },
      }),
    ).toMatchObject({
      version: workingCopy.workingVersion,
      textEvidence: "第一版历史证据",
    });
    expect(
      await database!.submissionRevision.count({
        where: { submissionId: workingCopy.submissionId },
      }),
    ).toBe(1);
    expect(
      await database!.actionAudit.count({
        where: {
          actorId: fixture.studentId,
          targetId: fixture.releaseId,
          outcome: "DENIED",
          errorCode: "NOT_FOUND",
          actionName: {
            in: [
              "save_submission_working_copy",
              "submit_submission_revision",
              "start_submission_resubmission",
            ],
          },
        },
      }),
    ).toBe(3);
  });

  it("keeps visually blank Unicode working copies but refuses to submit them", async () => {
    for (const emptyEvidence of [
      " \n\t ",
      "\u00a0",
      "\u0085",
      "\u200b",
      "\ufe0f",
      "\u{e0100}",
    ]) {
      const fixture = await createSubmissionFixture();
      const saved = await saveInitialText(fixture, emptyEvidence);

      await expect(
        submitSubmissionRevision(
          database!,
          commandContext(fixture.studentId, fixture.now),
          {
            releaseId: fixture.releaseId,
            expectedWorkingCopyId: saved.workingCopyId,
            expectedWorkingVersion: saved.workingVersion,
            idempotencyKey: `submit_${randomUUID()}`,
          },
        ),
      ).rejects.toEqual(new SubmitSubmissionRevisionError("NO_EVIDENCE"));

      expect(
        await database!.submissionRevision.count({
          where: { submissionId: saved.submissionId },
        }),
      ).toBe(0);
      expect(
        await database!.submissionWorkingCopy.count({
          where: { submissionId: saved.submissionId },
        }),
      ).toBe(1);
    }
  });

  it("replays saves and formal submissions without duplicating history", async () => {
    const fixture = await createSubmissionFixture();
    const saveInput = {
      releaseId: fixture.releaseId,
      expectedWorkingCopyId: null,
      expectedWorkingVersion: null,
      textEvidence: "水表读数由 120.3 增加到 121.1。",
      idempotencyKey: `save_${randomUUID()}`,
    };
    const firstSave = await saveSubmissionWorkingCopy(
      database!,
      commandContext(fixture.studentId, fixture.now),
      saveInput,
    );
    const replayedSave = await saveSubmissionWorkingCopy(
      database!,
      commandContext(fixture.studentId, fixture.now),
      saveInput,
    );
    expect(replayedSave).toEqual(firstSave);

    await expect(
      saveSubmissionWorkingCopy(
        database!,
        commandContext(fixture.studentId, fixture.now),
        { ...saveInput, textEvidence: "参数已经改变" },
      ),
    ).rejects.toEqual(
      new SaveSubmissionWorkingCopyError("IDEMPOTENCY_MISMATCH"),
    );

    const submitInput = {
      releaseId: fixture.releaseId,
      expectedWorkingCopyId: firstSave.workingCopyId,
      expectedWorkingVersion: firstSave.workingVersion,
      idempotencyKey: `submit_${randomUUID()}`,
    };
    const submitted = await submitSubmissionRevision(
      database!,
      commandContext(fixture.studentId, fixture.now),
      submitInput,
    );
    const replayedSubmission = await submitSubmissionRevision(
      database!,
      commandContext(fixture.studentId, fixture.now),
      submitInput,
    );

    expect(replayedSubmission).toEqual(submitted);
    expect(submitted).toMatchObject({ revisionNumber: 1, isLate: true });
    expect(
      await database!.submissionRevision.count({
        where: { submissionId: submitted.submissionId },
      }),
    ).toBe(1);
  });

  it("starts an explicit resubmission and preserves the first revision", async () => {
    const fixture = await createSubmissionFixture({ dueAt: null });
    const initial = await saveInitialText(fixture, "第一版证据");
    const firstRevision = await submitSubmissionRevision(
      database!,
      commandContext(fixture.studentId, fixture.now),
      {
        releaseId: fixture.releaseId,
        expectedWorkingCopyId: initial.workingCopyId,
        expectedWorkingVersion: initial.workingVersion,
        idempotencyKey: `submit_${randomUUID()}`,
      },
    );

    const started = await startSubmissionResubmission(
      database!,
      commandContext(fixture.studentId, fixture.now),
      {
        releaseId: fixture.releaseId,
        expectedLatestRevisionNumber: 1,
        idempotencyKey: `restart_${randomUUID()}`,
      },
    );
    const repeatedStart = await startSubmissionResubmission(
      database!,
      commandContext(fixture.studentId, fixture.now),
      {
        releaseId: fixture.releaseId,
        expectedLatestRevisionNumber: 1,
        idempotencyKey: `restart_${randomUUID()}`,
      },
    );
    expect(repeatedStart.workingCopyId).toBe(started.workingCopyId);

    const workingCopy =
      await database!.submissionWorkingCopy.findUniqueOrThrow({
        where: { id: started.workingCopyId },
      });
    expect(workingCopy.textEvidence).toBe("第一版证据");

    const revised = await saveSubmissionWorkingCopy(
      database!,
      commandContext(fixture.studentId, fixture.now),
      {
        releaseId: fixture.releaseId,
        expectedWorkingCopyId: started.workingCopyId,
        expectedWorkingVersion: started.workingVersion,
        textEvidence: "第二版证据，补充了测量时间。",
        idempotencyKey: `save_${randomUUID()}`,
      },
    );
    const secondRevision = await submitSubmissionRevision(
      database!,
      commandContext(fixture.studentId, fixture.now),
      {
        releaseId: fixture.releaseId,
        expectedWorkingCopyId: revised.workingCopyId,
        expectedWorkingVersion: revised.workingVersion,
        idempotencyKey: `submit_${randomUUID()}`,
      },
    );

    expect(secondRevision.revisionNumber).toBe(2);
    expect(firstRevision.revisionNumber).toBe(1);
    expect(
      await database!.submissionRevision.findUniqueOrThrow({
        where: { id: firstRevision.revisionId },
      }),
    ).toMatchObject({
      revisionNumber: 1,
      textEvidence: "第一版证据",
    });
    expect(
      await database!.submissionRevision.findUniqueOrThrow({
        where: { id: secondRevision.revisionId },
      }),
    ).toMatchObject({
      revisionNumber: 2,
      baseRevisionNumber: 1,
      textEvidence: "第二版证据，补充了测量时间。",
    });

    await expect(
      database!.submissionRevision.update({
        where: { id: firstRevision.revisionId },
        data: { textEvidence: "不应覆盖的内容" },
      }),
    ).rejects.toThrow(/append-only/);
  });

  it("returns one revision for concurrent retries", async () => {
    const fixture = await createSubmissionFixture();
    const saved = await saveInitialText(fixture, "并发提交证据");
    const input = {
      releaseId: fixture.releaseId,
      expectedWorkingCopyId: saved.workingCopyId,
      expectedWorkingVersion: saved.workingVersion,
      idempotencyKey: `submit_${randomUUID()}`,
    };

    const [first, second] = await Promise.all([
      submitSubmissionRevision(
        database!,
        commandContext(fixture.studentId, fixture.now),
        input,
      ),
      submitSubmissionRevision(
        database!,
        commandContext(fixture.studentId, fixture.now),
        input,
      ),
    ]);

    expect(second).toEqual(first);
    expect(
      await database!.submissionRevision.count({
        where: { submissionId: saved.submissionId },
      }),
    ).toBe(1);
  });
});
