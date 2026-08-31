import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";

vi.mock("server-only", () => ({}));

import {
  getAdminDashboard,
  listAdminSchools,
  listAdminTeachers,
} from "./admin-dashboard";
import type { CommandContext } from "../commands/command-context";

const context: CommandContext = {
  actorId: "00000000-0000-4000-8000-000000000001",
  source: "UI",
  traceId: "admin-query-test",
  clock: () => new Date("2026-08-30T00:00:00.000Z"),
};

function databaseWith(
  role: "ADMIN" | "TEACHER" = "ADMIN",
  schoolId = "00000000-0000-4000-8000-000000000010",
) {
  const activitiesRead = vi.fn();
  const database = {
    appUser: {
      findUnique: async () => ({ role, accountStatus: "ACTIVE" }),
      count: async ({ where }: { where: { role?: string } }) =>
        where.role === "TEACHER" ? 3 : where.role === "STUDENT" ? 8 : 0,
      findMany: async () => [
        {
          id: "00000000-0000-4000-8000-000000000011",
          displayName: "林老师",
          staffNo: "T001",
          primaryDisciplineCode: "math",
          secondaryDisciplineCodes: ["physics"],
          accountStatus: "ACTIVE",
          school: { id: schoolId, name: "实验小学", code: "SCHAB234", status: "ACTIVE" },
        },
      ],
    },
    school: {
      count: async () => 2,
      findMany: async () => [
        {
          id: schoolId,
          name: "实验小学",
          code: "SCHAB234",
          status: "ACTIVE",
          users: [{ role: "TEACHER" }, { role: "STUDENT" }, { role: "STUDENT" }],
          _count: { classrooms: 2 },
        },
      ],
    },
    classroom: { count: async () => 4 },
    activityDraft: { findMany: activitiesRead },
    activityRelease: { findMany: activitiesRead },
    submission: { findMany: activitiesRead },
  } as unknown as PrismaClient;
  return { database, activitiesRead };
}

describe("administrator content-free queries", () => {
  it("returns only school/teacher aggregates and never reads teaching content", async () => {
    const fixture = databaseWith();
    await expect(getAdminDashboard(fixture.database, context, {})).resolves.toEqual({
      schoolCount: 2,
      teacherCount: 3,
      studentCount: 8,
      classroomCount: 4,
    });
    await expect(listAdminSchools(fixture.database, context, {})).resolves.toEqual([
      {
        id: "00000000-0000-4000-8000-000000000010",
        name: "实验小学",
        code: "SCHAB234",
        status: "ACTIVE",
        teacherCount: 1,
        studentCount: 2,
        classroomCount: 2,
      },
    ]);
    await expect(listAdminTeachers(fixture.database, context, {})).resolves.toEqual([
      {
        id: "00000000-0000-4000-8000-000000000011",
        displayName: "林老师",
        staffNo: "T001",
        primaryDisciplineCode: "math",
        secondaryDisciplineCodes: ["physics"],
        accountStatus: "ACTIVE",
        school: {
          id: "00000000-0000-4000-8000-000000000010",
          name: "实验小学",
          code: "SCHAB234",
          status: "ACTIVE",
        },
      },
    ]);
    expect(fixture.activitiesRead).not.toHaveBeenCalled();
  });

  it("does not expose administration data to a teacher", async () => {
    const fixture = databaseWith("TEACHER");
    await expect(getAdminDashboard(fixture.database, context, {})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("reads the migrated legacy school identifier accepted by PostgreSQL", async () => {
    const legacySchoolId = "00000000-0000-0000-0000-000000000101";
    const fixture = databaseWith("ADMIN", legacySchoolId);

    await expect(listAdminSchools(fixture.database, context, {})).resolves.toMatchObject([
      { id: legacySchoolId, code: "SCHAB234" },
    ]);
    await expect(listAdminTeachers(fixture.database, context, {})).resolves.toMatchObject([
      { school: { id: legacySchoolId, code: "SCHAB234" } },
    ]);
  });
});
