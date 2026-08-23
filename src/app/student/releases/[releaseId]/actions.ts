"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { workingTextEvidenceSchema } from "../../../../domain/submission/text-evidence";
import { AuthenticationError } from "../../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../../server/commands/create-ui-command-context";
import {
  saveSubmissionWorkingCopy,
  SaveSubmissionWorkingCopyError,
} from "../../../../server/commands/save-submission-working-copy";
import {
  startSubmissionResubmission,
  StartSubmissionResubmissionError,
} from "../../../../server/commands/start-submission-resubmission";
import {
  submitSubmissionRevision,
  SubmitSubmissionRevisionError,
} from "../../../../server/commands/submit-submission-revision";
import { getDatabaseClient } from "../../../../server/db/client";
import type {
  SubmissionActionOperation,
  SubmissionActionState,
} from "./submission-action-state";

const idempotencyKeySchema = z.string().trim().min(8).max(200);
const nullableUuidSchema = z.preprocess(
  (value) => (value === null || value === "" ? null : value),
  z.uuid().nullable(),
);
const nullableVersionSchema = z.preprocess(
  (value) => (value === null || value === "" ? null : value),
  z.coerce.number().int().positive().nullable(),
);

const saveFormSchema = z
  .object({
    releaseId: z.uuid(),
    workingCopyId: nullableUuidSchema,
    version: nullableVersionSchema,
    idempotencyKey: idempotencyKeySchema,
    text: workingTextEvidenceSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if ((input.workingCopyId === null) !== (input.version === null)) {
      context.addIssue({
        code: "custom",
        message: "Working-copy identity and version must be provided together",
        path: ["workingCopyId"],
      });
    }
  });

const submitFormSchema = z
  .object({
    releaseId: z.uuid(),
    workingCopyId: z.uuid(),
    version: z.coerce.number().int().positive(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

const resubmitFormSchema = z
  .object({
    releaseId: z.uuid(),
    version: z.coerce.number().int().positive(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

const allowedFormFields = {
  save: new Set([
    "releaseId",
    "workingCopyId",
    "version",
    "idempotencyKey",
    "text",
  ]),
  submit: new Set([
    "releaseId",
    "workingCopyId",
    "version",
    "idempotencyKey",
  ]),
  resubmit: new Set(["releaseId", "version", "idempotencyKey"]),
} satisfies Record<SubmissionActionOperation, ReadonlySet<string>>;

function hasExactFormFields(
  formData: FormData,
  expectedFields: ReadonlySet<string>,
): boolean {
  const submittedFields = Array.from(formData.keys()).filter(
    (field) => !field.startsWith("$ACTION_"),
  );
  return (
    submittedFields.every((field) => expectedFields.has(field)) &&
    Array.from(expectedFields).every(
      (field) => formData.getAll(field).length === 1,
    )
  );
}

function actionState(
  operation: SubmissionActionOperation,
  status: SubmissionActionState["status"],
  message: string,
  nextIdempotencyKey: string | null,
): SubmissionActionState {
  return { operation, status, message, nextIdempotencyKey };
}

function createIdempotencyKey(
  operation: SubmissionActionOperation,
): string {
  return `${operation}_${randomUUID()}`;
}

function submittedIdempotencyKey(formData: FormData): string | null {
  const parsed = idempotencyKeySchema.safeParse(
    formData.get("idempotencyKey"),
  );
  return parsed.success ? parsed.data : null;
}

function invalidFormState(
  operation: SubmissionActionOperation,
  formData: FormData,
): SubmissionActionState {
  return actionState(
    operation,
    "error",
    "提交的数据格式不正确。请重新整理页面后再试一次。",
    submittedIdempotencyKey(formData),
  );
}

function domainErrorCode(error: unknown): string | null {
  if (
    error instanceof SaveSubmissionWorkingCopyError ||
    error instanceof StartSubmissionResubmissionError ||
    error instanceof SubmitSubmissionRevisionError
  ) {
    return error.code;
  }
  return null;
}

function failedActionState(
  operation: SubmissionActionOperation,
  error: unknown,
  idempotencyKey: string | null,
): SubmissionActionState {
  if (error instanceof z.ZodError) {
    const tooLong = error.issues.some((issue) => issue.code === "too_big");
    return actionState(
      operation,
      "error",
      tooLong
        ? "文字证据不能超过 20,000 个 Unicode 字符，原文没有被截断。"
        : "提交的数据格式不正确。请检查内容后再试一次。",
      idempotencyKey,
    );
  }

  if (error instanceof AuthenticationError) {
    return actionState(
      operation,
      "error",
      error.code === "AUTH_NOT_CONFIGURED"
        ? "登录服务尚未配置，当前无法写入。"
        : "登录状态已失效，请重新登录后再试。",
      idempotencyKey,
    );
  }

  const code = domainErrorCode(error);
  const retryKey =
    code === "IDEMPOTENCY_MISMATCH"
      ? createIdempotencyKey(operation)
      : idempotencyKey;
  if (
    code === "STALE_WORKING_COPY" ||
    code === "STALE_REVISION" ||
    code === "CONCURRENT_WRITE" ||
    code === "IDEMPOTENCY_MISMATCH" ||
    code === "NO_WORKING_COPY" ||
    code === "RESUBMISSION_NOT_STARTED" ||
    code === "NO_SUBMITTED_REVISION"
  ) {
    return actionState(
      operation,
      "conflict",
      "页面版本已落后，系统没有覆盖较新的内容。请刷新最新版本后再确认。",
      retryKey,
    );
  }

  if (code === "NO_EVIDENCE") {
    return actionState(
      operation,
      "error",
      "正式提交至少需要一段可见文字。工作草稿仍然保留。",
      idempotencyKey,
    );
  }

  if (code === "RELEASE_NOT_ACTIVE") {
    return actionState(
      operation,
      "error",
      "活动已关闭，当前只能查看现有草稿与正式修订。",
      idempotencyKey,
    );
  }

  if (code === "FORBIDDEN" || code === "NOT_FOUND") {
    return actionState(
      operation,
      "error",
      "当前无法操作这份活动。请确认登录账号与班级资格。",
      idempotencyKey,
    );
  }

  console.error("Student submission action failed", {
    errorName: error instanceof Error ? error.name : "UnknownError",
    operation,
  });
  return actionState(
    operation,
    "error",
    "服务器暂时无法完成操作。你的页面内容仍在，请稍后再试。",
    idempotencyKey,
  );
}

export async function saveWorkingCopyAction(
  _previousState: SubmissionActionState,
  formData: FormData,
): Promise<SubmissionActionState> {
  const operation = "save";
  const requestIdempotencyKey = submittedIdempotencyKey(formData);
  if (!hasExactFormFields(formData, allowedFormFields.save)) {
    return invalidFormState(operation, formData);
  }
  try {
    const input = saveFormSchema.parse({
      releaseId: formData.get("releaseId"),
      workingCopyId: formData.get("workingCopyId"),
      version: formData.get("version"),
      idempotencyKey: formData.get("idempotencyKey"),
      text: formData.get("text"),
    });
    const context = await createUiCommandContext();
    const database = getDatabaseClient();
    await saveSubmissionWorkingCopy(database, context, {
      releaseId: input.releaseId,
      expectedWorkingCopyId: input.workingCopyId,
      expectedWorkingVersion: input.version,
      textEvidence: input.text,
      idempotencyKey: input.idempotencyKey,
    });
    revalidatePath(`/student/releases/${input.releaseId}`);
    return actionState(
      operation,
      "success",
      "草稿已保存。正式提交前仍可继续修改。",
      createIdempotencyKey(operation),
    );
  } catch (error) {
    return failedActionState(
      operation,
      error,
      requestIdempotencyKey,
    );
  }
}

export async function submitRevisionAction(
  _previousState: SubmissionActionState,
  formData: FormData,
): Promise<SubmissionActionState> {
  const operation = "submit";
  const requestIdempotencyKey = submittedIdempotencyKey(formData);
  if (!hasExactFormFields(formData, allowedFormFields.submit)) {
    return invalidFormState(operation, formData);
  }
  try {
    const input = submitFormSchema.parse({
      releaseId: formData.get("releaseId"),
      workingCopyId: formData.get("workingCopyId"),
      version: formData.get("version"),
      idempotencyKey: formData.get("idempotencyKey"),
    });
    const context = await createUiCommandContext();
    const database = getDatabaseClient();
    const result = await submitSubmissionRevision(database, context, {
      releaseId: input.releaseId,
      expectedWorkingCopyId: input.workingCopyId,
      expectedWorkingVersion: input.version,
      idempotencyKey: input.idempotencyKey,
    });
    revalidatePath(`/student/releases/${input.releaseId}`);
    return actionState(
      operation,
      "success",
      result.isLate
        ? `第 ${result.revisionNumber} 版已正式迟交，修订内容与迟交标记都已保留。`
        : `第 ${result.revisionNumber} 版已正式提交，之后的修改需另开重交草稿。`,
      createIdempotencyKey(operation),
    );
  } catch (error) {
    return failedActionState(
      operation,
      error,
      requestIdempotencyKey,
    );
  }
}

export async function startResubmissionAction(
  _previousState: SubmissionActionState,
  formData: FormData,
): Promise<SubmissionActionState> {
  const operation = "resubmit";
  const requestIdempotencyKey = submittedIdempotencyKey(formData);
  if (!hasExactFormFields(formData, allowedFormFields.resubmit)) {
    return invalidFormState(operation, formData);
  }
  try {
    const input = resubmitFormSchema.parse({
      releaseId: formData.get("releaseId"),
      version: formData.get("version"),
      idempotencyKey: formData.get("idempotencyKey"),
    });
    const context = await createUiCommandContext();
    const database = getDatabaseClient();
    await startSubmissionResubmission(database, context, {
      releaseId: input.releaseId,
      expectedLatestRevisionNumber: input.version,
      idempotencyKey: input.idempotencyKey,
    });
    revalidatePath(`/student/releases/${input.releaseId}`);
    return actionState(
      operation,
      "success",
      `已从第 ${input.version} 版创建重交草稿，旧修订不会被覆盖。`,
      createIdempotencyKey(operation),
    );
  } catch (error) {
    return failedActionState(
      operation,
      error,
      requestIdempotencyKey,
    );
  }
}
