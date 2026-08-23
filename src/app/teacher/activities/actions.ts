"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { activityContentSchema } from "../../../domain/activity/activity-content";
import { AuthenticationError } from "../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../server/commands/create-ui-command-context";
import {
  saveActivityDraft,
  SaveActivityDraftError,
} from "../../../server/commands/save-activity-draft";
import { getDatabaseClient } from "../../../server/db/client";
import type {
  ActivityDraftActionState,
  ActivityDraftFormValues,
} from "./activity-draft-action-state";

const nullableUuidSchema = z.preprocess(
  (value) => (value === "" ? null : value),
  z.uuid().nullable(),
);
const nullableVersionSchema = z.preprocess(
  (value) => (value === "" ? null : value),
  z.coerce.number().int().positive().nullable(),
);
const formSchema = z
  .object({
    draftId: nullableUuidSchema,
    expectedVersion: nullableVersionSchema,
    desiredStatus: z.enum(["EDITING", "READY_FOR_PREVIEW"]),
    title: z.string(),
    summary: z.string(),
    learningObjectives: z.string(),
    taskInstructions: z.string(),
    evidenceRequirements: z.string(),
    feedbackCriteria: z.string(),
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .strict()
  .superRefine((input, context) => {
    if ((input.draftId === null) !== (input.expectedVersion === null)) {
      context.addIssue({
        code: "custom",
        path: ["draftId"],
        message: "Draft identity and version must be provided together",
      });
    }
  });

const formFields = new Set([
  "draftId",
  "expectedVersion",
  "desiredStatus",
  "title",
  "summary",
  "learningObjectives",
  "taskInstructions",
  "evidenceRequirements",
  "feedbackCriteria",
  "idempotencyKey",
]);

function hasExactFormFields(formData: FormData): boolean {
  const submittedFields = Array.from(formData.keys()).filter(
    (field) => !field.startsWith("$ACTION_"),
  );
  return (
    submittedFields.every((field) => formFields.has(field)) &&
    Array.from(formFields).every(
      (field) => formData.getAll(field).length === 1,
    )
  );
}

function createIdempotencyKey(): string {
  return `save_activity_draft_${randomUUID()}`;
}

function formValues(formData: FormData): ActivityDraftFormValues | null {
  const entries = {
    title: formData.get("title"),
    summary: formData.get("summary"),
    learningObjectives: formData.get("learningObjectives"),
    taskInstructions: formData.get("taskInstructions"),
    evidenceRequirements: formData.get("evidenceRequirements"),
    feedbackCriteria: formData.get("feedbackCriteria"),
  };
  return Object.values(entries).every((value) => typeof value === "string")
    ? (entries as ActivityDraftFormValues)
    : null;
}

function listFromTextarea(value: string): string[] {
  return value
    .split(/\r\n?|\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function state(
  previousState: ActivityDraftActionState,
  overrides: Partial<ActivityDraftActionState>,
): ActivityDraftActionState {
  return { ...previousState, ...overrides };
}

function failureState(
  previousState: ActivityDraftActionState,
  values: ActivityDraftFormValues,
  error: unknown,
): ActivityDraftActionState {
  if (error instanceof z.ZodError) {
    return state(previousState, {
      status: "validation_error",
      message:
        "请检查六类活动内容；每份清单至少保留一行，标题与说明不能留空。页面输入已保留。",
      values,
    });
  }

  if (error instanceof AuthenticationError) {
    return state(previousState, {
      status: "unauthorized",
      message:
        error.code === "AUTH_NOT_CONFIGURED"
          ? "登录服务尚未设置，当前不会写入草稿。页面输入已保留。"
          : "登录状态已失效或教师账号尚未创建。页面输入已保留。",
      values,
    });
  }

  if (error instanceof SaveActivityDraftError) {
    if (
      error.code === "STALE_VERSION" ||
      error.code === "CONCURRENT_WRITE" ||
      error.code === "IDEMPOTENCY_MISMATCH" ||
      error.code === "DRAFT_SEALED"
    ) {
      return state(previousState, {
        status: "conflict",
        message:
          "草稿已有较新版本或已封存，系统没有覆盖它。当前页面输入仍然保留，请另开最新版本核对。",
        values,
        nextIdempotencyKey:
          error.code === "IDEMPOTENCY_MISMATCH"
            ? createIdempotencyKey()
            : previousState.nextIdempotencyKey,
      });
    }
    if (error.code === "FORBIDDEN" || error.code === "NOT_FOUND") {
      return state(previousState, {
        status: "unauthorized",
        message:
          "当前无法修改这份草稿。请确认登录教师仍是草稿所有者。页面输入已保留。",
        values,
      });
    }
  }

  console.error("Teacher activity draft action failed", {
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return state(previousState, {
    status: "error",
    message: "服务器暂时无法保存；没有覆盖任何草稿，页面输入已保留。",
    values,
  });
}

export async function saveActivityDraftAction(
  previousState: ActivityDraftActionState,
  formData: FormData,
): Promise<ActivityDraftActionState> {
  if (!hasExactFormFields(formData)) {
    return state(previousState, {
      status: "validation_error",
      message: "提交的字段不完整或包含未允许内容。页面输入已保留。",
    });
  }

  const submittedValues = formValues(formData);
  if (!submittedValues) {
    return state(previousState, {
      status: "validation_error",
      message: "活动内容必须是文字。页面输入已保留。",
    });
  }

  try {
    const input = formSchema.parse({
      draftId: formData.get("draftId"),
      expectedVersion: formData.get("expectedVersion"),
      desiredStatus: formData.get("desiredStatus"),
      ...submittedValues,
      idempotencyKey: formData.get("idempotencyKey"),
    });
    const content = activityContentSchema.parse({
      schemaVersion: 1,
      title: input.title,
      summary: input.summary,
      learningObjectives: listFromTextarea(input.learningObjectives),
      taskInstructions: input.taskInstructions,
      evidenceRequirements: listFromTextarea(input.evidenceRequirements),
      feedbackCriteria: listFromTextarea(input.feedbackCriteria),
    });
    const context = await createUiCommandContext();
    const database = getDatabaseClient();
    const result = await saveActivityDraft(database, context, {
      draftId: input.draftId,
      expectedVersion: input.expectedVersion,
      desiredStatus: input.desiredStatus,
      content,
      agentRunId: null,
      idempotencyKey: input.idempotencyKey,
    });

    revalidatePath("/teacher");
    revalidatePath(`/teacher/activities/${result.draftId}`);
    revalidatePath(`/teacher/activities/${result.draftId}/preview`);
    return {
      status: "success",
      message:
        result.status === "READY_FOR_PREVIEW"
          ? `版本 ${result.version} 已保存并可进入发布预览。`
          : `版本 ${result.version} 已保存为编辑中草稿。`,
      values: {
        title: content.title,
        summary: content.summary,
        learningObjectives: content.learningObjectives.join("\n"),
        taskInstructions: content.taskInstructions,
        evidenceRequirements: content.evidenceRequirements.join("\n"),
        feedbackCriteria: content.feedbackCriteria.join("\n"),
      },
      draftId: result.draftId,
      expectedVersion: result.version,
      persistedStatus: result.status,
      nextIdempotencyKey: createIdempotencyKey(),
    };
  } catch (error) {
    return failureState(previousState, submittedValues, error);
  }
}
