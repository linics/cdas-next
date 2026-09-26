"use server";

import { z } from "zod";
import { AuthenticationError } from "../../../server/auth/current-actor";
import {
  ActivitySourceReferenceError,
  adoptActivitySource,
} from "../../../server/commands/activity-source-references";
import { createUiCommandContext } from "../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../server/db/client";
import type { AdoptSourceState } from "./adopt-source-state";

const adoptFormSchema = z
  .object({
    draftId: z.uuid(),
    sourceId: z.string().min(1),
    sectionId: z.string().min(1),
    rationale: z.string(),
    idempotencyKey: z.string().min(8),
  })
  .strict();

const rejections: Partial<Record<ActivitySourceReferenceError["code"], string>> = {
  DRAFT_SEALED: "这份活动已经发布，依据不再变更。",
  UNSUPPORTED_SCHEMA: "只有新版任务书可以记录依据。",
  SOURCE_NOT_FOUND: "这个章节不在当前收录范围内。",
  SOURCE_NOT_APPLICABLE: "这个章节不覆盖该活动的学段或学科，没有采纳。",
  ALREADY_ADOPTED: "这份草稿已经采纳过这个章节。",
  NOT_FOUND: "找不到这份草稿。",
};

export async function adoptSourceAction(
  _previous: AdoptSourceState,
  formData: FormData,
): Promise<AdoptSourceState> {
  const parsed = adoptFormSchema.safeParse({
    draftId: formData.get("draftId"),
    sourceId: formData.get("sourceId"),
    sectionId: formData.get("sectionId"),
    rationale: formData.get("rationale") ?? "",
    idempotencyKey: formData.get("idempotencyKey"),
  });
  if (!parsed.success) {
    return { status: "rejected", message: "请选择一份草稿。", draftId: null };
  }
  const rationale = parsed.data.rationale.trim();
  if (rationale.length === 0 || rationale.length > 600) {
    return {
      status: "rejected",
      message: "请写明采用理由（600 字以内）。",
      draftId: null,
    };
  }
  try {
    const database = getDatabaseClient();
    const context = await createUiCommandContext(database);
    const result = await adoptActivitySource(database, context, {
      ...parsed.data,
      rationale,
    });
    return {
      status: "adopted",
      message: `已记录为该草稿第 ${result.revisionVersion} 版的依据。`,
      draftId: result.draftId,
    };
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return { status: "error", message: "登录状态已失效，请重新登录。", draftId: null };
    }
    if (error instanceof ActivitySourceReferenceError) {
      return {
        status: error.code in rejections ? "rejected" : "error",
        message: rejections[error.code] ?? "没有记录成功，请稍后重试。",
        draftId: null,
      };
    }
    throw error;
  }
}
