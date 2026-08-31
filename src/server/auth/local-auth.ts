import "server-only";

import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma/client";
import {
  createSessionToken,
  hashSessionToken,
  verifyPassword,
} from "./local-auth-primitives";
export {
  adminIdentifier,
  studentIdentifier,
  teacherIdentifier,
} from "./local-auth-primitives";
export { hashPassword, verifyPassword } from "./local-auth-primitives";

export const SESSION_COOKIE = "cdas_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;
export { createSessionToken, hashSessionToken } from "./local-auth-primitives";

export async function createAuthSession(
  database: PrismaClient,
  userId: string,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = createSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await database.authSession.create({
    data: { id: randomUUID(), userId, tokenHash: hashSessionToken(token), expiresAt, createdAt: now },
  });
  return { token, expiresAt };
}

export async function revokeUserSessions(database: PrismaClient, userId: string, now = new Date()): Promise<void> {
  await database.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
}

export async function getSession(database: PrismaClient, token: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
  return database.authSession.findFirst({
    where: { tokenHash: hashSessionToken(token), revokedAt: null, expiresAt: { gt: now } },
    include: { user: { include: { school: { select: { status: true } }, localCredential: true } } },
  });
}

export type LoginRole = "ADMIN" | "TEACHER" | "STUDENT";
export type LoginResult =
  | { ok: true; userId: string; token: string; expiresAt: Date; mustChangePassword: boolean }
  | { ok: false; code: "INVALID_CREDENTIALS" | "ACCOUNT_LOCKED" | "ACCOUNT_DISABLED" | "SCHOOL_DISABLED" };

export async function authenticate(
  database: PrismaClient,
  identifier: string,
  password: string,
  role: LoginRole,
  now = new Date(),
): Promise<LoginResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const credential = await database.localCredential.findUnique({
      where: { identifier },
      include: { user: { include: { school: { select: { status: true } } } } },
    });
    if (!credential || credential.user.role !== role) return { ok: false, code: "INVALID_CREDENTIALS" };
    const valid = await verifyPassword(password, credential.passwordHash);
    if (!valid) {
      const next = credential.failedLoginCount + 1;
      const updated = await database.localCredential.updateMany({
        where: { id: credential.id, failedLoginCount: credential.failedLoginCount },
        data: {
          failedLoginCount: next,
          lockedUntil: next >= MAX_FAILURES
            ? new Date(now.getTime() + LOCK_MS)
            : credential.lockedUntil,
        },
      });
      if (updated.count !== 1) continue;
      return { ok: false, code: "INVALID_CREDENTIALS" };
    }
    if (credential.lockedUntil && credential.lockedUntil > now) return { ok: false, code: "ACCOUNT_LOCKED" };
    if (credential.user.accountStatus !== "ACTIVE") return { ok: false, code: "ACCOUNT_DISABLED" };
    if (credential.user.role !== "ADMIN" && credential.user.school?.status !== "ACTIVE") return { ok: false, code: "SCHOOL_DISABLED" };
    const token = createSessionToken();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    try {
      await database.$transaction(async (transaction) => {
        const reset = await transaction.localCredential.updateMany({
          where: { id: credential.id, failedLoginCount: credential.failedLoginCount },
          data: { failedLoginCount: 0, lockedUntil: null },
        });
        if (reset.count !== 1) throw new Error("AUTH_RETRY");
        await transaction.authSession.create({
          data: { id: randomUUID(), userId: credential.user.id, tokenHash: hashSessionToken(token), expiresAt, createdAt: now },
        });
      });
      return { ok: true, userId: credential.user.id, token, expiresAt, mustChangePassword: credential.mustChangePassword };
    } catch (error) {
      if (error instanceof Error && error.message === "AUTH_RETRY") continue;
      throw error;
    }
  }
  return { ok: false, code: "INVALID_CREDENTIALS" };
}
