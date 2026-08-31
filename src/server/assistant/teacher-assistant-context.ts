import "server-only";

import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client";
import {
  type CommandContext,
  resolveCommandContext,
} from "../commands/command-context";
import { isActiveSchoolMember } from "../school/teacher-authorization";

const classroomSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(200),
});

export type AssistantClassroom = Readonly<z.infer<typeof classroomSchema>>;

export class TeacherAssistantContextError extends Error {
  constructor(public readonly code: "NOT_FOUND") {
    super(code);
    this.name = "TeacherAssistantContextError";
  }
}

export async function getTeacherAssistantClassrooms(
  database: PrismaClient,
  commandContext: CommandContext,
): Promise<AssistantClassroom[]> {
  const context = resolveCommandContext(commandContext, ["UI"]);
  if (!(await isActiveSchoolMember(database, context.actorId))) {
    throw new TeacherAssistantContextError("NOT_FOUND");
  }
  const actor = await database.appUser.findUnique({
    where: { id: context.actorId },
    select: { role: true },
  });
  if (actor?.role !== "TEACHER") {
    throw new TeacherAssistantContextError("NOT_FOUND");
  }

  const classrooms = await database.classroom.findMany({
    where: { managerId: context.actorId },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true },
  });
  return z.array(classroomSchema).parse(classrooms);
}
