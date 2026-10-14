"use server";

import { AuthenticationError } from "../../../server/auth/current-actor";
import {
  SelectionRewriteSuggestionError,
  suggestSelectionRewrite,
} from "../../../server/assistant/selection-rewrite-suggestion";
import { createUiCommandContext } from "../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../server/db/client";

export type SelectionRewriteResult =
  | Readonly<{ status: "ok"; replacement: string; note: string; fieldText: string }>
  | Readonly<{ status: "failed"; message: string }>;

const failureMessages: Record<SelectionRewriteSuggestionError["code"], string> = {
  AI_UNAVAILABLE: "AI 暂时不可用，可以直接手动修改。",
  INVALID_REQUEST: "选中的文字和编辑器里的内容对不上，请重新选择后再试。",
  INVALID_OUTPUT: "这次没有得到可用的改写，可以再试一次或换个说法。",
  PROVIDER_FAILED: "AI 服务暂时没有响应，请稍后再试。",
};

/** D-098: a suggestion only; nothing is written until the teacher replaces the text. */
export async function suggestSelectionRewriteAction(input: unknown): Promise<SelectionRewriteResult> {
  try {
    const context = await createUiCommandContext();
    const suggestion = await suggestSelectionRewrite(getDatabaseClient(), context, input);
    return {
      status: "ok",
      replacement: suggestion.replacement,
      note: suggestion.note,
      fieldText: suggestion.fieldText,
    };
  } catch (error) {
    if (error instanceof SelectionRewriteSuggestionError) {
      return { status: "failed", message: failureMessages[error.code] };
    }
    if (error instanceof AuthenticationError) {
      return { status: "failed", message: "登录状态已失效，请重新登录后再试。" };
    }
    console.error("Selection rewrite failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return { status: "failed", message: failureMessages.PROVIDER_FAILED };
  }
}
