"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "../../../../../generated/prisma/client";
import { AuthenticationError } from "../../../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../../../server/commands/create-ui-command-context";
import {
  deleteReleaseGroup,
  ManageReleaseGroupError,
  saveReleaseGroup,
  type DeleteReleaseGroupInput,
  type SaveReleaseGroupInput,
} from "../../../../../server/commands/manage-release-group";
import { getDatabaseClient } from "../../../../../server/db/client";

export type ReleaseGroupActionResult =
  | Readonly<{ ok: true; message: string }>
  | Readonly<{
      ok: false;
      code: "VALIDATION" | "UNAUTHORIZED" | "CONFLICT" | "ERROR";
      message: string;
    }>;

function failure(error: unknown): ReleaseGroupActionResult {
  if (error instanceof z.ZodError) {
    return {
      ok: false,
      code: "VALIDATION",
      message: "请填写小组名称，并至少选择一名学生；组内角色可留空。",
    };
  }
  if (
    error instanceof AuthenticationError ||
    (error instanceof ManageReleaseGroupError &&
      ["FORBIDDEN", "NOT_FOUND"].includes(error.code))
  ) {
    return {
      ok: false,
      code: "UNAUTHORIZED",
      message: "当前账号不能管理这个发布活动的小组。",
    };
  }
  if (
    error instanceof ManageReleaseGroupError ||
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      ["P2002", "P2003", "P2034"].includes(error.code))
  ) {
    return {
      ok: false,
      code: "CONFLICT",
      message:
        "小组、名单或提交状态已经变化。已有提交的小组不能再修改，请刷新后重试。",
    };
  }
  console.error("Release group action failed", {
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return {
    ok: false,
    code: "ERROR",
    message: "服务器暂时无法完成小组操作，现有分组没有被假设为已改变。",
  };
}

function revalidateReleaseGroupPaths(releaseId: string) {
  revalidatePath(`/teacher/releases/${releaseId}/submissions`);
  revalidatePath("/student");
  revalidatePath(`/student/releases/${releaseId}`);
}

export async function saveReleaseGroupAction(
  input: SaveReleaseGroupInput,
): Promise<ReleaseGroupActionResult> {
  try {
    await saveReleaseGroup(
      getDatabaseClient(),
      await createUiCommandContext(),
      input,
    );
    revalidateReleaseGroupPaths(input.releaseId);
    return { ok: true, message: input.groupId ? "小组已更新。" : "小组已创建。" };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteReleaseGroupAction(
  input: DeleteReleaseGroupInput,
): Promise<ReleaseGroupActionResult> {
  try {
    await deleteReleaseGroup(
      getDatabaseClient(),
      await createUiCommandContext(),
      input,
    );
    revalidateReleaseGroupPaths(input.releaseId);
    return { ok: true, message: "小组已删除，成员恢复为未分组状态。" };
  } catch (error) {
    return failure(error);
  }
}
