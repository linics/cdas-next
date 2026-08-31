import "server-only";

import { cookies } from "next/headers";
import type { AppUser, PrismaClient } from "../../generated/prisma/client";
import { getDatabaseClient } from "../db/client";
import { SchoolMemberAuthorizationError, assertActiveBusinessActor } from "../school/teacher-authorization";
import { getSession, SESSION_COOKIE } from "./local-auth";

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

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) throw new AuthenticationError("UNAUTHENTICATED");
  const session = await getSession(db, token);
  if (!session) throw new AuthenticationError("UNAUTHENTICATED");
  const actor = session.user;
  const gated = gateActiveActor(actor);
  if (
    session.user.localCredential?.mustChangePassword &&
    (gated.role === "TEACHER" || gated.role === "STUDENT")
  ) {
    throw new AuthenticationError("PASSWORD_CHANGE_REQUIRED");
  }
  return gated;
}

export async function getPasswordChangeActor(database?: PrismaClient): Promise<AppUser> {
  const db = database ?? getDatabaseClient();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) throw new AuthenticationError("UNAUTHENTICATED");
  const session = await getSession(db, token);
  if (!session) throw new AuthenticationError("UNAUTHENTICATED");
  return gateActiveActor(session.user);
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
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
