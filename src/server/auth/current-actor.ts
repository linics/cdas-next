import "server-only";

import { cookies } from "next/headers";
import type {
  AppUser,
  PrismaClient,
} from "../../generated/prisma/client";
import { getDatabaseClient } from "../db/client";
import { findLocalSessionActor, LOCAL_SESSION_COOKIE } from "./local-auth";

export class AuthenticationError extends Error {
  constructor(
    public readonly code:
      | "AUTH_NOT_CONFIGURED"
      | "UNAUTHENTICATED"
      | "USER_NOT_PROVISIONED"
      | "ACCOUNT_DISABLED"
      | "SCHOOL_DISABLED"
      | "PASSWORD_CHANGE_REQUIRED",
  ) {
    super(code);
    this.name = "AuthenticationError";
  }
}

export async function getCurrentActor(
  database?: PrismaClient,
): Promise<AppUser> {
  const db = database ?? getDatabaseClient();

  const cookieStore = await cookies();
  const actor = await findLocalSessionActor(
    db,
    cookieStore.get(LOCAL_SESSION_COOKIE)?.value,
  );
  if (!actor) {
    throw new AuthenticationError("UNAUTHENTICATED");
  }
  const enabledActor = requireEnabledActor(actor);
  if (enabledActor.role === "TEACHER") {
    const credential = await db.localCredential.findUnique({ where: { userId: enabledActor.id }, select: { mustChangePassword: true } });
    if (credential?.mustChangePassword) throw new AuthenticationError("PASSWORD_CHANGE_REQUIRED");
  }
  return enabledActor;
}

type ActorWithSchool = AppUser & {
  school: { id: string; status: "ACTIVE" | "DISABLED" } | null;
};

function requireEnabledActor(actor: ActorWithSchool): AppUser {
  if (actor.accountStatus !== "ACTIVE") {
    throw new AuthenticationError("ACCOUNT_DISABLED");
  }
  if (
    actor.role !== "ADMIN" &&
    (!actor.school || actor.school.status !== "ACTIVE")
  ) {
    throw new AuthenticationError("SCHOOL_DISABLED");
  }
  return actor;
}
