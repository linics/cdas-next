import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";

vi.mock("server-only", () => ({}));

import {
  updateTeacherProfile,
  UpdateTeacherProfileError,
} from "./update-teacher-profile";
import type { CommandContext } from "./command-context";

const teacherId = "00000000-0000-4000-8000-000000000002";
const schoolId = "00000000-0000-4000-8000-000000000010";
const context: CommandContext = {
  actorId: teacherId,
  source: "UI",
  traceId: "teacher-profile-command-test",
  clock: () => new Date("2026-08-30T00:00:00.000Z"),
};

function databaseWith(options?: { active?: boolean }) {
  const user = {
    id: teacherId,
    role: "TEACHER" as const,
    accountStatus: options?.active === false ? "DISABLED" as const : "ACTIVE" as const,
    schoolId,
    school: { status: "ACTIVE" as const },
    staffNo: "T001",
    displayName: "旧姓名",
    primaryDisciplineCode: "math",
    secondaryDisciplineCodes: ["physics"],
  };
  const idempotency: Array<Record<string, unknown>> = [];
  const client = {
    $transaction: async <T>(work: (transaction: unknown) => Promise<T>) => work(client),
    appUser: {
      findUnique: async () => user,
      update: async ({ data }: { data: Partial<typeof user> }) => {
        Object.assign(user, data);
        return user;
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
  return { database: client as unknown as PrismaClient, user };
}

describe("teacher profile command", () => {
  it("updates only name and discipline fields, preserving school and staff number", async () => {
    const fixture = databaseWith();
    await expect(
      updateTeacherProfile(fixture.database, context, {
        displayName: "新姓名",
        primaryDisciplineCode: "chinese",
        secondaryDisciplineCodes: ["math"],
        idempotencyKey: "update-profile-001",
      }),
    ).resolves.toEqual({
      teacherId,
      displayName: "新姓名",
      primaryDisciplineCode: "chinese",
      secondaryDisciplineCodes: ["math"],
    });
    expect(fixture.user).toMatchObject({ schoolId, staffNo: "T001" });
  });

  it("rejects a disabled teacher and a duplicate primary/secondary discipline", async () => {
    await expect(
      updateTeacherProfile(databaseWith({ active: false }).database, context, {
        displayName: "新姓名",
        primaryDisciplineCode: "math",
        secondaryDisciplineCodes: [],
        idempotencyKey: "update-profile-002",
      }),
    ).rejects.toEqual(new UpdateTeacherProfileError("FORBIDDEN"));
    await expect(
      updateTeacherProfile(databaseWith().database, context, {
        displayName: "新姓名",
        primaryDisciplineCode: "math",
        secondaryDisciplineCodes: ["math"],
        idempotencyKey: "update-profile-003",
      }),
    ).rejects.toMatchObject({ name: "ZodError" });
  });
});
