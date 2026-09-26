import "server-only";

import type { PrismaClient } from "../../generated/prisma/client";
import { legacySchoolCode } from "../../domain/school/legacy-school";
import {
  createAuthSession,
  studentIdentifier,
  teacherIdentifier,
  type LoginRole,
} from "./local-auth";

export type DevelopmentQuickLoginError = "DISABLED" | "DEFAULT_ACCOUNT_UNAVAILABLE";

export function isDevelopmentQuickLoginEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment.NODE_ENV === "development" && !environment.E2E_RUN_MARKER;
}

function preferredIdentifier(role: LoginRole): string | null {
  if (role === "TEACHER") {
    return teacherIdentifier(legacySchoolCode, "T-DEMO");
  }
  if (role === "STUDENT") {
    return studentIdentifier(legacySchoolCode, "700001");
  }
  return null;
}

/**
 * Local-only acceleration for the seeded demo. It still creates an ordinary
 * hashed session for a real active AppUser, so every domain command continues
 * to receive the same authenticated actor and run its usual authorization.
 * This module is unavailable when Next runs a production build or server.
 */
export async function createDevelopmentQuickSession(
  database: PrismaClient,
  role: LoginRole,
  now = new Date(),
): Promise<
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; code: DevelopmentQuickLoginError }
> {
  if (!isDevelopmentQuickLoginEnabled()) {
    return { ok: false, code: "DISABLED" };
  }

  const activeUser = {
    role,
    accountStatus: "ACTIVE" as const,
    ...(role === "ADMIN" ? {} : { school: { is: { status: "ACTIVE" as const } } }),
  };
  const eligible = {
    mustChangePassword: false,
    user: activeUser,
  };
  const preferred = preferredIdentifier(role);
  const credential =
    (preferred
      ? await database.localCredential.findFirst({
          where: { ...eligible, identifier: preferred },
          select: { userId: true },
        })
      : null) ??
    (await database.localCredential.findFirst({
      where: eligible,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { userId: true },
    }));

  if (!credential) {
    return { ok: false, code: "DEFAULT_ACCOUNT_UNAVAILABLE" };
  }

  const session = await createAuthSession(database, credential.userId, now);
  return { ok: true, ...session };
}
