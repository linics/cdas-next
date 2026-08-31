"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  authenticateLocalCredential,
  localAdminIdentifier,
  localStudentIdentifier,
  localTeacherIdentifier,
  LOCAL_SESSION_COOKIE,
  normalizeStudentNo,
  revokeLocalSession,
} from "../../server/auth/local-auth";
import { normalizeSchoolCode, normalizeStaffNo, schoolCodeSchema, staffNoSchema } from "../../domain/school/identity";
import { getDatabaseClient } from "../../server/db/client";
import type { LocalLoginState } from "./local-login-state";

function invalid(previous: LocalLoginState): LocalLoginState {
  return { ...previous, status: "error", message: "账号信息或密码不正确。", destination: null };
}

function failureFor(status: string, previous: LocalLoginState): LocalLoginState {
  if (status === "ACCOUNT_DISABLED") return { ...previous, status: "error", message: "该账号已停用，请联系平台管理员。", destination: null };
  if (status === "SCHOOL_DISABLED") return { ...previous, status: "error", message: "所在学校已停用，暂不能登录。", destination: null };
  if (status === "ACCOUNT_LOCKED") return { ...previous, status: "error", message: "连续登录失败次数过多，15 分钟后再试。", destination: null };
  return invalid(previous);
}

async function completeLogin(
  previous: LocalLoginState,
  input: Readonly<{ identifier: string; password: string; role: "ADMIN" | "TEACHER" | "STUDENT"; destination: string }>,
): Promise<LocalLoginState> {
  const result = await authenticateLocalCredential(getDatabaseClient(), input);
  if (result.status !== "SUCCESS") return failureFor(result.status, previous);
  const cookieStore = await cookies();
  cookieStore.set(LOCAL_SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return {
    status: "success",
    message: result.mustChangePassword ? "请先修改一次性密码。" : "登录成功。",
    destination: result.mustChangePassword && input.role === "TEACHER" ? "/teacher/password" : input.destination,
  };
}

export async function loginAdminAction(previous: LocalLoginState, formData: FormData): Promise<LocalLoginState> {
  try {
    const input = z.object({ username: z.string().trim().min(3).max(64), password: z.string().min(1).max(256) }).strict().parse({ username: formData.get("username"), password: formData.get("password") });
    return await completeLogin(previous, { identifier: localAdminIdentifier(input.username), password: input.password, role: "ADMIN", destination: "/admin" });
  } catch { return invalid(previous); }
}

export async function loginTeacherAction(previous: LocalLoginState, formData: FormData): Promise<LocalLoginState> {
  try {
    const input = z.object({ schoolCode: z.string().transform(normalizeSchoolCode).pipe(schoolCodeSchema), staffNo: z.string().transform(normalizeStaffNo).pipe(staffNoSchema), password: z.string().min(1).max(256) }).strict().parse({ schoolCode: formData.get("schoolCode"), staffNo: formData.get("staffNo"), password: formData.get("password") });
    return await completeLogin(previous, { identifier: localTeacherIdentifier(input.schoolCode, input.staffNo), password: input.password, role: "TEACHER", destination: "/teacher" });
  } catch { return invalid(previous); }
}

export async function loginStudentAction(previous: LocalLoginState, formData: FormData): Promise<LocalLoginState> {
  try {
    const input = z.object({ schoolCode: z.string().transform(normalizeSchoolCode).pipe(schoolCodeSchema), studentNo: z.string().transform(normalizeStudentNo).pipe(z.string().regex(/^[0-9]{6,32}$/u)), password: z.string().min(1).max(256) }).strict().parse({ schoolCode: formData.get("schoolCode"), studentNo: formData.get("studentNo"), password: formData.get("password") });
    return await completeLogin(previous, { identifier: localStudentIdentifier(input.schoolCode, input.studentNo), password: input.password, role: "STUDENT", destination: "/student" });
  } catch { return invalid(previous); }
}

export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies();
  await revokeLocalSession(getDatabaseClient(), cookieStore.get(LOCAL_SESSION_COOKIE)?.value);
  cookieStore.delete(LOCAL_SESSION_COOKIE);
  redirect("/");
}
