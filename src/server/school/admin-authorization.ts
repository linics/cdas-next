import "server-only";

import type { PrismaClient } from "../../generated/prisma/client";

type AppUserReader = Pick<PrismaClient, "appUser">;

export class AdminAuthorizationError extends Error {
  constructor(public readonly code: "FORBIDDEN") {
    super(code);
    this.name = "AdminAuthorizationError";
  }
}

/**
 * The database command boundary repeats this check even though UI contexts are
 * created from getCurrentActor. It prevents a forged CommandContext or an
 * account disabled between page render and mutation from gaining admin access.
 */
export async function requireActivePlatformAdmin(
  database: AppUserReader,
  actorId: string,
): Promise<{ role: "ADMIN"; accountStatus: "ACTIVE" }> {
  const actor = await database.appUser.findUnique({
    where: { id: actorId },
    select: { role: true, accountStatus: true },
  });
  if (actor?.role !== "ADMIN" || actor.accountStatus !== "ACTIVE") {
    throw new AdminAuthorizationError("FORBIDDEN");
  }
  return { role: "ADMIN", accountStatus: "ACTIVE" };
}
