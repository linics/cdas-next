"use server";

import { cookies } from "next/headers";
import { redirect, RedirectType } from "next/navigation";
import { getPasswordChangeActor } from "../../server/auth/current-actor";
import {
  changeLocalPassword,
  SESSION_COOKIE,
} from "../../server/auth/local-auth";
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
  const now = new Date();
  const session = await changeLocalPassword(database, actor.id, password, now);
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
