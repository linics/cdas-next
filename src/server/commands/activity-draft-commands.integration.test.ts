import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  v3ProjectionColumns,
  type ActivityContentV2,
} from "../../domain/activity/activity-content";
import { waterConservationTaskBookV3 } from "../../fixtures/water-conservation-v3";
import {
  waterConservationActivity,
  waterConservationTaskBook,
} from "../../fixtures/water-conservation";
import { createPublishedActivity } from "../../test/fixtures/published-activity";
import { createDatabaseClient } from "../db/client";
import type { CommandContext, CommandSource } from "./command-context";
import {
  preparePublishActivityIntent,
  PreparePublishActivityIntentError,
} from "./prepare-publish-activity-intent";
import {
  saveActivityDraft,
  SaveActivityDraftError,
} from "./save-activity-draft";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabaseClient(databaseUrl) : null;

const now = new Date("2026-08-18T12:00:00.000Z");

function commandContext(
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

function content(overrides?: Partial<ActivityContentV2>): ActivityContentV2 {
  return {
    ...waterConservationTaskBook,
    title: "校园节水行动",
    summary: "用观察数据形成校园节水建议",
    taskInstructions: "记录两次水表读数，并解释变化。",
    ...overrides,
  };
}

function storedContent(value: ActivityContentV2 = content()) {
  return {
    schemaVersion: 2,
    taskBook: value,
    title: value.title,
    summary: value.summary,
    learningObjectives: value.learningObjectives,
    taskInstructions: value.taskInstructions,
    evidenceRequirements: value.evidenceRequirements,
    feedbackCriteria: value.feedbackCriteria,
  };
}

async function createActors() {
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
        displayName: "草稿测试教师",
      },
      {
        id: otherTeacherId,
        authSubject: `teacher_${otherTeacherId}`,
        role: "TEACHER",
        displayName: "其他教师",
      },
      {
        id: studentId,
        authSubject: `student_${studentId}`,
        role: "STUDENT",
        displayName: "测试学生",
      },
    ],
  });
  return { teacherId, otherTeacherId, studentId };
}

async function createTerminalAgentRun(
  actorId: string,
  status: "FAILED" | "CANCELLED",
  failureCode: string,
) {
  if (!database) {
    throw new Error("TEST_DATABASE_URL is required");
  }
  const running = await database.agentRun.create({
    data: { actorId, status: "RUNNING", model: "test", startedAt: now },
  });
  return database.agentRun.update({
    where: { id: running.id },
    data: { status, completedAt: now, failureCode },
  });
}

async function createClassroom(managerId: string) {
  if (!database) {
    throw new Error("TEST_DATABASE_URL is required");
  }
  return database.classroom.create({
    data: { name: `草稿测试班级_${randomUUID()}`, managerId },
  });
}

async function saveNewDraft(
  actorId: string,
  options?: {
    desiredStatus?: "EDITING" | "READY_FOR_PREVIEW";
    source?: CommandSource;
    agentRunId?: string | null;
    value?: ActivityContentV2;
    idempotencyKey?: string;
  },
) {
  return saveActivityDraft(
    database!,
    commandContext(actorId, options?.source),
    {
      draftId: null,
      expectedVersion: null,
      desiredStatus: options?.desiredStatus ?? "EDITING",
      content: options?.value ?? content(),
      agentRunId: options?.agentRunId ?? null,
      idempotencyKey: options?.idempotencyKey ?? `draft_${randomUUID()}`,
    },
  );
}

describeWithDatabase("activity draft write commands", () => {
  afterAll(async () => {
    await database?.$disconnect();
  });

  it("keeps schema v1 read-only for all new business writes", async () => {
    const { teacherId } = await createActors();

    await expect(
      saveActivityDraft(database!, commandContext(teacherId), {
        draftId: null,
        expectedVersion: null,
        desiredStatus: "EDITING",
        content: waterConservationActivity,
        agentRunId: null,
        idempotencyKey: `legacy_draft_${randomUUID()}`,
      }),
    ).rejects.toEqual(new SaveActivityDraftError("LEGACY_SCHEMA_READ_ONLY"));
  });

  it("creates, normalizes, versions, and marks a manual draft ready", async () => {
    const { teacherId } = await createActors();
    const created = await saveNewDraft(teacherId, {
      value: content({
        title: "  校园节水行动  ",
        learningObjectives: ["  使用数据支持结论  "],
      }),
    });

    expect(created).toMatchObject({ version: 1, status: "EDITING" });
    const ready = await saveActivityDraft(database!, commandContext(teacherId), {
      draftId: created.draftId,
      expectedVersion: 1,
      desiredStatus: "READY_FOR_PREVIEW",
      content: content({ summary: "补充了观察周期与测量方法" }),
      agentRunId: null,
      idempotencyKey: `draft_${randomUUID()}`,
    });
    expect(ready).toMatchObject({
      draftId: created.draftId,
      version: 2,
      status: "READY_FOR_PREVIEW",
    });

    const draft = await database!.activityDraft.findUniqueOrThrow({
      where: { id: created.draftId },
      include: { revisions: { orderBy: { version: "asc" } } },
    });
    expect(draft.title).toBe("校园节水行动");
    expect(draft.summary).toBe("补充了观察周期与测量方法");
    expect(draft.revisions).toHaveLength(2);
    expect(draft.revisions.map((revision) => revision.source)).toEqual([
      "MANUAL",
      "MANUAL",
    ]);
    expect(draft.revisions[1]).toMatchObject({
      id: ready.revisionId,
      version: 2,
      summary: draft.summary,
      agentRunId: null,
    });
  });

  it("stores a v3 task book and derives its summary columns", async () => {
    const { teacherId } = await createActors();
    const created = await saveActivityDraft(database!, commandContext(teacherId), {
      draftId: null,
      expectedVersion: null,
      desiredStatus: "EDITING",
      content: waterConservationTaskBookV3,
      agentRunId: null,
      idempotencyKey: `draft_${randomUUID()}`,
    });

    const draft = await database!.activityDraft.findUniqueOrThrow({
      where: { id: created.draftId },
      include: { revisions: true },
    });
    const projection = v3ProjectionColumns(waterConservationTaskBookV3);

    // The row only exists if the database's own re-derivation agreed with
    // ours; a v3 draft that cannot be stored is the failure this guards.
    expect(draft.schemaVersion).toBe(3);
    expect(draft.learningObjectives).toEqual(projection.learningObjectives);
    expect(draft.evidenceRequirements).toEqual(projection.evidenceRequirements);
    expect(draft.feedbackCriteria).toEqual(projection.feedbackCriteria);
    expect(draft.revisions).toHaveLength(1);
    expect(draft.revisions[0]?.schemaVersion).toBe(3);
  });

  it("rejects a v3 task book whose goals no phase serves", async () => {
    const { teacherId } = await createActors();
    const orphaned = {
      ...waterConservationTaskBookV3,
      phases: waterConservationTaskBookV3.phases.map((phase) => ({
        ...phase,
        learningGoalIds: [waterConservationTaskBookV3.learningGoals[0]!.id],
      })),
    };

    await expect(
      saveActivityDraft(database!, commandContext(teacherId), {
        draftId: null,
        expectedVersion: null,
        desiredStatus: "EDITING",
        content: orphaned,
        agentRunId: null,
        idempotencyKey: `draft_${randomUUID()}`,
      }),
    ).rejects.toThrow();
  });

  it("rechecks role, ownership, version, and sealed state", async () => {
    const { teacherId, otherTeacherId, studentId } = await createActors();
    const created = await saveNewDraft(teacherId);
    const updateInput = {
      draftId: created.draftId,
      expectedVersion: 1,
      desiredStatus: "EDITING" as const,
      content: content({ summary: "新的摘要" }),
      agentRunId: null,
      idempotencyKey: `draft_${randomUUID()}`,
    };

    await expect(
      saveActivityDraft(
        database!,
        commandContext(otherTeacherId),
        updateInput,
      ),
    ).rejects.toEqual(new SaveActivityDraftError("NOT_FOUND"));
    await expect(
      saveNewDraft(studentId),
    ).rejects.toEqual(new SaveActivityDraftError("FORBIDDEN"));

    const updated = await saveActivityDraft(
      database!,
      commandContext(teacherId),
      updateInput,
    );
    await expect(
      saveActivityDraft(database!, commandContext(teacherId), {
        ...updateInput,
        idempotencyKey: `draft_${randomUUID()}`,
      }),
    ).rejects.toEqual(new SaveActivityDraftError("STALE_VERSION"));

    await database!.activityDraft.update({
      where: { id: created.draftId },
      data: {
        status: "READY_FOR_PREVIEW",
        version: updated.version + 1,
        updatedAt: new Date(now.getTime() + 1_000),
        revisions: {
          create: {
            version: updated.version + 1,
            source: "MANUAL",
            ...storedContent(content({ summary: "新的摘要" })),
            createdAt: new Date(now.getTime() + 1_000),
          },
        },
      },
    });
    const classroom = await createClassroom(teacherId);
    await createPublishedActivity(database!, {
      teacherId,
      classroomId: classroom.id,
      publishedAt: new Date(now.getTime() + 2_000),
      dueAt: null,
      draft: {
        draftId: created.draftId,
        version: updated.version + 1,
      },
    });

    await expect(
      saveActivityDraft(database!, commandContext(teacherId), {
        ...updateInput,
        expectedVersion: updated.version + 1,
        idempotencyKey: `draft_${randomUUID()}`,
      }),
    ).rejects.toEqual(new SaveActivityDraftError("DRAFT_SEALED"));
  });

  it("replays concurrent creates and rejects key reuse with new parameters", async () => {
    const { teacherId } = await createActors();
    const idempotencyKey = `draft_${randomUUID()}`;
    const input = {
      draftId: null,
      expectedVersion: null,
      desiredStatus: "EDITING" as const,
      content: content(),
      agentRunId: null,
      idempotencyKey,
    };

    const [first, second] = await Promise.all([
      saveActivityDraft(database!, commandContext(teacherId), input),
      saveActivityDraft(database!, commandContext(teacherId), input),
    ]);
    expect(second).toEqual(first);
    expect(
      await database!.activityDraft.count({ where: { id: first.draftId } }),
    ).toBe(1);
    expect(
      await database!.activityDraftRevision.count({
        where: { draftId: first.draftId },
      }),
    ).toBe(1);

    await expect(
      saveActivityDraft(database!, commandContext(teacherId), {
        ...input,
        content: content({ title: "不同参数" }),
      }),
    ).rejects.toEqual(new SaveActivityDraftError("IDEMPOTENCY_MISMATCH"));
    await expect(
      saveActivityDraft(
        database!,
        commandContext(teacherId, "AGENT"),
        input,
      ),
    ).rejects.toEqual(new SaveActivityDraftError("IDEMPOTENCY_MISMATCH"));

    const concurrentUpdates = await Promise.allSettled([
      saveActivityDraft(database!, commandContext(teacherId), {
        draftId: first.draftId,
        expectedVersion: 1,
        desiredStatus: "EDITING",
        content: content({ summary: "并发版本 A" }),
        agentRunId: null,
        idempotencyKey: `draft_${randomUUID()}`,
      }),
      saveActivityDraft(database!, commandContext(teacherId), {
        draftId: first.draftId,
        expectedVersion: 1,
        desiredStatus: "EDITING",
        content: content({ summary: "并发版本 B" }),
        agentRunId: null,
        idempotencyKey: `draft_${randomUUID()}`,
      }),
    ]);
    expect(
      concurrentUpdates.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      await database!.activityDraftRevision.count({
        where: { draftId: first.draftId },
      }),
    ).toBe(2);
  });

  it("binds Agent revisions to a valid run owned by the human actor", async () => {
    const { teacherId, otherTeacherId } = await createActors();
    const [running, secondRunning, failed, cancelled, foreign] = await Promise.all([
      database!.agentRun.create({
        data: {
          actorId: teacherId,
          status: "RUNNING",
          model: "test",
          startedAt: now,
        },
      }),
      database!.agentRun.create({
        data: {
          actorId: teacherId,
          status: "RUNNING",
          model: "test",
          startedAt: now,
        },
      }),
      createTerminalAgentRun(teacherId, "FAILED", "TEST_FAILED"),
      createTerminalAgentRun(teacherId, "CANCELLED", "TEST_CANCELLED"),
      database!.agentRun.create({
        data: {
          actorId: otherTeacherId,
          status: "RUNNING",
          model: "test",
          startedAt: now,
        },
      }),
    ]);

    const created = await saveNewDraft(teacherId, {
      source: "AGENT",
      agentRunId: running.id,
    });
    expect(
      await database!.agentRun.findUniqueOrThrow({
        where: { id: running.id },
        select: { status: true, completedAt: true, failureCode: true },
      }),
    ).toEqual({
      status: "SUCCEEDED",
      completedAt: now,
      failureCode: null,
    });
    const updated = await saveActivityDraft(
      database!,
      commandContext(teacherId, "AGENT"),
      {
        draftId: created.draftId,
        expectedVersion: 1,
        desiredStatus: "READY_FOR_PREVIEW",
        content: content({ summary: "Agent 补充了观察方法" }),
        agentRunId: secondRunning.id,
        idempotencyKey: `draft_${randomUUID()}`,
      },
    );
    expect(updated.version).toBe(2);

    const revisions = await database!.activityDraftRevision.findMany({
      where: { draftId: created.draftId },
      orderBy: { version: "asc" },
    });
    expect(revisions.map(({ source, agentRunId }) => ({ source, agentRunId }))).toEqual([
      { source: "AGENT", agentRunId: running.id },
      { source: "AGENT", agentRunId: secondRunning.id },
    ]);
    const audits = await database!.actionAudit.findMany({
      where: {
        actionName: "save_activity_draft",
        targetId: created.draftId,
        outcome: "SUCCEEDED",
      },
      orderBy: { afterVersion: "asc" },
    });
    expect(
      audits.map(({ source, agentRunId }) => ({ source, agentRunId })),
    ).toEqual([
      { source: "AGENT", agentRunId: running.id },
      { source: "AGENT", agentRunId: secondRunning.id },
    ]);

    for (const invalid of [
      { source: "AGENT" as const, agentRunId: null },
      { source: "AGENT" as const, agentRunId: running.id },
      { source: "AGENT" as const, agentRunId: failed.id },
      { source: "AGENT" as const, agentRunId: cancelled.id },
      { source: "AGENT" as const, agentRunId: foreign.id },
      { source: "UI" as const, agentRunId: running.id },
    ]) {
      await expect(
        saveNewDraft(teacherId, invalid),
      ).rejects.toEqual(new SaveActivityDraftError("INVALID_AGENT_RUN"));
    }
  });

  it("prepares one exact expiring intent without publishing", async () => {
    const { teacherId } = await createActors();
    const classroom = await createClassroom(teacherId);
    const draft = await saveNewDraft(teacherId, {
      desiredStatus: "READY_FOR_PREVIEW",
    });
    const idempotencyKey = `prepare_${randomUUID()}`;
    const input = {
      draftId: draft.draftId,
      expectedDraftVersion: 1,
      classroomId: classroom.id,
      dueAt: "2026-08-31T23:59:59.000+08:00",
      agentRunId: null,
      idempotencyKey,
    };

    const [prepared, replayed] = await Promise.all([
      preparePublishActivityIntent(
        database!,
        commandContext(teacherId),
        input,
      ),
      preparePublishActivityIntent(
        database!,
        commandContext(teacherId),
        input,
      ),
    ]);
    expect(replayed).toEqual(prepared);
    expect(prepared.expiresAt).toBe("2026-08-18T12:10:00.000Z");

    const intent = await database!.actionIntent.findUniqueOrThrow({
      where: { id: prepared.actionIntentId },
    });
    expect(intent).toMatchObject({
      actorId: teacherId,
      agentRunId: null,
      actionName: "publish_activity_release",
      targetType: "ActivityDraft",
      targetId: draft.draftId,
      expectedVersion: 1,
      status: "PREPARED",
      payloadHash: prepared.payloadHash,
    });
    expect(intent.payload).toEqual({
      draftId: draft.draftId,
      expectedDraftVersion: 1,
      classroomId: classroom.id,
      dueAt: input.dueAt,
    });
    expect(
      await database!.activityRelease.count({
        where: { sourceDraftId: draft.draftId },
      }),
    ).toBe(0);
    expect(
      (
        await database!.activityDraft.findUniqueOrThrow({
          where: { id: draft.draftId },
        })
      ).status,
    ).toBe("READY_FOR_PREVIEW");

    await expect(
      preparePublishActivityIntent(database!, commandContext(teacherId), {
        ...input,
        dueAt: null,
      }),
    ).rejects.toEqual(
      new PreparePublishActivityIntentError("IDEMPOTENCY_MISMATCH"),
    );
    await expect(
      preparePublishActivityIntent(
        database!,
        commandContext(teacherId, "AGENT"),
        input,
      ),
    ).rejects.toEqual(
      new PreparePublishActivityIntentError("IDEMPOTENCY_MISMATCH"),
    );
  });

  it("revalidates publish ownership, readiness, version, due date, and Agent provenance", async () => {
    const { teacherId, otherTeacherId, studentId } = await createActors();
    const [classroom, otherClassroom] = await Promise.all([
      createClassroom(teacherId),
      createClassroom(otherTeacherId),
    ]);
    const editing = await saveNewDraft(teacherId);
    const ready = await saveNewDraft(teacherId, {
      desiredStatus: "READY_FOR_PREVIEW",
    });
    const [run, cancelledRun, foreignRun] = await Promise.all([
      database!.agentRun.create({
        data: {
          actorId: teacherId,
          status: "RUNNING",
          model: "test",
          startedAt: now,
        },
      }),
      createTerminalAgentRun(teacherId, "CANCELLED", "TEST_CANCELLED"),
      database!.agentRun.create({
        data: {
          actorId: otherTeacherId,
          status: "RUNNING",
          model: "test",
          startedAt: now,
        },
      }),
    ]);
    const base = {
      draftId: ready.draftId,
      expectedDraftVersion: 1,
      classroomId: classroom.id,
      dueAt: null,
      agentRunId: null,
      idempotencyKey: `prepare_${randomUUID()}`,
    };

    await expect(
      preparePublishActivityIntent(database!, commandContext(teacherId), {
        ...base,
        draftId: editing.draftId,
      }),
    ).rejects.toEqual(
      new PreparePublishActivityIntentError("DRAFT_NOT_READY"),
    );
    await expect(
      preparePublishActivityIntent(database!, commandContext(teacherId), {
        ...base,
        expectedDraftVersion: 2,
      }),
    ).rejects.toEqual(new PreparePublishActivityIntentError("STALE_VERSION"));
    await expect(
      preparePublishActivityIntent(database!, commandContext(teacherId), {
        ...base,
        classroomId: otherClassroom.id,
      }),
    ).rejects.toEqual(new PreparePublishActivityIntentError("NOT_FOUND"));
    await expect(
      preparePublishActivityIntent(database!, commandContext(otherTeacherId), {
        ...base,
      }),
    ).rejects.toEqual(new PreparePublishActivityIntentError("NOT_FOUND"));
    await expect(
      preparePublishActivityIntent(database!, commandContext(studentId), {
        ...base,
      }),
    ).rejects.toEqual(new PreparePublishActivityIntentError("FORBIDDEN"));
    await expect(
      preparePublishActivityIntent(database!, commandContext(teacherId), {
        ...base,
        dueAt: "2026-08-18T11:59:59.000Z",
      }),
    ).rejects.toEqual(
      new PreparePublishActivityIntentError("DUE_DATE_EXPIRED"),
    );
    await expect(
      preparePublishActivityIntent(
        database!,
        commandContext(teacherId, "AGENT"),
        base,
      ),
    ).rejects.toEqual(
      new PreparePublishActivityIntentError("INVALID_AGENT_RUN"),
    );
    for (const invalid of [
      { source: "AGENT" as const, agentRunId: cancelledRun.id },
      { source: "AGENT" as const, agentRunId: foreignRun.id },
      { source: "UI" as const, agentRunId: run.id },
    ]) {
      await expect(
        preparePublishActivityIntent(
          database!,
          commandContext(teacherId, invalid.source),
          {
            ...base,
            agentRunId: invalid.agentRunId,
            idempotencyKey: `prepare_${randomUUID()}`,
          },
        ),
      ).rejects.toEqual(
        new PreparePublishActivityIntentError("INVALID_AGENT_RUN"),
      );
    }

    const agentPrepared = await preparePublishActivityIntent(
      database!,
      commandContext(teacherId, "AGENT"),
      {
        ...base,
        agentRunId: run.id,
        idempotencyKey: `prepare_${randomUUID()}`,
      },
    );
    expect(
      (
        await database!.actionIntent.findUniqueOrThrow({
          where: { id: agentPrepared.actionIntentId },
        })
      ).agentRunId,
    ).toBe(run.id);
    expect(
      await database!.actionAudit.findFirst({
        where: {
          actionIntentId: agentPrepared.actionIntentId,
          source: "AGENT",
          agentRunId: run.id,
          outcome: "SUCCEEDED",
        },
      }),
    ).not.toBeNull();
  });

  it("rejects client authority fields and widened nested content", async () => {
    const { teacherId } = await createActors();
    await expect(
      saveActivityDraft(database!, commandContext(teacherId), {
        draftId: null,
        expectedVersion: null,
        desiredStatus: "EDITING",
        content: { ...content(), hiddenAuthority: true },
        agentRunId: null,
        idempotencyKey: `draft_${randomUUID()}`,
        actorId: randomUUID(),
        source: "AGENT",
        now: new Date(0),
      } as never),
    ).rejects.toMatchObject({ name: "ZodError" });

    const classroom = await createClassroom(teacherId);
    const ready = await saveNewDraft(teacherId, {
      desiredStatus: "READY_FOR_PREVIEW",
    });
    await expect(
      preparePublishActivityIntent(database!, commandContext(teacherId), {
        draftId: ready.draftId,
        expectedDraftVersion: 1,
        classroomId: classroom.id,
        dueAt: null,
        agentRunId: null,
        idempotencyKey: `prepare_${randomUUID()}`,
        actorId: randomUUID(),
        source: "AGENT",
        now: new Date(0),
      } as never),
    ).rejects.toMatchObject({ name: "ZodError" });

    await expect(
      saveActivityDraft(database!, commandContext(teacherId), {
        draftId: null,
        expectedVersion: null,
        desiredStatus: "EDITING",
        content: { ...content(), hiddenAuthority: true },
        agentRunId: null,
        idempotencyKey: `draft_${randomUUID()}`,
      } as never),
    ).rejects.toMatchObject({ name: "ZodError" });
  });

  it("blocks direct head/revision bypasses while allowing an unchanged publish seal", async () => {
    const { teacherId, otherTeacherId } = await createActors();
    const draft = await saveNewDraft(teacherId, {
      desiredStatus: "READY_FOR_PREVIEW",
    });

    await expect(
      database!.$transaction(async (transaction) => {
        const bypassContent = content({ summary: "没有对应 Revision 的改写" });
        await transaction.activityDraft.update({
          where: { id: draft.draftId },
          data: {
            version: 2,
            ...storedContent(bypassContent),
            updatedAt: new Date(now.getTime() + 1_000),
          },
        });
      }),
    ).rejects.toThrow(/inconsistent revision sequence/);

    await expect(
      database!.$transaction(async (transaction) => {
        const headContent = content({ summary: "头行正文" });
        await transaction.activityDraft.update({
          where: { id: draft.draftId },
          data: {
            version: 2,
            ...storedContent(headContent),
            updatedAt: new Date(now.getTime() + 1_000),
          },
        });
        await transaction.activityDraftRevision.create({
          data: {
            draftId: draft.draftId,
            version: 2,
            source: "MANUAL",
            ...storedContent(content({ summary: "不同的修订正文" })),
            createdAt: new Date(now.getTime() + 1_000),
          },
        });
      }),
    ).rejects.toThrow(/does not match its current revision/);

    const foreignRun = await database!.agentRun.create({
      data: {
        actorId: otherTeacherId,
        status: "RUNNING",
        model: "test",
        startedAt: now,
      },
    });
    await expect(
      database!.activityDraftRevision.create({
        data: {
          draftId: draft.draftId,
          version: 2,
          source: "AGENT",
          ...storedContent(),
          agentRunId: foreignRun.id,
          createdAt: new Date(now.getTime() + 1_000),
        },
      }),
    ).rejects.toThrow(/agent revision requires .* run owned by the draft teacher/);

    await expect(
      database!.activityDraft.create({
        data: {
          ownerId: teacherId,
          status: "SEALED",
          version: 1,
          ...storedContent(),
          sealedAt: now,
          revisions: {
            create: {
              version: 1,
              source: "MANUAL",
              ...storedContent(),
            },
          },
        },
      }),
    ).rejects.toThrow(/must start at version 1 and remain unsealed/);

    await expect(
      database!.activityDraft.update({
        where: { id: draft.draftId },
        data: {
          status: "SEALED",
          sealedAt: new Date(now.getTime() + 2_000),
          updatedAt: new Date(now.getTime() + 2_000),
        },
      }),
    ).rejects.toThrow(/sealed activity draft .* requires one activity release/);

    const classroom = await createClassroom(teacherId);
    await createPublishedActivity(database!, {
      teacherId,
      classroomId: classroom.id,
      publishedAt: new Date(now.getTime() + 2_000),
      dueAt: null,
      draft: { draftId: draft.draftId, version: draft.version },
    });
    await expect(
      database!.activityDraft.update({
        where: { id: draft.draftId },
        data: { title: "封存后不应改写" },
      }),
    ).rejects.toThrow(/sealed activity drafts cannot be changed/);
    await expect(
      database!.activityDraft.delete({ where: { id: draft.draftId } }),
    ).rejects.toThrow(/history cannot be deleted|sealed activity drafts/);
  });
});
