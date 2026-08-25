"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  hashTeacherEvaluationPayload,
  normalizeTeacherEvaluationSummary,
  teacherEvaluationOutcomeSchema,
  teacherEvaluationPayloadSchema,
} from "../../../../domain/evaluation/teacher-evaluation-intent";
import { AuthenticationError } from "../../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../../server/commands/create-ui-command-context";
import {
  decideActionIntent,
  DecideActionIntentError,
} from "../../../../server/commands/decide-action-intent";
import {
  prepareTeacherEvaluationIntent,
  PrepareTeacherEvaluationIntentError,
} from "../../../../server/commands/prepare-teacher-evaluation-intent";
import {
  saveTeacherEvaluation,
  SaveTeacherEvaluationError,
} from "../../../../server/commands/save-teacher-evaluation";
import { getDatabaseClient } from "../../../../server/db/client";
import type {
  EvaluationActionOperation,
  EvaluationActionState,
} from "./evaluation-action-state";

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
    expectedEvaluationVersion: nonnegativeFormIntegerSchema,
    summary: z.string(),
    outcomes: z.string(),
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
  "expectedEvaluationVersion",
  "summary",
  "outcomes",
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
  return `${kind}_teacher_evaluation_${randomUUID()}`;
}

function actionState(options: {
  operation: EvaluationActionOperation;
  status: EvaluationActionState["status"];
  message: string;
  confirmation?: EvaluationActionState["confirmation"];
  resolvedIntentId?: string | null;
  nextPrepareIdempotencyKey?: string | null;
}): EvaluationActionState {
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
  operation: EvaluationActionOperation,
): EvaluationActionState {
  return actionState({
    operation,
    status: "validation_error",
    message: "提交的数据格式不正确。请重新整理页面后再试一次。",
    nextPrepareIdempotencyKey: createIdempotencyKey("prepare"),
  });
}

function failedActionState(
  operation: EvaluationActionOperation,
  error: unknown,
  resolvedIntentId: string | null = null,
): EvaluationActionState {
  if (error instanceof z.ZodError) {
    const tooLong = error.issues.some((issue) => issue.code === "too_big");
    return actionState({
      operation,
      status: "validation_error",
      message: tooLong
        ? "综评不能超过 10,000 个 Unicode 字符；原文没有被截断。"
        : "量规评价必须覆盖全部冻结维度，等级判断需引用本版证据，综评必须包含可见文字。",
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
          ? "登录服务尚未配置，当前不会开放评价写入。"
          : error.code === "USER_NOT_PROVISIONED"
            ? "当前登录账号尚未创建教师身份，无法操作这份提交。"
            : "登录状态已失效，请重新登录后再试。",
      resolvedIntentId,
      nextPrepareIdempotencyKey: createIdempotencyKey("prepare"),
    });
  }

  const code =
    error instanceof PrepareTeacherEvaluationIntentError ||
    error instanceof DecideActionIntentError ||
    error instanceof SaveTeacherEvaluationError
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
        "学生已重交或当前正式修订已改变。系统没有保存这次评价，请刷新后查看最新提交。",
      resolvedIntentId,
      nextPrepareIdempotencyKey: createIdempotencyKey("prepare"),
    });
  }

  if (code === "EVALUATION_VERSION_CONFLICT") {
    return actionState({
      operation,
      status: "version_conflict",
      message:
        "评价已由另一个操作更新。系统没有覆盖新版，请刷新评价历史后再编辑。",
      resolvedIntentId,
      nextPrepareIdempotencyKey: createIdempotencyKey("prepare"),
    });
  }

  if (code === "RUBRIC_UNAVAILABLE" || code === "INVALID_EVALUATION") {
    return actionState({
      operation,
      status: "validation_error",
      message:
        code === "RUBRIC_UNAVAILABLE"
          ? "当前发布快照没有四档量规，不能写入证据绑定评价。"
          : "量规评价必须覆盖全部冻结维度，等级判断需引用本版证据，综评必须包含可见文字。",
      resolvedIntentId,
      nextPrepareIdempotencyKey: createIdempotencyKey("prepare"),
    });
  }

  if (code === "ACTION_EXPIRED") {
    return actionState({
      operation,
      status: "expired",
      message:
        "这份确认已超过 10 分钟有效期，没有保存评价。请重新准备并再次确认。",
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

  console.error("Teacher evaluation action failed", {
    errorName: error instanceof Error ? error.name : "UnknownError",
    operation,
  });
  return actionState({
    operation,
    status: "error",
    message: "服务器暂时无法完成操作。评价尚未保存，请稍后再试。",
    resolvedIntentId,
    nextPrepareIdempotencyKey: createIdempotencyKey("prepare"),
  });
}

function parseOutcomesJson(raw: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["outcomes"],
        message: "Evaluation outcomes must be JSON",
      },
    ]);
  }
  return z.array(teacherEvaluationOutcomeSchema).min(4).max(8).parse(parsed);
}

export async function prepareTeacherEvaluationAction(
  _previousState: EvaluationActionState,
  formData: FormData,
): Promise<EvaluationActionState> {
  if (!formContainsExactly(formData, prepareFormFields)) {
    return invalidFormState("prepare");
  }

  let input: z.infer<typeof prepareFormSchema>;
  let payload: z.infer<typeof teacherEvaluationPayloadSchema>;
  try {
    input = prepareFormSchema.parse({
      submissionId: formData.get("submissionId"),
      submissionRevisionId: formData.get("submissionRevisionId"),
      submissionRevisionNumber: formData.get("submissionRevisionNumber"),
      expectedEvaluationVersion: formData.get("expectedEvaluationVersion"),
      summary: formData.get("summary"),
      outcomes: formData.get("outcomes"),
      idempotencyKey: formData.get("idempotencyKey"),
    });
    payload = teacherEvaluationPayloadSchema.parse({
      schemaVersion: 1,
      submissionId: input.submissionId,
      submissionRevisionId: input.submissionRevisionId,
      expectedSubmissionRevisionNumber: input.submissionRevisionNumber,
      expectedEvaluationVersion: input.expectedEvaluationVersion,
      summary: normalizeTeacherEvaluationSummary(input.summary),
      outcomes: parseOutcomesJson(input.outcomes),
      suggestionAgentRunId: null,
    });
  } catch (error) {
    return failedActionState("prepare", error);
  }

  try {
    const database = getDatabaseClient();
    const context = await createUiCommandContext(database);
    const prepared = await prepareTeacherEvaluationIntent(
      database,
      context,
      {
        submissionId: payload.submissionId,
        expectedSubmissionRevisionId: payload.submissionRevisionId,
        expectedSubmissionRevisionNumber:
          payload.expectedSubmissionRevisionNumber,
        expectedEvaluationVersion: payload.expectedEvaluationVersion,
        summary: payload.summary,
        outcomes: payload.outcomes,
        suggestionAgentRunId: null,
        idempotencyKey: input.idempotencyKey,
      },
    );

    if (
      prepared.submissionRevisionId !== payload.submissionRevisionId ||
      prepared.expectedEvaluationVersion !==
        payload.expectedEvaluationVersion ||
      prepared.payloadHash !== hashTeacherEvaluationPayload(payload)
    ) {
      throw new TypeError("Prepared evaluation intent did not match input");
    }

    return actionState({
      operation: "prepare",
      status: "prepared",
      message:
        "确认内容已固定。只有按下「确认并保存」后，量规评价才会成为正式历史。",
      confirmation: {
        actionIntentId: prepared.actionIntentId,
        submissionRevisionId: prepared.submissionRevisionId,
        submissionRevisionNumber: payload.expectedSubmissionRevisionNumber,
        expectedEvaluationVersion: prepared.expectedEvaluationVersion,
        summary: payload.summary,
        outcomes: payload.outcomes,
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

export async function decideTeacherEvaluationAction(
  _previousState: EvaluationActionState,
  formData: FormData,
): Promise<EvaluationActionState> {
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
        message: "已取消这份确认；没有保存或修改任何正式评价。",
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
    }

    const saved = await saveTeacherEvaluation(database, context, {
      actionIntentId: input.actionIntentId,
      idempotencyKey: input.idempotencyKey,
    });
    revalidatePath("/teacher/submissions/[submissionId]", "page");
    return actionState({
      operation: "confirm",
      status: "saved",
      message: `第 ${saved.version} 版量规评价已确认并保存；旧版仍保留在历史中。`,
      resolvedIntentId: input.actionIntentId,
      nextPrepareIdempotencyKey: createIdempotencyKey("prepare"),
    });
  } catch (error) {
    return failedActionState("confirm", error, input.actionIntentId);
  }
}
