"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { activityContentV2Schema } from "../../../domain/activity/activity-content";
import { AuthenticationError } from "../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../server/commands/create-ui-command-context";
import { saveActivityDraft, SaveActivityDraftError } from "../../../server/commands/save-activity-draft";
import { getDatabaseClient } from "../../../server/db/client";
import { normalizeTaskBookValues, type ActivityDraftActionState, type ActivityDraftFormValues } from "./activity-draft-action-state";

const nullableUuidSchema = z.preprocess((value) => value === "" ? null : value, z.uuid().nullable());
const nullableVersionSchema = z.preprocess((value) => value === "" ? null : value, z.coerce.number().int().positive().nullable());
const formSchema = z.object({
  draftId: nullableUuidSchema,
  expectedVersion: nullableVersionSchema,
  desiredStatus: z.enum(["EDITING", "READY_FOR_PREVIEW"]),
  content: z.string().min(2).max(100_000),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict().superRefine((input, context) => {
  if ((input.draftId === null) !== (input.expectedVersion === null)) {
    context.addIssue({ code: "custom", path: ["draftId"], message: "Draft identity and version must be provided together" });
  }
});

const formFields = new Set(["draftId", "expectedVersion", "desiredStatus", "content", "idempotencyKey"]);

function hasExactFormFields(formData: FormData): boolean {
  const submitted = Array.from(formData.keys()).filter((field) => !field.startsWith("$ACTION_"));
  return submitted.every((field) => formFields.has(field)) && Array.from(formFields).every((field) => formData.getAll(field).length === 1);
}

function createIdempotencyKey() { return `save_activity_draft_${randomUUID()}`; }

function state(previous: ActivityDraftActionState, overrides: Partial<ActivityDraftActionState>): ActivityDraftActionState {
  return { ...previous, ...overrides };
}

function parsedValues(formData: FormData, fallback: ActivityDraftFormValues): ActivityDraftFormValues {
  const raw = formData.get("content");
  if (typeof raw !== "string") return fallback;
  try { return normalizeTaskBookValues(activityContentV2Schema.parse(JSON.parse(raw))); } catch { return fallback; }
}

function failureState(previous: ActivityDraftActionState, values: ActivityDraftFormValues, error: unknown): ActivityDraftActionState {
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return state(previous, { status: "validation_error", message: "请补齐任务书：基本设置、三维目标、3–4 个阶段及每个评价维度的四档描述都必须完整。页面输入已保留。", values });
  }
  if (error instanceof AuthenticationError) {
    return state(previous, { status: "unauthorized", message: error.code === "AUTH_NOT_CONFIGURED" ? "登录服务尚未设置，当前不会写入草稿。页面输入已保留。" : "登录状态已失效或教师账号尚未创建。页面输入已保留。", values });
  }
  if (error instanceof SaveActivityDraftError) {
    if (["STALE_VERSION", "CONCURRENT_WRITE", "IDEMPOTENCY_MISMATCH", "DRAFT_SEALED"].includes(error.code)) {
      return state(previous, { status: "conflict", message: "草稿已有较新版本或已封存，系统没有覆盖它。当前页面输入仍然保留，请另开最新版本核对。", values, nextIdempotencyKey: error.code === "IDEMPOTENCY_MISMATCH" ? createIdempotencyKey() : previous.nextIdempotencyKey });
    }
    if (error.code === "FORBIDDEN" || error.code === "NOT_FOUND") {
      return state(previous, { status: "unauthorized", message: "当前无法修改这份草稿。请确认登录教师仍是草稿所有者。页面输入已保留。", values });
    }
  }
  console.error("Teacher activity draft action failed", { errorName: error instanceof Error ? error.name : "UnknownError" });
  return state(previous, { status: "error", message: "服务器暂时无法保存；没有覆盖任何草稿，页面输入已保留。", values });
}

export async function saveActivityDraftAction(previous: ActivityDraftActionState, formData: FormData): Promise<ActivityDraftActionState> {
  const values = parsedValues(formData, previous.values);
  if (!hasExactFormFields(formData)) {
    return state(previous, { status: "validation_error", message: "提交的字段不完整或包含未允许内容。页面输入已保留。", values });
  }
  try {
    const input = formSchema.parse({
      draftId: formData.get("draftId"), expectedVersion: formData.get("expectedVersion"), desiredStatus: formData.get("desiredStatus"), content: formData.get("content"), idempotencyKey: formData.get("idempotencyKey"),
    });
    const content = normalizeTaskBookValues(activityContentV2Schema.parse(JSON.parse(input.content)));
    const context = await createUiCommandContext();
    const result = await saveActivityDraft(getDatabaseClient(), context, {
      draftId: input.draftId, expectedVersion: input.expectedVersion, desiredStatus: input.desiredStatus,
      content, agentRunId: null, idempotencyKey: input.idempotencyKey,
    });
    revalidatePath("/teacher");
    revalidatePath("/teacher/activities");
    revalidatePath(`/teacher/activities/${result.draftId}`);
    revalidatePath(`/teacher/activities/${result.draftId}/preview`);
    return { status: "success", message: result.status === "READY_FOR_PREVIEW" ? `版本 ${result.version} 已保存并可进入发布预览。` : `版本 ${result.version} 已保存为编辑中草稿。`, values: content, draftId: result.draftId, expectedVersion: result.version, persistedStatus: result.status, nextIdempotencyKey: createIdempotencyKey() };
  } catch (error) {
    return failureState(previous, values, error);
  }
}
