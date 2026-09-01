"use server";

import { redirect, RedirectType } from "next/navigation";
import { ZodError } from "zod";
import { registerTeacherWithInvite, RegisterTeacherError } from "../../../server/commands/register-teacher";
import { getDatabaseClient } from "../../../server/db/client";

export type RegisterTeacherActionState = {
  error?: string;
  schoolCode: string;
  staffNo: string;
  displayName: string;
};

export const idleRegisterTeacherState: RegisterTeacherActionState = {
  schoolCode: "",
  staffNo: "",
  displayName: "",
};

export async function registerTeacherAction(
  _previous: RegisterTeacherActionState,
  formData: FormData,
): Promise<RegisterTeacherActionState> {
  const schoolCode = String(formData.get("schoolCode") ?? "");
  const staffNo = String(formData.get("staffNo") ?? "");
  const displayName = String(formData.get("displayName") ?? "");
  try {
    await registerTeacherWithInvite(getDatabaseClient(), {
    schoolCode,
    inviteCode: String(formData.get("inviteCode") ?? ""),
    staffNo,
    displayName,
    password: String(formData.get("password") ?? ""),
    });
    redirect("/teacher/login", RedirectType.replace);
  } catch (error) {
    const message = error instanceof RegisterTeacherError
      ? error.code === "INVALID_INVITE" ? "学校代码或邀请码不正确。"
        : error.code === "SCHOOL_DISABLED" ? "学校已停用。"
          : "该教师账号已存在或已开通。"
      : error instanceof ZodError ? "请检查表单信息。" : "开通失败，请稍后重试。";
    return { error: message, schoolCode, staffNo, displayName };
  }
}
