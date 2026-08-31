"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AdminActionState } from "./action-state";
import { databaseUuidSchema } from "../../domain/school/identity";
import { AuthenticationError } from "../../server/auth/current-actor";
import {
  createSchool,
  resetSchoolTeacherInvite,
  SchoolAdminCommandError,
  setSchoolStatus,
  updateSchoolName,
} from "../../server/commands/admin-school-commands";
import {
  resetTeacherPassword,
  setTeacherAccountStatus,
  TeacherAdminCommandError,
} from "../../server/commands/admin-teacher-commands";
import { createUiCommandContext } from "../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../server/db/client";

const uuid = z.uuid();
const schoolId = databaseUuidSchema;
const idempotencyKey = z.string().trim().min(8).max(200);
const schoolName = z.string().trim().min(1).max(120);

function hasExactFields(formData: FormData, fields: readonly string[]): boolean {
  const submitted = Array.from(formData.keys()).filter((key) => !key.startsWith("$ACTION_"));
  return submitted.every((key) => fields.includes(key)) && fields.every((key) => formData.getAll(key).length === 1);
}

function fail(
  previous: AdminActionState,
  message: string,
  status: AdminActionState["status"] = "error",
  canRetry = false,
): AdminActionState {
  return { ...previous, status, message, oneTimeLabel: null, oneTimeValue: null, canRetry };
}

function failure(previous: AdminActionState, error: unknown): AdminActionState {
  if (error instanceof z.ZodError) {
    return fail(previous, "提交内容不完整或格式不正确，未执行任何变更。", "validation_error");
  }
  if (error instanceof AuthenticationError) {
    return fail(previous, "管理员登录状态不可用，未执行任何变更。");
  }
  if (error instanceof SchoolAdminCommandError || error instanceof TeacherAdminCommandError) {
    if (error.code === "FORBIDDEN" || error.code === "NOT_FOUND") {
      return fail(previous, "当前账号无权访问该资源，未执行任何变更。");
    }
    if (error.code === "IDEMPOTENCY_MISMATCH") {
      return fail(previous, "该操作编号已用于不同请求，请刷新页面后重试。", "validation_error");
    }
  }
  return fail(previous, "服务器暂时无法完成操作；没有确认新的结果。");
}

function success(
  message: string,
  secret?: { label: string; value: string | null },
): AdminActionState {
  return {
    status: "success",
    message,
    oneTimeLabel: secret?.label ?? null,
    oneTimeValue: secret?.value ?? null,
    canRetry: false,
  };
}

export async function createSchoolAction(
  previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  if (!hasExactFields(formData, ["name", "idempotencyKey"])) {
    return fail(previous, "提交字段不完整或包含未允许内容。", "validation_error");
  }
  try {
    const input = z.object({ name: schoolName, idempotencyKey }).strict().parse({
      name: formData.get("name"),
      idempotencyKey: formData.get("idempotencyKey"),
    });
    const result = await createSchool(getDatabaseClient(), await createUiCommandContext(), input);
    revalidatePath("/admin");
    revalidatePath("/admin/schools");
    return success(
      result.teacherInviteCode
        ? `已创建学校 ${result.schoolCode}。请立即保存教师邀请码。`
        : `学校 ${result.schoolCode} 已存在；邀请码不会再次展示。`,
      { label: "教师邀请码（仅本次显示）", value: result.teacherInviteCode },
    );
  } catch (error) {
    return failure(previous, error);
  }
}

export async function updateSchoolNameAction(
  previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  if (!hasExactFields(formData, ["schoolId", "name", "idempotencyKey"])) {
    return fail(previous, "提交字段不完整或包含未允许内容。", "validation_error");
  }
  try {
    const input = z.object({ schoolId, name: schoolName, idempotencyKey }).strict().parse({
      schoolId: formData.get("schoolId"), name: formData.get("name"), idempotencyKey: formData.get("idempotencyKey"),
    });
    await updateSchoolName(getDatabaseClient(), await createUiCommandContext(), input);
    revalidatePath("/admin");
    revalidatePath("/admin/schools");
    return success("学校名称已更新。");
  } catch (error) {
    return failure(previous, error);
  }
}

export async function setSchoolStatusAction(
  previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  if (!hasExactFields(formData, ["schoolId", "status", "idempotencyKey"])) {
    return fail(previous, "提交字段不完整或包含未允许内容。", "validation_error");
  }
  try {
    const input = z.object({ schoolId, status: z.enum(["ACTIVE", "DISABLED"]), idempotencyKey }).strict().parse({
      schoolId: formData.get("schoolId"), status: formData.get("status"), idempotencyKey: formData.get("idempotencyKey"),
    });
    await setSchoolStatus(getDatabaseClient(), await createUiCommandContext(), input);
    revalidatePath("/admin");
    revalidatePath("/admin/schools");
    return success(input.status === "ACTIVE" ? "学校已启用。" : "学校已停用；该校账号随后将无法进入业务工作区。");
  } catch (error) {
    return failure(previous, error);
  }
}

export async function resetSchoolTeacherInviteAction(
  previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  if (!hasExactFields(formData, ["schoolId", "idempotencyKey"])) {
    return fail(previous, "提交字段不完整或包含未允许内容。", "validation_error");
  }
  try {
    const input = z.object({ schoolId, idempotencyKey }).strict().parse({
      schoolId: formData.get("schoolId"), idempotencyKey: formData.get("idempotencyKey"),
    });
    const result = await resetSchoolTeacherInvite(getDatabaseClient(), await createUiCommandContext(), input);
    revalidatePath("/admin/schools");
    return success(
      result.teacherInviteCode ? "已重置邀请码；旧码立即失效。请立即保存新码。" : "这次重置已完成；邀请码不会再次展示。",
      { label: "新教师邀请码（仅本次显示）", value: result.teacherInviteCode },
    );
  } catch (error) {
    return failure(previous, error);
  }
}

export async function setTeacherAccountStatusAction(
  previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  if (!hasExactFields(formData, ["teacherId", "accountStatus", "idempotencyKey"])) {
    return fail(previous, "提交字段不完整或包含未允许内容。", "validation_error");
  }
  try {
    const input = z.object({ teacherId: uuid, accountStatus: z.enum(["ACTIVE", "DISABLED"]), idempotencyKey }).strict().parse({
      teacherId: formData.get("teacherId"), accountStatus: formData.get("accountStatus"), idempotencyKey: formData.get("idempotencyKey"),
    });
    await setTeacherAccountStatus(getDatabaseClient(), await createUiCommandContext(), input);
    revalidatePath("/admin");
    revalidatePath("/admin/teachers");
    return success(input.accountStatus === "ACTIVE" ? "教师账号已启用。" : "教师账号已停用；该账号随后将无法进入教师工作区。");
  } catch (error) {
    return failure(previous, error);
  }
}

export async function resetTeacherPasswordAction(
  previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  if (!hasExactFields(formData, ["teacherId", "idempotencyKey"])) {
    return fail(previous, "提交字段不完整或包含未允许内容。", "validation_error");
  }
  try {
    const input = z.object({ teacherId: uuid, idempotencyKey }).strict().parse({
      teacherId: formData.get("teacherId"), idempotencyKey: formData.get("idempotencyKey"),
    });
    const result = await resetTeacherPassword(getDatabaseClient(), await createUiCommandContext(), input);
    revalidatePath("/admin/teachers");
    return success(
      result.temporaryPassword ? "已生成一次性密码。请仅通过受控渠道交给该教师。" : "该重置请求已经完成；密码不会再次展示。",
      { label: "一次性临时密码（仅本次显示）", value: result.temporaryPassword },
    );
  } catch (error) {
    return failure(previous, error);
  }
}
