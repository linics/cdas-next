"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  ActivityDraftDiagnosisError,
  diagnoseActivityDraft,
} from "../../../../server/assistant/activity-draft-diagnosis";
import { AuthenticationError } from "../../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../../server/db/client";

export type DiagnosisActionState = Readonly<{
  status: "idle" | "stale" | "unavailable" | "error";
  message: string;
}>;

const messages: Record<ActivityDraftDiagnosisError["code"], DiagnosisActionState> = {
  STALE_VERSION: { status: "stale", message: "草稿已在别处保存，这次没有记录检查结果。请刷新后再检查最新版本。" },
  NOT_DIAGNOSABLE: { status: "stale", message: "这份草稿已发布或不是新版任务书，不能检查。" },
  NOT_FOUND: { status: "error", message: "当前无法读取这份草稿。" },
  INVALID_OUTPUT: { status: "error", message: "AI 这次的结果无法对应到任务书的具体位置，已丢弃。可以直接重试。" },
  AI_UNAVAILABLE: { status: "unavailable", message: "AI 检查暂时不可用，草稿不受影响。" },
  PROVIDER_FAILED: { status: "unavailable", message: "AI 检查暂时不可用，草稿不受影响。" },
};

export async function diagnoseDraftAction(
  _previous: DiagnosisActionState,
  formData: FormData,
): Promise<DiagnosisActionState> {
  const input = z
    .object({ draftId: z.uuid(), expectedVersion: z.coerce.number().int().positive() })
    .safeParse({
      draftId: formData.get("draftId"),
      expectedVersion: formData.get("expectedVersion"),
    });
  if (!input.success) {
    return { status: "error", message: "请求格式不正确，请刷新后再试。" };
  }
  try {
    const database = getDatabaseClient();
    const context = await createUiCommandContext(database);
    await diagnoseActivityDraft(database, context, input.data);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return { status: "error", message: "登录状态已失效，请重新登录后再试。" };
    }
    if (error instanceof ActivityDraftDiagnosisError) return messages[error.code];
    throw error;
  }
  // Same path plus a hash is a client-side scroll; without this the page
  // would keep showing the pre-action render.
  revalidatePath(`/teacher/activities/${input.data.draftId}`);
  redirect(`/teacher/activities/${input.data.draftId}#draft-diagnosis`);
}
