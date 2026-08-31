import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";

vi.mock("server-only", () => ({}));

import { createClassroom, CreateClassroomError } from "./create-classroom";
import type { CommandContext } from "./command-context";

const teacherId = "00000000-0000-4000-8000-000000000002";
const schoolId = "00000000-0000-4000-8000-000000000010";
const context: CommandContext = {
  actorId: teacherId,
  source: "UI",
  traceId: "create-classroom-test",
  clock: () => new Date("2026-08-30T00:00:00.000Z"),
};

function databaseWith(options?: { schoolStatus?: "ACTIVE" | "DISABLED" }) {
  const classrooms: Array<Record<string, unknown>> = [];
  const idempotency: Array<Record<string, unknown>> = [];
  let nextId = 100;
  const client = {
    $transaction: async <T>(work: (transaction: unknown) => Promise<T>) => work(client),
    appUser: {
      findUnique: async () => ({
        role: "TEACHER",
        accountStatus: "ACTIVE",
        schoolId,
        school: { status: options?.schoolStatus ?? "ACTIVE" },
      }),
    },
    classroom: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const classroom = { ...data, id: `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}` };
        classrooms.push(classroom);
        return classroom;
      },
    },
    idempotencyRecord: {
      findUnique: async ({ where }: { where: { actorId_commandName_idempotencyKey: { actorId: string; commandName: string; idempotencyKey: string } } }) => {
        const key = where.actorId_commandName_idempotencyKey;
        return idempotency.find((record) => record.actorId === key.actorId && record.commandName === key.commandName && record.idempotencyKey === key.idempotencyKey) ?? null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => { idempotency.push(data); return data; },
    },
    actionAudit: { create: async () => undefined },
  };
  return { database: client as unknown as PrismaClient, classrooms };
}

describe("teacher classroom creation", () => {
  it("creates a classroom inside the active teacher's own school", async () => {
    const fixture = databaseWith();
    await expect(
      createClassroom(fixture.database, context, {
        name: "七年一班",
        idempotencyKey: "create-classroom-001",
      }),
    ).resolves.toMatchObject({ name: "七年一班", schoolId, managerId: teacherId });
    expect(fixture.classrooms[0]).toMatchObject({ schoolId, managerId: teacherId });
  });

  it("rejects creating a classroom after its school is disabled", async () => {
    await expect(
      createClassroom(databaseWith({ schoolStatus: "DISABLED" }).database, context, {
        name: "七年一班",
        idempotencyKey: "create-classroom-002",
      }),
    ).rejects.toEqual(new CreateClassroomError("FORBIDDEN"));
  });
});
