import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  preparePublishIntent,
  publishRequestSchema,
} from "../../domain/activity/prepare-publish-intent";
import { waterConservationActivity } from "../../fixtures/water-conservation";
import { waterConservationTaskBookV3 } from "../../fixtures/water-conservation-v3";
import {
  closePublishedActivity,
  createPublishedActivity,
} from "../../test/fixtures/published-activity";
import { createDatabaseClient } from "../db/client";
import {
  publishActivityRelease,
  PublishActivityReleaseError,
} from "./publish-activity-release";
import type { CommandContext, CommandSource } from "./command-context";

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

async function createPublishFixture(
  options: { withAgentRun?: boolean } = {},
) {
  if (!database) {
    throw new Error("TEST_DATABASE_URL is required");
  }

  const teacherId = randomUUID();
  const otherTeacherId = randomUUID();
  const classroomId = randomUUID();
  const draftId = randomUUID();
  const now = new Date("2026-08-18T12:00:00.000Z");
  const payload = {
    draftId,
    expectedDraftVersion: 7,
    classroomId,
    dueAt: "2026-08-31T23:59:59.000+08:00",
  };

  await database.appUser.createMany({
    data: [
      {
        id: teacherId,
        authSubject: `teacher_${teacherId}`,
        role: "TEACHER",
        displayName: "测试教师",
      },
      {
        id: otherTeacherId,
        authSubject: `teacher_${otherTeacherId}`,
        role: "TEACHER",
        displayName: "其他教师",
      },
    ],
  });
  await database.classroom.create({
    data: { id: classroomId, name: "七年一班", managerId: teacherId },
  });
  const agentRun = options.withAgentRun
    ? await database.agentRun.create({
        data: {
          actorId: teacherId,
          status: "RUNNING",
          model: "openai/gpt-5-mini",
          startedAt: now,
        },
      })
    : null;
  await database.activityDraft.create({
    data: {
      id: draftId,
      ownerId: teacherId,
      status: "READY_FOR_PREVIEW",
      version: 1,
      title: waterConservationActivity.title,
      summary: waterConservationActivity.summary,
      learningObjectives: waterConservationActivity.learningObjectives,
      taskInstructions: waterConservationActivity.taskInstructions,
      evidenceRequirements: waterConservationActivity.evidenceRequirements,
      feedbackCriteria: waterConservationActivity.feedbackCriteria,
      revisions: {
        create: {
          version: 1,
          source: "MANUAL",
          title: waterConservationActivity.title,
          summary: waterConservationActivity.summary,
          learningObjectives: waterConservationActivity.learningObjectives,
          taskInstructions: waterConservationActivity.taskInstructions,
          evidenceRequirements: waterConservationActivity.evidenceRequirements,
          feedbackCriteria: waterConservationActivity.feedbackCriteria,
        },
      },
    },
  });
  for (let version = 2; version <= 7; version += 1) {
    await database.activityDraft.update({
      where: { id: draftId },
      data: {
        version,
        revisions: {
          create: {
            version,
            source: "MANUAL",
            title: waterConservationActivity.title,
            summary: waterConservationActivity.summary,
            learningObjectives: waterConservationActivity.learningObjectives,
            taskInstructions: waterConservationActivity.taskInstructions,
            evidenceRequirements: waterConservationActivity.evidenceRequirements,
            feedbackCriteria: waterConservationActivity.feedbackCriteria,
          },
        },
      },
    });
  }

  const prepared = preparePublishIntent(payload, {
    actor: { id: teacherId, role: "TEACHER" },
    draft: {
      id: draftId,
      ownerId: teacherId,
      version: 7,
      status: "READY_FOR_PREVIEW",
    },
    classroom: { id: classroomId, managerId: teacherId },
    now,
  });

  await database.actionIntent.create({
    data: {
      id: prepared.id,
      actorId: teacherId,
      agentRunId: agentRun?.id,
      actionName: prepared.actionName,
      payload: prepared.payload,
      payloadHash: prepared.payloadHash,
      targetType: "ActivityDraft",
      targetId: draftId,
      expectedVersion: 7,
      expiresAt: prepared.expiresAt,
      createdAt: now,
    },
  });
  await database.actionIntent.update({
    where: { id: prepared.id },
    data: {
      status: "CONFIRMED",
      decidedById: teacherId,
      decidedAt: now,
    },
  });

  return {
    teacherId,
    otherTeacherId,
    classroomId,
    draftId,
    intentId: prepared.id,
    agentRunId: agentRun?.id ?? null,
    now,
  };
}

describeWithDatabase("publishActivityRelease database command", () => {
  afterAll(async () => {
    await database?.$disconnect();
  });

  it("publishes the exact v3 revision and keeps sequential execution", async () => {
    if (!database) throw new Error("TEST_DATABASE_URL is required");
    const teacherId = randomUUID();
    const classroomId = randomUUID();
    const publishedAt = new Date("2026-09-01T08:00:00.000Z");
    await database.appUser.create({
      data: {
        id: teacherId,
        authSubject: `teacher_${teacherId}`,
        role: "TEACHER",
        displayName: "v3 发布教师",
      },
    });
    await database.classroom.create({
      data: { id: classroomId, name: "v3 测试班", managerId: teacherId },
    });
    const content = {
      ...waterConservationTaskBookV3,
      submissionMode: "phased" as const,
    };
    const published = await createPublishedActivity(database, {
      teacherId,
      classroomId,
      publishedAt,
      content,
    });
    const release = await database.activityRelease.findUniqueOrThrow({
      where: { id: published.releaseId },
      include: { snapshot: true },
    });
    const revision = await database.activityDraftRevision.findUniqueOrThrow({
      where: {
        draftId_version: {
          draftId: published.draftId,
          version: published.draftVersion,
        },
      },
    });

    expect(release.executionVersion).toBe(1);
    if (!release.snapshot) throw new Error("Published release requires a snapshot");
    expect(release.snapshot.schemaVersion).toBe(3);
    expect(release.snapshot.content).toEqual(content);
    expect(release.snapshot.content).toEqual(revision.taskBook);
    expect(release.snapshot.contentHash).toBe(published.snapshotHash);
  });

  it("rejects another teacher, then publishes once and safely replays", async () => {
    const fixture = await createPublishFixture();
    const idempotencyKey = `publish_${randomUUID()}`;

    await expect(
      publishActivityRelease(database!, {
        actorId: fixture.otherTeacherId,
        source: "UI",
        traceId: randomUUID(),
        clock: () => fixture.now,
      }, {
        actionIntentId: fixture.intentId,
        idempotencyKey,
      }),
    ).rejects.toEqual(new PublishActivityReleaseError("FORBIDDEN"));

    const input = {
      actionIntentId: fixture.intentId,
      idempotencyKey,
    };
    const published = await publishActivityRelease(
      database!,
      commandContext(fixture.teacherId, fixture.now),
      input,
    );
    const replayed = await publishActivityRelease(
      database!,
      commandContext(fixture.teacherId, fixture.now),
      input,
    );

    expect(replayed).toEqual(published);
    expect(
      await database!.activityRelease.count({
        where: { sourceDraftId: fixture.draftId },
      }),
    ).toBe(1);

    const draft = await database!.activityDraft.findUniqueOrThrow({
      where: { id: fixture.draftId },
    });
    const snapshot = await database!.activityReleaseSnapshot.findUniqueOrThrow({
      where: { releaseId: published.releaseId },
    });
    const release = await database!.activityRelease.findUniqueOrThrow({
      where: { id: published.releaseId },
      select: { actionIntentId: true },
    });
    expect(draft.status).toBe("SEALED");
    expect(release.actionIntentId).toBe(fixture.intentId);
    expect(snapshot.contentHash).toBe(published.snapshotHash);
    expect(snapshot.sourceDraftVersion).toBe(7);

    const audits = await database!.actionAudit.findMany({
      where: { actionIntentId: fixture.intentId },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((audit) => audit.outcome)).toEqual([
      "DENIED",
      "SUCCEEDED",
    ]);

    const originalIntent = await database!.actionIntent.findUniqueOrThrow({
      where: { id: fixture.intentId },
    });
    const secondIntentId = randomUUID();
    await database!.actionIntent.create({
      data: {
        id: secondIntentId,
        actorId: fixture.teacherId,
        actionName: originalIntent.actionName,
        payload: publishRequestSchema.parse(originalIntent.payload),
        payloadHash: originalIntent.payloadHash,
        targetType: originalIntent.targetType,
        targetId: originalIntent.targetId,
        expectedVersion: originalIntent.expectedVersion,
        expiresAt: originalIntent.expiresAt,
        createdAt: fixture.now,
      },
    });
    await database!.actionIntent.update({
      where: { id: secondIntentId },
      data: {
        status: "CONFIRMED",
        decidedById: fixture.teacherId,
        decidedAt: fixture.now,
      },
    });

    await expect(
      publishActivityRelease(
        database!,
        commandContext(fixture.teacherId, fixture.now),
        { ...input, actionIntentId: secondIntentId },
      ),
    ).rejects.toEqual(
      new PublishActivityReleaseError("IDEMPOTENCY_MISMATCH"),
    );
  });

  it("atomically commits an Agent publish and its successful run provenance", async () => {
    const fixture = await createPublishFixture({ withAgentRun: true });
    if (!fixture.agentRunId) {
      throw new Error("Expected an AgentRun fixture");
    }
    const idempotencyKey = `publish_${randomUUID()}`;
    const input = {
      actionIntentId: fixture.intentId,
      idempotencyKey,
    };

    const published = await publishActivityRelease(
      database!,
      commandContext(fixture.teacherId, fixture.now, "AGENT"),
      input,
    );

    expect(
      await database!.agentRun.findUniqueOrThrow({
        where: { id: fixture.agentRunId },
        select: { status: true, completedAt: true, failureCode: true },
      }),
    ).toEqual({
      status: "SUCCEEDED",
      completedAt: fixture.now,
      failureCode: null,
    });
    expect(
      await database!.actionAudit.findFirst({
        where: {
          actionName: "publish_activity_release",
          resultResourceId: published.releaseId,
          source: "AGENT",
          agentRunId: fixture.agentRunId,
          outcome: "SUCCEEDED",
        },
      }),
    ).not.toBeNull();

    await expect(
      publishActivityRelease(
        database!,
        commandContext(fixture.teacherId, fixture.now, "UI"),
        input,
      ),
    ).rejects.toEqual(
      new PublishActivityReleaseError("IDEMPOTENCY_MISMATCH"),
    );
    expect(
      await database!.activityRelease.count({
        where: { sourceDraftId: fixture.draftId },
      }),
    ).toBe(1);
  });

  it("rolls back an Agent publish when its run was cancelled first", async () => {
    const fixture = await createPublishFixture({ withAgentRun: true });
    if (!fixture.agentRunId) {
      throw new Error("Expected an AgentRun fixture");
    }
    await database!.agentRun.update({
      where: { id: fixture.agentRunId },
      data: {
        status: "CANCELLED",
        completedAt: fixture.now,
        failureCode: "REQUEST_ABORTED",
      },
    });

    await expect(
      publishActivityRelease(
        database!,
        commandContext(fixture.teacherId, fixture.now, "AGENT"),
        {
          actionIntentId: fixture.intentId,
          idempotencyKey: `publish_${randomUUID()}`,
        },
      ),
    ).rejects.toEqual(new PublishActivityReleaseError("INVALID_AGENT_RUN"));
    expect(
      await database!.activityRelease.count({
        where: { sourceDraftId: fixture.draftId },
      }),
    ).toBe(0);
    expect(
      (
        await database!.actionIntent.findUniqueOrThrow({
          where: { id: fixture.intentId },
          select: { status: true },
        })
      ).status,
    ).toBe("CONFIRMED");
  });

  it("returns the same release for concurrent retries", async () => {
    const fixture = await createPublishFixture({ withAgentRun: true });
    const input = {
      actionIntentId: fixture.intentId,
      idempotencyKey: `publish_${randomUUID()}`,
    };

    const [first, second] = await Promise.all([
      publishActivityRelease(
        database!,
        commandContext(fixture.teacherId, fixture.now, "AGENT"),
        input,
      ),
      publishActivityRelease(
        database!,
        commandContext(fixture.teacherId, fixture.now, "AGENT"),
        input,
      ),
    ]);

    expect(second).toEqual(first);
    expect(
      await database!.activityRelease.count({
        where: { sourceDraftId: fixture.draftId },
      }),
    ).toBe(1);
  });

  it("freezes the full parameter set after preparation", async () => {
    const fixture = await createPublishFixture();
    const intent = await database!.actionIntent.findUniqueOrThrow({
      where: { id: fixture.intentId },
    });
    const payload = intent.payload as {
      draftId: string;
      expectedDraftVersion: number;
      classroomId: string;
      dueAt: string | null;
    };

    await expect(
      database!.actionIntent.update({
        where: { id: fixture.intentId },
        data: {
          payload: {
            ...payload,
            draftId: randomUUID(),
            expectedDraftVersion: 8,
          },
          payloadHash: "b".repeat(64),
          targetId: randomUUID(),
          expectedVersion: 8,
        },
      }),
    ).rejects.toThrow(/immutable/);

    const published = await publishActivityRelease(
      database!,
      commandContext(fixture.teacherId, fixture.now),
      {
        actionIntentId: fixture.intentId,
        idempotencyKey: `publish_${randomUUID()}`,
      },
    );

    expect(
      await database!.activityRelease.count({
        where: { sourceDraftId: fixture.draftId },
      }),
    ).toBe(1);
    expect(
      (
        await database!.actionIntent.findUniqueOrThrow({
          where: { id: fixture.intentId },
        })
      ).status,
    ).toBe("EXECUTED");
    expect(published.releaseId).toBeTypeOf("string");
  });

  it("requires a matching snapshot and keeps release history forward-only", async () => {
    const fixture = await createPublishFixture();

    await expect(
      database!.$transaction(async (transaction) => {
        await transaction.actionIntent.update({
          where: { id: fixture.intentId },
          data: { status: "EXECUTED", executedAt: fixture.now },
        });
        await transaction.activityDraft.update({
          where: { id: fixture.draftId },
          data: { status: "SEALED", sealedAt: fixture.now },
        });
        await transaction.activityRelease.create({
          data: {
            sourceDraftId: fixture.draftId,
            publisherId: fixture.teacherId,
            classroomId: fixture.classroomId,
            actionIntentId: fixture.intentId,
            publishedAt: fixture.now,
            dueAt: new Date("2026-08-31T23:59:59.000+08:00"),
          },
        });
      }),
    ).rejects.toThrow(/requires (an intent, sealed draft, and snapshot|its immutable source facts)/);

    const otherDraftId = randomUUID();
    await database!.activityDraft.create({
      data: {
        id: otherDraftId,
        ownerId: fixture.teacherId,
        status: "READY_FOR_PREVIEW",
        version: 1,
        title: "另一份草稿",
        summary: "用于验证发布快照的来源一致性",
        learningObjectives: ["验证边界"],
        taskInstructions: "提交证据",
        evidenceRequirements: ["文本"],
        feedbackCriteria: ["清楚"],
        revisions: {
          create: {
            version: 1,
            source: "MANUAL",
            title: "另一份草稿",
            summary: "用于验证发布快照的来源一致性",
            learningObjectives: ["验证边界"],
            taskInstructions: "提交证据",
            evidenceRequirements: ["文本"],
            feedbackCriteria: ["清楚"],
          },
        },
      },
    });

    await expect(
      database!.$transaction(async (transaction) => {
        const release = await transaction.activityRelease.create({
          data: {
            sourceDraftId: fixture.draftId,
            publisherId: fixture.teacherId,
            classroomId: fixture.classroomId,
            actionIntentId: fixture.intentId,
            publishedAt: fixture.now,
            dueAt: new Date("2026-08-19T12:00:00.000Z"),
          },
        });
        await transaction.activityReleaseSnapshot.create({
          data: {
            releaseId: release.id,
            sourceDraftId: otherDraftId,
            sourceDraftVersion: 1,
            content: { schemaVersion: 1 },
            contentHash: "c".repeat(64),
          },
        });
      }),
    ).rejects.toThrow();

    const published = await publishActivityRelease(
      database!,
      commandContext(fixture.teacherId, fixture.now),
      {
        actionIntentId: fixture.intentId,
        idempotencyKey: `publish_${randomUUID()}`,
      },
    );

    await expect(
      database!.activityRelease.update({
        where: { id: published.releaseId },
        data: { publishedAt: new Date("2026-08-18T12:01:00.000Z") },
      }),
    ).rejects.toThrow(/immutable/);

    const closed = await closePublishedActivity(database!, {
      teacherId: fixture.teacherId,
      releaseId: published.releaseId,
      closedAt: new Date("2026-08-18T12:30:00.000Z"),
    });
    expect(closed.status).toBe("CLOSED");

    await expect(
      database!.activityRelease.update({
        where: { id: published.releaseId },
        data: { status: "ACTIVE", closedAt: null },
      }),
    ).rejects.toThrow(/invalid activity release status transition/);

    await expect(
      database!.actionIntent.update({
        where: { id: fixture.intentId },
        data: {
          status: "PREPARED",
          decidedById: null,
          decidedAt: null,
          executedAt: null,
        },
      }),
    ).rejects.toThrow(/invalid action intent status transition/);
  });
});
