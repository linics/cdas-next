import "server-only";

import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client";
import { requireActivePlatformAdmin } from "../school/admin-authorization";
import {
  type CommandContext,
  resolveCommandContext,
} from "../commands/command-context";

const emptyInputSchema = z.object({}).strict();
const listTeachersInputSchema = z
  .object({
    schoolId: z.uuid().optional(),
  })
  .strict();

export class AdminDashboardQueryError extends Error {
  constructor(public readonly code: "FORBIDDEN") {
    super(code);
    this.name = "AdminDashboardQueryError";
  }
}

const countSchema = z.int().nonnegative();

export const adminDashboardSchema = z
  .object({
    actor: z.object({ displayName: z.string().trim().min(1) }).strict(),
    schoolCount: countSchema,
    teacherCount: countSchema,
    studentCount: countSchema,
    classroomCount: countSchema,
  })
  .strict();

export const adminSchoolListSchema = z
  .object({
    schools: z.array(
      z
        .object({
          id: z.uuid(),
          name: z.string().trim().min(1),
          code: z.string().trim().min(1),
          status: z.enum(["ACTIVE", "DISABLED"]),
          teacherCount: countSchema,
          studentCount: countSchema,
          classroomCount: countSchema,
        })
        .strict(),
    ),
  })
  .strict();

export const adminTeacherListSchema = z
  .object({
    teachers: z.array(
      z
        .object({
          id: z.uuid(),
          displayName: z.string().trim().min(1),
          staffNo: z.string().nullable(),
          accountStatus: z.enum(["ACTIVE", "DISABLED"]),
          legacyProfile: z.boolean(),
          provisioningStatus: z
            .enum(["PENDING", "COMPLETED", "FAILED"])
            .nullable(),
          school: z
            .object({
              id: z.uuid(),
              name: z.string().trim().min(1),
              code: z.string().trim().min(1),
            })
            .strict(),
        })
        .strict(),
    ),
  })
  .strict();

export type AdminDashboard = z.infer<typeof adminDashboardSchema>;
export type AdminSchoolList = z.infer<typeof adminSchoolListSchema>;
export type AdminTeacherList = z.infer<typeof adminTeacherListSchema>;

async function requireAdmin(
  database: PrismaClient,
  context: CommandContext,
) {
  const resolved = resolveCommandContext(context, ["UI"]);
  try {
    await requireActivePlatformAdmin(database, resolved.actorId);
  } catch {
    throw new AdminDashboardQueryError("FORBIDDEN");
  }
  const actor = await database.appUser.findUnique({
    where: { id: resolved.actorId },
    select: { displayName: true },
  });
  if (!actor) {
    throw new AdminDashboardQueryError("FORBIDDEN");
  }
  return { resolved, displayName: actor.displayName };
}

export async function getAdminDashboard(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: unknown,
): Promise<AdminDashboard> {
  emptyInputSchema.parse(rawInput);
  const { displayName } = await requireAdmin(database, commandContext);
  const [schoolCount, teacherCount, studentCount, classroomCount] =
    await Promise.all([
      database.school.count(),
      database.appUser.count({ where: { role: "TEACHER" } }),
      database.appUser.count({ where: { role: "STUDENT" } }),
      database.classroom.count(),
    ]);
  return adminDashboardSchema.parse({
    actor: { displayName },
    schoolCount,
    teacherCount,
    studentCount,
    classroomCount,
  });
}

export async function listAdminSchools(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: unknown,
): Promise<AdminSchoolList> {
  emptyInputSchema.parse(rawInput);
  await requireAdmin(database, commandContext);
  const schools = await database.school.findMany({
    orderBy: [{ createdAt: "asc" }, { code: "asc" }],
    select: {
      id: true,
      name: true,
      code: true,
      status: true,
      _count: {
        select: {
          classrooms: true,
          users: true,
        },
      },
      users: {
        select: { role: true },
      },
    },
  });
  return adminSchoolListSchema.parse({
    schools: schools.map((school) => ({
      id: school.id,
      name: school.name,
      code: school.code,
      status: school.status,
      teacherCount: school.users.filter((user) => user.role === "TEACHER")
        .length,
      studentCount: school.users.filter((user) => user.role === "STUDENT")
        .length,
      classroomCount: school._count.classrooms,
    })),
  });
}

export async function listAdminTeachers(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: unknown,
): Promise<AdminTeacherList> {
  const input = listTeachersInputSchema.parse(rawInput ?? {});
  await requireAdmin(database, commandContext);
  const teachers = await database.appUser.findMany({
    where: {
      role: "TEACHER",
      ...(input.schoolId ? { schoolId: input.schoolId } : {}),
    },
    orderBy: [{ displayName: "asc" }, { id: "asc" }],
    select: {
      id: true,
      displayName: true,
      staffNo: true,
      accountStatus: true,
      legacyProfile: true,
      school: { select: { id: true, name: true, code: true } },
      teacherProvisioning: { select: { status: true } },
    },
  });
  return adminTeacherListSchema.parse({
    teachers: teachers.flatMap((teacher) => {
      if (!teacher.school) {
        return [];
      }
      return [
        {
          id: teacher.id,
          displayName: teacher.displayName,
          staffNo: teacher.staffNo,
          accountStatus: teacher.accountStatus,
          legacyProfile: teacher.legacyProfile,
          provisioningStatus: teacher.teacherProvisioning?.status ?? null,
          school: teacher.school,
        },
      ];
    }),
  });
}
