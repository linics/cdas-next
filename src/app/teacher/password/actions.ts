"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { findLocalSessionActor, LOCAL_SESSION_COOKIE, replaceLocalPassword } from "../../../server/auth/local-auth";
import { getDatabaseClient } from "../../../server/db/client";
import type { ChangePasswordState } from "./state";

export async function changeTeacherPasswordAction(_previous: ChangePasswordState, formData: FormData): Promise<ChangePasswordState> {
  try {
    const input = z.object({ password: z.string().min(10).max(256), confirmation: z.string().min(10).max(256) }).strict().parse({ password: formData.get("password"), confirmation: formData.get("confirmation") });
    if (input.password !== input.confirmation) return { status: "error", message: "两次输入的密码不一致。" };
    const cookieStore = await cookies();
    const database = getDatabaseClient();
    const actor = await findLocalSessionActor(database, cookieStore.get(LOCAL_SESSION_COOKIE)?.value);
    if (!actor || actor.role !== "TEACHER" || actor.accountStatus !== "ACTIVE" || !actor.school || actor.school.status !== "ACTIVE") return { status: "error", message: "当前会话已失效，请重新登录。" };
    await replaceLocalPassword(database, { userId: actor.id, password: input.password, mustChangePassword: false });
    cookieStore.delete(LOCAL_SESSION_COOKIE);
  } catch { return { status: "error", message: "无法设置新密码，请检查输入后重新登录。" }; }
  redirect("/teacher/login");
}
