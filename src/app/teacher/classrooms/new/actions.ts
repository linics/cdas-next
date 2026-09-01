"use server";

import { randomUUID } from "node:crypto";
import { redirect, RedirectType } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { AuthenticationError } from "../../../../server/auth/current-actor";
import {
  createClassroom,
  CreateClassroomError,
} from "../../../../server/commands/create-classroom";
import { createUiCommandContext } from "../../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../../server/db/client";

export type CreateClassroomActionState = Readonly<{
  error?: string;
  name: string;
}>;

const errorMessages: Readonly<Record<CreateClassroomError["code"], string>> = {
  FORBIDDEN: "当前账号不能创建班级。",
  ACCOUNT_DISABLED: "账号已停用，请联系管理员。",
  SCHOOL_DISABLED: "所属学校已停用，请联系管理员。",
  DUPLICATE_NAME: "你已经有同名班级了，请换一个名称。",
  IDEMPOTENCY_MISMATCH: "请求重复但内容不同，请重新提交。",
  CONCURRENT_WRITE: "系统繁忙，请稍后重试。",
};

export async function createClassroomAction(
  _previous: CreateClassroomActionState,
  formData: FormData,
): Promise<CreateClassroomActionState> {
  const name = String(formData.get("name") ?? "");
  let classroomId: string;
  try {
    const result = await createClassroom(
      getDatabaseClient(),
      await createUiCommandContext(),
      { name, idempotencyKey: `create_classroom_${randomUUID()}` },
    );
    classroomId = result.classroomId;
  } catch (error) {
    if (error instanceof CreateClassroomError) {
      return { error: errorMessages[error.code], name };
    }
    if (error instanceof AuthenticationError) {
      return { error: "登录状态已失效，请重新登录。", name };
    }
    if (error instanceof ZodError) {
      return { error: "班级名称需为 1–120 个字符。", name };
    }
    console.error("Classroom creation action failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return { error: "创建失败，请稍后重试。", name };
  }
  revalidatePath("/teacher");
  redirect(`/teacher/classrooms/${classroomId}/members`, RedirectType.push);
}
