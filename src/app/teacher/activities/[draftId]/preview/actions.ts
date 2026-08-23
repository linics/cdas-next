"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { publishDueAtSchema } from "../../../../../domain/activity/prepare-publish-intent";
import { AuthenticationError } from "../../../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../../../server/commands/create-ui-command-context";
import {
  decideActionIntent,
  DecideActionIntentError,
} from "../../../../../server/commands/decide-action-intent";
import {
  preparePublishActivityIntent,
  PreparePublishActivityIntentError,
} from "../../../../../server/commands/prepare-publish-activity-intent";
import {
  publishActivityRelease,
  PublishActivityReleaseError,
} from "../../../../../server/commands/publish-activity-release";
import { getDatabaseClient } from "../../../../../server/db/client";
import {
  getTeacherPublishConfirmation,
  TeacherActivityQueryError,
} from "../../../../../server/queries/teacher-activity-workspace";
import type {
  PublishDecisionState,
  PublishPreparationState,
} from "./publish-action-state";

const idempotencyKeySchema = z.string().trim().min(8).max(200);
const dueAtInstantSchema = z.union([
  z.literal(""),
  z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u,
    )
    .pipe(publishDueAtSchema),
]);
const prepareFormSchema = z
  .object({
    draftId: z.uuid(),
    expectedDraftVersion: z.coerce.number().int().positive(),
    classroomId: z.uuid(),
    dueAt: dueAtInstantSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
const confirmationFormSchema = z
  .object({
    actionIntentId: z.uuid(),
    decision: z.literal("CONFIRM"),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
const rejectionFormSchema = z
  .object({
    actionIntentId: z.uuid(),
    decision: z.literal("REJECT"),
  })
  .strict();

const prepareFields = new Set([
  "draftId",
  "expectedDraftVersion",
  "classroomId",
  "dueAt",
  "idempotencyKey",
]);
const confirmFields = new Set([
  "actionIntentId",
  "decision",
  "idempotencyKey",
]);
const rejectFields = new Set(["actionIntentId", "decision"]);

function hasExactFormFields(
  formData: FormData,
  allowedFields: ReadonlySet<string>,
): boolean {
  const submittedFields = Array.from(formData.keys()).filter(
    (field) => !field.startsWith("$ACTION_"),
  );
  return (
    submittedFields.every((field) => allowedFields.has(field)) &&
    Array.from(allowedFields).every(
      (field) => formData.getAll(field).length === 1,
    )
  );
}

function prepareIdempotencyKey(): string {
  return `prepare_publish_${randomUUID()}`;
}

function publishIdempotencyKey(): string {
  return `publish_activity_${randomUUID()}`;
}

function preparationFailure(
  previousState: PublishPreparationState,
  error: unknown,
  selectedClassroomId: string,
  dueAtInstant: string,
): PublishPreparationState {
  if (error instanceof z.ZodError) {
    return {
      ...previousState,
      status: "validation_error",
      message: "发布参数格式不正确，请重新选择班级和截止时间。",
      confirmation: null,
      selectedClassroomId,
      dueAtInstant,
    };
  }
  if (error instanceof AuthenticationError) {
    return {
      ...previousState,
      status: "unauthorized",
      message:
        error.code === "AUTH_NOT_CONFIGURED"
          ? "登录服务尚未设置，当前不会准备发布。"
          : "登录状态已失效或教师账号尚未创建。",
      confirmation: null,
      selectedClassroomId,
      dueAtInstant,
    };
  }
  if (
    error instanceof PreparePublishActivityIntentError ||
    error instanceof TeacherActivityQueryError
  ) {
    const code = error.code;
    if (code === "FORBIDDEN" || code === "NOT_FOUND") {
      return {
        ...previousState,
        status: "unauthorized",
        message: "当前无法为这份草稿和班级准备发布。",
        confirmation: null,
        selectedClassroomId,
        dueAtInstant,
      };
    }
    return {
      ...previousState,
      status: "conflict",
      message:
        code === "DUE_DATE_EXPIRED"
          ? "截止时间必须晚于服务器当前时间。"
          : "草稿状态或版本已经变化，没有产生可确认的发布动作。",
      confirmation: null,
      selectedClassroomId,
      dueAtInstant,
      nextPrepareIdempotencyKey:
        code === "IDEMPOTENCY_MISMATCH"
          ? prepareIdempotencyKey()
          : previousState.nextPrepareIdempotencyKey,
    };
  }

  console.error("Prepare publish action failed", {
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return {
    ...previousState,
    status: "error",
    message: "服务器暂时无法准备发布；草稿与发布记录均未改变。",
    confirmation: null,
    selectedClassroomId,
    dueAtInstant,
  };
}

export async function preparePublishActivityAction(
  previousState: PublishPreparationState,
  formData: FormData,
): Promise<PublishPreparationState> {
  const rawClassroomId = formData.get("classroomId");
  const rawDueAt = formData.get("dueAt");
  const selectedClassroomId =
    typeof rawClassroomId === "string" ? rawClassroomId : "";
  const dueAtInstant = typeof rawDueAt === "string" ? rawDueAt : "";

  if (!hasExactFormFields(formData, prepareFields)) {
    return {
      ...previousState,
      status: "validation_error",
      message: "提交的字段不完整或包含未允许内容。",
      confirmation: null,
      selectedClassroomId,
      dueAtInstant,
    };
  }

  try {
    const input = prepareFormSchema.parse({
      draftId: formData.get("draftId"),
      expectedDraftVersion: formData.get("expectedDraftVersion"),
      classroomId: rawClassroomId,
      dueAt: rawDueAt,
      idempotencyKey: formData.get("idempotencyKey"),
    });
    const dueAt = input.dueAt === "" ? null : input.dueAt;
    const context = await createUiCommandContext();
    const database = getDatabaseClient();
    const prepared = await preparePublishActivityIntent(database, context, {
      draftId: input.draftId,
      expectedDraftVersion: input.expectedDraftVersion,
      classroomId: input.classroomId,
      dueAt,
      agentRunId: null,
      idempotencyKey: input.idempotencyKey,
    });
    const confirmation = await getTeacherPublishConfirmation(
      database,
      context,
      { actionIntentId: prepared.actionIntentId },
    );
    if (
      confirmation.draftId !== input.draftId ||
      confirmation.draftVersion !== input.expectedDraftVersion ||
      confirmation.classroom.id !== input.classroomId ||
      confirmation.dueAt !== dueAt ||
      confirmation.payloadHash !== prepared.payloadHash ||
      confirmation.expiresAt !== prepared.expiresAt
    ) {
      throw new TypeError("Persisted publish intent did not match request");
    }
    if (
      confirmation.status !== "PREPARED" ||
      new Date(confirmation.expiresAt) <= context.clock()
    ) {
      return {
        ...previousState,
        status: "conflict",
        message: "这份发布确认已过期或已被处理，请重新准备一份确认。",
        confirmation: null,
        selectedClassroomId: input.classroomId,
        dueAtInstant: input.dueAt,
        nextPrepareIdempotencyKey: prepareIdempotencyKey(),
      };
    }

    return {
      status: "prepared",
      message:
        "发布内容与参数已冻结。请在下方独立确认；当前步骤尚未发布。",
      confirmation: {
        ...confirmation,
        publishIdempotencyKey: publishIdempotencyKey(),
      },
      selectedClassroomId: input.classroomId,
      dueAtInstant: input.dueAt,
      nextPrepareIdempotencyKey: prepareIdempotencyKey(),
    };
  } catch (error) {
    return preparationFailure(
      previousState,
      error,
      selectedClassroomId,
      dueAtInstant,
    );
  }
}

function decisionFailure(error: unknown): PublishDecisionState {
  if (error instanceof z.ZodError) {
    return {
      status: "error",
      message: "确认字段格式不正确，请重新准备发布。",
      releaseId: null,
    };
  }
  if (error instanceof AuthenticationError) {
    return {
      status: "unauthorized",
      message:
        error.code === "AUTH_NOT_CONFIGURED"
          ? "登录服务尚未设置，发布没有执行。"
          : "登录状态已失效，发布没有执行。",
      releaseId: null,
    };
  }

  const code =
    error instanceof DecideActionIntentError ||
    error instanceof PublishActivityReleaseError
      ? error.code
      : null;
  if (code === "FORBIDDEN" || code === "NOT_FOUND") {
    return {
      status: "unauthorized",
      message: "当前无法决定或执行这份发布确认。",
      releaseId: null,
    };
  }
  if (code) {
    return {
      status: "conflict",
      message:
        code === "ACTION_EXPIRED"
          ? "这份确认已超过 10 分钟有效期，请重新准备。"
          : code === "ACTION_NOT_CONFIRMED" || code === "ALREADY_DECIDED"
            ? "这份确认已被拒绝或由另一操作处理，未创建新的发布。"
            : "草稿、班级或确认状态已经变化，未创建新的发布。",
      releaseId: null,
    };
  }

  console.error("Publish decision action failed", {
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return {
    status: "error",
    message: "服务器暂时无法完成发布，请保留本页并重试同一确认。",
    releaseId: null,
  };
}

export async function decidePublishActivityAction(
  _previousState: PublishDecisionState,
  formData: FormData,
): Promise<PublishDecisionState> {
  const decision = formData.get("decision");
  const fields = decision === "REJECT" ? rejectFields : confirmFields;
  if (!hasExactFormFields(formData, fields)) {
    return {
      status: "error",
      message: "提交的确认字段不完整或包含未允许内容。",
      releaseId: null,
    };
  }

  try {
    const input =
      decision === "REJECT"
        ? rejectionFormSchema.parse({
            actionIntentId: formData.get("actionIntentId"),
            decision,
          })
        : confirmationFormSchema.parse({
            actionIntentId: formData.get("actionIntentId"),
            decision,
            idempotencyKey: formData.get("idempotencyKey"),
          });
    const context = await createUiCommandContext();
    const database = getDatabaseClient();

    if (input.decision === "REJECT") {
      await decideActionIntent(database, context, input);
      return {
        status: "rejected",
        message: "已拒绝这次发布确认；草稿仍保留可编辑历史。",
        releaseId: null,
      };
    }

    try {
      await decideActionIntent(database, context, {
        actionIntentId: input.actionIntentId,
        decision: "CONFIRM",
      });
    } catch (error) {
      if (
        !(error instanceof DecideActionIntentError) ||
        error.code !== "ALREADY_DECIDED"
      ) {
        throw error;
      }
    }

    const published = await publishActivityRelease(database, context, {
      actionIntentId: input.actionIntentId,
      idempotencyKey: input.idempotencyKey,
    });
    revalidatePath("/teacher");
    revalidatePath("/teacher/activities/[draftId]", "page");
    revalidatePath("/teacher/activities/[draftId]/preview", "page");
    return {
      status: "published",
      message: "活动已发布，学生将读取不可变发布快照。",
      releaseId: published.releaseId,
    };
  } catch (error) {
    return decisionFailure(error);
  }
}
