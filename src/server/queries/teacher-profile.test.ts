import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";

vi.mock("server-only", () => ({}));

import { getTeacherProfile } from "./teacher-profile";
import { listTeacherClassrooms } from "./teacher-classrooms";
import type { CommandContext } from "../commands/command-context";

const context: CommandContext = {
  actorId: "00000000-0000-4000-8000-000000000002",
  source: "UI",
  traceId: "teacher-query-test",
  clock: () => new Date("2026-08-30T00:00:00.000Z"),
};

function databaseWith() {
  return {
    appUser: {
      findUnique: async () => ({
        id: context.actorId,
        role: "TEACHER",
        accountStatus: "ACTIVE",
        schoolId: "00000000-0000-4000-8000-000000000010",
        staffNo: "T001",
        displayName: "林老师",
        primaryDisciplineCode: "math",
        secondaryDisciplineCodes: ["physics"],
        school: { id: "00000000-0000-4000-8000-000000000010", name: "实验小学", code: "SCHAB234", status: "ACTIVE" },
      }),
    },
    classroom: {
      findMany: async () => [
        { id: "00000000-0000-4000-8000-000000000020", name: "七年一班", version: 1, _count: { memberships: 2 } },
      ],
    },
  } as unknown as PrismaClient;
}

describe("teacher school-scoped profile queries", () => {
  it("returns a teacher profile and only classrooms from their own school boundary", async () => {
    const database = databaseWith();
    await expect(getTeacherProfile(database, context, {})).resolves.toMatchObject({
      staffNo: "T001",
      school: { code: "SCHAB234", name: "实验小学" },
    });
    await expect(listTeacherClassrooms(database, context, {})).resolves.toEqual([
      {
        id: "00000000-0000-4000-8000-000000000020",
        name: "七年一班",
        version: 1,
        currentMemberCount: 2,
      },
    ]);
  });
});
