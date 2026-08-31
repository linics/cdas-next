import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { legacySchoolId } from "../../domain/school/legacy-school";
import { waterConservationTaskBook } from "../../fixtures/water-conservation";
import { createPublishedActivity } from "../../test/fixtures/published-activity";
import {
  getStudentReleaseWorkspace,
  getTeacherReleaseSubmissions,
} from "../queries/submission-workspace";
import { createDatabaseClient } from "../db/client";
import type { CommandContext } from "./command-context";
import {
  saveSubmissionWorkingCopy,
  SaveSubmissionWorkingCopyError,
} from "./save-submission-working-copy";
import { submitSubmissionRevision } from "./submit-submission-revision";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabaseClient(databaseUrl) : null;
const legacyUser = { schoolId: legacySchoolId, legacyProfile: true } as const;

function context(actorId: string, now: Date): CommandContext {
  return {
    actorId,
    source: "UI",
    traceId: randomUUID(),
    clock: () => now,
  };
}

async function createFixture(submissionMode: "phased" | "mixed") {
  const now = new Date("2026-08-23T08:00:00.000Z");
  const teacherId = randomUUID();
  const studentId = randomUUID();
  const classroomId = randomUUID();

  await database!.appUser.createMany({
    data: [
      {
        id: teacherId,
        authSubject: `phase_teacher_${teacherId}`,
        role: "TEACHER",
        displayName: "阶段测试教师",
        ...legacyUser,
      },
      {
        id: studentId,
        authSubject: `phase_student_${studentId}`,
        role: "STUDENT",
        displayName: "阶段测试学生",
        ...legacyUser,
      },
    ],
  });
  await database!.classroom.create({
    data: {
      id: classroomId,
      name: "阶段测试班级",
      managerId: teacherId,
      schoolId: legacySchoolId,
    },
  });
  await database!.classroomMembership.create({
    data: {
      classroomId,
      studentId,
      joinedAt: new Date("2026-08-23T07:00:00.000Z"),
    },
  });
  const published = await createPublishedActivity(database!, {
    teacherId,
    classroomId,
    publishedAt: new Date("2026-08-23T07:30:00.000Z"),
    content: { ...waterConservationTaskBook, submissionMode },
  });
  return { now, teacherId, studentId, releaseId: published.releaseId };
}

async function submitPhase(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  phaseIndex: number,
) {
  const existing = await database!.submission.findUnique({
    where: {
      releaseId_studentId_phaseIndex: {
        releaseId: fixture.releaseId,
        studentId: fixture.studentId,
        phaseIndex,
      },
    },
    include: { workingCopy: true },
  });
  const saved = await saveSubmissionWorkingCopy(
    database!,
    context(fixture.studentId, fixture.now),
    {
      releaseId: fixture.releaseId,
      phaseIndex,
      expectedWorkingCopyId: existing?.workingCopy?.id ?? null,
      expectedWorkingVersion: existing?.workingCopy?.version ?? null,
      textEvidence: "",
      completedEvidenceIndexes: [1],
      idempotencyKey: `phase_save_${randomUUID()}`,
    },
  );
  return submitSubmissionRevision(
    database!,
    context(fixture.studentId, fixture.now),
    {
      releaseId: fixture.releaseId,
      phaseIndex,
      expectedWorkingCopyId: saved.workingCopyId,
      expectedWorkingVersion: saved.workingVersion,
      idempotencyKey: `phase_submit_${randomUUID()}`,
    },
  );
}

describeWithDatabase("D-031 sequential phase submissions", () => {
  afterAll(async () => {
    await database?.$disconnect();
  });

  it("rejects skipped or undefined checkpoints and prepares each next phase idempotently", async () => {
    const fixture = await createFixture("phased");
    expect(
      await database!.activityRelease.findUniqueOrThrow({
        where: { id: fixture.releaseId },
        select: { executionVersion: true },
      }),
    ).toEqual({ executionVersion: 1 });

    await expect(
      saveSubmissionWorkingCopy(
        database!,
        context(fixture.studentId, fixture.now),
        {
          releaseId: fixture.releaseId,
          phaseIndex: 2,
          expectedWorkingCopyId: null,
          expectedWorkingVersion: null,
          textEvidence: "不能跳阶段",
          completedEvidenceIndexes: [],
          idempotencyKey: `phase_skip_${randomUUID()}`,
        },
      ),
    ).rejects.toEqual(new SaveSubmissionWorkingCopyError("PHASE_LOCKED"));

    await expect(
      saveSubmissionWorkingCopy(
        database!,
        context(fixture.studentId, fixture.now),
        {
          releaseId: fixture.releaseId,
          phaseIndex: 1,
          expectedWorkingCopyId: null,
          expectedWorkingVersion: null,
          textEvidence: "",
          completedEvidenceIndexes: [4],
          idempotencyKey: `phase_invalid_checkpoint_${randomUUID()}`,
        },
      ),
    ).rejects.toEqual(
      new SaveSubmissionWorkingCopyError("INVALID_CHECKPOINTS"),
    );

    const firstSave = await saveSubmissionWorkingCopy(
      database!,
      context(fixture.studentId, fixture.now),
      {
        releaseId: fixture.releaseId,
        phaseIndex: 1,
        expectedWorkingCopyId: null,
        expectedWorkingVersion: null,
        textEvidence: "",
        completedEvidenceIndexes: [1],
        idempotencyKey: `phase_save_${randomUUID()}`,
      },
    );
    const submitKey = `phase_submit_${randomUUID()}`;
    const submitInput = {
      releaseId: fixture.releaseId,
      phaseIndex: 1,
      expectedWorkingCopyId: firstSave.workingCopyId,
      expectedWorkingVersion: firstSave.workingVersion,
      idempotencyKey: submitKey,
    };
    const first = await submitSubmissionRevision(
      database!,
      context(fixture.studentId, fixture.now),
      submitInput,
    );
    expect(first.nextPhaseIndex).toBe(2);
    expect(
      await submitSubmissionRevision(
        database!,
        context(fixture.studentId, fixture.now),
        submitInput,
      ),
    ).toEqual(first);

    const studentWorkspace = await getStudentReleaseWorkspace(
      database!,
      context(fixture.studentId, fixture.now),
      { releaseId: fixture.releaseId },
    );
    expect(studentWorkspace.execution).toMatchObject({
      version: 1,
      mode: "phased",
      currentPhaseIndex: 2,
    });
    expect(studentWorkspace.submission?.phaseIndex).toBe(2);
    expect(
      studentWorkspace.submissions.find(
        (submission) => submission.phaseIndex === 1,
      )?.revisions[0]?.completedEvidenceIndexes,
    ).toEqual([1]);

    for (
      let phaseIndex = 2;
      phaseIndex <= waterConservationTaskBook.phases.length;
      phaseIndex += 1
    ) {
      const result = await submitPhase(fixture, phaseIndex);
      expect(result.nextPhaseIndex).toBe(
        phaseIndex < waterConservationTaskBook.phases.length
          ? phaseIndex + 1
          : null,
      );
    }

    const phaseOne = await database!.submission.findUniqueOrThrow({
      where: {
        releaseId_studentId_phaseIndex: {
          releaseId: fixture.releaseId,
          studentId: fixture.studentId,
          phaseIndex: 1,
        },
      },
      include: { revisions: true },
    });
    expect(phaseOne.revisions).toMatchObject([
      { textEvidence: "", completedEvidenceIndexes: [1] },
    ]);

    const teacherWorkspace = await getTeacherReleaseSubmissions(
      database!,
      context(fixture.teacherId, fixture.now),
      { releaseId: fixture.releaseId },
    );
    expect(teacherWorkspace.progress).toMatchObject([
      {
        completedPhaseCount: waterConservationTaskBook.phases.length,
        complete: true,
      },
    ]);
  });

  it("prepares one mixed final only after every frozen phase is submitted", async () => {
    const fixture = await createFixture("mixed");
    await expect(
      saveSubmissionWorkingCopy(
        database!,
        context(fixture.studentId, fixture.now),
        {
          releaseId: fixture.releaseId,
          phaseIndex: 0,
          expectedWorkingCopyId: null,
          expectedWorkingVersion: null,
          textEvidence: "过早终稿",
          completedEvidenceIndexes: [],
          idempotencyKey: `mixed_early_${randomUUID()}`,
        },
      ),
    ).rejects.toEqual(new SaveSubmissionWorkingCopyError("PHASE_LOCKED"));

    let lastResult = null;
    for (
      let phaseIndex = 1;
      phaseIndex <= waterConservationTaskBook.phases.length;
      phaseIndex += 1
    ) {
      lastResult = await submitPhase(fixture, phaseIndex);
    }
    expect(lastResult?.nextPhaseIndex).toBe(0);

    const final = await database!.submission.findUniqueOrThrow({
      where: {
        releaseId_studentId_phaseIndex: {
          releaseId: fixture.releaseId,
          studentId: fixture.studentId,
          phaseIndex: 0,
        },
      },
      include: { workingCopy: true },
    });
    expect(final.workingCopy).not.toBeNull();
  });
});
