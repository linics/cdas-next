import "server-only";

import type { PrismaClient } from "../../generated/prisma/client";

type AppUserReader = Pick<PrismaClient, "appUser">;

export class TeacherAuthorizationError extends Error {
  constructor(public readonly code: "FORBIDDEN") {
    super(code);
    this.name = "TeacherAuthorizationError";
  }
}

/** Command/query boundary check for teacher-owned resources. The current actor
 * check remains the first gate, but this makes a manually forged/stale command
 * context unable to bypass account and school state. */
export async function requireActiveTeacher(
  database: AppUserReader,
  actorId: string,
): Promise<{ schoolId: string }> {
  const actor = await database.appUser.findUnique({
    where: { id: actorId },
    select: {
      role: true,
      accountStatus: true,
      schoolId: true,
      school: { select: { status: true } },
    },
  });
  if (
    actor?.role !== "TEACHER" ||
    actor.accountStatus !== "ACTIVE" ||
    !actor.schoolId ||
    actor.school?.status !== "ACTIVE"
  ) {
    throw new TeacherAuthorizationError("FORBIDDEN");
  }
  return { schoolId: actor.schoolId };
}
