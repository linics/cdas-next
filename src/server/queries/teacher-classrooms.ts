import "server-only";

import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client";
import { requireActiveTeacher } from "../school/teacher-authorization";
import {
  type CommandContext,
  resolveCommandContext,
} from "../commands/command-context";

const emptyInputSchema = z.object({}).strict();
export const teacherClassroomSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1),
    version: z.int().positive(),
    currentMemberCount: z.int().nonnegative(),
  })
  .strict();
export type TeacherClassroom = z.infer<typeof teacherClassroomSchema>;

export class TeacherClassroomQueryError extends Error {
  constructor(public readonly code: "FORBIDDEN") {
    super(code);
    this.name = "TeacherClassroomQueryError";
  }
}

export async function listTeacherClassrooms(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: unknown,
): Promise<readonly TeacherClassroom[]> {
  emptyInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  let actor;
  try {
    actor = await requireActiveTeacher(database, context.actorId);
  } catch {
    throw new TeacherClassroomQueryError("FORBIDDEN");
  }
  const classrooms = await database.classroom.findMany({
    where: { managerId: context.actorId, schoolId: actor.schoolId },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      version: true,
      _count: { select: { memberships: { where: { endedAt: null } } } },
    },
  });
  return classrooms.map((classroom) =>
    teacherClassroomSchema.parse({
      id: classroom.id,
      name: classroom.name,
      version: classroom.version,
      currentMemberCount: classroom._count.memberships,
    }),
  );
}
