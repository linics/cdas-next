import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { legacySchoolId } from "../../domain/school/legacy-school";
import { createPublishedActivity } from "../../test/fixtures/published-activity";
import {
  createCloseReleasePayload,
  hashCloseReleasePayload,
} from "../../domain/activity/close-release-intent";
import { waterConservationActivity } from "../../fixtures/water-conservation";
import { createDatabaseClient } from "../db/client";
import {
  closeActivityRelease,
  CloseActivityReleaseError,
} from "./close-activity-release";
import type { CommandContext, CommandSource } from "./command-context";
import { decideActionIntent } from "./decide-action-intent";
import {
  prepareCloseActivityIntent,
  PrepareCloseActivityIntentError,
} from "./prepare-close-activity-intent";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabaseClient(databaseUrl) : null;
const legacyUser = { schoolId: legacySchoolId, legacyProfile: true } as const;

function commandContext(
  actorId: string,
  now: Date,
  source: CommandSource = "UI",
): CommandContext {
  return { actorId, source, traceId: randomUUID(), clock: () => now };
}

async function createCloseFixture() {
  if (!database) {
    throw new Error("TEST_DATABASE_URL is required");
  }

  const teacherId = randomUUID();
  const otherTeacherId = randomUUID();
  const studentId = randomUUID();
  const classroomId = randomUUID();
  const publishedAt = new Date("2026-08-20T08:00:00.000Z");
  const now = new Date("2026-08-20T09:00:00.000Z");
  const dueAt = new Date("2026-08-31T16:00:00.000Z");

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
        displayName: "测试学生",
        ...legacyUser,
      },
    ],
  });
  await database.classroom.create({
    data: {
      id: classroomId,
      name: "八年二班",
      managerId: teacherId,
      schoolId: legacySchoolId,
    },
  });
  const release = await createPublishedActivity(database, {
    teacherId,
    classroomId,
    publishedAt,
    dueAt,
    content: waterConservationActivity,
  });

  return {
    teacherId,
    otherTeacherId,
    studentId,
    classroomId,
    releaseId: release.releaseId,
    now,
    publishedAt,
    dueAt,
  };
}

async function prepareAndDecide(
  fixture: Awaited<ReturnType<typeof createCloseFixture>>,
  decision: "CONFIRM" | "REJECT" = "CONFIRM",
) {
  const prepared = await prepareCloseActivityIntent(
    database!,
    commandContext(fixture.teacherId, fixture.now),
    {
      releaseId: fixture.releaseId,
      expectedStatus: "ACTIVE",
      idempotencyKey: `prepare_close_${randomUUID()}`,
    },
  );
  await decideActionIntent(
    database!,
    commandContext(fixture.teacherId, fixture.now),
    { actionIntentId: prepared.actionIntentId, decision },
  );
  return prepared;
}

describeWithDatabase("close activity release commands", () => {
  afterAll(async () => {
    await database?.$disconnect();
  });

  it("prepares an exact UI intent and rejects unauthorized or widened calls", async () => {
    const fixture = await createCloseFixture();
    const input = {
      releaseId: fixture.releaseId,
      expectedStatus: "ACTIVE" as const,
      idempotencyKey: `prepare_close_${randomUUID()}`,
    };

    const prepared = await prepareCloseActivityIntent(
      database!,
      commandContext(fixture.teacherId, fixture.now),
      input,
    );
    const replayed = await prepareCloseActivityIntent(
      database!,
      commandContext(fixture.teacherId, fixture.now),
      input,
    );
    expect(replayed).toEqual(prepared);
    expect(prepared).toMatchObject({
      releaseId: fixture.releaseId,
      classroomName: "八年二班",
    });
    await expect(
      prepareCloseActivityIntent(
        database!,
        commandContext(fixture.teacherId, fixture.now),
        { ...input, releaseId: randomUUID() },
      ),
    ).rejects.toEqual(
      new PrepareCloseActivityIntentError("IDEMPOTENCY_MISMATCH"),
    );
    expect(
      await database!.actionIntent.findUniqueOrThrow({
        where: { id: prepared.actionIntentId },
        select: {
          actionName: true,
          payload: true,
          payloadHash: true,
          targetType: true,
          targetId: true,
          expectedVersion: true,
          agentRunId: true,
        },
      }),
    ).toEqual({
      actionName: "close_activity_release",
      payload: createCloseReleasePayload({
        releaseId: fixture.releaseId,
        expectedStatus: "ACTIVE",
      }),
      payloadHash: prepared.payloadHash,
      targetType: "ActivityRelease",
      targetId: fixture.releaseId,
      expectedVersion: null,
      agentRunId: null,
    });

    await expect(
      prepareCloseActivityIntent(
        database!,
        commandContext(fixture.otherTeacherId, fixture.now),
        { ...input, idempotencyKey: `other_${randomUUID()}` },
      ),
    ).rejects.toEqual(new PrepareCloseActivityIntentError("NOT_FOUND"));
    await expect(
      prepareCloseActivityIntent(
        database!,
        commandContext(fixture.studentId, fixture.now),
        { ...input, idempotencyKey: `student_${randomUUID()}` },
      ),
    ).rejects.toEqual(new PrepareCloseActivityIntentError("FORBIDDEN"));
    await expect(
      prepareCloseActivityIntent(
        database!,
        commandContext(fixture.teacherId, fixture.now, "AGENT"),
        { ...input, idempotencyKey: `agent_${randomUUID()}` },
      ),
    ).rejects.toThrow(/not allowed/);
    await expect(
      prepareCloseActivityIntent(
        database!,
        commandContext(fixture.teacherId, fixture.now),
        {
          ...input,
          idempotencyKey: `widened_${randomUUID()}`,
          actorId: fixture.otherTeacherId,
        } as never,
      ),
    ).rejects.toThrow();
  });

  it("closes once after confirmation without changing snapshot or schedule", async () => {
    const fixture = await createCloseFixture();
    const prepared = await prepareAndDecide(fixture);
    const beforeRelease = await database!.activityRelease.findUniqueOrThrow({
      where: { id: fixture.releaseId },
      select: {
        sourceDraftId: true,
        publisherId: true,
        classroomId: true,
        publishedAt: true,
        dueAt: true,
        closeActionIntentId: true,
      },
    });
    const beforeSnapshot =
      await database!.activityReleaseSnapshot.findUniqueOrThrow({
        where: { releaseId: fixture.releaseId },
      });
    const input = {
      actionIntentId: prepared.actionIntentId,
      idempotencyKey: `close_${randomUUID()}`,
    };

    const closed = await closeActivityRelease(
      database!,
      commandContext(fixture.teacherId, fixture.now),
      input,
    );
    const replayed = await closeActivityRelease(
      database!,
      commandContext(fixture.teacherId, fixture.now),
      input,
    );

    expect(replayed).toEqual(closed);
    expect(closed).toEqual({
      releaseId: fixture.releaseId,
      status: "CLOSED",
      closedAt: fixture.now.toISOString(),
    });
    expect(
      await database!.activityRelease.findUniqueOrThrow({
        where: { id: fixture.releaseId },
        select: {
          sourceDraftId: true,
          publisherId: true,
          classroomId: true,
          publishedAt: true,
          dueAt: true,
          status: true,
          closedAt: true,
          closeActionIntentId: true,
        },
      }),
    ).toEqual({
      ...beforeRelease,
      status: "CLOSED",
      closedAt: fixture.now,
      closeActionIntentId: prepared.actionIntentId,
    });
    expect(
      await database!.activityReleaseSnapshot.findUniqueOrThrow({
        where: { releaseId: fixture.releaseId },
      }),
    ).toEqual(beforeSnapshot);
    expect(
      await database!.actionAudit.count({
        where: {
          actionName: "close_activity_release",
          resultResourceId: fixture.releaseId,
          outcome: "SUCCEEDED",
        },
      }),
    ).toBe(1);
    expect(
      (
        await database!.actionIntent.findUniqueOrThrow({
          where: { id: prepared.actionIntentId },
          select: { status: true, executedAt: true },
        })
      ),
    ).toEqual({ status: "EXECUTED", executedAt: fixture.now });

    await expect(
      database!.activityRelease.update({
        where: { id: fixture.releaseId },
        data: { closeActionIntentId: randomUUID() },
      }),
    ).rejects.toThrow(/provenance|immutable/);
  });

  it("rejects database writes that bypass either side of close integrity", async () => {
    const directCloseFixture = await createCloseFixture();
    await expect(
      database!.activityRelease.update({
        where: { id: directCloseFixture.releaseId },
        data: { status: "CLOSED", closedAt: directCloseFixture.now },
      }),
    ).rejects.toThrow(/close intent|lifecycle/);
    expect(
      await database!.activityRelease.findUniqueOrThrow({
        where: { id: directCloseFixture.releaseId },
        select: {
          status: true,
          closedAt: true,
          closeActionIntentId: true,
        },
      }),
    ).toEqual({
      status: "ACTIVE",
      closedAt: null,
      closeActionIntentId: null,
    });

    const orphanIntentFixture = await createCloseFixture();
    const prepared = await prepareAndDecide(orphanIntentFixture);
    await expect(
      database!.actionIntent.update({
        where: { id: prepared.actionIntentId },
        data: {
          status: "EXECUTED",
          executedAt: orphanIntentFixture.now,
        },
      }),
    ).rejects.toThrow(/requires one closed activity release/);
    expect(
      await database!.actionIntent.findUniqueOrThrow({
        where: { id: prepared.actionIntentId },
        select: { status: true, executedAt: true },
      }),
    ).toEqual({ status: "CONFIRMED", executedAt: null });
  });

  it("revalidates classroom management after confirmation", async () => {
    const fixture = await createCloseFixture();
    const prepared = await prepareAndDecide(fixture);
    await database!.classroom.update({
      where: { id: fixture.classroomId },
      data: { managerId: fixture.otherTeacherId },
    });

    await expect(
      closeActivityRelease(
        database!,
        commandContext(fixture.teacherId, fixture.now),
        {
          actionIntentId: prepared.actionIntentId,
          idempotencyKey: `close_${randomUUID()}`,
        },
      ),
    ).rejects.toEqual(new CloseActivityReleaseError("NOT_FOUND"));
    expect(
      await database!.activityRelease.findUniqueOrThrow({
        where: { id: fixture.releaseId },
        select: { status: true, closedAt: true },
      }),
    ).toEqual({ status: "ACTIVE", closedAt: null });
    expect(
      (
        await database!.actionIntent.findUniqueOrThrow({
          where: { id: prepared.actionIntentId },
          select: { status: true },
        })
      ).status,
    ).toBe("CONFIRMED");
  });

  it("rejects rejected, expired, and forged intents without closing", async () => {
    const rejectedFixture = await createCloseFixture();
    const rejected = await prepareAndDecide(rejectedFixture, "REJECT");
    await expect(
      closeActivityRelease(
        database!,
        commandContext(rejectedFixture.teacherId, rejectedFixture.now),
        {
          actionIntentId: rejected.actionIntentId,
          idempotencyKey: `close_${randomUUID()}`,
        },
      ),
    ).rejects.toEqual(
      new CloseActivityReleaseError("ACTION_NOT_CONFIRMED"),
    );

    const expiredFixture = await createCloseFixture();
    const expired = await prepareAndDecide(expiredFixture);
    const expiredNow = new Date(expired.expiresAt);
    await expect(
      closeActivityRelease(
        database!,
        commandContext(expiredFixture.teacherId, expiredNow),
        {
          actionIntentId: expired.actionIntentId,
          idempotencyKey: `close_${randomUUID()}`,
        },
      ),
    ).rejects.toEqual(new CloseActivityReleaseError("ACTION_EXPIRED"));

    const forgedFixture = await createCloseFixture();
    const payload = createCloseReleasePayload({
      releaseId: forgedFixture.releaseId,
      expectedStatus: "ACTIVE",
    });
    const forgedIntent = await database!.actionIntent.create({
      data: {
        actorId: forgedFixture.teacherId,
        actionName: "close_activity_release",
        payload,
        payloadHash: hashCloseReleasePayload({
          ...payload,
          releaseId: randomUUID(),
        }),
        targetType: "ActivityRelease",
        targetId: forgedFixture.releaseId,
        expectedVersion: null,
        expiresAt: new Date(forgedFixture.now.getTime() + 10 * 60 * 1_000),
        createdAt: forgedFixture.now,
      },
    });
    await decideActionIntent(
      database!,
      commandContext(forgedFixture.teacherId, forgedFixture.now),
      { actionIntentId: forgedIntent.id, decision: "CONFIRM" },
    );
    await expect(
      closeActivityRelease(
        database!,
        commandContext(forgedFixture.teacherId, forgedFixture.now),
        {
          actionIntentId: forgedIntent.id,
          idempotencyKey: `close_${randomUUID()}`,
        },
      ),
    ).rejects.toEqual(new CloseActivityReleaseError("INTENT_TAMPERED"));

    for (const releaseId of [
      rejectedFixture.releaseId,
      expiredFixture.releaseId,
      forgedFixture.releaseId,
    ]) {
      expect(
        await database!.activityRelease.findUniqueOrThrow({
          where: { id: releaseId },
          select: { status: true, closedAt: true },
        }),
      ).toEqual({ status: "ACTIVE", closedAt: null });
    }
  });

  it("rejects a second confirmed intent after the release was closed", async () => {
    const fixture = await createCloseFixture();
    const first = await prepareAndDecide(fixture);
    const second = await prepareAndDecide(fixture);

    await closeActivityRelease(
      database!,
      commandContext(fixture.teacherId, fixture.now),
      {
        actionIntentId: first.actionIntentId,
        idempotencyKey: `close_${randomUUID()}`,
      },
    );
    await expect(
      closeActivityRelease(
        database!,
        commandContext(fixture.teacherId, fixture.now),
        {
          actionIntentId: second.actionIntentId,
          idempotencyKey: `close_${randomUUID()}`,
        },
      ),
    ).rejects.toEqual(
      new CloseActivityReleaseError("RELEASE_NOT_ACTIVE"),
    );
    expect(
      (
        await database!.actionIntent.findUniqueOrThrow({
          where: { id: second.actionIntentId },
          select: { status: true },
        })
      ).status,
    ).toBe("CONFIRMED");
  });

  it("returns one result for concurrent retries and rejects key reuse for another intent", async () => {
    const fixture = await createCloseFixture();
    const first = await prepareAndDecide(fixture);
    const second = await prepareAndDecide(fixture);
    const idempotencyKey = `close_${randomUUID()}`;
    const input = {
      actionIntentId: first.actionIntentId,
      idempotencyKey,
    };

    const [left, right] = await Promise.all([
      closeActivityRelease(
        database!,
        commandContext(fixture.teacherId, fixture.now),
        input,
      ),
      closeActivityRelease(
        database!,
        commandContext(fixture.teacherId, fixture.now),
        input,
      ),
    ]);
    expect(right).toEqual(left);
    expect(
      await database!.actionAudit.count({
        where: {
          actionName: "close_activity_release",
          resultResourceId: fixture.releaseId,
          outcome: "SUCCEEDED",
        },
      }),
    ).toBe(1);

    await expect(
      closeActivityRelease(
        database!,
        commandContext(fixture.teacherId, fixture.now),
        {
          actionIntentId: second.actionIntentId,
          idempotencyKey,
        },
      ),
    ).rejects.toEqual(
      new CloseActivityReleaseError("IDEMPOTENCY_MISMATCH"),
    );
  });
});
