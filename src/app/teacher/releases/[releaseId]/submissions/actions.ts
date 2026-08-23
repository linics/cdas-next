"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthenticationError } from "../../../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../../../server/commands/create-ui-command-context";
import {
  closeActivityRelease,
  CloseActivityReleaseError,
} from "../../../../../server/commands/close-activity-release";
import {
  decideActionIntent,
  DecideActionIntentError,
} from "../../../../../server/commands/decide-action-intent";
import {
  prepareCloseActivityIntent,
  PrepareCloseActivityIntentError,
} from "../../../../../server/commands/prepare-close-activity-intent";
import { getDatabaseClient } from "../../../../../server/db/client";
import type {
  CloseActivityActionState,
  CloseActivityOperation,
} from "./close-activity-action-state";

const idempotencyKeySchema = z.string().trim().min(8).max(200);
const prepareFormSchema = z
  .object({
    releaseId: z.uuid(),
    expectedStatus: z.literal("ACTIVE"),
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

const prepareFormFields = new Set([
  "releaseId",
  "expectedStatus",
  "idempotencyKey",
]);
const confirmationFormFields = new Set([
  "actionIntentId",
  "decision",
  "idempotencyKey",
]);
const rejectionFormFields = new Set(["actionIntentId", "decision"]);

function formContainsExactly(
  formData: FormData,
  expectedFields: ReadonlySet<string>,
): boolean {
  const submittedFields = Array.from(formData.keys()).filter(
    (field) => !field.startsWith("$ACTION_"),
  );
  return (
    submittedFields.length === expectedFields.size &&
    submittedFields.every((field) => expectedFields.has(field)) &&
    Array.from(expectedFields).every(
      (field) => formData.getAll(field).length === 1,
    )
  );
}

function createIdempotencyKey(kind: "prepare" | "close"): string {
  return `${kind}_close_activity_${randomUUID()}`;
}

function actionState(options: {
  operation: CloseActivityOperation;
  status: CloseActivityActionState["status"];
  message: string;
  confirmation?: CloseActivityActionState["confirmation"];
  resolvedIntentId?: string | null;
  nextPrepareIdempotencyKey?: string | null;
}): CloseActivityActionState {
  return {
    operation: options.operation,
    status: options.status,
    message: options.message,
    confirmation: options.confirmation ?? null,
    resolvedIntentId: options.resolvedIntentId ?? null,
    nextPrepareIdempotencyKey: options.nextPrepareIdempotencyKey ?? null,
  };
}

function invalidFormState(operation: CloseActivityOperation) {
  return actionState({
    operation,
    status: "validation_error",
    message: "提交的确认字段不完整或包含未允许内容。",
    nextPrepareIdempotencyKey: createIdempotencyKey("prepare"),
  });
}

function failedActionState(
  operation: CloseActivityOperation,
  error: unknown,
  resolvedIntentId: string | null = null,
): CloseActivityActionState {
  if (error instanceof z.ZodError) {
    return invalidFormState(operation);
  }
  if (error instanceof AuthenticationError) {
    return actionState({
      operation,
      status:
        error.code === "USER_NOT_PROVISIONED" ? "unauthorized" : "unauthenticated",
      message:
        error.code === "AUTH_NOT_CONFIGURED"
          ? "登录服务尚未配置，当前不会准备或关闭活动。"
          : error.code === "USER_NOT_PROVISIONED"
            ? "当前登录账号尚未创建教师身份，无法关闭活动。"
            : "登录状态已失效，请重新登录后再试。",
      resolvedIntentId,
      nextPrepareIdempotencyKey: createIdempotencyKey("prepare"),
    });
  }

  const code =
    error instanceof PrepareCloseActivityIntentError ||
    error instanceof CloseActivityReleaseError ||
    error instanceof DecideActionIntentError
      ? error.code
      : null;
  if (code === "FORBIDDEN" || code === "NOT_FOUND") {
    return actionState({
      operation,
      status: "unauthorized",
      message: "当前无法操作这个活动。请确认登录教师仍是发布者与班级管理者。",
      resolvedIntentId,
      nextPrepareIdempotencyKey: createIdempotencyKey("prepare"),
    });
  }
  if (code === "ACTION_EXPIRED") {
    return actionState({
      operation,
      status: "expired",
      message: "这份确认已超过 10 分钟有效期；活动没有被关闭，请重新准备。",
      resolvedIntentId,
      nextPrepareIdempotencyKey: createIdempotencyKey("prepare"),
    });
  }
  if (
    code === "RELEASE_NOT_ACTIVE" ||
    code === "CONCURRENT_WRITE" ||
    code === "IDEMPOTENCY_MISMATCH" ||
    code === "ACTION_NOT_CONFIRMED" ||
    code === "ALREADY_DECIDED" ||
    code === "INTENT_TAMPERED"
  ) {
    return actionState({
      operation,
      status: "conflict",
      message:
        code === "RELEASE_NOT_ACTIVE"
          ? "活动已不是开放状态，没有新的提交入口可关闭。"
          : "确认状态或活动已变更；没有执行新的关闭操作，请刷新页面。",
      resolvedIntentId,
      nextPrepareIdempotencyKey: createIdempotencyKey("prepare"),
    });
  }

  console.error("Close activity action failed", {
    errorName: error instanceof Error ? error.name : "UnknownError",
    operation,
  });
  return actionState({
    operation,
    status: "error",
    message: "服务器暂时无法完成操作；活动状态没有被假设为已关闭。",
    resolvedIntentId,
    nextPrepareIdempotencyKey: createIdempotencyKey("prepare"),
  });
}

export async function prepareCloseActivityAction(
  _previousState: CloseActivityActionState,
  formData: FormData,
): Promise<CloseActivityActionState> {
  if (!formContainsExactly(formData, prepareFormFields)) {
    return invalidFormState("prepare");
  }

  try {
    const input = prepareFormSchema.parse({
      releaseId: formData.get("releaseId"),
      expectedStatus: formData.get("expectedStatus"),
      idempotencyKey: formData.get("idempotencyKey"),
    });
    const database = getDatabaseClient();
    const context = await createUiCommandContext();
    const prepared = await prepareCloseActivityIntent(database, context, input);
    if (prepared.releaseId !== input.releaseId) {
      throw new TypeError("Prepared close intent did not match requested release");
    }
    return actionState({
      operation: "prepare",
      status: "prepared",
      message: "关闭对象与影响已固定；只有下方独立确认才会停止新的学生提交。",
      confirmation: {
        actionIntentId: prepared.actionIntentId,
        releaseId: prepared.releaseId,
        classroomName: prepared.classroomName,
        impact: "停止这个班级对此活动的所有新保存与正式提交；现有历史与教师反馈仍保留。",
        payloadHash: prepared.payloadHash,
        expiresAt: prepared.expiresAt,
        closeIdempotencyKey: createIdempotencyKey("close"),
      },
      nextPrepareIdempotencyKey: createIdempotencyKey("prepare"),
    });
  } catch (error) {
    return failedActionState("prepare", error);
  }
}

export async function decideCloseActivityAction(
  _previousState: CloseActivityActionState,
  formData: FormData,
): Promise<CloseActivityActionState> {
  const decision = formData.get("decision");
  if (decision === "REJECT") {
    if (!formContainsExactly(formData, rejectionFormFields)) {
      return invalidFormState("reject");
    }
    let input: z.infer<typeof rejectionFormSchema> | null = null;
    try {
      input = rejectionFormSchema.parse({
        actionIntentId: formData.get("actionIntentId"),
        decision,
      });
      const database = getDatabaseClient();
      const context = await createUiCommandContext();
      await decideActionIntent(database, context, input);
      return actionState({
        operation: "reject",
        status: "rejected",
        message: "已取消这次关闭确认；活动仍开放新的学生提交。",
        resolvedIntentId: input.actionIntentId,
        nextPrepareIdempotencyKey: createIdempotencyKey("prepare"),
      });
    } catch (error) {
      return failedActionState("reject", error, input?.actionIntentId ?? null);
    }
  }

  if (
    decision !== "CONFIRM" ||
    !formContainsExactly(formData, confirmationFormFields)
  ) {
    return invalidFormState("confirm");
  }

  let input: z.infer<typeof confirmationFormSchema> | null = null;
  try {
    input = confirmationFormSchema.parse({
      actionIntentId: formData.get("actionIntentId"),
      decision,
      idempotencyKey: formData.get("idempotencyKey"),
    });
    const database = getDatabaseClient();
    const context = await createUiCommandContext();
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
      // Only the close command's idempotency record can turn this retry into
      // a successful replay. A different key remains a conflict.
    }
    const closed = await closeActivityRelease(database, context, {
      actionIntentId: input.actionIntentId,
      idempotencyKey: input.idempotencyKey,
    });
    revalidatePath("/teacher");
    revalidatePath(`/teacher/releases/${closed.releaseId}/submissions`);
    revalidatePath("/student");
    revalidatePath(`/student/releases/${closed.releaseId}`);
    return actionState({
      operation: "confirm",
      status: "closed",
      message: "活动已关闭；新的学生保存与正式提交已停止，现有记录仍可查看。",
      resolvedIntentId: input.actionIntentId,
      nextPrepareIdempotencyKey: createIdempotencyKey("prepare"),
    });
  } catch (error) {
    return failedActionState("confirm", error, input?.actionIntentId ?? null);
  }
}
