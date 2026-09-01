"use server";

import { cookies } from "next/headers";
import { redirect, RedirectType } from "next/navigation";
import {
  adminIdentifier,
  authenticate,
  hashSessionToken,
  SESSION_COOKIE,
  sessionCookieIsSecure,
  studentIdentifier,
  teacherIdentifier,
} from "../../server/auth/local-auth";
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
    secure: sessionCookieIsSecure(),
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
    secure: sessionCookieIsSecure(),
    path: "/",
    maxAge: 0,
  });
  redirect("/");
}
