import "server-only";

import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client";
import { requireActiveTeacher } from "../school/teacher-authorization";
import {
  type CommandContext,
  resolveCommandContext,
} from "../commands/command-context";

const emptyInputSchema = z.object({}).strict();

export const teacherProfileSchema = z
  .object({
    id: z.uuid(),
    displayName: z.string().trim().min(1),
    staffNo: z.string().trim().min(1),
    primaryDisciplineCode: z.string().trim().min(1),
    secondaryDisciplineCodes: z.array(z.string().trim().min(1)),
    school: z
      .object({
        id: z.uuid(),
        name: z.string().trim().min(1),
        code: z.string().trim().min(1),
      })
      .strict(),
  })
  .strict();

export type TeacherProfile = z.infer<typeof teacherProfileSchema>;

export class TeacherProfileQueryError extends Error {
  constructor(public readonly code: "FORBIDDEN" | "NOT_FOUND") {
    super(code);
    this.name = "TeacherProfileQueryError";
  }
}

export async function getTeacherProfile(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: unknown,
): Promise<TeacherProfile> {
  emptyInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  try {
    await requireActiveTeacher(database, context.actorId);
  } catch {
    throw new TeacherProfileQueryError("FORBIDDEN");
  }
  const teacher = await database.appUser.findUnique({
    where: { id: context.actorId },
    select: {
      id: true,
      displayName: true,
      staffNo: true,
      primaryDisciplineCode: true,
      secondaryDisciplineCodes: true,
      school: { select: { id: true, name: true, code: true } },
    },
  });
  if (!teacher) throw new TeacherProfileQueryError("NOT_FOUND");
  if (!teacher.school) throw new TeacherProfileQueryError("NOT_FOUND");
  return teacherProfileSchema.parse({
    id: teacher.id,
    displayName: teacher.displayName,
    staffNo: teacher.staffNo,
    primaryDisciplineCode: teacher.primaryDisciplineCode,
    secondaryDisciplineCodes: teacher.secondaryDisciplineCodes,
    school: {
      id: teacher.school.id,
      name: teacher.school.name,
      code: teacher.school.code,
    },
  });
}
