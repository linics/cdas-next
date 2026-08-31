import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createPublishedActivity } from "../../test/fixtures/published-activity";
import { legacySchoolId } from "../../domain/school/legacy-school";
import { createDatabaseClient } from "../db/client";
import type { CommandContext } from "../commands/command-context";
import { decideActionIntent } from "../commands/decide-action-intent";
import { prepareTeacherFeedbackIntent } from "../commands/prepare-teacher-feedback-intent";
import { saveSubmissionWorkingCopy } from "../commands/save-submission-working-copy";
import { saveTeacherFeedback } from "../commands/save-teacher-feedback";
import { startSubmissionResubmission } from "../commands/start-submission-resubmission";
import { submitSubmissionRevision } from "../commands/submit-submission-revision";
import { getTeacherActivityDashboard } from "./teacher-activity-workspace";
import {
  getStudentReleaseWorkspace,
  getTeacherReleaseSubmissions,
  SubmissionWorkspaceQueryError,
} from "./submission-workspace";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabaseClient(databaseUrl) : null;
const legacyUser = { schoolId: legacySchoolId, legacyProfile: true } as const;

function commandContext(actorId: string, now: Date): CommandContext {
  return {
    actorId,
    source: "UI",
    traceId: randomUUID(),
    clock: () => now,
  };
}

async function createWorkspaceFixture() {
  if (!database) {
    throw new Error("TEST_DATABASE_URL is required");
  }

  const now = new Date("2026-08-18T12:00:00.000Z");
  const publishedAt = new Date("2026-08-18T10:00:00.000Z");
  const teacherId = randomUUID();
  const otherTeacherId = randomUUID();
  const studentId = randomUUID();
  const peerId = randomUUID();
  const historicalStudentId = randomUUID();
  const outsiderId = randomUUID();
  const classroomId = randomUUID();

  await database.appUser.createMany({
    data: [
      {
        id: teacherId,
        authSubject: `teacher_${teacherId}`,
        role: "TEACHER",
        displayName: "发布教师",
        ...legacyUser,
      },
      {
        id: otherTeacherId,
        authSubject: `teacher_${otherTeacherId}`,
        role: "TEACHER",
        displayName: "其他教师",
        ...legacyUser,
      },
      {
        id: studentId,
        authSubject: `student_${studentId}`,
        role: "STUDENT",
        displayName: "当前学生",
        ...legacyUser,
      },
      {
        id: peerId,
        authSubject: `student_${peerId}`,
        role: "STUDENT",
        displayName: "同班学生",
        ...legacyUser,
      },
      {
        id: historicalStudentId,
        authSubject: `student_${historicalStudentId}`,
        role: "STUDENT",
        displayName: "历史成员",
        ...legacyUser,
      },
      {
        id: outsiderId,
        authSubject: `student_${outsiderId}`,
        role: "STUDENT",
        displayName: "班级外学生",
        ...legacyUser,
      },
    ],
  });
  await database.classroom.create({
    data: { id: classroomId, name: "工作台测试班级", managerId: teacherId, schoolId: legacySchoolId },
  });
  await database.classroomMembership.createMany({
    data: [
      {
        classroomId,
        studentId,
        joinedAt: new Date("2026-08-18T09:00:00.000Z"),
      },
      {
        classroomId,
        studentId: peerId,
        joinedAt: new Date("2026-08-18T09:00:00.000Z"),
      },
      {
        classroomId,
        studentId: historicalStudentId,
        joinedAt: new Date("2026-08-18T09:00:00.000Z"),
        endedAt: new Date("2026-08-18T11:00:00.000Z"),
      },
    ],
  });
  const published = await createPublishedActivity(database, {
    teacherId,
    classroomId,
    publishedAt,
    dueAt: new Date("2026-08-20T12:00:00.000Z"),
    content: {
      schemaVersion: 1,
      title: "校园水表观察",
      summary: "记录并解释水表变化",
      learningObjectives: ["使用数据支持结论"],
      taskInstructions: "记录两次水表读数并解释差异。",
      evidenceRequirements: ["包含时间和读数"],
      feedbackCriteria: ["数据与结论一致"],
    },
  });
  const releaseId = published.releaseId;

  const initial = await saveSubmissionWorkingCopy(
    database,
    commandContext(studentId, now),
    {
      releaseId,
      expectedWorkingCopyId: null,
      expectedWorkingVersion: null,
      textEvidence: "10:00 为 120.3，11:00 为 121.1。",
      idempotencyKey: `save_${randomUUID()}`,
    },
  );
  const submission = await submitSubmissionRevision(
    database,
    commandContext(studentId, now),
    {
      releaseId,
      expectedWorkingCopyId: initial.workingCopyId,
      expectedWorkingVersion: initial.workingVersion,
      idempotencyKey: `submit_${randomUUID()}`,
    },
  );
  const resubmission = await startSubmissionResubmission(
    database,
    commandContext(studentId, now),
    {
      releaseId,
      expectedLatestRevisionNumber: 1,
      idempotencyKey: `restart_${randomUUID()}`,
    },
  );
  await saveSubmissionWorkingCopy(
    database,
    commandContext(studentId, now),
    {
      releaseId,
      expectedWorkingCopyId: resubmission.workingCopyId,
      expectedWorkingVersion: resubmission.workingVersion,
      textEvidence: "准备补充用水量换算。",
      idempotencyKey: `save_${randomUUID()}`,
    },
  );
  await saveSubmissionWorkingCopy(
    database,
    commandContext(peerId, now),
    {
      releaseId,
      expectedWorkingCopyId: null,
      expectedWorkingVersion: null,
      textEvidence: "同班学生尚未提交的草稿",
      idempotencyKey: `save_${randomUUID()}`,
    },
  );
  const feedbackBody = "只可在教師回饋工作區讀取的正式回饋正文";
  const feedbackIntent = await prepareTeacherFeedbackIntent(
    database,
    commandContext(teacherId, now),
    {
      submissionId: submission.submissionId,
      expectedSubmissionRevisionId: submission.revisionId,
      expectedSubmissionRevisionNumber: submission.revisionNumber,
      expectedFeedbackVersion: 0,
      body: feedbackBody,
      nextStep: "CONTINUE",
      supportLevel: "STANDARD",
      suggestionAgentRunId: null,
      idempotencyKey: `prepare_feedback_${randomUUID()}`,
    },
  );
  await decideActionIntent(database, commandContext(teacherId, now), {
    actionIntentId: feedbackIntent.actionIntentId,
    decision: "CONFIRM",
  });
  await saveTeacherFeedback(database, commandContext(teacherId, now), {
    actionIntentId: feedbackIntent.actionIntentId,
    idempotencyKey: `save_feedback_${randomUUID()}`,
  });

  return {
    now,
    teacherId,
    otherTeacherId,
    studentId,
    peerId,
    historicalStudentId,
    outsiderId,
    classroomId,
    releaseId,
    submissionId: submission.submissionId,
    feedbackBody,
  };
}

describeWithDatabase("submission workspace queries", () => {
  afterAll(async () => {
    await database?.$disconnect();
  });

  it("returns an active member's own working copy and formal revisions", async () => {
    const fixture = await createWorkspaceFixture();
    const workspace = await getStudentReleaseWorkspace(
      database!,
      commandContext(fixture.studentId, fixture.now),
      { releaseId: fixture.releaseId },
    );

    expect(workspace.actor).toEqual({ displayName: "当前学生" });
    expect(workspace.access.canWrite).toBe(true);
    expect(workspace.release).toMatchObject({
      title: "校园水表观察",
      classroomName: "工作台测试班级",
    });
    expect(workspace.release.snapshot.content.title).toBe("校园水表观察");
    expect(workspace.submission).toMatchObject({
      id: fixture.submissionId,
      latestRevisionNumber: 1,
      workingCopy: {
        baseRevisionNumber: 1,
        textEvidence: "准备补充用水量换算。",
      },
      revisions: [
        {
          revisionNumber: 1,
          textEvidence: "10:00 为 120.3，11:00 为 121.1。",
        },
      ],
    });
  });

  it("keeps a historical member's overlapping release visible", async () => {
    const fixture = await createWorkspaceFixture();
    const workspace = await getStudentReleaseWorkspace(
      database!,
      commandContext(fixture.historicalStudentId, fixture.now),
      { releaseId: fixture.releaseId },
    );

    expect(workspace.release.id).toBe(fixture.releaseId);
    expect(workspace.access.canWrite).toBe(false);
    expect(workspace.submission).toBeNull();
  });

  it("does not expose another student's submission and hides nonmember resources", async () => {
    const fixture = await createWorkspaceFixture();
    const peerWorkspace = await getStudentReleaseWorkspace(
      database!,
      commandContext(fixture.peerId, fixture.now),
      { releaseId: fixture.releaseId },
    );

    expect(peerWorkspace.access.canWrite).toBe(true);
    expect(peerWorkspace.submission?.latestRevisionNumber).toBe(0);
    expect(peerWorkspace.submission?.workingCopy?.textEvidence).toBe(
      "同班学生尚未提交的草稿",
    );
    expect(peerWorkspace.submission?.revisions).toEqual([]);
    expect(JSON.stringify(peerWorkspace)).not.toContain(
      "10:00 为 120.3，11:00 为 121.1。",
    );

    await expect(
      getStudentReleaseWorkspace(
        database!,
        commandContext(fixture.outsiderId, fixture.now),
        { releaseId: fixture.releaseId },
      ),
    ).rejects.toEqual(new SubmissionWorkspaceQueryError("NOT_FOUND"));
  });

  it("returns not found to teachers outside the precise query role or release", async () => {
    const fixture = await createWorkspaceFixture();

    await expect(
      getStudentReleaseWorkspace(
        database!,
        commandContext(fixture.teacherId, fixture.now),
        { releaseId: fixture.releaseId },
      ),
    ).rejects.toEqual(new SubmissionWorkspaceQueryError("NOT_FOUND"));

    await expect(
      getTeacherReleaseSubmissions(
        database!,
        commandContext(fixture.otherTeacherId, fixture.now),
        { releaseId: fixture.releaseId },
      ),
    ).rejects.toEqual(new SubmissionWorkspaceQueryError("NOT_FOUND"));

    await expect(
      getTeacherReleaseSubmissions(
        database!,
        commandContext(fixture.teacherId, fixture.now),
        { releaseId: "not-a-uuid" },
      ),
    ).rejects.toMatchObject({ name: "ZodError" });
  });

  it("hides submissions when the publisher no longer manages the classroom", async () => {
    const fixture = await createWorkspaceFixture();
    await database!.classroom.update({
      where: { id: fixture.classroomId },
      data: { managerId: fixture.otherTeacherId },
    });

    await expect(
      getTeacherReleaseSubmissions(
        database!,
        commandContext(fixture.teacherId, fixture.now),
        { releaseId: fixture.releaseId },
      ),
    ).rejects.toEqual(new SubmissionWorkspaceQueryError("NOT_FOUND"));
  });

  it("lets the publishing manager list only formal submissions", async () => {
    const fixture = await createWorkspaceFixture();
    const result = await getTeacherReleaseSubmissions(
      database!,
      commandContext(fixture.teacherId, fixture.now),
      { releaseId: fixture.releaseId },
    );

    expect(result.submissions).toEqual([
      {
        submissionId: fixture.submissionId,
        phaseIndex: 0,
        phaseName: null,
        student: {
          id: fixture.studentId,
          displayName: "当前学生",
        },
        group: null,
        currentRevision: expect.objectContaining({
          revisionNumber: 1,
          isLate: false,
          feedback: { currentVersion: 1 },
          evaluation: null,
          followUp: null,
        }),
      },
    ]);
    expect(result.actor).toEqual({ displayName: "发布教师" });
    expect(result.progress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          student: expect.objectContaining({ displayName: "当前学生" }),
          complete: true,
          awaitingFormalRevision: false,
        }),
        expect.objectContaining({
          student: expect.objectContaining({ displayName: "同班学生" }),
          started: true,
          complete: false,
          awaitingFormalRevision: true,
        }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain("同班学生尚未提交的草稿");
    expect(JSON.stringify(result)).not.toContain(
      "10:00 为 120.3，11:00 为 121.1。",
    );
    expect(JSON.stringify(result)).not.toContain(
      `student_${fixture.studentId}`,
    );
    expect(JSON.stringify(result)).not.toContain(fixture.feedbackBody);
    expect(result.release).toMatchObject({
      title: "校园水表观察",
      classroomId: fixture.classroomId,
      classroomName: "工作台测试班级",
      rubricAvailable: true,
    });
    expect(result.reviewCoverage).toEqual({
      currentRevisionCount: 1,
      feedbackCount: 1,
      evaluationCount: 0,
    });
  });

  it("flags revise feedback as awaiting resubmission then in progress", async () => {
    if (!database) {
      throw new Error("TEST_DATABASE_URL is required");
    }
    const now = new Date("2026-08-18T12:00:00.000Z");
    const teacherId = randomUUID();
    const studentId = randomUUID();
    const classroomId = randomUUID();
    await database.appUser.createMany({
      data: [
        {
          id: teacherId,
          authSubject: `teacher_${teacherId}`,
          role: "TEACHER",
          displayName: "跟进教师",
          ...legacyUser,
        },
        {
          id: studentId,
          authSubject: `student_${studentId}`,
          role: "STUDENT",
          displayName: "跟进学生",
          ...legacyUser,
        },
      ],
    });
    await database.classroom.create({
      data: { id: classroomId, name: "跟进测试班级", managerId: teacherId, schoolId: legacySchoolId },
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
      publishedAt: new Date("2026-08-18T10:00:00.000Z"),
    });
    const draft = await saveSubmissionWorkingCopy(
      database,
      commandContext(studentId, now),
      {
        releaseId: published.releaseId,
        expectedWorkingCopyId: null,
        expectedWorkingVersion: null,
        textEvidence: "跟进用的正式观察记录。",
        idempotencyKey: `save_${randomUUID()}`,
      },
    );
    const submitted = await submitSubmissionRevision(
      database,
      commandContext(studentId, now),
      {
        releaseId: published.releaseId,
        expectedWorkingCopyId: draft.workingCopyId,
        expectedWorkingVersion: draft.workingVersion,
        idempotencyKey: `submit_${randomUUID()}`,
      },
    );
    const feedbackBody = "只应出现在反馈工作区的重交意见";
    const feedbackIntent = await prepareTeacherFeedbackIntent(
      database,
      commandContext(teacherId, now),
      {
        submissionId: submitted.submissionId,
        expectedSubmissionRevisionId: submitted.revisionId,
        expectedSubmissionRevisionNumber: submitted.revisionNumber,
        expectedFeedbackVersion: 0,
        body: feedbackBody,
        nextStep: "REVISE",
        supportLevel: "FOUNDATION",
        suggestionAgentRunId: null,
        idempotencyKey: `prepare_feedback_${randomUUID()}`,
      },
    );
    await decideActionIntent(database, commandContext(teacherId, now), {
      actionIntentId: feedbackIntent.actionIntentId,
      decision: "CONFIRM",
    });
    await saveTeacherFeedback(database, commandContext(teacherId, now), {
      actionIntentId: feedbackIntent.actionIntentId,
      idempotencyKey: `save_feedback_${randomUUID()}`,
    });

    const awaiting = await getTeacherReleaseSubmissions(
      database,
      commandContext(teacherId, now),
      { releaseId: published.releaseId },
    );
    expect(awaiting.submissions[0]?.currentRevision.followUp).toBe(
      "AWAITING_RESUBMISSION",
    );
    expect(JSON.stringify(awaiting)).not.toContain(feedbackBody);
    expect(JSON.stringify(awaiting)).not.toContain("REVISE");
    await expect(
      getTeacherActivityDashboard(
        database,
        commandContext(teacherId, now),
        {},
      ),
    ).resolves.toMatchObject({
      releases: [
        {
          id: published.releaseId,
          attention: {
            pendingFeedbackCount: 0,
            pendingEvaluationCount: 1,
            awaitingResubmissionCount: 1,
          },
        },
      ],
    });

    await startSubmissionResubmission(database, commandContext(studentId, now), {
      releaseId: published.releaseId,
      expectedLatestRevisionNumber: 1,
      idempotencyKey: `restart_${randomUUID()}`,
    });
    const inProgress = await getTeacherReleaseSubmissions(
      database,
      commandContext(teacherId, now),
      { releaseId: published.releaseId },
    );
    expect(inProgress.submissions[0]?.currentRevision.followUp).toBe(
      "RESUBMISSION_IN_PROGRESS",
    );
    expect(JSON.stringify(inProgress)).not.toContain(feedbackBody);
    await expect(
      getTeacherActivityDashboard(
        database,
        commandContext(teacherId, now),
        {},
      ),
    ).resolves.toMatchObject({
      releases: [
        {
          id: published.releaseId,
          attention: {
            pendingFeedbackCount: 0,
            pendingEvaluationCount: 1,
            awaitingResubmissionCount: 0,
          },
        },
      ],
    });
  });
});
