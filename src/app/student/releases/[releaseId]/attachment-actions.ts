"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthenticationError } from "../../../../server/auth/current-actor";
import {
  finalizeSubmissionAttachmentUpload,
  createSubmissionAttachmentUpload,
  refreshSubmissionAttachmentScan,
} from "../../../../server/attachments/submission-attachment-service";
import { createAttachmentStorageFromEnvironment } from "../../../../server/attachments/s3-attachment-storage";
import {
  removeSubmissionAttachment,
  SubmissionAttachmentCommandError,
} from "../../../../server/commands/submission-attachment-commands";
import { createUiCommandContext } from "../../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../../server/db/client";

const reserveInputSchema = z.strictObject({
  releaseId: z.uuid(),
  workingCopyId: z.uuid(),
  workingVersion: z.int().positive(),
  filename: z.string(),
  mediaType: z.string(),
  byteSize: z.int(),
  idempotencyKey: z.string().trim().min(8).max(200),
});
const attachmentInputSchema = z.strictObject({
  releaseId: z.uuid(),
  attachmentId: z.uuid(),
});
const removeInputSchema = attachmentInputSchema.extend({
  workingCopyId: z.uuid(),
  workingVersion: z.int().positive(),
  idempotencyKey: z.string().trim().min(8).max(200),
});

export type AttachmentActionResult =
  | Readonly<{
      ok: true;
      attachmentId: string;
      status: "UPLOAD_PENDING" | "SCAN_PENDING" | "READY" | "REJECTED";
      workingCopyId?: string;
      workingVersion?: number;
      upload?: Readonly<{
        url: string;
        headers: Readonly<Record<string, string>>;
        expiresAt: string;
      }>;
    }>
  | Readonly<{ ok: false; message: string }>;

function failure(error: unknown): AttachmentActionResult {
  if (error instanceof z.ZodError) {
    return { ok: false, message: "附件资料格式不正确。" };
  }
  if (error instanceof AuthenticationError) {
    return { ok: false, message: "登录状态已失效，请重新登录。" };
  }
  if (error instanceof SubmissionAttachmentCommandError) {
    const messages: Partial<Record<typeof error.code, string>> = {
      ATTACHMENT_LIMIT: "每份工作草稿最多附加 5 个文件。",
      STALE_WORKING_COPY: "草稿版本已变化，请刷新后再操作附件。",
      NO_WORKING_COPY: "请先保存文字草稿，再添加附件。",
      RELEASE_NOT_ACTIVE: "活动已关闭，不能再修改附件。",
      ATTACHMENT_OBJECT_MISMATCH: "上传对象与声明的文件资料不一致。",
      FORBIDDEN: "当前账号不能操作这份附件。",
      NOT_FOUND: "附件或工作草稿不存在。",
    };
    return {
      ok: false,
      message: messages[error.code] ?? "附件状态已变化，请刷新后再试。",
    };
  }
  console.error("Submission attachment action failed", {
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return { ok: false, message: "附件服务暂时无法完成操作。" };
}

function storageOrFailure() {
  return createAttachmentStorageFromEnvironment();
}

export async function reserveAttachmentUploadAction(
  rawInput: z.input<typeof reserveInputSchema>,
): Promise<AttachmentActionResult> {
  try {
    const input = reserveInputSchema.parse(rawInput);
    const storage = storageOrFailure();
    if (!storage) {
      return { ok: false, message: "附件存储尚未启用。" };
    }
    const result = await createSubmissionAttachmentUpload(
      getDatabaseClient(),
      storage,
      await createUiCommandContext(),
      {
        releaseId: input.releaseId,
        expectedWorkingCopyId: input.workingCopyId,
        expectedWorkingVersion: input.workingVersion,
        filename: input.filename,
        mediaType: input.mediaType,
        byteSize: input.byteSize,
        idempotencyKey: input.idempotencyKey,
      },
    );
    revalidatePath(`/student/releases/${input.releaseId}`);
    return {
      ok: true,
      attachmentId: result.attachmentId,
      workingCopyId: result.workingCopyId,
      workingVersion: result.workingVersion,
      status: "UPLOAD_PENDING",
      upload: result.upload,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function finalizeAttachmentUploadAction(
  rawInput: z.input<typeof attachmentInputSchema>,
): Promise<AttachmentActionResult> {
  try {
    const input = attachmentInputSchema.parse(rawInput);
    const storage = storageOrFailure();
    if (!storage) {
      return { ok: false, message: "附件存储尚未启用。" };
    }
    const result = await finalizeSubmissionAttachmentUpload(
      getDatabaseClient(),
      storage,
      await createUiCommandContext(),
      input.attachmentId,
    );
    revalidatePath(`/student/releases/${input.releaseId}`);
    return { ok: true, ...result };
  } catch (error) {
    return failure(error);
  }
}

export async function refreshAttachmentScanAction(
  rawInput: z.input<typeof attachmentInputSchema>,
): Promise<AttachmentActionResult> {
  try {
    const input = attachmentInputSchema.parse(rawInput);
    const storage = storageOrFailure();
    if (!storage) {
      return { ok: false, message: "附件存储尚未启用。" };
    }
    const result = await refreshSubmissionAttachmentScan(
      getDatabaseClient(),
      storage,
      await createUiCommandContext(),
      input.attachmentId,
    );
    revalidatePath(`/student/releases/${input.releaseId}`);
    return { ok: true, ...result };
  } catch (error) {
    return failure(error);
  }
}

export async function removeAttachmentAction(
  rawInput: z.input<typeof removeInputSchema>,
): Promise<AttachmentActionResult> {
  try {
    const input = removeInputSchema.parse(rawInput);
    const result = await removeSubmissionAttachment(
      getDatabaseClient(),
      await createUiCommandContext(),
      {
        releaseId: input.releaseId,
        attachmentId: input.attachmentId,
        expectedWorkingCopyId: input.workingCopyId,
        expectedWorkingVersion: input.workingVersion,
        idempotencyKey: input.idempotencyKey,
      },
    );
    revalidatePath(`/student/releases/${input.releaseId}`);
    return {
      ok: true,
      attachmentId: result.attachmentId,
      workingCopyId: result.workingCopyId,
      workingVersion: result.workingVersion,
      status: "UPLOAD_PENDING",
    };
  } catch (error) {
    return failure(error);
  }
}
