import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { ActivityContent } from "../../domain/activity/activity-content";
import {
  closePublishedActivity,
  createPublishedActivity,
} from "../../test/fixtures/published-activity";
import type { CommandContext } from "../commands/command-context";
import { decideActionIntent } from "../commands/decide-action-intent";
import { prepareTeacherFeedbackIntent } from "../commands/prepare-teacher-feedback-intent";
import { saveSubmissionWorkingCopy } from "../commands/save-submission-working-copy";
import { saveTeacherFeedback } from "../commands/save-teacher-feedback";
import { submitSubmissionRevision } from "../commands/submit-submission-revision";
import { createDatabaseClient } from "../db/client";
import {
  listStudentReleases,
  StudentReleaseListQueryError,
} from "./student-releases";

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

function at(hour: number, minute = 0): Date {
  return new Date(
    `2026-08-18T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`,
  );
}

async function createRelease(options: {
  teacherId: string;
  classroomId: string;
  title: string;
  publishedAt: Date;
  dueAt?: Date | null;
  closedAt?: Date;
}) {
  if (!database) {
    throw new Error("TEST_DATABASE_URL is required");
  }

  const content = {
    schemaVersion: 1,
    title: options.title,
    summary: `${options.title}摘要`,
    learningObjectives: ["使用证据说明观察结果"],
    taskInstructions: `完成${options.title}并提交文字证据。`,
    evidenceRequirements: ["至少包含一项可核验记录"],
    feedbackCriteria: ["证据与结论一致"],
  } satisfies ActivityContent;
  const release = await createPublishedActivity(database, {
    teacherId: options.teacherId,
    classroomId: options.classroomId,
    publishedAt: options.publishedAt,
    dueAt: options.dueAt,
    content,
  });
  if (options.closedAt) {
    await closePublishedActivity(database, {
      teacherId: options.teacherId,
      releaseId: release.releaseId,
      closedAt: options.closedAt,
    });
  }

  return release.releaseId;
}

async function createReleaseListFixture() {
  if (!database) {
    throw new Error("TEST_DATABASE_URL is required");
  }

  const teacherId = randomUUID();
  const studentId = randomUUID();
  const otherStudentId = randomUUID();
  const currentClassroomId = randomUUID();
  const historicalClassroomId = randomUUID();
  const unrelatedClassroomId = randomUUID();

  await database.appUser.createMany({
    data: [
      {
        id: teacherId,
        authSubject: `release_list_teacher_${teacherId}`,
        role: "TEACHER",
        displayName: "发布列表教师",
      },
      {
        id: studentId,
        authSubject: `release_list_student_${studentId}`,
        role: "STUDENT",
        displayName: "发布列表学生",
      },
      {
        id: otherStudentId,
        authSubject: `release_list_other_${otherStudentId}`,
        role: "STUDENT",
        displayName: "无班级学生",
      },
    ],
  });
  await database.classroom.createMany({
    data: [
      {
        id: currentClassroomId,
        name: "当前成员班级",
        managerId: teacherId,
      },
      {
        id: historicalClassroomId,
        name: "历史成员班级",
        managerId: teacherId,
      },
      {
        id: unrelatedClassroomId,
        name: "无关班级",
        managerId: teacherId,
      },
    ],
  });
  await database.classroomMembership.createMany({
    data: [
      {
        classroomId: currentClassroomId,
        studentId,
        joinedAt: at(8),
      },
      {
        classroomId: historicalClassroomId,
        studentId,
        joinedAt: at(9),
        endedAt: at(11),
      },
    ],
  });

  const feedbackReleaseId = await createRelease({
    teacherId,
    classroomId: currentClassroomId,
    title: "已有反馈活动",
    publishedAt: at(11),
    dueAt: at(13),
  });
  const draftReleaseId = await createRelease({
    teacherId,
    classroomId: currentClassroomId,
    title: "未提交草稿活动",
    publishedAt: at(10, 50),
    dueAt: at(13),
  });
  const pendingReleaseId = await createRelease({
    teacherId,
    classroomId: currentClassroomId,
    title: "尚未开始活动",
    publishedAt: at(10, 40),
    dueAt: at(13),
  });
  const activeHistoricalReleaseId = await createRelease({
    teacherId,
    classroomId: historicalClassroomId,
    title: "历史成员开放活动",
    publishedAt: at(10, 30),
  });
  const closedHistoricalReleaseId = await createRelease({
    teacherId,
    classroomId: historicalClassroomId,
    title: "历史成员关闭活动",
    publishedAt: at(10, 20),
    closedAt: at(11, 30),
  });
  const beforeMembershipReleaseId = await createRelease({
    teacherId,
    classroomId: historicalClassroomId,
    title: "加入前的隐藏活动",
    publishedAt: at(7),
    closedAt: at(8, 30),
  });
  const unrelatedReleaseId = await createRelease({
    teacherId,
    classroomId: unrelatedClassroomId,
    title: "其他班级秘密活动",
    publishedAt: at(11, 10),
  });

  await saveSubmissionWorkingCopy(
    database,
    commandContext(studentId, at(11, 1)),
    {
      releaseId: draftReleaseId,
      expectedWorkingCopyId: null,
      expectedWorkingVersion: null,
      textEvidence: "未提交草稿秘密正文",
      idempotencyKey: `save_${randomUUID()}`,
    },
  );
  const workingCopy = await saveSubmissionWorkingCopy(
    database,
    commandContext(studentId, at(11, 2)),
    {
      releaseId: feedbackReleaseId,
      expectedWorkingCopyId: null,
      expectedWorkingVersion: null,
      textEvidence: "正式修订秘密正文",
      idempotencyKey: `save_${randomUUID()}`,
    },
  );
  const submitted = await submitSubmissionRevision(
    database,
    commandContext(studentId, at(11, 3)),
    {
      releaseId: feedbackReleaseId,
      expectedWorkingCopyId: workingCopy.workingCopyId,
      expectedWorkingVersion: workingCopy.workingVersion,
      idempotencyKey: `submit_${randomUUID()}`,
    },
  );
  const prepared = await prepareTeacherFeedbackIntent(
    database,
    commandContext(teacherId, at(11, 4)),
    {
      submissionId: submitted.submissionId,
      expectedSubmissionRevisionId: submitted.revisionId,
      expectedSubmissionRevisionNumber: 1,
      expectedFeedbackVersion: 0,
      body: "教师反馈秘密正文",
      suggestionAgentRunId: null,
      idempotencyKey: `prepare_feedback_${randomUUID()}`,
    },
  );
  await decideActionIntent(
    database,
    commandContext(teacherId, at(11, 5)),
    { actionIntentId: prepared.actionIntentId, decision: "CONFIRM" },
  );
  await saveTeacherFeedback(
    database,
    commandContext(teacherId, at(11, 6)),
    {
      actionIntentId: prepared.actionIntentId,
      idempotencyKey: `save_feedback_${randomUUID()}`,
    },
  );

  return {
    now: at(12),
    teacherId,
    studentId,
    otherStudentId,
    feedbackReleaseId,
    draftReleaseId,
    pendingReleaseId,
    activeHistoricalReleaseId,
    closedHistoricalReleaseId,
    beforeMembershipReleaseId,
    unrelatedReleaseId,
  };
}

describeWithDatabase("student release list query", () => {
  afterAll(async () => {
    await database?.$disconnect();
  });

  it("returns only visible releases with minimal own progress metadata", async () => {
    const fixture = await createReleaseListFixture();
    const result = await listStudentReleases(
      database!,
      commandContext(fixture.studentId, fixture.now),
      {},
    );

    expect(result.actor).toEqual({ displayName: "发布列表学生" });

    expect(result.releases.map((release) => release.id)).toEqual([
      fixture.feedbackReleaseId,
      fixture.draftReleaseId,
      fixture.pendingReleaseId,
      fixture.activeHistoricalReleaseId,
      fixture.closedHistoricalReleaseId,
    ]);
    expect(
      result.releases.find(
        (release) => release.id === fixture.pendingReleaseId,
      ),
    ).toMatchObject({
      access: { canWrite: true },
      snapshot: { title: "尚未开始活动" },
      submission: {
        latestRevisionNumber: 0,
        hasWorkingCopy: false,
        hasCurrentFeedback: false,
      },
    });
    expect(
      result.releases.find(
        (release) => release.id === fixture.draftReleaseId,
      )?.submission,
    ).toEqual({
      latestRevisionNumber: 0,
      hasWorkingCopy: true,
      hasCurrentFeedback: false,
    });
    expect(
      result.releases.find(
        (release) => release.id === fixture.feedbackReleaseId,
      )?.submission,
    ).toEqual({
      latestRevisionNumber: 1,
      hasWorkingCopy: false,
      hasCurrentFeedback: true,
    });
    expect(
      result.releases.find(
        (release) => release.id === fixture.activeHistoricalReleaseId,
      )?.access.canWrite,
    ).toBe(false);
    expect(
      result.releases.find(
        (release) => release.id === fixture.closedHistoricalReleaseId,
      ),
    ).toMatchObject({
      status: "CLOSED",
      access: { canWrite: false },
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("未提交草稿秘密正文");
    expect(serialized).not.toContain("正式修订秘密正文");
    expect(serialized).not.toContain("教师反馈秘密正文");
    expect(serialized).not.toContain("其他班级秘密活动");
    expect(serialized).not.toContain(fixture.beforeMembershipReleaseId);
    expect(serialized).not.toContain(fixture.unrelatedReleaseId);
  });

  it("returns an empty list to a student without visible memberships", async () => {
    const fixture = await createReleaseListFixture();

    await expect(
      listStudentReleases(
        database!,
        commandContext(fixture.otherStudentId, fixture.now),
        {},
      ),
    ).resolves.toEqual({
      actor: { displayName: "无班级学生" },
      releases: [],
    });
  });

  it("does not expose the student list to a teacher", async () => {
    const fixture = await createReleaseListFixture();

    await expect(
      listStudentReleases(
        database!,
        commandContext(fixture.teacherId, fixture.now),
        {},
      ),
    ).rejects.toEqual(
      new StudentReleaseListQueryError("WRONG_ROLE", "发布列表教师"),
    );
  });
});
