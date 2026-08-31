"use server";

import { cookies } from "next/headers";
import { redirect, RedirectType } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "../../generated/prisma/client";
import { getPasswordChangeActor } from "../../server/auth/current-actor";
import { hashPassword, SESSION_COOKIE } from "../../server/auth/local-auth";
import { passwordSchema } from "../../server/auth/password-policy";
import { getDatabaseClient } from "../../server/db/client";

export type PasswordActionState = { error?: string };

async function changePasswordForRole(
  formData: FormData,
  role: "TEACHER" | "STUDENT",
): Promise<PasswordActionState> {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) return { error: "密码需满足长度、字母和数字要求" };
  if (password !== confirmation) return { error: "两次输入的密码不一致" };
  const database = getDatabaseClient();
  const actor = await getPasswordChangeActor(database);
  if (actor.role !== role) return { error: "账号角色不匹配" };
  const passwordHash = await hashPassword(password);
  const now = new Date();
  const session = await database.$transaction(async (transaction) => {
    await transaction.localCredential.update({ where: { userId: actor.id }, data: { passwordHash, mustChangePassword: false, passwordChangedAt: now, failedLoginCount: 0, lockedUntil: null } });
    await transaction.authSession.updateMany({ where: { userId: actor.id, revokedAt: null }, data: { revokedAt: now } });
    if (actor.role === "TEACHER") {
      await transaction.teacherProvisioning.updateMany({ where: { appUserId: actor.id, status: "PENDING" }, data: { status: "COMPLETED", completedAt: now } });
    }
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + 12 * 60 * 60 * 1000);
    await transaction.authSession.create({ data: { userId: actor.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt, createdAt: now } });
    return { token, expiresAt };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  (await cookies()).set(SESSION_COOKIE, session.token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 43200, expires: session.expiresAt });
  redirect(role === "TEACHER" ? "/teacher" : "/student", RedirectType.replace);
}

export async function changeTeacherPasswordAction(
  _state: PasswordActionState,
  formData: FormData,
): Promise<PasswordActionState> {
  return changePasswordForRole(formData, "TEACHER");
}

export async function changeStudentPasswordAction(
  _state: PasswordActionState,
  formData: FormData,
): Promise<PasswordActionState> {
  return changePasswordForRole(formData, "STUDENT");
}
