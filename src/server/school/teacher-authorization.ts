import type { PrismaClient } from "../../generated/prisma/client";

export class SchoolMemberAuthorizationError extends Error {
  constructor(
    public readonly code: "FORBIDDEN" | "ACCOUNT_DISABLED" | "SCHOOL_DISABLED",
  ) {
    super(code);
    this.name = "SchoolMemberAuthorizationError";
  }
}

type ActorStatus = {
  role: "ADMIN" | "TEACHER" | "STUDENT";
  accountStatus: "ACTIVE" | "DISABLED";
  schoolId: string | null;
  school: { status: "ACTIVE" | "DISABLED" } | null;
};

export function assertActiveBusinessActor(actor: ActorStatus | null): void {
  if (!actor) {
    throw new SchoolMemberAuthorizationError("FORBIDDEN");
  }
  if (actor.accountStatus !== "ACTIVE") {
    throw new SchoolMemberAuthorizationError("ACCOUNT_DISABLED");
  }
  if (actor.role === "ADMIN") {
    return;
  }
  if (!actor.schoolId || !actor.school) {
    throw new SchoolMemberAuthorizationError("FORBIDDEN");
  }
  if (actor.school.status !== "ACTIVE") {
    throw new SchoolMemberAuthorizationError("SCHOOL_DISABLED");
  }
}

export async function requireActiveSchoolMember(
  database: Pick<PrismaClient, "appUser">,
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
  assertActiveBusinessActor(actor);
  if (!actor || actor.role === "ADMIN" || !actor.schoolId) {
    throw new SchoolMemberAuthorizationError("FORBIDDEN");
  }
  return { schoolId: actor.schoolId };
}

export async function isActiveSchoolMember(
  database: Pick<PrismaClient, "appUser">,
  actorId: string,
): Promise<boolean> {
  try {
    await requireActiveSchoolMember(database, actorId);
    return true;
  } catch (error) {
    if (error instanceof SchoolMemberAuthorizationError) {
      return false;
    }
    throw error;
  }
}
