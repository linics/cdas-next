"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { AuthenticationError } from "../../server/auth/current-actor";
import { createUiCommandContext } from "../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../server/db/client";
import {
  createSchool,
  resetSchoolTeacherInvite,
  SchoolAdminCommandError,
  setSchoolStatus,
  updateSchoolName,
} from "../../server/commands/admin-school-commands";
import {
  registerSchoolTeacher,
  issueTeacherOneTimePassword,
  setTeacherAccountStatus,
  TeacherAdminCommandError,
} from "../../server/commands/admin-teacher-commands";
import {
  idleAdminActionState,
  type AdminActionState,
} from "./action-state";

function fail(message: string): AdminActionState {
  return {
    status: "error",
    message,
    inviteCode: null,
    oneTimePassword: null,
  };
}

function commandErrorMessage(error: unknown): string {
  if (error instanceof AuthenticationError) {
    return "当前账号不能执行管理员操作。";
  }
  if (error instanceof SchoolAdminCommandError || error instanceof TeacherAdminCommandError) {
    if (error.code === "FORBIDDEN") return "没有管理员权限。";
    if (error.code === "NOT_FOUND") return "找不到对应的学校或教师。";
    if (error.code === "STAFF_NO_CONFLICT") return "该校已有相同工号。";
    if (error.code === "SCHOOL_DISABLED") return "已停用的学校不能再登记教师。";
    if (error.code === "IDEMPOTENCY_MISMATCH") return "重复提交的内容不一致，请刷新后重试。";
    return "保存时发生冲突，请稍后重试。";
  }
  return "操作未能完成。";
}

export async function createSchoolAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    const result = await createSchool(
      getDatabaseClient(),
      await createUiCommandContext(),
      {
        name: String(formData.get("name") ?? ""),
        idempotencyKey: `ui_create_school_${randomUUID()}`,
      },
    );
    refresh();
    return {
      status: "success",
      message: `已创建学校 ${result.schoolCode}`,
      inviteCode: result.teacherInviteCode,
      oneTimePassword: null,
    };
  } catch (error) {
    return fail(commandErrorMessage(error));
  }
}

export async function updateSchoolNameAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await updateSchoolName(getDatabaseClient(), await createUiCommandContext(), {
      schoolId: String(formData.get("schoolId") ?? ""),
      name: String(formData.get("name") ?? ""),
      idempotencyKey: `ui_rename_school_${randomUUID()}`,
    });
    refresh();
    return {
      status: "success",
      message: "已更新学校名称。",
      inviteCode: null,
      oneTimePassword: null,
    };
  } catch (error) {
    return fail(commandErrorMessage(error));
  }
}

export async function setSchoolStatusAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    const status = String(formData.get("status") ?? "");
    await setSchoolStatus(getDatabaseClient(), await createUiCommandContext(), {
      schoolId: String(formData.get("schoolId") ?? ""),
      status: status === "DISABLED" ? "DISABLED" : "ACTIVE",
      idempotencyKey: `ui_school_status_${randomUUID()}`,
    });
    refresh();
    return {
      status: "success",
      message: status === "DISABLED" ? "已停用该校。" : "已恢复该校。",
      inviteCode: null,
      oneTimePassword: null,
    };
  } catch (error) {
    return fail(commandErrorMessage(error));
  }
}

export async function resetSchoolTeacherInviteAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    const result = await resetSchoolTeacherInvite(
      getDatabaseClient(),
      await createUiCommandContext(),
      {
        schoolId: String(formData.get("schoolId") ?? ""),
        idempotencyKey: `ui_reset_invite_${randomUUID()}`,
      },
    );
    refresh();
    return {
      status: "success",
      message: "已重置教师邀请码。明文只出现这一次。",
      inviteCode: result.teacherInviteCode,
      oneTimePassword: null,
    };
  } catch (error) {
    return fail(commandErrorMessage(error));
  }
}

export async function registerSchoolTeacherAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await registerSchoolTeacher(
      getDatabaseClient(),
      await createUiCommandContext(),
      {
        schoolId: String(formData.get("schoolId") ?? ""),
        displayName: String(formData.get("displayName") ?? ""),
        staffNo: String(formData.get("staffNo") ?? ""),
        idempotencyKey: `ui_register_teacher_${randomUUID()}`,
      },
    );
    refresh();
    return {
      status: "success",
      message: "已登记教师。登录凭据将在本地认证切片开通。",
      inviteCode: null,
      oneTimePassword: null,
    };
  } catch (error) {
    return fail(commandErrorMessage(error));
  }
}

export async function setTeacherAccountStatusAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    const accountStatus = String(formData.get("accountStatus") ?? "");
    await setTeacherAccountStatus(
      getDatabaseClient(),
      await createUiCommandContext(),
      {
        teacherId: String(formData.get("teacherId") ?? ""),
        accountStatus: accountStatus === "DISABLED" ? "DISABLED" : "ACTIVE",
        idempotencyKey: `ui_teacher_status_${randomUUID()}`,
      },
    );
    refresh();
    return {
      status: "success",
      message: accountStatus === "DISABLED" ? "已停用该教师。" : "已恢复该教师。",
      inviteCode: null,
      oneTimePassword: null,
    };
  } catch (error) {
    return fail(commandErrorMessage(error));
  }
}

export async function issueTeacherPasswordAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    const result = await issueTeacherOneTimePassword(
      getDatabaseClient(),
      await createUiCommandContext(),
      {
        teacherId: String(formData.get("teacherId") ?? ""),
        idempotencyKey: `ui_issue_teacher_password_${randomUUID()}`,
      },
    );
    refresh();
    return {
      status: "success",
      message: "一次性密码仅显示这一次，教师首次登录后必须改密。",
      inviteCode: null,
      oneTimePassword: result.oneTimePassword,
    };
  } catch (error) {
    if (
      error instanceof TeacherAdminCommandError &&
      error.code === "PASSWORD_ALREADY_ISSUED"
    ) {
      return fail("该请求已签发过一次性密码，请生成新的签发请求。");
    }
    return fail(commandErrorMessage(error));
  }
}

export async function schoolManagerAction(
  previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  switch (String(formData.get("operation") ?? "")) {
    case "create":
      return createSchoolAction(previous, formData);
    case "rename":
      return updateSchoolNameAction(previous, formData);
    case "status":
      return setSchoolStatusAction(previous, formData);
    case "reset-invite":
      return resetSchoolTeacherInviteAction(previous, formData);
    default:
      return fail("无法识别这次学校操作，请刷新后重试。");
  }
}

export async function teacherManagerAction(
  previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  switch (String(formData.get("operation") ?? "")) {
    case "register":
      return registerSchoolTeacherAction(previous, formData);
    case "status":
      return setTeacherAccountStatusAction(previous, formData);
    case "issue-password":
      return issueTeacherPasswordAction(previous, formData);
    default:
      return fail("无法识别这次教师操作，请刷新后重试。");
  }
}

export { idleAdminActionState };
