import type { PrismaClient } from "../../generated/prisma/client";

export class PlatformAdminAuthorizationError extends Error {
  constructor(public readonly code: "FORBIDDEN") {
    super(code);
    this.name = "PlatformAdminAuthorizationError";
  }
}

export async function requireActivePlatformAdmin(
  database: Pick<PrismaClient, "appUser">,
  actorId: string,
): Promise<{ role: "ADMIN"; accountStatus: "ACTIVE" }> {
  const actor = await database.appUser.findUnique({
    where: { id: actorId },
    select: { role: true, accountStatus: true },
  });
  if (actor?.role !== "ADMIN" || actor.accountStatus !== "ACTIVE") {
    throw new PlatformAdminAuthorizationError("FORBIDDEN");
  }
  return { role: "ADMIN", accountStatus: "ACTIVE" };
}
