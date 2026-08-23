import "server-only";

import { auth } from "@clerk/nextjs/server";
import type { AppUser, PrismaClient } from "../../generated/prisma/client";
import { getDatabaseClient } from "../db/client";
import { isClerkAuthenticationAvailable } from "./clerk-availability";

export class AuthenticationError extends Error {
  constructor(
    public readonly code:
      | "AUTH_NOT_CONFIGURED"
      | "UNAUTHENTICATED"
      | "USER_NOT_PROVISIONED",
  ) {
    super(code);
    this.name = "AuthenticationError";
  }
}

export async function getCurrentActor(
  database?: PrismaClient,
): Promise<AppUser> {
  if (!isClerkAuthenticationAvailable()) {
    throw new AuthenticationError("AUTH_NOT_CONFIGURED");
  }

  const session = await auth();
  if (!session.userId) {
    throw new AuthenticationError("UNAUTHENTICATED");
  }

  const actor = await (database ?? getDatabaseClient()).appUser.findUnique({
    where: { authSubject: session.userId },
  });
  if (!actor) {
    throw new AuthenticationError("USER_NOT_PROVISIONED");
  }

  return actor;
}
