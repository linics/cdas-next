import "server-only";

import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client";
import { databaseUuidSchema } from "../../domain/school/identity";
import { requireActivePlatformAdmin } from "../school/admin-authorization";
import {
  type CommandContext,
  resolveCommandContext,
} from "../commands/command-context";

const emptyInputSchema = z.object({}).strict();
const teacherListInputSchema = z
  .object({ schoolId: databaseUuidSchema.nullable().optional() })
  .strict();

export const adminDashboardSchema = z
  .object({
    schoolCount: z.int().nonnegative(),
    teacherCount: z.int().nonnegative(),
    studentCount: z.int().nonnegative(),
    classroomCount: z.int().nonnegative(),
  })
  .strict();

export const adminSchoolListItemSchema = z
  .object({
    id: databaseUuidSchema,
    name: z.string().trim().min(1),
    code: z.string().trim().min(1),
    status: z.enum(["ACTIVE", "DISABLED"]),
    teacherCount: z.int().nonnegative(),
    studentCount: z.int().nonnegative(),
    classroomCount: z.int().nonnegative(),
  })
  .strict();

export const adminTeacherListItemSchema = z
  .object({
    id: z.uuid(),
    displayName: z.string().trim().min(1),
    staffNo: z.string().trim().min(1).nullable(),
    primaryDisciplineCode: z.string().trim().min(1).nullable(),
    secondaryDisciplineCodes: z.array(z.string().trim().min(1)),
    accountStatus: z.enum(["ACTIVE", "DISABLED"]),
    school: z
      .object({
        id: databaseUuidSchema,
        name: z.string().trim().min(1),
        code: z.string().trim().min(1),
        status: z.enum(["ACTIVE", "DISABLED"]),
      })
      .strict(),
  })
  .strict();

export type AdminDashboard = z.infer<typeof adminDashboardSchema>;
export type AdminSchoolListItem = z.infer<typeof adminSchoolListItemSchema>;
export type AdminTeacherListItem = z.infer<
  typeof adminTeacherListItemSchema
>;

/** The only administrator read models. They deliberately do not touch any
 * activity, release, evidence, feedback, or evaluation table. */
export async function getAdminDashboard(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: unknown,
): Promise<AdminDashboard> {
  emptyInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  await requireActivePlatformAdmin(database, context.actorId);
  const [schoolCount, teacherCount, studentCount, classroomCount] =
    await Promise.all([
      database.school.count(),
      database.appUser.count({ where: { role: "TEACHER" } }),
      database.appUser.count({ where: { role: "STUDENT" } }),
      database.classroom.count(),
    ]);
  return adminDashboardSchema.parse({
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
): Promise<readonly AdminSchoolListItem[]> {
  emptyInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  await requireActivePlatformAdmin(database, context.actorId);
  const schools = await database.school.findMany({
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      code: true,
      status: true,
      users: {
        where: { role: { in: ["TEACHER", "STUDENT"] } },
        select: { role: true },
      },
      _count: { select: { classrooms: true } },
    },
  });
  return schools.map((school) =>
    adminSchoolListItemSchema.parse({
      id: school.id,
      name: school.name,
      code: school.code,
      status: school.status,
      teacherCount: school.users.filter((user) => user.role === "TEACHER")
        .length,
      studentCount: school.users.filter((user) => user.role === "STUDENT")
        .length,
      classroomCount: school._count.classrooms,
    }),
  );
}

export async function listAdminTeachers(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: unknown,
): Promise<readonly AdminTeacherListItem[]> {
  const input = teacherListInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  await requireActivePlatformAdmin(database, context.actorId);
  const teachers = await database.appUser.findMany({
    where: {
      role: "TEACHER",
      ...(input.schoolId ? { schoolId: input.schoolId } : {}),
    },
    orderBy: [
      { school: { name: "asc" } },
      { displayName: "asc" },
      { id: "asc" },
    ],
    select: {
      id: true,
      displayName: true,
      staffNo: true,
      primaryDisciplineCode: true,
      secondaryDisciplineCodes: true,
      accountStatus: true,
      school: { select: { id: true, name: true, code: true, status: true } },
    },
  });
  return teachers.map((teacher) =>
    adminTeacherListItemSchema.parse({
      ...teacher,
      school: teacher.school,
    }),
  );
}
