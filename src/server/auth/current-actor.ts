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
import {
  SchoolMemberAuthorizationError,
  assertActiveBusinessActor,
} from "../school/teacher-authorization";

export class AuthenticationError extends Error {
  constructor(
    public readonly code:
      | "AUTH_NOT_CONFIGURED"
      | "UNAUTHENTICATED"
      | "USER_NOT_PROVISIONED"
      | "ACCOUNT_DISABLED"
      | "SCHOOL_DISABLED",
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
    include: { school: { select: { status: true } } },
  });
  if (!actor) {
    throw new AuthenticationError("USER_NOT_PROVISIONED");
  }

  return gateActiveActor(actor);
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
    include: { school: { select: { status: true } } },
  });
  if (!actor || actor.role !== audience) {
    throw new AuthenticationError("USER_NOT_PROVISIONED");
  }

  return gateActiveActor(actor);
}

function gateActiveActor(
  actor: AppUser & { school: { status: "ACTIVE" | "DISABLED" } | null },
): AppUser {
  try {
    assertActiveBusinessActor(actor);
  } catch (error) {
    if (error instanceof SchoolMemberAuthorizationError) {
      if (error.code === "ACCOUNT_DISABLED") {
        throw new AuthenticationError("ACCOUNT_DISABLED");
      }
      if (error.code === "SCHOOL_DISABLED") {
        throw new AuthenticationError("SCHOOL_DISABLED");
      }
    }
    throw new AuthenticationError("USER_NOT_PROVISIONED");
  }
  return actor;
}
