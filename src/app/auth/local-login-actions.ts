"use server";

import { cookies } from "next/headers";
import { redirect, RedirectType } from "next/navigation";
import {
  adminIdentifier,
  authenticate,
  hashSessionToken,
  SESSION_COOKIE,
  studentIdentifier,
  teacherIdentifier,
} from "../../server/auth/local-auth";
import { createDevelopmentQuickSession } from "../../server/auth/development-quick-login";
import { getDatabaseClient } from "../../server/db/client";

function rolePath(role: "ADMIN" | "TEACHER" | "STUDENT"): string {
  return role === "ADMIN" ? "/admin" : role === "TEACHER" ? "/teacher" : "/student";
}

export type LoginActionState = {
  error?: string;
  schoolCode: string;
  account: string;
};

async function loginForRole(
  formData: FormData,
  role: "ADMIN" | "TEACHER" | "STUDENT",
): Promise<LoginActionState> {
  const school = String(formData.get("schoolCode") ?? "");
  const account = String(formData.get("identifier") ?? "");
  let identifier: string;
  try {
    identifier = role === "ADMIN"
      ? adminIdentifier(account)
      : role === "TEACHER"
        ? teacherIdentifier(school, account)
        : studentIdentifier(school, account);
  } catch {
    return { error: "INVALID_CREDENTIALS", schoolCode: school, account };
  }
  const result = await authenticate(
    getDatabaseClient(), identifier, String(formData.get("password") ?? ""), role,
  );
  if (!result.ok) return { error: result.code, schoolCode: school, account };
  (await cookies()).set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 43200,
    expires: result.expiresAt,
  });
  redirect(
    result.mustChangePassword && role !== "ADMIN"
      ? `${rolePath(role)}/password`
      : rolePath(role),
    RedirectType.replace,
  );
}

export async function adminLoginAction(
  _state: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  return loginForRole(formData, "ADMIN");
}

export async function teacherLoginAction(
  _state: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  return loginForRole(formData, "TEACHER");
}

export async function studentLoginAction(
  _state: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  return loginForRole(formData, "STUDENT");
}

async function developmentQuickLoginForRole(
  role: "ADMIN" | "TEACHER" | "STUDENT",
): Promise<LoginActionState> {
  const result = await createDevelopmentQuickSession(
    getDatabaseClient(),
    role,
  );
  if (!result.ok) {
    return {
      error:
        result.code === "DEFAULT_ACCOUNT_UNAVAILABLE"
          ? "默认账号尚未准备。请先运行演示数据初始化，或创建一个已启用且无需改密的账号。"
          : "当前环境未启用快捷登录。",
      schoolCode: "",
      account: "",
    };
  }
  (await cookies()).set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 43200,
    expires: result.expiresAt,
  });
  redirect(rolePath(role), RedirectType.replace);
}

export async function developmentQuickAdminLoginAction(
  _state: LoginActionState,
  _formData: FormData,
): Promise<LoginActionState> {
  void _state;
  void _formData;
  return developmentQuickLoginForRole("ADMIN");
}

export async function developmentQuickTeacherLoginAction(
  _state: LoginActionState,
  _formData: FormData,
): Promise<LoginActionState> {
  void _state;
  void _formData;
  return developmentQuickLoginForRole("TEACHER");
}

export async function developmentQuickStudentLoginAction(
  _state: LoginActionState,
  _formData: FormData,
): Promise<LoginActionState> {
  void _state;
  void _formData;
  return developmentQuickLoginForRole("STUDENT");
}

/** One-argument variants are used by the compact identity switcher in the shell. */
export async function developmentQuickAdminEntryAction(
  _formData: FormData,
): Promise<void> {
  void _formData;
  await developmentQuickLoginForRole("ADMIN");
}

export async function developmentQuickTeacherEntryAction(
  _formData: FormData,
): Promise<void> {
  void _formData;
  await developmentQuickLoginForRole("TEACHER");
}

export async function developmentQuickStudentEntryAction(
  _formData: FormData,
): Promise<void> {
  void _formData;
  await developmentQuickLoginForRole("STUDENT");
}

export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await getDatabaseClient().authSession.updateMany({
      where: { tokenHash: hashSessionToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  redirect("/");
}
