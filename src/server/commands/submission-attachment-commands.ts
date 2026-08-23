import { createHash, randomUUID } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import {
  attachmentReservationSchema,
  MAX_SUBMISSION_ATTACHMENTS,
} from "../../domain/submission/attachment-policy";
import {
  Prisma,
  type PrismaClient,
} from "../../generated/prisma/client";
import {
  type CommandContext,
  resolveCommandContext,
} from "./command-context";

const idempotencyKeySchema = z.string().trim().min(8).max(200);

const reserveInputSchema = z
  .object({
    releaseId: z.uuid(),
    expectedWorkingCopyId: z.uuid(),
    expectedWorkingVersion: z.int().positive(),
    filename: z.string(),
    mediaType: z.string(),
    byteSize: z.int(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

const reserveResponseSchema = z.strictObject({
  submissionId: z.uuid(),
  attachmentId: z.uuid(),
  workingCopyId: z.uuid(),
  workingVersion: z.int().positive(),
  storageKey: z.string().min(1),
  filename: z.string().min(1),
  mediaType: z.string().min(1),
  byteSize: z.int().positive(),
});

const transitionInputSchema = z
  .object({
    attachmentId: z.uuid(),
  })
  .strict();

const markUploadedInputSchema = transitionInputSchema.extend({
  observedMediaType: z.string().min(1),
  observedByteSize: z.int().positive(),
});

const scanInputSchema = transitionInputSchema.extend({
  decision: z.enum(["READY", "REJECTED"]),
});

const transitionResponseSchema = z.strictObject({
  attachmentId: z.uuid(),
  status: z.enum(["SCAN_PENDING", "READY", "REJECTED"]),
});

const removeInputSchema = z
  .object({
    releaseId: z.uuid(),
    attachmentId: z.uuid(),
    expectedWorkingCopyId: z.uuid(),
    expectedWorkingVersion: z.int().positive(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

const removeResponseSchema = z.strictObject({
  attachmentId: z.uuid(),
  workingCopyId: z.uuid(),
  workingVersion: z.int().positive(),
});

export type ReserveSubmissionAttachmentInput = z.input<
  typeof reserveInputSchema
>;
export type ReserveSubmissionAttachmentResult = z.infer<
  typeof reserveResponseSchema
>;
export type MarkSubmissionAttachmentUploadedInput = z.input<
  typeof markUploadedInputSchema
>;
export type RecordSubmissionAttachmentScanInput = z.input<
  typeof scanInputSchema
>;
export type RemoveSubmissionAttachmentInput = z.input<
  typeof removeInputSchema
>;

type AttachmentCommandErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RELEASE_NOT_ACTIVE"
  | "NO_WORKING_COPY"
  | "STALE_WORKING_COPY"
  | "ATTACHMENT_LIMIT"
  | "ATTACHMENT_NOT_UPLOADED"
  | "ATTACHMENT_OBJECT_MISMATCH"
  | "IDEMPOTENCY_MISMATCH"
  | "CONCURRENT_WRITE";

export class SubmissionAttachmentCommandError extends Error {
  constructor(public readonly code: AttachmentCommandErrorCode) {
    super(code);
    this.name = "SubmissionAttachmentCommandError";
  }
}

function hashValue(value: unknown): string {
  const canonicalValue = canonicalize(value);
  if (canonicalValue === undefined) {
    throw new TypeError("Command input cannot be canonicalized");
  }
  return createHash("sha256").update(canonicalValue).digest("hex");
}

function currentMembershipWhere(
  actorId: string,
  now: Date,
): Prisma.ClassroomMembershipWhereInput {
  return {
    studentId: actorId,
    joinedAt: { lte: now },
    OR: [{ endedAt: null }, { endedAt: { gt: now } }],
  };
}

async function retrySerializable<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";
      if (retryable && attempt < 3) {
        continue;
      }
      if (retryable) {
        throw new SubmissionAttachmentCommandError("CONCURRENT_WRITE");
      }
      throw error;
    }
  }
  throw new SubmissionAttachmentCommandError("CONCURRENT_WRITE");
}

export async function reserveSubmissionAttachment(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: ReserveSubmissionAttachmentInput,
): Promise<ReserveSubmissionAttachmentResult> {
  const parsed = reserveInputSchema.parse(rawInput);
  const reservation = attachmentReservationSchema.parse({
    filename: parsed.filename,
    mediaType: parsed.mediaType,
    byteSize: parsed.byteSize,
  });
  const input = { ...parsed, ...reservation };
  const context = resolveCommandContext(commandContext, ["UI"]);
  const attachmentId = randomUUID();
  const requestHash = hashValue({
    releaseId: input.releaseId,
    expectedWorkingCopyId: input.expectedWorkingCopyId,
    expectedWorkingVersion: input.expectedWorkingVersion,
    filename: input.filename,
    mediaType: input.mediaType,
    byteSize: input.byteSize,
  });
  const commandName = "reserve_submission_attachment";

  return retrySerializable(() =>
    database.$transaction(
      async (transaction) => {
        const existing = await transaction.idempotencyRecord.findUnique({
          where: {
            actorId_commandName_idempotencyKey: {
              actorId: context.actorId,
              commandName,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw new SubmissionAttachmentCommandError(
              "IDEMPOTENCY_MISMATCH",
            );
          }
          return reserveResponseSchema.parse(existing.response);
        }

        const [actor, release] = await Promise.all([
          transaction.appUser.findUnique({
            where: { id: context.actorId },
            select: { role: true },
          }),
          transaction.activityRelease.findUnique({
            where: { id: input.releaseId },
            select: {
              status: true,
              classroom: {
                select: {
                  memberships: {
                    where: currentMembershipWhere(
                      context.actorId,
                      context.now,
                    ),
                    select: { id: true },
                    take: 1,
                  },
                },
              },
            },
          }),
        ]);
        if (!actor) {
          throw new SubmissionAttachmentCommandError("NOT_FOUND");
        }
        if (actor.role !== "STUDENT") {
          throw new SubmissionAttachmentCommandError("FORBIDDEN");
        }
        if (!release || release.classroom.memberships.length === 0) {
          throw new SubmissionAttachmentCommandError("NOT_FOUND");
        }
        if (release.status !== "ACTIVE") {
          throw new SubmissionAttachmentCommandError(
            "RELEASE_NOT_ACTIVE",
          );
        }

        const submission = await transaction.submission.findUnique({
          where: {
            releaseId_studentId: {
              releaseId: input.releaseId,
              studentId: context.actorId,
            },
          },
          include: {
            workingCopy: {
              include: {
                attachments: {
                  orderBy: { position: "asc" },
                  select: { position: true },
                },
              },
            },
          },
        });
        if (!submission || !submission.workingCopy) {
          throw new SubmissionAttachmentCommandError("NO_WORKING_COPY");
        }
        const workingCopy = submission.workingCopy;
        if (
          workingCopy.id !== input.expectedWorkingCopyId ||
          workingCopy.version !== input.expectedWorkingVersion
        ) {
          throw new SubmissionAttachmentCommandError(
            "STALE_WORKING_COPY",
          );
        }
        if (workingCopy.attachments.length >= MAX_SUBMISSION_ATTACHMENTS) {
          throw new SubmissionAttachmentCommandError("ATTACHMENT_LIMIT");
        }
        if (
          workingCopy.attachments.some(
            (entry, index) => entry.position !== index,
          )
        ) {
          throw new SubmissionAttachmentCommandError("CONCURRENT_WRITE");
        }

        const workingVersion = workingCopy.version + 1;
        const updated = await transaction.submissionWorkingCopy.updateMany({
          where: {
            id: workingCopy.id,
            submissionId: submission.id,
            version: workingCopy.version,
          },
          data: { version: workingVersion, updatedAt: context.now },
        });
        if (updated.count !== 1) {
          throw new SubmissionAttachmentCommandError("CONCURRENT_WRITE");
        }

        const storageKey = `submissions/${submission.id}/${attachmentId}`;
        await transaction.submissionAttachment.create({
          data: {
            id: attachmentId,
            submissionId: submission.id,
            studentId: context.actorId,
            kind: input.kind,
            originalFilename: input.filename,
            mediaType: input.mediaType,
            byteSize: input.byteSize,
            storageKey,
            createdAt: context.now,
            workingCopies: {
              create: {
                workingCopyId: workingCopy.id,
                position: workingCopy.attachments.length,
                addedAt: context.now,
              },
            },
          },
        });
        await transaction.submission.update({
          where: { id: submission.id },
          data: { updatedAt: context.now },
        });

        const response = {
          submissionId: submission.id,
          attachmentId,
          workingCopyId: workingCopy.id,
          workingVersion,
          storageKey,
          filename: input.filename,
          mediaType: input.mediaType,
          byteSize: input.byteSize,
        } satisfies ReserveSubmissionAttachmentResult;

        await transaction.actionAudit.create({
          data: {
            actorId: context.actorId,
            source: context.source,
            actionName: commandName,
            targetType: "SubmissionAttachment",
            targetId: attachmentId,
            requestHash,
            idempotencyKey: input.idempotencyKey,
            outcome: "SUCCEEDED",
            beforeVersion: workingCopy.version,
            afterVersion: workingVersion,
            resultResourceId: attachmentId,
            traceId: context.traceId,
          },
        });
        await transaction.idempotencyRecord.create({
          data: {
            actorId: context.actorId,
            commandName,
            idempotencyKey: input.idempotencyKey,
            requestHash,
            response,
            resourceType: "SubmissionAttachment",
            resourceId: attachmentId,
          },
        });
        return response;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 10_000,
      },
    ),
  );
}

async function ownedWritableAttachment(
  database: Prisma.TransactionClient,
  actorId: string,
  now: Date,
  attachmentId: string,
) {
  const actor = await database.appUser.findUnique({
    where: { id: actorId },
    select: { role: true },
  });
  if (!actor) {
    throw new SubmissionAttachmentCommandError("NOT_FOUND");
  }
  if (actor.role !== "STUDENT") {
    throw new SubmissionAttachmentCommandError("FORBIDDEN");
  }
  const attachment = await database.submissionAttachment.findFirst({
    where: {
      id: attachmentId,
      studentId: actorId,
      workingCopies: { some: {} },
      submission: {
        release: {
          status: "ACTIVE",
          classroom: {
            memberships: { some: currentMembershipWhere(actorId, now) },
          },
        },
      },
    },
  });
  if (!attachment) {
    throw new SubmissionAttachmentCommandError("NOT_FOUND");
  }
  return attachment;
}

export async function markSubmissionAttachmentUploaded(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: MarkSubmissionAttachmentUploadedInput,
) {
  const input = markUploadedInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  return retrySerializable(() =>
    database.$transaction(
      async (transaction) => {
        const attachment = await ownedWritableAttachment(
          transaction,
          context.actorId,
          context.now,
          input.attachmentId,
        );
        if (attachment.status !== "UPLOAD_PENDING") {
          if (
            attachment.status === "SCAN_PENDING" ||
            attachment.status === "READY" ||
            attachment.status === "REJECTED"
          ) {
            return transitionResponseSchema.parse({
              attachmentId: attachment.id,
              status: attachment.status,
            });
          }
        }
        if (
          attachment.mediaType !== input.observedMediaType ||
          attachment.byteSize !== input.observedByteSize
        ) {
          throw new SubmissionAttachmentCommandError(
            "ATTACHMENT_OBJECT_MISMATCH",
          );
        }
        const updated = await transaction.submissionAttachment.updateMany({
          where: { id: attachment.id, status: "UPLOAD_PENDING" },
          data: { status: "SCAN_PENDING", uploadedAt: context.now },
        });
        if (updated.count !== 1) {
          throw new SubmissionAttachmentCommandError("CONCURRENT_WRITE");
        }
        await transaction.actionAudit.create({
          data: {
            actorId: context.actorId,
            source: context.source,
            actionName: "mark_submission_attachment_uploaded",
            targetType: "SubmissionAttachment",
            targetId: attachment.id,
            requestHash: hashValue({ attachmentId: attachment.id }),
            outcome: "SUCCEEDED",
            resultResourceId: attachment.id,
            traceId: context.traceId,
          },
        });
        return transitionResponseSchema.parse({
          attachmentId: attachment.id,
          status: "SCAN_PENDING",
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 10_000,
      },
    ),
  );
}

export async function recordSubmissionAttachmentScan(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: RecordSubmissionAttachmentScanInput,
) {
  const input = scanInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  return retrySerializable(() =>
    database.$transaction(
      async (transaction) => {
        const attachment = await ownedWritableAttachment(
          transaction,
          context.actorId,
          context.now,
          input.attachmentId,
        );
        if (
          attachment.status === "READY" ||
          attachment.status === "REJECTED"
        ) {
          return transitionResponseSchema.parse({
            attachmentId: attachment.id,
            status: attachment.status,
          });
        }
        if (attachment.status !== "SCAN_PENDING") {
          throw new SubmissionAttachmentCommandError(
            "ATTACHMENT_NOT_UPLOADED",
          );
        }
        const updated = await transaction.submissionAttachment.updateMany({
          where: { id: attachment.id, status: "SCAN_PENDING" },
          data: { status: input.decision, scannedAt: context.now },
        });
        if (updated.count !== 1) {
          throw new SubmissionAttachmentCommandError("CONCURRENT_WRITE");
        }
        await transaction.actionAudit.create({
          data: {
            actorId: context.actorId,
            source: context.source,
            actionName: "record_submission_attachment_scan",
            targetType: "SubmissionAttachment",
            targetId: attachment.id,
            requestHash: hashValue({
              attachmentId: attachment.id,
              decision: input.decision,
            }),
            outcome: "SUCCEEDED",
            resultResourceId: attachment.id,
            traceId: context.traceId,
          },
        });
        return transitionResponseSchema.parse({
          attachmentId: attachment.id,
          status: input.decision,
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 10_000,
      },
    ),
  );
}

export async function removeSubmissionAttachment(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: RemoveSubmissionAttachmentInput,
) {
  const input = removeInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const commandName = "remove_submission_attachment";
  const requestHash = hashValue({
    releaseId: input.releaseId,
    attachmentId: input.attachmentId,
    expectedWorkingCopyId: input.expectedWorkingCopyId,
    expectedWorkingVersion: input.expectedWorkingVersion,
  });

  return retrySerializable(() =>
    database.$transaction(
      async (transaction) => {
        const existing = await transaction.idempotencyRecord.findUnique({
          where: {
            actorId_commandName_idempotencyKey: {
              actorId: context.actorId,
              commandName,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw new SubmissionAttachmentCommandError(
              "IDEMPOTENCY_MISMATCH",
            );
          }
          return removeResponseSchema.parse(existing.response);
        }

        const [actor, release, submission] = await Promise.all([
          transaction.appUser.findUnique({
            where: { id: context.actorId },
            select: { role: true },
          }),
          transaction.activityRelease.findUnique({
            where: { id: input.releaseId },
            select: {
              status: true,
              classroom: {
                select: {
                  memberships: {
                    where: currentMembershipWhere(
                      context.actorId,
                      context.now,
                    ),
                    select: { id: true },
                    take: 1,
                  },
                },
              },
            },
          }),
          transaction.submission.findUnique({
            where: {
              releaseId_studentId: {
                releaseId: input.releaseId,
                studentId: context.actorId,
              },
            },
            include: {
              workingCopy: {
                include: {
                  attachments: { orderBy: { position: "asc" } },
                },
              },
            },
          }),
        ]);
        if (!actor) {
          throw new SubmissionAttachmentCommandError("NOT_FOUND");
        }
        if (actor.role !== "STUDENT") {
          throw new SubmissionAttachmentCommandError("FORBIDDEN");
        }
        if (!release || release.classroom.memberships.length === 0) {
          throw new SubmissionAttachmentCommandError("NOT_FOUND");
        }
        if (release.status !== "ACTIVE") {
          throw new SubmissionAttachmentCommandError(
            "RELEASE_NOT_ACTIVE",
          );
        }
        if (!submission || !submission.workingCopy) {
          throw new SubmissionAttachmentCommandError("NO_WORKING_COPY");
        }
        const workingCopy = submission.workingCopy;
        if (
          workingCopy.id !== input.expectedWorkingCopyId ||
          workingCopy.version !== input.expectedWorkingVersion
        ) {
          throw new SubmissionAttachmentCommandError(
            "STALE_WORKING_COPY",
          );
        }
        const removed = workingCopy.attachments.find(
          (entry) => entry.attachmentId === input.attachmentId,
        );
        if (!removed) {
          throw new SubmissionAttachmentCommandError("NOT_FOUND");
        }

        const workingVersion = workingCopy.version + 1;
        const updated = await transaction.submissionWorkingCopy.updateMany({
          where: {
            id: workingCopy.id,
            submissionId: submission.id,
            version: workingCopy.version,
          },
          data: { version: workingVersion, updatedAt: context.now },
        });
        if (updated.count !== 1) {
          throw new SubmissionAttachmentCommandError("CONCURRENT_WRITE");
        }
        const removedLink =
          await transaction.submissionWorkingCopyAttachment.deleteMany({
            where: {
              workingCopyId: workingCopy.id,
              attachmentId: input.attachmentId,
            },
          });
        if (removedLink.count !== 1) {
          throw new SubmissionAttachmentCommandError("CONCURRENT_WRITE");
        }
        await transaction.submissionWorkingCopyAttachment.updateMany({
          where: {
            workingCopyId: workingCopy.id,
            position: { gt: removed.position },
          },
          data: { position: { decrement: 1 } },
        });
        await transaction.submission.update({
          where: { id: submission.id },
          data: { updatedAt: context.now },
        });

        const response = {
          attachmentId: input.attachmentId,
          workingCopyId: workingCopy.id,
          workingVersion,
        };
        await transaction.actionAudit.create({
          data: {
            actorId: context.actorId,
            source: context.source,
            actionName: commandName,
            targetType: "SubmissionAttachment",
            targetId: input.attachmentId,
            requestHash,
            idempotencyKey: input.idempotencyKey,
            outcome: "SUCCEEDED",
            beforeVersion: workingCopy.version,
            afterVersion: workingVersion,
            resultResourceId: input.attachmentId,
            traceId: context.traceId,
          },
        });
        await transaction.idempotencyRecord.create({
          data: {
            actorId: context.actorId,
            commandName,
            idempotencyKey: input.idempotencyKey,
            requestHash,
            response,
            resourceType: "SubmissionWorkingCopy",
            resourceId: workingCopy.id,
          },
        });
        return removeResponseSchema.parse(response);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 10_000,
      },
    ),
  );
}
