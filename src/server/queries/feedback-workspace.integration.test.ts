import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { legacySchoolId } from "../../domain/school/legacy-school";
import { createPublishedActivity } from "../../test/fixtures/published-activity";
import type { CommandSource } from "../commands/command-context";
import type { CommandContext } from "../commands/command-context";
import { decideActionIntent } from "../commands/decide-action-intent";
import { prepareTeacherFeedbackIntent } from "../commands/prepare-teacher-feedback-intent";
import { saveSubmissionWorkingCopy } from "../commands/save-submission-working-copy";
import { saveTeacherFeedback } from "../commands/save-teacher-feedback";
import { startSubmissionResubmission } from "../commands/start-submission-resubmission";
import { submitSubmissionRevision } from "../commands/submit-submission-revision";
import { createDatabaseClient } from "../db/client";
import {
  type FeedbackWorkspaceInput,
  FeedbackWorkspaceQueryError,
  getStudentFeedbackWorkspace,
  getTeacherFeedbackWorkspace,
} from "./feedback-workspace";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabaseClient(databaseUrl) : null;
const legacyUser = { schoolId: legacySchoolId, legacyProfile: true } as const;

function commandContext(
  actorId: string,
  now: Date,
  source: CommandSource = "UI",
): CommandContext {
  return {
    actorId,
    source,
    traceId: randomUUID(),
    clock: () => now,
  };
}

function minutesAfter(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000);
}

async function confirmFeedback(options: {
  teacherId: string;
  submissionId: string;
  revisionId: string;
  revisionNumber: number;
  expectedFeedbackVersion: number;
  body: string;
  baseTime: Date;
  prepareMinute: number;
  nextStep?: "CONTINUE" | "REVISE";
  supportLevel?: "FOUNDATION" | "STANDARD" | "CHALLENGE";
}) {
  const prepareTime = minutesAfter(
    options.baseTime,
    options.prepareMinute,
  );
  const prepared = await prepareTeacherFeedbackIntent(
    database!,
    commandContext(options.teacherId, prepareTime),
    {
      submissionId: options.submissionId,
      expectedSubmissionRevisionId: options.revisionId,
      expectedSubmissionRevisionNumber: options.revisionNumber,
      expectedFeedbackVersion: options.expectedFeedbackVersion,
      body: options.body,
      nextStep: options.nextStep ?? "CONTINUE",
      supportLevel: options.supportLevel ?? "STANDARD",
      suggestionAgentRunId: null,
      idempotencyKey: `prepare_feedback_${randomUUID()}`,
    },
  );
  await decideActionIntent(
    database!,
    commandContext(options.teacherId, minutesAfter(prepareTime, 1)),
    {
      actionIntentId: prepared.actionIntentId,
      decision: "CONFIRM",
    },
  );
  return saveTeacherFeedback(
    database!,
    commandContext(options.teacherId, minutesAfter(prepareTime, 2)),
    {
      actionIntentId: prepared.actionIntentId,
      idempotencyKey: `save_feedback_${randomUUID()}`,
    },
  );
}

async function createFeedbackWorkspaceFixture() {
  if (!database) {
    throw new Error("TEST_DATABASE_URL is required");
  }

  const baseTime = new Date("2026-08-18T12:00:00.000Z");
  const teacherId = randomUUID();
  const otherTeacherId = randomUUID();
  const studentId = randomUUID();
  const otherStudentId = randomUUID();
  const classroomId = randomUUID();
  const membershipId = randomUUID();
  const firstRevisionBody = "第一版正式观察：水表增加 0.8 吨。";
  const secondRevisionBody = "第二版正式观察：补充了时间、单位和计算过程。";
  const firstFeedbackBody = "第一版反馈：请补充测量时间。";
  const editedFeedbackBody = "修改后的反馈：时间清楚，请说明单位换算。";
  const secondFeedbackBody = "第二次提交反馈：证据与结论已经对应。";
  const unconfirmedFeedbackSecret = "未确认的反馈草案，不应出现在查询结果。";
  const workingCopySecret = "绝密未提交工作副本，不得向教师查询泄漏。";

  await database.appUser.createMany({
    data: [
      {
        id: teacherId,
        authSubject: `feedback_query_teacher_${teacherId}`,
        role: "TEACHER",
        displayName: "反馈工作台教师",
        ...legacyUser,
      },
      {
        id: otherTeacherId,
        authSubject: `feedback_query_other_teacher_${otherTeacherId}`,
        role: "TEACHER",
        displayName: "其他教师",
        ...legacyUser,
      },
      {
        id: studentId,
        authSubject: `feedback_query_student_${studentId}`,
        role: "STUDENT",
        displayName: "反馈工作台学生",
        ...legacyUser,
      },
      {
        id: otherStudentId,
        authSubject: `feedback_query_other_student_${otherStudentId}`,
        role: "STUDENT",
        displayName: "其他学生",
        ...legacyUser,
      },
    ],
  });
  await database.classroom.create({
    data: {
      id: classroomId,
      name: "反馈工作台班级",
      managerId: teacherId,
      schoolId: legacySchoolId,
    },
  });
  await database.classroomMembership.create({
    data: {
      id: membershipId,
      classroomId,
      studentId,
      joinedAt: minutesAfter(baseTime, -30),
    },
  });
  const published = await createPublishedActivity(database, {
    teacherId,
    classroomId,
    publishedAt: minutesAfter(baseTime, -20),
    dueAt: minutesAfter(baseTime, 9),
    content: {
      schemaVersion: 1,
      title: "校园水表观察",
      summary: "记录并解释水表变化",
      learningObjectives: ["使用数据支持结论"],
      taskInstructions: "记录两次水表读数并解释差异。",
      evidenceRequirements: ["包含时间、读数和单位"],
      feedbackCriteria: ["数据与结论一致"],
    },
  });
  const releaseId = published.releaseId;

  const firstWorkingCopy = await saveSubmissionWorkingCopy(
    database,
    commandContext(studentId, minutesAfter(baseTime, -1)),
    {
      releaseId,
      expectedWorkingCopyId: null,
      expectedWorkingVersion: null,
      textEvidence: firstRevisionBody,
      idempotencyKey: `save_submission_${randomUUID()}`,
    },
  );
  const firstRevision = await submitSubmissionRevision(
    database,
    commandContext(studentId, baseTime),
    {
      releaseId,
      expectedWorkingCopyId: firstWorkingCopy.workingCopyId,
      expectedWorkingVersion: firstWorkingCopy.workingVersion,
      idempotencyKey: `submit_submission_${randomUUID()}`,
    },
  );

  const firstFeedback = await confirmFeedback({
    teacherId,
    submissionId: firstRevision.submissionId,
    revisionId: firstRevision.revisionId,
    revisionNumber: 1,
    expectedFeedbackVersion: 0,
    body: firstFeedbackBody,
    baseTime,
    prepareMinute: 1,
    nextStep: "REVISE",
    supportLevel: "FOUNDATION",
  });
  await confirmFeedback({
    teacherId,
    submissionId: firstRevision.submissionId,
    revisionId: firstRevision.revisionId,
    revisionNumber: 1,
    expectedFeedbackVersion: 1,
    body: editedFeedbackBody,
    baseTime,
    prepareMinute: 4,
    nextStep: "CONTINUE",
    supportLevel: "CHALLENGE",
  });

  const resubmission = await startSubmissionResubmission(
    database,
    commandContext(studentId, minutesAfter(baseTime, 7)),
    {
      releaseId,
      expectedLatestRevisionNumber: 1,
      idempotencyKey: `start_resubmission_${randomUUID()}`,
    },
  );
  const updatedResubmission = await saveSubmissionWorkingCopy(
    database,
    commandContext(studentId, minutesAfter(baseTime, 8)),
    {
      releaseId,
      expectedWorkingCopyId: resubmission.workingCopyId,
      expectedWorkingVersion: resubmission.workingVersion,
      textEvidence: secondRevisionBody,
      idempotencyKey: `save_resubmission_${randomUUID()}`,
    },
  );
  const secondRevision = await submitSubmissionRevision(
    database,
    commandContext(studentId, minutesAfter(baseTime, 10)),
    {
      releaseId,
      expectedWorkingCopyId: updatedResubmission.workingCopyId,
      expectedWorkingVersion: updatedResubmission.workingVersion,
      idempotencyKey: `submit_resubmission_${randomUUID()}`,
    },
  );
  const secondFeedback = await confirmFeedback({
    teacherId,
    submissionId: secondRevision.submissionId,
    revisionId: secondRevision.revisionId,
    revisionNumber: 2,
    expectedFeedbackVersion: 0,
    body: secondFeedbackBody,
    baseTime,
    prepareMinute: 11,
    nextStep: "REVISE",
    supportLevel: "STANDARD",
  });

  const unconfirmedIntent = await prepareTeacherFeedbackIntent(
    database,
    commandContext(teacherId, minutesAfter(baseTime, 14)),
    {
      submissionId: secondRevision.submissionId,
      expectedSubmissionRevisionId: secondRevision.revisionId,
      expectedSubmissionRevisionNumber: 2,
      expectedFeedbackVersion: 1,
      body: unconfirmedFeedbackSecret,
      nextStep: "REVISE",
      supportLevel: "FOUNDATION",
      suggestionAgentRunId: null,
      idempotencyKey: `prepare_unconfirmed_${randomUUID()}`,
    },
  );

  const pendingResubmission = await startSubmissionResubmission(
    database,
    commandContext(studentId, minutesAfter(baseTime, 15)),
    {
      releaseId,
      expectedLatestRevisionNumber: 2,
      idempotencyKey: `start_pending_resubmission_${randomUUID()}`,
    },
  );
  await saveSubmissionWorkingCopy(
    database,
    commandContext(studentId, minutesAfter(baseTime, 16)),
    {
      releaseId,
      expectedWorkingCopyId: pendingResubmission.workingCopyId,
      expectedWorkingVersion: pendingResubmission.workingVersion,
      textEvidence: workingCopySecret,
      idempotencyKey: `save_pending_resubmission_${randomUUID()}`,
    },
  );

  await database.classroomMembership.update({
    where: { id: membershipId },
    data: { endedAt: minutesAfter(baseTime, 17) },
  });

  return {
    baseTime,
    teacherId,
    otherTeacherId,
    studentId,
    otherStudentId,
    classroomId,
    releaseId,
    snapshotHash: published.snapshotHash,
    submissionId: firstRevision.submissionId,
    firstRevisionId: firstRevision.revisionId,
    secondRevisionId: secondRevision.revisionId,
    firstFeedbackId: firstFeedback.teacherFeedbackId,
    secondFeedbackId: secondFeedback.teacherFeedbackId,
    unconfirmedActionIntentId: unconfirmedIntent.actionIntentId,
    firstRevisionBody,
    secondRevisionBody,
    firstFeedbackBody,
    editedFeedbackBody,
    secondFeedbackBody,
    unconfirmedFeedbackSecret,
    workingCopySecret,
  };
}

type Fixture = Awaited<ReturnType<typeof createFeedbackWorkspaceFixture>>;

describeWithDatabase("feedback workspace queries", () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await createFeedbackWorkspaceFixture();
  });

  afterAll(async () => {
    await database?.$disconnect();
  });

  it("returns every formal revision and confirmed feedback version to the publishing manager", async () => {
    const workspace = await getTeacherFeedbackWorkspace(
      database!,
      commandContext(
        fixture.teacherId,
        minutesAfter(fixture.baseTime, 20),
        "AGENT",
      ),
      { submissionId: fixture.submissionId },
    );

    expect(workspace.actor).toEqual({ displayName: "反馈工作台教师" });
    expect(workspace.student).toEqual({
      id: fixture.studentId,
      displayName: "反馈工作台学生",
    });
    expect(workspace.submission.release).toMatchObject({
      id: fixture.releaseId,
      status: "ACTIVE",
      classroom: {
        id: fixture.classroomId,
        name: "反馈工作台班级",
      },
      snapshot: {
        sourceDraftVersion: 1,
        contentHash: fixture.snapshotHash,
        content: { title: "校园水表观察" },
      },
    });
    expect(workspace.submission.latestRevisionNumber).toBe(2);
    expect(workspace.submission.revisions).toMatchObject([
      {
        id: fixture.firstRevisionId,
        revisionNumber: 1,
        textEvidence: fixture.firstRevisionBody,
        isLate: false,
        submittedAt: fixture.baseTime.toISOString(),
        feedback: {
          id: fixture.firstFeedbackId,
          currentVersion: 2,
          teacher: {
            id: fixture.teacherId,
            displayName: "反馈工作台教师",
          },
          revisions: [
            {
              version: 1,
              body: fixture.firstFeedbackBody,
              nextStep: "REVISE",
              supportLevel: "FOUNDATION",
              source: "MANUAL",
            },
            {
              version: 2,
              body: fixture.editedFeedbackBody,
              nextStep: "CONTINUE",
              supportLevel: "CHALLENGE",
              source: "MANUAL",
            },
          ],
        },
      },
      {
        id: fixture.secondRevisionId,
        revisionNumber: 2,
        textEvidence: fixture.secondRevisionBody,
        isLate: true,
        submittedAt: minutesAfter(fixture.baseTime, 10).toISOString(),
        feedback: {
          id: fixture.secondFeedbackId,
          currentVersion: 1,
          teacher: {
            id: fixture.teacherId,
            displayName: "反馈工作台教师",
          },
          revisions: [
            {
              version: 1,
              body: fixture.secondFeedbackBody,
              nextStep: "REVISE",
              supportLevel: "STANDARD",
              source: "MANUAL",
            },
          ],
        },
      },
    ]);

    assertNoInternalOrDraftData(workspace, fixture);
  });

  it("returns NOT_FOUND to every teacher or role outside the exact resource authorization", async () => {
    await expect(
      getTeacherFeedbackWorkspace(
        database!,
        commandContext(
          fixture.otherTeacherId,
          minutesAfter(fixture.baseTime, 20),
        ),
        { submissionId: fixture.submissionId },
      ),
    ).rejects.toEqual(new FeedbackWorkspaceQueryError("NOT_FOUND"));
    await expect(
      getTeacherFeedbackWorkspace(
        database!,
        commandContext(
          fixture.studentId,
          minutesAfter(fixture.baseTime, 20),
        ),
        { submissionId: fixture.submissionId },
      ),
    ).rejects.toEqual(new FeedbackWorkspaceQueryError("NOT_FOUND"));
  });

  it("requires the publishing teacher to still manage the classroom", async () => {
    await database!.classroom.update({
      where: { id: fixture.classroomId },
      data: { managerId: fixture.otherTeacherId },
    });

    try {
      await expect(
        getTeacherFeedbackWorkspace(
          database!,
          commandContext(
            fixture.teacherId,
            minutesAfter(fixture.baseTime, 20),
          ),
          { submissionId: fixture.submissionId },
        ),
      ).rejects.toEqual(new FeedbackWorkspaceQueryError("NOT_FOUND"));
    } finally {
      await database!.classroom.update({
        where: { id: fixture.classroomId },
        data: { managerId: fixture.teacherId },
      });
    }
  });

  it("lets the submission owner read confirmed history after membership ends", async () => {
    const workspace = await getStudentFeedbackWorkspace(
      database!,
      commandContext(
        fixture.studentId,
        minutesAfter(fixture.baseTime, 20),
      ),
      { submissionId: fixture.submissionId },
    );

    expect(workspace.submission.id).toBe(fixture.submissionId);
    expect(workspace.submission.revisions.map((revision) => ({
      revisionNumber: revision.revisionNumber,
      body: revision.textEvidence,
      teacher: revision.feedback?.teacher,
      feedbackVersions: revision.feedback?.revisions.map(
        (feedback) => feedback.version,
      ),
    }))).toEqual([
      {
        revisionNumber: 1,
        body: fixture.firstRevisionBody,
        teacher: {
          id: fixture.teacherId,
          displayName: "反馈工作台教师",
        },
        feedbackVersions: [1, 2],
      },
      {
        revisionNumber: 2,
        body: fixture.secondRevisionBody,
        teacher: {
          id: fixture.teacherId,
          displayName: "反馈工作台教师",
        },
        feedbackVersions: [1],
      },
    ]);
    expect(JSON.stringify(workspace)).not.toContain('"student"');
    assertNoInternalOrDraftData(workspace, fixture);
  });

  it("returns NOT_FOUND to another student and to a teacher using the student view", async () => {
    await expect(
      getStudentFeedbackWorkspace(
        database!,
        commandContext(
          fixture.otherStudentId,
          minutesAfter(fixture.baseTime, 20),
        ),
        { submissionId: fixture.submissionId },
      ),
    ).rejects.toEqual(new FeedbackWorkspaceQueryError("NOT_FOUND"));
    await expect(
      getStudentFeedbackWorkspace(
        database!,
        commandContext(
          fixture.teacherId,
          minutesAfter(fixture.baseTime, 20),
        ),
        { submissionId: fixture.submissionId },
      ),
    ).rejects.toEqual(new FeedbackWorkspaceQueryError("NOT_FOUND"));
  });

  it("rejects extra input fields and SYSTEM read contexts", async () => {
    await expect(
      getStudentFeedbackWorkspace(
        database!,
        commandContext(
          fixture.studentId,
          minutesAfter(fixture.baseTime, 20),
        ),
        {
          submissionId: fixture.submissionId,
          unexpectedActorId: fixture.otherStudentId,
        } as unknown as FeedbackWorkspaceInput,
      ),
    ).rejects.toMatchObject({ name: "ZodError" });

    await expect(
      getStudentFeedbackWorkspace(
        database!,
        commandContext(
          fixture.studentId,
          minutesAfter(fixture.baseTime, 20),
          "SYSTEM",
        ),
        { submissionId: fixture.submissionId },
      ),
    ).rejects.toBeInstanceOf(TypeError);
  });
});

function assertNoInternalOrDraftData(
  value: unknown,
  fixture: Fixture,
): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(fixture.workingCopySecret);
  expect(serialized).not.toContain(fixture.unconfirmedFeedbackSecret);
  expect(serialized).not.toContain(fixture.unconfirmedActionIntentId);
  for (const privateField of [
    "workingCopy",
    "actionIntentId",
    "payload",
    "payloadHash",
    "bodyHash",
    "agentRunId",
    "authSubject",
    "confirmedById",
    "requestHash",
    "audit",
  ]) {
    expect(serialized).not.toContain(`\"${privateField}\"`);
  }
}
