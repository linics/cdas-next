import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { waterConservationTaskBook } from "../../fixtures/water-conservation";
import {
  closePublishedActivity,
  createPublishedActivity,
} from "../../test/fixtures/published-activity";
import { hashTeacherEvaluationSummary } from "../../domain/evaluation/teacher-evaluation-intent";
import { createDatabaseClient } from "../db/client";
import type { CommandContext, CommandSource } from "./command-context";
import { decideActionIntent } from "./decide-action-intent";
import {
  prepareTeacherEvaluationIntent,
  PrepareTeacherEvaluationIntentError,
} from "./prepare-teacher-evaluation-intent";
import {
  saveTeacherEvaluation,
  SaveTeacherEvaluationError,
} from "./save-teacher-evaluation";
import { saveSubmissionWorkingCopy } from "./save-submission-working-copy";
import { startSubmissionResubmission } from "./start-submission-resubmission";
import { submitSubmissionRevision } from "./submit-submission-revision";
import { listStudentReleases } from "../queries/student-releases";
import { getTeacherReleaseSubmissions } from "../queries/submission-workspace";

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

function coveringOutcomes(
  overrides?: Partial<
    Record<number, { status: "LEVEL" | "INSUFFICIENT_EVIDENCE"; level?: "excellent" | "good" | "pass" | "improve" }>
  >,
) {
  return waterConservationTaskBook.rubricDimensions.map((dimension, index) => {
    const override = overrides?.[index];
    if (override?.status === "INSUFFICIENT_EVIDENCE") {
      return {
        dimensionIndex: index + 1,
        dimensionName: dimension.name,
        status: "INSUFFICIENT_EVIDENCE" as const,
        citations: [],
      };
    }
    return {
      dimensionIndex: index + 1,
      dimensionName: dimension.name,
      status: "LEVEL" as const,
      level: override?.level ?? "good",
      citations: [{ kind: "text" as const }],
    };
  });
}

async function createEvaluationFixture(options?: {
  withReadyAttachment?: boolean;
  completedEvidenceIndexes?: number[];
  content?: typeof waterConservationTaskBook;
  phaseIndex?: number;
}) {
  if (!database) {
    throw new Error("TEST_DATABASE_URL is required");
  }

  const baseTime = new Date("2026-08-18T12:00:00.000Z");
  const teacherId = randomUUID();
  const otherTeacherId = randomUUID();
  const studentId = randomUUID();
  const classroomId = randomUUID();
  const phaseIndex = options?.phaseIndex ?? 0;

  await database.appUser.createMany({
    data: [
      {
        id: teacherId,
        authSubject: `evaluation_teacher_${teacherId}`,
        role: "TEACHER",
        displayName: "评价测试教师",
      },
      {
        id: otherTeacherId,
        authSubject: `evaluation_other_teacher_${otherTeacherId}`,
        role: "TEACHER",
        displayName: "其他评价教师",
      },
      {
        id: studentId,
        authSubject: `evaluation_student_${studentId}`,
        role: "STUDENT",
        displayName: "评价测试学生",
      },
    ],
  });
  await database.classroom.create({
    data: { id: classroomId, name: "评价测试班级", managerId: teacherId },
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
    content: options?.content,
  });
  const workingCopy = await saveSubmissionWorkingCopy(
    database,
    commandContext(studentId, minutesAfter(baseTime, -5)),
    {
      releaseId: published.releaseId,
      phaseIndex,
      expectedWorkingCopyId: null,
      expectedWorkingVersion: null,
      textEvidence: "第一版节水观察证据。",
      completedEvidenceIndexes: options?.completedEvidenceIndexes ?? [],
      idempotencyKey: `save_${randomUUID()}`,
    },
  );

  let attachmentId: string | null = null;
  if (options?.withReadyAttachment) {
    const attachment = await database.submissionAttachment.create({
      data: {
        submissionId: workingCopy.submissionId,
        studentId,
        kind: "IMAGE",
        originalFilename: "synthetic.png",
        mediaType: "image/png",
        byteSize: 1_024,
        storageKey: `submissions/${workingCopy.submissionId}/${randomUUID()}`,
        status: "READY",
        createdAt: minutesAfter(baseTime, -4),
        uploadedAt: minutesAfter(baseTime, -3),
        scannedAt: minutesAfter(baseTime, -2),
        workingCopies: {
          create: {
            workingCopyId: workingCopy.workingCopyId,
            position: 0,
            addedAt: minutesAfter(baseTime, -4),
          },
        },
      },
    });
    attachmentId = attachment.id;
  }

  const submissionRevision = await submitSubmissionRevision(
    database,
    commandContext(studentId, baseTime),
    {
      releaseId: published.releaseId,
      phaseIndex,
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
    attachmentId,
  };
}

async function prepareAndConfirm(
  fixture: Awaited<ReturnType<typeof createEvaluationFixture>>,
  options?: {
    summary?: string;
    expectedEvaluationVersion?: number;
    prepareMinute?: number;
    outcomes?: ReturnType<typeof coveringOutcomes>;
  },
) {
  const prepareTime = minutesAfter(
    fixture.baseTime,
    options?.prepareMinute ?? 1,
  );
  const prepared = await prepareTeacherEvaluationIntent(
    database!,
    commandContext(fixture.teacherId, prepareTime),
    {
      submissionId: fixture.submissionId,
      expectedSubmissionRevisionId: fixture.submissionRevisionId,
      expectedSubmissionRevisionNumber: 1,
      expectedEvaluationVersion: options?.expectedEvaluationVersion ?? 0,
      summary: options?.summary ?? "证据能支持四个维度的判断。",
      outcomes: options?.outcomes ?? coveringOutcomes(),
      suggestionAgentRunId: null,
      idempotencyKey: `prepare_evaluation_${randomUUID()}`,
    },
  );
  await decideActionIntent(
    database!,
    commandContext(fixture.teacherId, minutesAfter(prepareTime, 1)),
    { actionIntentId: prepared.actionIntentId, decision: "CONFIRM" },
  );
  return prepared;
}

describeWithDatabase("teacher evaluation commands", () => {
  afterAll(async () => {
    await database?.$disconnect();
  });

  it("saves staging-shaped mixed citation outcomes through DB triggers", async () => {
    const fixture = await createEvaluationFixture({
      withReadyAttachment: true,
      completedEvidenceIndexes: [1],
      content: waterConservationTaskBook,
      phaseIndex: 1,
    });
    expect(fixture.attachmentId).toBeTruthy();

    const dimensions = waterConservationTaskBook.rubricDimensions;
    const outcomes = [
      {
        dimensionIndex: 1,
        dimensionName: dimensions[0]!.name,
        status: "LEVEL" as const,
        level: "excellent" as const,
        citations: [{ kind: "text" as const }],
      },
      {
        dimensionIndex: 2,
        dimensionName: dimensions[1]!.name,
        status: "INSUFFICIENT_EVIDENCE" as const,
        citations: [],
      },
      {
        dimensionIndex: 3,
        dimensionName: dimensions[2]!.name,
        status: "LEVEL" as const,
        level: "good" as const,
        citations: [
          {
            kind: "attachment" as const,
            attachmentId: fixture.attachmentId!,
          },
        ],
      },
      {
        dimensionIndex: 4,
        dimensionName: dimensions[3]!.name,
        status: "LEVEL" as const,
        level: "pass" as const,
        citations: [{ kind: "checkpoint" as const, evidenceIndex: 1 }],
      },
    ];

    const prepared = await prepareTeacherEvaluationIntent(
      database!,
      commandContext(fixture.teacherId, minutesAfter(fixture.baseTime, 1)),
      {
        submissionId: fixture.submissionId,
        expectedSubmissionRevisionId: fixture.submissionRevisionId,
        expectedSubmissionRevisionNumber: 1,
        expectedEvaluationVersion: 0,
        summary: "Synthetic teacher evaluation for mixed citations.",
        outcomes,
        suggestionAgentRunId: null,
        idempotencyKey: `prepare_evaluation_${randomUUID()}`,
      },
    );
    await decideActionIntent(
      database!,
      commandContext(fixture.teacherId, minutesAfter(fixture.baseTime, 2)),
      { actionIntentId: prepared.actionIntentId, decision: "CONFIRM" },
    );

    const saved = await saveTeacherEvaluation(
      database!,
      commandContext(fixture.teacherId, minutesAfter(fixture.baseTime, 3)),
      {
        actionIntentId: prepared.actionIntentId,
        idempotencyKey: `save_evaluation_${randomUUID()}`,
      },
    );

    expect(saved.version).toBe(1);
    const revision =
      await database!.teacherEvaluationRevision.findUniqueOrThrow({
        where: { id: saved.teacherEvaluationRevisionId },
      });
    expect(revision.outcomes).toEqual(outcomes);
  });

  it("creates version one, then appends a confirmed edit without rewriting history", async () => {
    const fixture = await createEvaluationFixture();
    const prepareInput = {
      submissionId: fixture.submissionId,
      expectedSubmissionRevisionId: fixture.submissionRevisionId,
      expectedSubmissionRevisionNumber: 1,
      expectedEvaluationVersion: 0,
      summary: "  第一版综评。\r\n证据清楚。  ",
      outcomes: coveringOutcomes({
        1: { status: "INSUFFICIENT_EVIDENCE" },
      }),
      suggestionAgentRunId: null,
      idempotencyKey: `prepare_evaluation_${randomUUID()}`,
    };
    const prepared = await prepareTeacherEvaluationIntent(
      database!,
      commandContext(fixture.teacherId, minutesAfter(fixture.baseTime, 1)),
      prepareInput,
    );
    const replayedPrepare = await prepareTeacherEvaluationIntent(
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
    const first = await saveTeacherEvaluation(
      database!,
      commandContext(fixture.teacherId, minutesAfter(fixture.baseTime, 3)),
      {
        actionIntentId: prepared.actionIntentId,
        idempotencyKey: `save_evaluation_${randomUUID()}`,
      },
    );
    expect(first.version).toBe(1);
    await expect(
      getTeacherReleaseSubmissions(
        database!,
        commandContext(fixture.teacherId, minutesAfter(fixture.baseTime, 3)),
        { releaseId: fixture.releaseId },
      ),
    ).resolves.toMatchObject({
      release: { rubricAvailable: true },
      submissions: [
        {
          submissionId: fixture.submissionId,
          currentRevision: {
            evaluation: { currentVersion: 1 },
          },
        },
      ],
    });
    const studentList = await listStudentReleases(
      database!,
      commandContext(fixture.studentId, minutesAfter(fixture.baseTime, 3)),
      {},
    );
    expect(
      studentList.releases.find((release) => release.id === fixture.releaseId)
        ?.submission,
    ).toEqual({
      latestRevisionNumber: 1,
      hasWorkingCopy: false,
      hasCurrentFeedback: false,
      hasCurrentEvaluation: true,
    });
    const serializedStudentList = JSON.stringify(studentList);
    expect(serializedStudentList).not.toContain("第一版综评");
    expect(serializedStudentList).not.toContain("证据清楚");

    const secondIntent = await prepareAndConfirm(fixture, {
      summary: "第二版综评：四个维度都有对应证据。",
      expectedEvaluationVersion: 1,
      prepareMinute: 4,
      outcomes: coveringOutcomes({ 0: { status: "LEVEL", level: "excellent" } }),
    });
    const second = await saveTeacherEvaluation(
      database!,
      commandContext(fixture.teacherId, minutesAfter(fixture.baseTime, 6)),
      {
        actionIntentId: secondIntent.actionIntentId,
        idempotencyKey: `save_evaluation_${randomUUID()}`,
      },
    );

    expect(second.teacherEvaluationId).toBe(first.teacherEvaluationId);
    expect(second.version).toBe(2);
    const evaluation = await database!.teacherEvaluation.findUniqueOrThrow({
      where: { id: first.teacherEvaluationId },
      include: { revisions: { orderBy: { version: "asc" } } },
    });
    expect(evaluation.version).toBe(2);
    expect(evaluation.revisions.map((revision) => revision.summary)).toEqual([
      "  第一版综评。\n证据清楚。  ",
      "第二版综评：四个维度都有对应证据。",
    ]);
    expect(evaluation.revisions[0]?.summaryHash).toBe(
      hashTeacherEvaluationSummary("  第一版综评。\n证据清楚。  "),
    );
    const firstOutcomes = evaluation.revisions[0]?.outcomes as Array<{
      status: string;
    }>;
    expect(firstOutcomes[1]?.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(
      evaluation.revisions.every((revision) => revision.source === "MANUAL"),
    ).toBe(true);

    await expect(
      database!.teacherEvaluationRevision.update({
        where: { id: evaluation.revisions[0]!.id },
        data: { summary: "不得覆盖" },
      }),
    ).rejects.toThrow(/append-only/);
  });

  it("rejects another teacher at prepare and execution time", async () => {
    const fixture = await createEvaluationFixture();
    const input = {
      submissionId: fixture.submissionId,
      expectedSubmissionRevisionId: fixture.submissionRevisionId,
      expectedSubmissionRevisionNumber: 1,
      expectedEvaluationVersion: 0,
      summary: "其他教师无权保存。",
      outcomes: coveringOutcomes(),
      suggestionAgentRunId: null,
      idempotencyKey: `prepare_evaluation_${randomUUID()}`,
    };

    await expect(
      prepareTeacherEvaluationIntent(
        database!,
        commandContext(
          fixture.otherTeacherId,
          minutesAfter(fixture.baseTime, 1),
        ),
        input,
      ),
    ).rejects.toEqual(new PrepareTeacherEvaluationIntentError("NOT_FOUND"));

    const prepared = await prepareAndConfirm(fixture);
    await expect(
      saveTeacherEvaluation(
        database!,
        commandContext(
          fixture.otherTeacherId,
          minutesAfter(fixture.baseTime, 3),
        ),
        {
          actionIntentId: prepared.actionIntentId,
          idempotencyKey: `save_evaluation_${randomUUID()}`,
        },
      ),
    ).rejects.toEqual(new SaveTeacherEvaluationError("FORBIDDEN"));
    expect(
      await database!.teacherEvaluation.count({
        where: { submissionRevisionId: fixture.submissionRevisionId },
      }),
    ).toBe(0);
  });

  it("refuses a confirmed intent after the student submits a newer revision", async () => {
    const fixture = await createEvaluationFixture();
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
      saveTeacherEvaluation(
        database!,
        commandContext(fixture.teacherId, minutesAfter(fixture.baseTime, 6)),
        {
          actionIntentId: prepared.actionIntentId,
          idempotencyKey: `save_evaluation_${randomUUID()}`,
        },
      ),
    ).rejects.toEqual(
      new SaveTeacherEvaluationError("STALE_SUBMISSION_REVISION"),
    );
    expect(
      await database!.teacherEvaluation.count({
        where: { submissionRevisionId: fixture.submissionRevisionId },
      }),
    ).toBe(0);
  });

  it("returns one evaluation revision for concurrent retries with the same key", async () => {
    const fixture = await createEvaluationFixture();
    const prepared = await prepareAndConfirm(fixture);
    const input = {
      actionIntentId: prepared.actionIntentId,
      idempotencyKey: `save_evaluation_${randomUUID()}`,
    };
    const savedAt = minutesAfter(fixture.baseTime, 3);

    const [first, second] = await Promise.all([
      saveTeacherEvaluation(
        database!,
        commandContext(fixture.teacherId, savedAt),
        input,
      ),
      saveTeacherEvaluation(
        database!,
        commandContext(fixture.teacherId, savedAt),
        input,
      ),
    ]);

    expect(second).toEqual(first);
    expect(
      await database!.teacherEvaluationRevision.count({
        where: { teacherEvaluationId: first.teacherEvaluationId },
      }),
    ).toBe(1);
  });

  it("rejects missing dimensions, unauthorized citations, and keeps handwriting independent of AI", async () => {
    const fixture = await createEvaluationFixture();
    await expect(
      prepareTeacherEvaluationIntent(
        database!,
        commandContext(fixture.teacherId, minutesAfter(fixture.baseTime, 1)),
        {
          submissionId: fixture.submissionId,
          expectedSubmissionRevisionId: fixture.submissionRevisionId,
          expectedSubmissionRevisionNumber: 1,
          expectedEvaluationVersion: 0,
          summary: "缺少维度。",
          outcomes: coveringOutcomes().slice(0, 3),
          suggestionAgentRunId: null,
          idempotencyKey: `prepare_evaluation_${randomUUID()}`,
        },
      ),
    ).rejects.toEqual(
      new PrepareTeacherEvaluationIntentError("INVALID_EVALUATION"),
    );

    await expect(
      prepareTeacherEvaluationIntent(
        database!,
        commandContext(fixture.teacherId, minutesAfter(fixture.baseTime, 1)),
        {
          submissionId: fixture.submissionId,
          expectedSubmissionRevisionId: fixture.submissionRevisionId,
          expectedSubmissionRevisionNumber: 1,
          expectedEvaluationVersion: 0,
          summary: "引用了不存在的附件。",
          outcomes: coveringOutcomes().map((outcome, index) =>
            index === 0
              ? {
                  ...outcome,
                  citations: [{ kind: "attachment" as const, attachmentId: randomUUID() }],
                }
              : outcome,
          ),
          suggestionAgentRunId: null,
          idempotencyKey: `prepare_evaluation_${randomUUID()}`,
        },
      ),
    ).rejects.toEqual(
      new PrepareTeacherEvaluationIntentError("INVALID_EVALUATION"),
    );

    const previous = process.env.AI_PROVIDER_DISABLED;
    process.env.AI_PROVIDER_DISABLED = "1";
    try {
      await closePublishedActivity(database!, {
        teacherId: fixture.teacherId,
        releaseId: fixture.releaseId,
        closedAt: minutesAfter(fixture.baseTime, 2),
      });
      const prepared = await prepareAndConfirm(fixture, {
        summary: "关闭后仍可手写量规评价。",
        prepareMinute: 3,
      });
      const result = await saveTeacherEvaluation(
        database!,
        commandContext(fixture.teacherId, minutesAfter(fixture.baseTime, 5)),
        {
          actionIntentId: prepared.actionIntentId,
          idempotencyKey: `save_evaluation_${randomUUID()}`,
        },
      );
      const revision =
        await database!.teacherEvaluationRevision.findUniqueOrThrow({
          where: { id: result.teacherEvaluationRevisionId },
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
});
