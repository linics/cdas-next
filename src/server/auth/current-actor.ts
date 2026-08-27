import "server-only";

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import type { AppUser, PrismaClient } from "../../generated/prisma/client";
import { getDatabaseClient } from "../db/client";
import {
  clickthroughAuthSubject,
  isClickthroughAuthEnabled,
  resolveClickthroughAudience,
} from "./clickthrough-auth";
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
  const db = database ?? getDatabaseClient();

  if (isClickthroughAuthEnabled()) {
    return loadClickthroughActor(db);
  }

  if (!isClerkAuthenticationAvailable()) {
    throw new AuthenticationError("AUTH_NOT_CONFIGURED");
  }

  const session = await auth();
  if (!session.userId) {
    throw new AuthenticationError("UNAUTHENTICATED");
  }

  const actor = await db.appUser.findUnique({
    where: { authSubject: session.userId },
  });
  if (!actor) {
    throw new AuthenticationError("USER_NOT_PROVISIONED");
  }

  return actor;
}

async function loadClickthroughActor(database: PrismaClient): Promise<AppUser> {
  const headerList = await headers();
  const audience = resolveClickthroughAudience({
    pathname: headerList.get("x-cdas-pathname"),
    referer: headerList.get("referer"),
  });
  if (!audience) {
    throw new AuthenticationError("UNAUTHENTICATED");
  }

  const authSubject = clickthroughAuthSubject(audience);
  if (!authSubject) {
    throw new AuthenticationError("AUTH_NOT_CONFIGURED");
  }

  const actor = await database.appUser.findUnique({
    where: { authSubject },
  });
  if (!actor || actor.role !== audience) {
    throw new AuthenticationError("USER_NOT_PROVISIONED");
  }

  return actor;
}
