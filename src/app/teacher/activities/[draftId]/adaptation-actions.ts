"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { activityContentV3Schema } from "../../../../domain/activity/activity-content";
import {
  activityAdaptationRequestSchema,
  adaptableTaskBookAreas,
  type AdaptationRequestProblem,
} from "../../../../domain/activity/activity-adaptation";
import {
  ActivityAdaptationSuggestionError,
  discardActivityAdaptation,
  suggestActivityAdaptation,
} from "../../../../server/assistant/activity-adaptation-suggestion";
import { AuthenticationError } from "../../../../server/auth/current-actor";
import {
  applyActivityAdaptation,
  ApplyActivityAdaptationError,
} from "../../../../server/commands/apply-activity-adaptation";
import { createUiCommandContext } from "../../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../../server/db/client";
import type {
  AdaptationApplyState,
  AdaptationSuggestionState,
} from "./adaptation-action-state";

const optionalFormInteger = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length > 0 ? value : null,
  z.coerce.number().int().nullable(),
);

const suggestFormSchema = z
  .object({
    draftId: z.uuid(),
    expectedVersion: z.coerce.number().int().positive(),
    targetGrade: optionalFormInteger,
    totalLessons: optionalFormInteger,
    contextNote: z.string(),
    areas: z.array(z.enum(adaptableTaskBookAreas)),
  })
  .strict();

const requestProblemMessages: Record<AdaptationRequestProblem, string> = {
  NOTHING_TO_ADAPT: "请至少指定新的年级、总课时或新情境说明中的一项。",
  GRADE_INCOMPATIBLE:
    "所选学科或核心素养不适用于目标年级。请先在表单中调整学科设置，再做适配。",
  LESSONS_NEED_PHASES: "调整总课时需要同时允许改写「任务链阶段」。",
  LESSONS_TOO_FEW: "总课时不能少于阶段数，每个阶段至少 1 课时。",
};

function suggestionState(
  status: AdaptationSuggestionState["status"],
  message: string,
): AdaptationSuggestionState {
  return { status, message, suggestion: null };
}

export async function suggestActivityAdaptationAction(
  _previous: AdaptationSuggestionState,
  formData: FormData,
): Promise<AdaptationSuggestionState> {
  const parsed = suggestFormSchema.safeParse({
    draftId: formData.get("draftId"),
    expectedVersion: formData.get("expectedVersion"),
    targetGrade: formData.get("targetGrade"),
    totalLessons: formData.get("totalLessons"),
    contextNote: formData.get("contextNote") ?? "",
    areas: formData.getAll("areas"),
  });
  if (!parsed.success) {
    return suggestionState("error", "适配请求格式不正确，请刷新后再试。");
  }
  const request = activityAdaptationRequestSchema.safeParse({
    targetGrade: parsed.data.targetGrade,
    totalLessons: parsed.data.totalLessons,
    contextNote: parsed.data.contextNote,
    areas: parsed.data.areas,
  });
  if (!request.success) {
    return suggestionState(
      "invalid_request",
      parsed.data.areas.length === 0
        ? "请至少选择一个允许 AI 改写的区域。"
        : "请检查年级（1–9）、总课时（3–64）和情境说明（500 字以内）。",
    );
  }

  try {
    const database = getDatabaseClient();
    const context = await createUiCommandContext(database);
    const suggestion = await suggestActivityAdaptation(database, context, {
      draftId: parsed.data.draftId,
      expectedVersion: parsed.data.expectedVersion,
      request: request.data,
    });
    return {
      status: "suggested",
      message: `AI 提出了 ${suggestion.changes.length} 处改写。逐处核对后再决定是否写入。`,
      suggestion: {
        agentRunId: suggestion.agentRunId,
        baseVersion: suggestion.baseVersion,
        content: suggestion.content,
        changes: suggestion.changes,
      },
    };
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return suggestionState("unauthorized", "登录状态已失效，请重新登录后再试。");
    }
    if (error instanceof ActivityAdaptationSuggestionError) {
      switch (error.code) {
        case "NOTHING_TO_ADAPT":
        case "GRADE_INCOMPATIBLE":
        case "LESSONS_NEED_PHASES":
        case "LESSONS_TOO_FEW":
          return suggestionState("invalid_request", requestProblemMessages[error.code]);
        case "STALE_VERSION":
        case "NOT_ADAPTABLE":
          return suggestionState(
            "stale",
            "草稿已在别处保存或已发布，这次没有生成建议。请刷新后基于最新版本再试。",
          );
        case "NOT_FOUND":
          return suggestionState("unauthorized", "当前无法读取这份草稿。");
        case "INVALID_OUTPUT":
          return suggestionState(
            "error",
            "AI 这次的改写不符合任务书结构，已丢弃，草稿没有变化。可以直接重试。",
          );
        case "AI_UNAVAILABLE":
        case "PROVIDER_FAILED":
          return suggestionState(
            "unavailable",
            "AI 适配暂时不可用。草稿没有变化，仍可在下方表单手工修改。",
          );
      }
    }
    throw error;
  }
}

const applyFormSchema = z
  .object({
    draftId: z.uuid(),
    expectedVersion: z.coerce.number().int().positive(),
    agentRunId: z.uuid(),
    content: z.string().max(200_000),
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .strict();

export async function applyActivityAdaptationAction(
  _previous: AdaptationApplyState,
  formData: FormData,
): Promise<AdaptationApplyState> {
  const parsed = applyFormSchema.safeParse({
    draftId: formData.get("draftId"),
    expectedVersion: formData.get("expectedVersion"),
    agentRunId: formData.get("agentRunId"),
    content: formData.get("content"),
    idempotencyKey: formData.get("idempotencyKey"),
  });
  if (!parsed.success) {
    return { status: "error", message: "确认请求格式不正确，请刷新后再试。" };
  }
  let content;
  try {
    content = activityContentV3Schema.parse(JSON.parse(parsed.data.content));
  } catch {
    return { status: "error", message: "改写内容无法读取，没有写入。请重新生成建议。" };
  }

  let database;
  let context;
  try {
    database = getDatabaseClient();
    context = await createUiCommandContext(database);
    await applyActivityAdaptation(database, context, {
      draftId: parsed.data.draftId,
      expectedVersion: parsed.data.expectedVersion,
      agentRunId: parsed.data.agentRunId,
      content,
      idempotencyKey: parsed.data.idempotencyKey,
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return { status: "error", message: "登录状态已失效，没有写入。请重新登录后再试。" };
    }
    if (error instanceof ApplyActivityAdaptationError) {
      if (
        database &&
        context &&
        (error.code === "STALE_VERSION" || error.code === "DRAFT_SEALED")
      ) {
        // The proposal can no longer be applied; end its run rather than
        // leaving it live.
        await discardActivityAdaptation(database, context, parsed.data.agentRunId).catch(
          () => undefined,
        );
      }
      if (error.code === "STALE_VERSION" || error.code === "DRAFT_SEALED") {
        return {
          status: "stale",
          message: "草稿在生成建议后已被修改或发布，这份建议没有写入。请刷新后重新生成。",
        };
      }
      if (error.code === "ALREADY_APPLIED") {
        redirect(`/teacher/activities/${parsed.data.draftId}`);
      }
      return {
        status: "error",
        message:
          error.code === "INVALID_SUGGESTION"
            ? "这份建议已失效或内容与生成时不一致，没有写入。请重新生成。"
            : "写入没有完成，草稿保持原样。请稍后重试。",
      };
    }
    throw error;
  }
  redirect(`/teacher/activities/${parsed.data.draftId}?adapted=1`);
}

export async function discardActivityAdaptationAction(formData: FormData) {
  const agentRunId = z.uuid().safeParse(formData.get("agentRunId"));
  if (!agentRunId.success) return;
  try {
    const database = getDatabaseClient();
    const context = await createUiCommandContext(database);
    await discardActivityAdaptation(database, context, agentRunId.data);
  } catch {
    // Discarding only closes provenance; the draft is untouched either way.
  }
}
