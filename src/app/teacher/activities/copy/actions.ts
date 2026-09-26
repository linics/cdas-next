"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";
import { AuthenticationError } from "../../../../server/auth/current-actor";
import {
  ActivityCopyError,
  activityCopySourceSchema,
} from "../../../../server/activity/activity-copy-source";
import { copyActivityDraft } from "../../../../server/commands/copy-activity-draft";
import { createUiCommandContext } from "../../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../../server/db/client";

const formSchema = z
  .object({
    sourceKind: z.enum(["DRAFT", "RELEASE"]),
    sourceId: z.uuid(),
    sourceVersion: z.coerce.number().int().positive(),
    title: z.string().trim().min(1).max(120),
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .strict();

const formFields = new Set([
  "sourceKind",
  "sourceId",
  "sourceVersion",
  "title",
  "idempotencyKey",
]);

export type CopyActivityActionState = Readonly<{
  status: "idle" | "validation_error" | "unauthorized" | "conflict" | "error";
  message: string;
  values: {
    sourceKind: "DRAFT" | "RELEASE";
    sourceId: string;
    sourceVersion: string;
    title: string;
  };
  nextIdempotencyKey: string;
}>;

function hasExactFormFields(formData: FormData): boolean {
  const submitted = Array.from(formData.keys()).filter(
    (field) => !field.startsWith("$ACTION_"),
  );
  return (
    submitted.every((field) => formFields.has(field)) &&
    Array.from(formFields).every((field) => formData.getAll(field).length === 1)
  );
}

function state(
  previous: CopyActivityActionState,
  overrides: Partial<CopyActivityActionState>,
): CopyActivityActionState {
  return { ...previous, ...overrides };
}

function submittedValues(
  formData: FormData,
  fallback: CopyActivityActionState["values"],
): CopyActivityActionState["values"] {
  const sourceKind = formData.get("sourceKind");
  const sourceId = formData.get("sourceId");
  const sourceVersion = formData.get("sourceVersion");
  const title = formData.get("title");
  return {
    sourceKind:
      sourceKind === "DRAFT" || sourceKind === "RELEASE"
        ? sourceKind
        : fallback.sourceKind,
    sourceId: typeof sourceId === "string" ? sourceId : fallback.sourceId,
    sourceVersion:
      typeof sourceVersion === "string"
        ? sourceVersion
        : fallback.sourceVersion,
    title: typeof title === "string" ? title : fallback.title,
  };
}

function failureState(
  previous: CopyActivityActionState,
  values: CopyActivityActionState["values"],
  error: unknown,
): CopyActivityActionState {
  if (error instanceof z.ZodError) {
    return state(previous, {
      status: "validation_error",
      message: "请填写 1–120 个字符的活动标题。页面输入已保留。",
      values,
    });
  }
  if (error instanceof AuthenticationError) {
    return state(previous, {
      status: "unauthorized",
      message:
        error.code === "AUTH_NOT_CONFIGURED"
          ? "登录服务尚未设置，当前不会创建草稿。页面输入已保留。"
          : "登录状态已失效或教师账号尚未创建。页面输入已保留。",
      values,
    });
  }
  if (error instanceof ActivityCopyError) {
    const message =
      error.code === "STALE_VERSION"
        ? "来源活动已有更新版本，请重新选择来源。页面输入已保留。"
        : error.code === "UNSUPPORTED_SCHEMA"
          ? "这份活动使用旧版任务书，不能自动转换；请重新选择 v3 活动。"
          : error.code === "IDEMPOTENCY_MISMATCH"
            ? "这次重试的请求内容与原请求不同，请重新选择来源后再开始。"
            : error.code === "CONCURRENT_WRITE"
              ? "系统正在处理另一项复制请求，请保持当前输入后重试。"
              : "当前来源不可访问，请重新选择来源。页面输入已保留。";
    return state(previous, {
      status:
        error.code === "STALE_VERSION" || error.code === "UNSUPPORTED_SCHEMA"
          ? "conflict"
          : "error",
      message,
      values,
      nextIdempotencyKey: previous.nextIdempotencyKey,
    });
  }
  console.error("Activity copy action failed", {
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return state(previous, {
    status: "error",
    message: "暂时无法确认复制结果，请保持输入后重试。页面输入已保留。",
    values,
  });
}

export async function copyActivityDraftAction(
  previous: CopyActivityActionState,
  formData: FormData,
): Promise<CopyActivityActionState> {
  const values = submittedValues(formData, previous.values);
  if (!hasExactFormFields(formData)) {
    return state(previous, {
      status: "validation_error",
      message: "提交的字段不完整或包含未允许内容。页面输入已保留。",
      values,
    });
  }

  let result: { draftId: string };
  try {
    const input = formSchema.parse({
      sourceKind: formData.get("sourceKind"),
      sourceId: formData.get("sourceId"),
      sourceVersion: formData.get("sourceVersion"),
      title: formData.get("title"),
      idempotencyKey: formData.get("idempotencyKey"),
    });
    const source = activityCopySourceSchema.parse({
      kind: input.sourceKind,
      id: input.sourceId,
      version: input.sourceVersion,
    });
    result = await copyActivityDraft(getDatabaseClient(), await createUiCommandContext(), {
      source,
      title: input.title,
      idempotencyKey: input.idempotencyKey,
    });
  } catch (error) {
    return failureState(previous, values, error);
  }

  revalidatePath("/teacher");
  revalidatePath("/teacher/activities");
  revalidatePath(`/teacher/activities/${result.draftId}`);
  redirect(`/teacher/activities/${result.draftId}`, RedirectType.push);
}
