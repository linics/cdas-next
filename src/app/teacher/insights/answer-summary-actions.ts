"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  ReleaseAnswerSummaryError,
  summarizeReleaseAnswers,
} from "../../../server/assistant/release-answer-summary";
import { AuthenticationError } from "../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../server/db/client";

export type AnswerSummaryActionState = Readonly<{
  status: "idle" | "stale" | "unavailable" | "error";
  message: string;
}>;

const messages: Record<ReleaseAnswerSummaryError["code"], AnswerSummaryActionState> = {
  STALE_ANSWERS: { status: "stale", message: "归纳期间有学生提交或重交了作答，这次没有保存结果。请再点一次。" },
  TOO_FEW_ANSWERS: { status: "stale", message: "这一阶段有文字的作答不足 3 份，直接读原文更快。" },
  NOT_FOUND: { status: "error", message: "当前无法读取这次发布。" },
  INVALID_OUTPUT: { status: "error", message: "AI 这次给出的共同点在学生原文里找不到出处，已丢弃。可以直接重试。" },
  AI_UNAVAILABLE: { status: "unavailable", message: "AI 归纳暂时不可用，其余诊断不受影响。" },
  PROVIDER_FAILED: { status: "unavailable", message: "AI 归纳暂时不可用，其余诊断不受影响。" },
};

export async function summarizeAnswersAction(
  _previous: AnswerSummaryActionState,
  formData: FormData,
): Promise<AnswerSummaryActionState> {
  const input = z
    .object({ releaseId: z.uuid(), phaseIndex: z.coerce.number().int().min(0).max(99) })
    .safeParse({
      releaseId: formData.get("releaseId"),
      phaseIndex: formData.get("phaseIndex"),
    });
  if (!input.success) {
    return { status: "error", message: "请求格式不正确，请刷新后再试。" };
  }
  try {
    const database = getDatabaseClient();
    const context = await createUiCommandContext(database);
    await summarizeReleaseAnswers(database, context, input.data);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return { status: "error", message: "登录状态已失效，请重新登录后再试。" };
    }
    if (error instanceof ReleaseAnswerSummaryError) return messages[error.code];
    throw error;
  }
  // Same path plus a hash is a client-side scroll; without this the page
  // would keep showing the pre-action render.
  revalidatePath("/teacher/insights");
  redirect(`/teacher/insights?release=${input.data.releaseId}#answers`);
}
