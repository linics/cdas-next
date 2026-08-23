import "server-only";

import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client";
import type { CommandContext } from "../commands/command-context";
import {
  markSubmissionAttachmentUploaded,
  recordSubmissionAttachmentScan,
  reserveSubmissionAttachment,
  type ReserveSubmissionAttachmentInput,
} from "../commands/submission-attachment-commands";
import type { AttachmentStorage } from "./attachment-storage";
import {
  getAuthorizedSubmissionAttachmentDownload,
  getWritableSubmissionAttachmentStorageRecord,
} from "./submission-attachment-access";

const attachmentIdSchema = z.uuid();

export async function createSubmissionAttachmentUpload(
  database: PrismaClient,
  storage: AttachmentStorage,
  commandContext: CommandContext,
  input: ReserveSubmissionAttachmentInput,
) {
  const reserved = await reserveSubmissionAttachment(
    database,
    commandContext,
    input,
  );
  const upload = await storage.createUploadTarget({
    storageKey: reserved.storageKey,
    mediaType: reserved.mediaType,
    byteSize: reserved.byteSize,
  });
  return {
    attachmentId: reserved.attachmentId,
    workingCopyId: reserved.workingCopyId,
    workingVersion: reserved.workingVersion,
    upload,
  };
}

export async function finalizeSubmissionAttachmentUpload(
  database: PrismaClient,
  storage: AttachmentStorage,
  commandContext: CommandContext,
  rawAttachmentId: string,
) {
  const attachmentId = attachmentIdSchema.parse(rawAttachmentId);
  const attachment = await getWritableSubmissionAttachmentStorageRecord(
    database,
    commandContext,
    { attachmentId },
  );
  if (attachment.status !== "UPLOAD_PENDING") {
    return {
      attachmentId,
      status: attachment.status,
    } as const;
  }
  const stored = await storage.inspectObject(attachment.storageKey);
  return markSubmissionAttachmentUploaded(database, commandContext, {
    attachmentId,
    observedMediaType: stored.mediaType,
    observedByteSize: stored.byteSize,
  });
}

export async function refreshSubmissionAttachmentScan(
  database: PrismaClient,
  storage: AttachmentStorage,
  commandContext: CommandContext,
  rawAttachmentId: string,
) {
  const attachmentId = attachmentIdSchema.parse(rawAttachmentId);
  const attachment = await getWritableSubmissionAttachmentStorageRecord(
    database,
    commandContext,
    { attachmentId },
  );
  if (
    attachment.status === "READY" ||
    attachment.status === "REJECTED"
  ) {
    return { attachmentId, status: attachment.status } as const;
  }
  if (attachment.status === "UPLOAD_PENDING") {
    return { attachmentId, status: attachment.status } as const;
  }
  const decision = await storage.getScanDecision(attachment.storageKey);
  if (decision === "PENDING") {
    return { attachmentId, status: "SCAN_PENDING" } as const;
  }
  return recordSubmissionAttachmentScan(database, commandContext, {
    attachmentId,
    decision,
  });
}

export async function createSubmissionAttachmentDownload(
  database: PrismaClient,
  storage: AttachmentStorage,
  commandContext: CommandContext,
  rawAttachmentId: string,
) {
  const attachmentId = attachmentIdSchema.parse(rawAttachmentId);
  const attachment = await getAuthorizedSubmissionAttachmentDownload(
    database,
    commandContext,
    { attachmentId },
  );
  return storage.createDownloadUrl({
    storageKey: attachment.storageKey,
    mediaType: attachment.mediaType,
    filename: attachment.originalFilename,
  });
}
