import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ActivityContent } from "../../domain/activity/activity-content";
import { waterConservationTaskBook } from "../../fixtures/water-conservation";
import type { CommandContext, CommandSource } from "../commands/command-context";
import { decideActionIntent } from "../commands/decide-action-intent";
import { preparePublishActivityIntent } from "../commands/prepare-publish-activity-intent";
import { publishActivityRelease } from "../commands/publish-activity-release";
import { saveActivityDraft } from "../commands/save-activity-draft";
import { createDatabaseClient } from "../db/client";
import {
  getTeacherActivityDashboard,
  getTeacherActivityDraft,
  getTeacherActivityPreview,
  getTeacherIdentity,
  getTeacherPublishConfirmation,
  TeacherActivityQueryError,
} from "./teacher-activity-workspace";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabaseClient(databaseUrl) : null;
const now = new Date("2026-08-18T12:00:00.000Z");

function context(
  actorId: string,
  source: CommandSource = "UI",
): CommandContext {
  return {
    actorId,
    source,
    traceId: randomUUID(),
    clock: () => now,
  };
}

function content(title: string): ActivityContent {
  return {
    ...waterConservationTaskBook,
    title,
    topic: `${title}主题`,
    summary: `${title}摘要`,
    taskInstructions: `${title}仅所有者可见的任务正文`,
  };
}

type Fixture = Awaited<ReturnType<typeof createFixture>>;
let fixture: Fixture;

async function createFixture() {
  if (!database) {
    throw new Error("TEST_DATABASE_URL is required");
  }

  const teacherId = randomUUID();
  const otherTeacherId = randomUUID();
  const studentId = randomUUID();
  await database.appUser.createMany({
    data: [
      {
        id: teacherId,
        authSubject: `teacher_${teacherId}`,
        role: "TEACHER",
        displayName: "林老师",
      },
      {
        id: otherTeacherId,
        authSubject: `teacher_${otherTeacherId}`,
        role: "TEACHER",
        displayName: "其他老师",
      },
      {
        id: studentId,
        authSubject: `student_${studentId}`,
        role: "STUDENT",
        displayName: "测试学生",
      },
    ],
  });

  const [classroom, foreignClassroom] = await Promise.all([
    database.classroom.create({
      data: { name: "七年一班", managerId: teacherId },
    }),
    database.classroom.create({
      data: { name: "其他教师班级", managerId: otherTeacherId },
    }),
  ]);
  await database.classroomMembership.create({
    data: {
      classroomId: classroom.id,
      studentId,
      joinedAt: new Date("2026-08-18T10:00:00.000Z"),
    },
  });

  const editing = await saveActivityDraft(database, context(teacherId), {
    draftId: null,
    expectedVersion: null,
    desiredStatus: "EDITING",
    content: content("观察校园用水"),
    agentRunId: null,
    idempotencyKey: `draft_${randomUUID()}`,
  });
  const ready = await saveActivityDraft(database, context(teacherId), {
    draftId: null,
    expectedVersion: null,
    desiredStatus: "READY_FOR_PREVIEW",
    content: content("准备发布的活动"),
    agentRunId: null,
    idempotencyKey: `draft_${randomUUID()}`,
  });
  const foreignDraft = await saveActivityDraft(
    database,
    context(otherTeacherId),
    {
      draftId: null,
      expectedVersion: null,
      desiredStatus: "EDITING",
      content: content("其他教师秘密活动"),
      agentRunId: null,
      idempotencyKey: `draft_${randomUUID()}`,
    },
  );
  const prepared = await preparePublishActivityIntent(
    database,
    context(teacherId),
    {
      draftId: ready.draftId,
      expectedDraftVersion: ready.version,
      classroomId: classroom.id,
      dueAt: "2026-08-31T15:59:00.000Z",
      agentRunId: null,
      idempotencyKey: `prepare_${randomUUID()}`,
    },
  );

  const releaseDraft = await saveActivityDraft(
    database,
    context(teacherId),
    {
      draftId: null,
      expectedVersion: null,
      desiredStatus: "READY_FOR_PREVIEW",
      content: content("已经发布的活动"),
      agentRunId: null,
      idempotencyKey: `draft_${randomUUID()}`,
    },
  );
  const releaseIntent = await preparePublishActivityIntent(
    database,
    context(teacherId),
    {
      draftId: releaseDraft.draftId,
      expectedDraftVersion: releaseDraft.version,
      classroomId: classroom.id,
      dueAt: null,
      agentRunId: null,
      idempotencyKey: `prepare_${randomUUID()}`,
    },
  );
  await decideActionIntent(database, context(teacherId), {
    actionIntentId: releaseIntent.actionIntentId,
    decision: "CONFIRM",
  });
  const release = await publishActivityRelease(
    database,
    context(teacherId),
    {
      actionIntentId: releaseIntent.actionIntentId,
      idempotencyKey: `publish_${randomUUID()}`,
    },
  );

  return {
    teacherId,
    otherTeacherId,
    studentId,
    classroom,
    foreignClassroom,
    editing,
    ready,
    foreignDraft,
    prepared,
    release,
  };
}

describeWithDatabase("teacher activity workspace queries", () => {
  beforeAll(async () => {
    fixture = await createFixture();
  });

  afterAll(async () => {
    await database?.$disconnect();
  });

  it("lists only the teacher's safe draft, release, and classroom summaries", async () => {
    const result = await getTeacherActivityDashboard(
      database!,
      context(fixture.teacherId),
      {},
    );

    expect(result.actor.displayName).toBe("林老师");
    expect(result.drafts.map((draft) => draft.id)).toEqual(
      expect.arrayContaining([
        fixture.editing.draftId,
        fixture.ready.draftId,
      ]),
    );
    expect(result.drafts.map((draft) => draft.id)).not.toContain(
      fixture.foreignDraft.draftId,
    );
    expect(result.classrooms).toEqual([
      {
        id: fixture.classroom.id,
        name: "七年一班",
        currentMemberCount: 1,
      },
    ]);
    expect(result.releases).toEqual([
      expect.objectContaining({
        id: fixture.release.releaseId,
        title: "已经发布的活动",
        classroomName: "七年一班",
        canViewSubmissions: true,
        attention: {
          pendingFeedbackCount: 0,
          pendingEvaluationCount: 0,
          awaitingResubmissionCount: 0,
        },
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("仅所有者可见的任务正文");
    expect(JSON.stringify(result)).not.toContain("其他教师秘密活动");
  });

  it("returns the exact current immutable revision and managed classrooms", async () => {
    const draft = await getTeacherActivityDraft(
      database!,
      context(fixture.teacherId),
      { draftId: fixture.editing.draftId },
    );
    expect(draft.draft.revision).toMatchObject({
      id: fixture.editing.revisionId,
      version: fixture.editing.version,
      content: { title: "观察校园用水" },
    });
    expect(draft.draft.revision.content.schemaVersion).toBe(2);
    expect(draft.draft.revision.content).toMatchObject({
      topic: "观察校园用水主题",
      mainDisciplineCode: "physics",
    });

    const preview = await getTeacherActivityPreview(
      database!,
      context(fixture.teacherId),
      { draftId: fixture.ready.draftId },
    );
    expect(preview.draft.revision.id).toBe(fixture.ready.revisionId);
    expect(preview.classrooms.map((classroom) => classroom.id)).toEqual([
      fixture.classroom.id,
    ]);
    expect(preview.classrooms.map((classroom) => classroom.id)).not.toContain(
      fixture.foreignClassroom.id,
    );
  });

  it("reconstructs the exact persisted intent confirmation without trusting a client payload", async () => {
    const result = await getTeacherPublishConfirmation(
      database!,
      context(fixture.teacherId),
      { actionIntentId: fixture.prepared.actionIntentId },
    );

    expect(result).toMatchObject({
      status: "PREPARED",
      draftId: fixture.ready.draftId,
      draftVersion: fixture.ready.version,
      classroom: { id: fixture.classroom.id, name: "七年一班" },
      dueAt: "2026-08-31T15:59:00.000Z",
      payloadHash: fixture.prepared.payloadHash,
      content: { title: "准备发布的活动" },
    });
  });

  it("returns NOT_FOUND across teachers and rejects widened query inputs", async () => {
    await expect(
      getTeacherActivityDraft(database!, context(fixture.otherTeacherId), {
        draftId: fixture.editing.draftId,
      }),
    ).rejects.toEqual(new TeacherActivityQueryError("NOT_FOUND"));
    await expect(
      getTeacherPublishConfirmation(
        database!,
        context(fixture.otherTeacherId),
        { actionIntentId: fixture.prepared.actionIntentId },
      ),
    ).rejects.toEqual(new TeacherActivityQueryError("NOT_FOUND"));
    await expect(
      getTeacherIdentity(database!, context(fixture.studentId), {}),
    ).rejects.toEqual(new TeacherActivityQueryError("NOT_FOUND"));
    await expect(
      getTeacherActivityDashboard(database!, context(fixture.teacherId), {
        actorId: fixture.otherTeacherId,
      }),
    ).rejects.toMatchObject({ name: "ZodError" });
  });
});
