"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createTeacherFeedbackPayload,
  hashTeacherFeedbackPayload,
} from "../../../../domain/feedback/teacher-feedback-intent";
import { AuthenticationError } from "../../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../../server/commands/create-ui-command-context";
import {
  decideActionIntent,
  DecideActionIntentError,
} from "../../../../server/commands/decide-action-intent";
import {
  prepareTeacherFeedbackIntent,
  PrepareTeacherFeedbackIntentError,
} from "../../../../server/commands/prepare-teacher-feedback-intent";
import {
  saveTeacherFeedback,
  SaveTeacherFeedbackError,
} from "../../../../server/commands/save-teacher-feedback";
import { getDatabaseClient } from "../../../../server/db/client";
import type {
  FeedbackActionOperation,
  FeedbackActionState,
} from "./feedback-action-state";

const idempotencyKeySchema = z.string().trim().min(8).max(200);
const positiveFormIntegerSchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length > 0
      ? value
      : Number.NaN,
  z.coerce.number().int().positive(),
);
const nonnegativeFormIntegerSchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length > 0
      ? value
      : Number.NaN,
  z.coerce.number().int().nonnegative(),
);

const prepareFormSchema = z
  .object({
    submissionId: z.uuid(),
    submissionRevisionId: z.uuid(),
    submissionRevisionNumber: positiveFormIntegerSchema,
    expectedFeedbackVersion: nonnegativeFormIntegerSchema,
    body: z.string(),
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
  "submissionId",
  "submissionRevisionId",
  "submissionRevisionNumber",
  "expectedFeedbackVersion",
  "body",
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
    submittedFields.every((field) => expectedFields.has(field))
  );
}

function createIdempotencyKey(kind: "prepare" | "save"): string {
  return `${kind}_teacher_feedback_${randomUUID()}`;
}

function actionState(options: {
  operation: FeedbackActionOperation;
  status: FeedbackActionState["status"];
  message: string;
  confirmation?: FeedbackActionState["confirmation"];
  resolvedIntentId?: string | null;
  nextPrepareIdempotencyKey?: string | null;
}): FeedbackActionState {
  return {
    operation: options.operation,
    status: options.status,
    message: options.message,
    confirmation: options.confirmation ?? null,
    resolvedIntentId: options.resolvedIntentId ?? null,
    nextPrepareIdempotencyKey:
      options.nextPrepareIdempotencyKey ?? null,
  };
}

function invalidFormState(
  operation: FeedbackActionOperation,
): FeedbackActionState {
  return actionState({
    operation,
    status: "validation_error",
    message: "提交的数据格式不正确。请重新整理页面后再试一次。",
    nextPrepareIdempotencyKey: createIdempotencyKey("prepare"),
  });
}

function failedActionState(
  operation: FeedbackActionOperation,
  error: unknown,
  resolvedIntentId: string | null = null,
): FeedbackActionState {
  if (error instanceof z.ZodError) {
    const tooLong = error.issues.some((issue) => issue.code === "too_big");
    return actionState({
      operation,
      status: "validation_error",
      message: tooLong
        ? "反馈不能超过 10,000 个 Unicode 字符；原文没有被截断。"
        : "反馈必须包含可见文字。请检查内容后再试一次。",
      resolvedIntentId,
      nextPrepareIdempotencyKey: createIdempotencyKey("prepare"),
    });
  }

  if (error instanceof AuthenticationError) {
    return actionState({
      operation,
      status:
        error.code === "USER_NOT_PROVISIONED"
          ? "unauthorized"
          : "unauthenticated",
      message:
        error.code === "AUTH_NOT_CONFIGURED"
          ? "登录服务尚未配置，当前不会开放反馈写入。"
          : error.code === "USER_NOT_PROVISIONED"
            ? "当前登录账号尚未创建教师身份，无法操作这份提交。"
            : "登录状态已失效，请重新登录后再试。",
      resolvedIntentId,
      nextPrepareIdempotencyKey: createIdempotencyKey("prepare"),
    });
  }

  const code =
    error instanceof PrepareTeacherFeedbackIntentError ||
    error instanceof DecideActionIntentError ||
    error instanceof SaveTeacherFeedbackError
      ? error.code
      : null;

  if (
    code === "STALE_SUBMISSION_REVISION" ||
    code === "NO_SUBMITTED_REVISION"
  ) {
    return actionState({
      operation,
      status: "stale",
      message:
        "学生已重交或当前正式修订已改变。系统没有保存这次反馈，请刷新后查看最新提交。",
      resolvedIntentId,
      nextPrepareIdempotencyKey: createIdempotencyKey("prepare"),
    });
  }

  if (code === "FEEDBACK_VERSION_CONFLICT") {
    return actionState({
      operation,
      status: "version_conflict",
      message:
        "反馈已由另一个操作更新。系统没有覆盖新版，请刷新反馈历史后再编辑。",
      resolvedIntentId,
      nextPrepareIdempotencyKey: createIdempotencyKey("prepare"),
    });
  }

  if (code === "ACTION_EXPIRED") {
    return actionState({
      operation,
      status: "expired",
      message:
        "这份确认已超过 10 分钟有效期，没有保存反馈。请重新准备并再次确认。",
      resolvedIntentId,
      nextPrepareIdempotencyKey: createIdempotencyKey("prepare"),
    });
  }

  if (
    code === "CONCURRENT_WRITE" ||
    code === "IDEMPOTENCY_MISMATCH" ||
    code === "ALREADY_DECIDED" ||
    code === "ACTION_NOT_CONFIRMED"
  ) {
    return actionState({
      operation,
      status: "concurrent",
      message:
        "确认状态正在变更或已被处理。请先重试同一确认；若仍未完成，再刷新页面。",
      resolvedIntentId,
      nextPrepareIdempotencyKey: createIdempotencyKey("prepare"),
    });
  }

  if (code === "FORBIDDEN" || code === "NOT_FOUND") {
    return actionState({
      operation,
      status: "unauthorized",
      message:
        "当前无法操作这份提交。请确认登录教师仍是活动发布者与班级管理者。",
      resolvedIntentId,
      nextPrepareIdempotencyKey: createIdempotencyKey("prepare"),
    });
  }

  console.error("Teacher feedback action failed", {
    errorName: error instanceof Error ? error.name : "UnknownError",
    operation,
  });
  return actionState({
    operation,
    status: "error",
    message:
      "服务器暂时无法完成操作。反馈尚未保存，请稍后再试。",
    resolvedIntentId,
    nextPrepareIdempotencyKey: createIdempotencyKey("prepare"),
  });
}

export async function prepareTeacherFeedbackAction(
  _previousState: FeedbackActionState,
  formData: FormData,
): Promise<FeedbackActionState> {
  if (!formContainsExactly(formData, prepareFormFields)) {
    return invalidFormState("prepare");
  }

  let input: z.infer<typeof prepareFormSchema>;
  let payload: ReturnType<typeof createTeacherFeedbackPayload>;
  try {
    input = prepareFormSchema.parse({
      submissionId: formData.get("submissionId"),
      submissionRevisionId: formData.get("submissionRevisionId"),
      submissionRevisionNumber: formData.get(
        "submissionRevisionNumber",
      ),
      expectedFeedbackVersion: formData.get("expectedFeedbackVersion"),
      body: formData.get("body"),
      idempotencyKey: formData.get("idempotencyKey"),
    });
    payload = createTeacherFeedbackPayload({
      submissionId: input.submissionId,
      submissionRevisionId: input.submissionRevisionId,
      expectedSubmissionRevisionNumber: input.submissionRevisionNumber,
      expectedFeedbackVersion: input.expectedFeedbackVersion,
      body: input.body,
      suggestionAgentRunId: null,
    });
  } catch (error) {
    return failedActionState("prepare", error);
  }

  try {
    const database = getDatabaseClient();
    const context = await createUiCommandContext(database);
    const prepared = await prepareTeacherFeedbackIntent(
      database,
      context,
      {
        submissionId: payload.submissionId,
        expectedSubmissionRevisionId: payload.submissionRevisionId,
        expectedSubmissionRevisionNumber:
          payload.expectedSubmissionRevisionNumber,
        expectedFeedbackVersion: payload.expectedFeedbackVersion,
        body: payload.body,
        suggestionAgentRunId: null,
        idempotencyKey: input.idempotencyKey,
      },
    );

    if (
      prepared.submissionRevisionId !== payload.submissionRevisionId ||
      prepared.expectedFeedbackVersion !==
        payload.expectedFeedbackVersion ||
      prepared.payloadHash !== hashTeacherFeedbackPayload(payload)
    ) {
      throw new TypeError("Prepared feedback intent did not match input");
    }

    return actionState({
      operation: "prepare",
      status: "prepared",
      message:
        "确认内容已固定。只有按下「确认并保存」后，反馈才会成为正式历史。",
      confirmation: {
        actionIntentId: prepared.actionIntentId,
        submissionRevisionId: prepared.submissionRevisionId,
        submissionRevisionNumber:
          payload.expectedSubmissionRevisionNumber,
        expectedFeedbackVersion: prepared.expectedFeedbackVersion,
        body: payload.body,
        payloadHash: prepared.payloadHash,
        expiresAt: prepared.expiresAt,
        saveIdempotencyKey: createIdempotencyKey("save"),
      },
      nextPrepareIdempotencyKey: createIdempotencyKey("prepare"),
    });
  } catch (error) {
    return failedActionState("prepare", error);
  }
}

export async function decideTeacherFeedbackAction(
  _previousState: FeedbackActionState,
  formData: FormData,
): Promise<FeedbackActionState> {
  const decision = formData.get("decision");

  if (decision === "REJECT") {
    if (!formContainsExactly(formData, rejectionFormFields)) {
      return invalidFormState("reject");
    }

    let input: z.infer<typeof rejectionFormSchema>;
    try {
      input = rejectionFormSchema.parse({
        actionIntentId: formData.get("actionIntentId"),
        decision,
      });
    } catch (error) {
      return failedActionState("reject", error);
    }

    try {
      const database = getDatabaseClient();
      const context = await createUiCommandContext(database);
      await decideActionIntent(database, context, {
        actionIntentId: input.actionIntentId,
        decision: "REJECT",
      });
      return actionState({
        operation: "reject",
        status: "rejected",
        message: "已取消这份确认；没有保存或修改任何正式反馈。",
        resolvedIntentId: input.actionIntentId,
        nextPrepareIdempotencyKey: createIdempotencyKey("prepare"),
      });
    } catch (error) {
      return failedActionState("reject", error, input.actionIntentId);
    }
  }

  if (
    decision !== "CONFIRM" ||
    !formContainsExactly(formData, confirmationFormFields)
  ) {
    return invalidFormState("confirm");
  }

  let input: z.infer<typeof confirmationFormSchema>;
  try {
    input = confirmationFormSchema.parse({
      actionIntentId: formData.get("actionIntentId"),
      decision,
      idempotencyKey: formData.get("idempotencyKey"),
    });
  } catch (error) {
    return failedActionState("confirm", error);
  }

  try {
    const database = getDatabaseClient();
    const context = await createUiCommandContext(database);

    try {
      await decideActionIntent(database, context, {
        actionIntentId: input.actionIntentId,
        decision: "CONFIRM",
      });
    } catch (error) {
      if (
        !(
          error instanceof DecideActionIntentError &&
          error.code === "ALREADY_DECIDED"
        )
      ) {
        throw error;
      }
      // A successful save may have committed while its response was lost.
      // The save command's idempotency record is the authoritative replay.
    }

    const saved = await saveTeacherFeedback(database, context, {
      actionIntentId: input.actionIntentId,
      idempotencyKey: input.idempotencyKey,
    });
    revalidatePath("/teacher/submissions/[submissionId]", "page");
    return actionState({
      operation: "confirm",
      status: "saved",
      message: `第 ${saved.version} 版反馈已确认并保存；旧版仍保留在历史中。`,
      resolvedIntentId: input.actionIntentId,
      nextPrepareIdempotencyKey: createIdempotencyKey("prepare"),
    });
  } catch (error) {
    return failedActionState("confirm", error, input.actionIntentId);
  }
}
