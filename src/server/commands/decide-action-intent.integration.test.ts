import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabaseClient } from "../db/client";
import {
  decideActionIntent,
  DecideActionIntentError,
} from "./decide-action-intent";
import type { CommandContext } from "./command-context";

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

async function createFixture(expiresAt: Date) {
  if (!database) {
    throw new Error("TEST_DATABASE_URL is required");
  }

  const actorId = randomUUID();
  const otherActorId = randomUUID();
  const actionIntentId = randomUUID();
  const targetId = randomUUID();

  await database.appUser.createMany({
    data: [
      {
        id: actorId,
        authSubject: `teacher_${actorId}`,
        role: "TEACHER",
        displayName: "确认教师",
      },
      {
        id: otherActorId,
        authSubject: `teacher_${otherActorId}`,
        role: "TEACHER",
        displayName: "其他教师",
      },
    ],
  });
  await database.actionIntent.create({
    data: {
      id: actionIntentId,
      actorId,
      actionName: "test_decide_action_intent",
      payload: { targetId },
      payloadHash: "a".repeat(64),
      targetType: "ActivityDraft",
      targetId,
      status: "PREPARED",
      expiresAt,
      createdAt: new Date("2026-08-18T12:00:00.000Z"),
    },
  });

  return { actorId, otherActorId, actionIntentId };
}

describeWithDatabase("decideActionIntent", () => {
  afterAll(async () => {
    await database?.$disconnect();
  });

  it("only lets the owning human confirm and safely replays the decision", async () => {
    const now = new Date("2026-08-18T12:05:00.000Z");
    const fixture = await createFixture(
      new Date("2026-08-18T12:10:00.000Z"),
    );

    await expect(
      decideActionIntent(database!, {
        actorId: fixture.otherActorId,
        source: "UI",
        traceId: randomUUID(),
        clock: () => now,
      }, {
        actionIntentId: fixture.actionIntentId,
        decision: "CONFIRM",
      }),
    ).rejects.toEqual(new DecideActionIntentError("FORBIDDEN"));

    const input = {
      actionIntentId: fixture.actionIntentId,
      decision: "CONFIRM" as const,
    };
    const confirmed = await decideActionIntent(
      database!,
      commandContext(fixture.actorId, now),
      input,
    );
    const replayed = await decideActionIntent(
      database!,
      commandContext(fixture.actorId, now),
      input,
    );

    expect(replayed).toEqual(confirmed);
    expect(confirmed.status).toBe("CONFIRMED");

    const audit = await database!.actionAudit.findFirstOrThrow({
      where: {
        actionIntentId: fixture.actionIntentId,
        actionName: "decide_action_intent",
        outcome: "SUCCEEDED",
      },
    });
    expect(audit.requestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("persists expiration and refuses a late confirmation", async () => {
    const fixture = await createFixture(
      new Date("2026-08-18T12:10:00.000Z"),
    );

    await expect(
      decideActionIntent(database!, {
        actorId: fixture.actorId,
        source: "UI",
        traceId: randomUUID(),
        clock: () => new Date("2026-08-18T12:11:00.000Z"),
      }, {
        actionIntentId: fixture.actionIntentId,
        decision: "CONFIRM",
      }),
    ).rejects.toEqual(new DecideActionIntentError("ACTION_EXPIRED"));

    expect(
      (
        await database!.actionIntent.findUniqueOrThrow({
          where: { id: fixture.actionIntentId },
        })
      ).status,
    ).toBe("EXPIRED");
  });

  it("rejects actor, source, and clock fields in untrusted input", async () => {
    const now = new Date("2026-08-18T12:05:00.000Z");
    const fixture = await createFixture(
      new Date("2026-08-18T12:10:00.000Z"),
    );

    await expect(
      decideActionIntent(
        database!,
        commandContext(fixture.actorId, now),
        {
          actionIntentId: fixture.actionIntentId,
          decision: "CONFIRM",
          actorId: fixture.otherActorId,
          source: "AGENT",
          now: new Date("2026-08-18T12:01:00.000Z"),
        } as never,
      ),
    ).rejects.toMatchObject({ name: "ZodError" });

    expect(
      (
        await database!.actionIntent.findUniqueOrThrow({
          where: { id: fixture.actionIntentId },
        })
      ).status,
    ).toBe("PREPARED");
  });
});
