"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { TeacherIdentityActionState, TeacherWorkspaceActionState } from "./identity-action-state";
import {
  normalizeSchoolCode,
  schoolCodeSchema,
} from "../../domain/school/identity";
import { teacherProfileFieldsSchema } from "../../domain/school/teacher-profile";
import { AuthenticationError } from "../../server/auth/current-actor";
import { createClassroom, CreateClassroomError } from "../../server/commands/create-classroom";
import { createUiCommandContext } from "../../server/commands/create-ui-command-context";
import { registerTeacher, registerTeacherInputSchema, TeacherRegistrationError, verifyTeacherInvite } from "../../server/commands/register-teacher";
import { updateTeacherProfile, UpdateTeacherProfileError } from "../../server/commands/update-teacher-profile";
import { getDatabaseClient } from "../../server/db/client";

const idempotencyKey = z.string().trim().min(8).max(200);
const schoolCode = z.string().transform(normalizeSchoolCode).pipe(schoolCodeSchema);

function hasExactFields(formData: FormData, fields: readonly string[]): boolean {
  const submitted = Array.from(formData.keys()).filter((key) => !key.startsWith("$ACTION_"));
  return submitted.every((key) => fields.includes(key)) && fields.every((key) => formData.getAll(key).length === 1);
}

function workspaceFailure(previous: TeacherWorkspaceActionState, error: unknown): TeacherWorkspaceActionState {
  if (error instanceof z.ZodError) return { status: "validation_error", message: "请检查填写内容，未执行任何变更。" };
  if (error instanceof AuthenticationError || error instanceof UpdateTeacherProfileError || error instanceof CreateClassroomError) {
    return { status: "error", message: "当前账号无权执行此操作，未执行任何变更。" };
  }
  return { ...previous, status: "error", message: "服务器暂时无法完成操作；没有确认新的结果。" };
}

export async function verifyTeacherInviteAction(
  previous: TeacherIdentityActionState,
  formData: FormData,
): Promise<TeacherIdentityActionState> {
  if (!hasExactFields(formData, ["schoolCode", "teacherInviteCode"])) {
    return { ...previous, status: "validation_error", message: "请完整填写学校代码和邀请码。", schoolName: null, schoolCode: null };
  }
  try {
    const input = z.object({ schoolCode, teacherInviteCode: z.string().trim().min(16).max(200) }).strict().parse({
      schoolCode: formData.get("schoolCode"), teacherInviteCode: formData.get("teacherInviteCode"),
    });
    const verified = await verifyTeacherInvite(getDatabaseClient(), input);
    if (!verified) {
      return { ...previous, status: "error", message: "邀请码无效或已失效。", schoolName: null, schoolCode: null };
    }
    return { status: "verified", message: "邀请码已验证，请继续填写教师资料。", schoolName: verified.schoolName, schoolCode: verified.schoolCode };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { ...previous, status: "validation_error", message: "请检查学校代码和邀请码格式。", schoolName: null, schoolCode: null };
    }
    return { ...previous, status: "error", message: "暂时无法验证邀请码；未显示学校信息。", schoolName: null, schoolCode: null };
  }
}

export async function registerTeacherAction(
  previous: TeacherIdentityActionState,
  formData: FormData,
): Promise<TeacherIdentityActionState> {
  const fields = ["schoolCode", "teacherInviteCode", "staffNo", "displayName", "primaryDisciplineCode", "secondaryDisciplineCodes", "password"];
  if (!hasExactFields(formData, fields)) {
    return { ...previous, status: "validation_error", message: "提交字段不完整或包含未允许内容。" };
  }
  try {
    const input = registerTeacherInputSchema.parse({
      schoolCode: formData.get("schoolCode"),
      teacherInviteCode: formData.get("teacherInviteCode"),
      staffNo: formData.get("staffNo"),
      displayName: formData.get("displayName"),
      primaryDisciplineCode: formData.get("primaryDisciplineCode"),
      secondaryDisciplineCodes: String(
        formData.get("secondaryDisciplineCodes") ?? "",
      )
        .split(",")
        .filter(Boolean),
      password: formData.get("password"),
    });
    await registerTeacher(getDatabaseClient(), input);
    return { status: "success", message: "教师账号已开通。请使用学校代码、工号和密码登录。", schoolName: previous.schoolName, schoolCode: input.schoolCode };
  } catch (error) {
    if (error instanceof z.ZodError) return { ...previous, status: "validation_error", message: "请检查姓名、工号、学科和密码。" };
    if (error instanceof TeacherRegistrationError) {
      const message = error.code === "INVALID_INVITE" ? "邀请码无效或已失效。" : error.code === "STAFF_NO_TAKEN" ? "该学校内的工号已被使用。" : "账号开通尚未完成；可用相同资料安全重试。";
      return { ...previous, status: "error", message };
    }
    return { ...previous, status: "error", message: "暂时无法开通账号；未确认新的教师身份。" };
  }
}

export async function updateTeacherProfileAction(
  previous: TeacherWorkspaceActionState,
  formData: FormData,
): Promise<TeacherWorkspaceActionState> {
  const fields = ["displayName", "primaryDisciplineCode", "secondaryDisciplineCodes", "idempotencyKey"];
  if (!hasExactFields(formData, fields)) return { ...previous, status: "validation_error", message: "提交字段不完整或包含未允许内容。" };
  try {
    const values = teacherProfileFieldsSchema.parse({
      displayName: formData.get("displayName"),
      primaryDisciplineCode: formData.get("primaryDisciplineCode"),
      secondaryDisciplineCodes: String(formData.get("secondaryDisciplineCodes") ?? "").split(",").filter(Boolean),
    });
    const key = idempotencyKey.parse(formData.get("idempotencyKey"));
    await updateTeacherProfile(getDatabaseClient(), await createUiCommandContext(), { ...values, idempotencyKey: key });
    revalidatePath("/teacher");
    revalidatePath("/teacher/profile");
    return { status: "success", message: "教师资料已更新。" };
  } catch (error) {
    return workspaceFailure(previous, error);
  }
}

export async function createClassroomAction(
  previous: TeacherWorkspaceActionState,
  formData: FormData,
): Promise<TeacherWorkspaceActionState> {
  if (!hasExactFields(formData, ["name", "idempotencyKey"])) return { ...previous, status: "validation_error", message: "提交字段不完整或包含未允许内容。" };
  try {
    const input = z.object({ name: z.string().trim().min(1).max(120), idempotencyKey }).strict().parse({
      name: formData.get("name"), idempotencyKey: formData.get("idempotencyKey"),
    });
    await createClassroom(getDatabaseClient(), await createUiCommandContext(), input);
    revalidatePath("/teacher");
    revalidatePath("/teacher/classrooms");
    return { status: "success", message: "班级已创建。可进入成员管理页继续维护名单。" };
  } catch (error) {
    return workspaceFailure(previous, error);
  }
}
