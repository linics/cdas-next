import "server-only";

import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client";
import {
  type CommandContext,
  resolveCommandContext,
} from "../commands/command-context";
import { isSubmissionAudienceMemberWhere } from "../submissions/submission-audience";

const inputSchema = z.strictObject({ attachmentId: z.uuid() });
const currentRevisionInputSchema = z.strictObject({
  attachmentId: z.uuid(),
  submissionId: z.uuid(),
  submissionRevisionId: z.uuid(),
  submissionRevisionNumber: z.int().positive(),
});

export class SubmissionAttachmentAccessError extends Error {
  constructor(public readonly code: "FORBIDDEN" | "NOT_FOUND") {
    super(code);
    this.name = "SubmissionAttachmentAccessError";
  }
}

export async function getWritableSubmissionAttachmentStorageRecord(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: z.input<typeof inputSchema>,
) {
  const input = inputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const actor = await database.appUser.findUnique({
    where: { id: context.actorId },
    select: { role: true },
  });
  if (!actor) {
    throw new SubmissionAttachmentAccessError("NOT_FOUND");
  }
  if (actor.role !== "STUDENT") {
    throw new SubmissionAttachmentAccessError("FORBIDDEN");
  }
  const attachment = await database.submissionAttachment.findFirst({
    where: {
      id: input.attachmentId,
      studentId: context.actorId,
      workingCopies: { some: {} },
      submission: {
        release: {
          status: "ACTIVE",
          classroom: {
            memberships: {
              some: {
                studentId: context.actorId,
                joinedAt: { lte: context.now },
                OR: [
                  { endedAt: null },
                  { endedAt: { gt: context.now } },
                ],
              },
            },
          },
        },
      },
    },
    select: {
      id: true,
      storageKey: true,
      mediaType: true,
      byteSize: true,
      status: true,
    },
  });
  if (!attachment) {
    throw new SubmissionAttachmentAccessError("NOT_FOUND");
  }
  return attachment;
}

export async function getAuthorizedSubmissionAttachmentDownload(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: z.input<typeof inputSchema>,
) {
  const input = inputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const actor = await database.appUser.findUnique({
    where: { id: context.actorId },
    select: { role: true },
  });
  if (!actor) {
    throw new SubmissionAttachmentAccessError("NOT_FOUND");
  }

  const attachment = await database.submissionAttachment.findFirst({
    where:
      actor.role === "STUDENT"
        ? {
            id: input.attachmentId,
            status: "READY",
            submission: isSubmissionAudienceMemberWhere(context.actorId),
            OR: [
              { workingCopies: { some: {} } },
              { revisions: { some: {} } },
            ],
          }
        : {
            id: input.attachmentId,
            status: "READY",
            revisions: {
              some: {
                submissionRevision: {
                  submission: {
                    release: {
                      publisherId: context.actorId,
                      classroom: { managerId: context.actorId },
                    },
                  },
                },
              },
            },
          },
    select: {
      id: true,
      storageKey: true,
      mediaType: true,
      originalFilename: true,
    },
  });
  if (!attachment) {
    throw new SubmissionAttachmentAccessError("NOT_FOUND");
  }
  return attachment;
}

/**
 * Authorize an attachment specifically as evidence from the current formal
 * revision. Unlike the first-party download query, this deliberately rejects
 * an attachment that remains in immutable history after a newer revision is
 * submitted. Suggestion readers must use this check before loading bytes or
 * sending any derived content to a model.
 */
export async function getAuthorizedCurrentRevisionAttachmentDownload(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: z.input<typeof currentRevisionInputSchema>,
) {
  const input = currentRevisionInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const actor = await database.appUser.findUnique({
    where: { id: context.actorId },
    select: { role: true },
  });
  if (!actor) {
    throw new SubmissionAttachmentAccessError("NOT_FOUND");
  }
  if (actor.role !== "TEACHER") {
    throw new SubmissionAttachmentAccessError("FORBIDDEN");
  }

  const attachment = await database.submissionAttachment.findFirst({
    where: {
      id: input.attachmentId,
      submissionId: input.submissionId,
      status: "READY",
      revisions: {
        some: {
          submissionRevisionId: input.submissionRevisionId,
          submissionRevision: {
            revisionNumber: input.submissionRevisionNumber,
            submission: {
              id: input.submissionId,
              latestRevisionNumber: input.submissionRevisionNumber,
              release: {
                publisherId: context.actorId,
                classroom: { managerId: context.actorId },
              },
            },
          },
        },
      },
    },
    select: {
      id: true,
      storageKey: true,
      mediaType: true,
      originalFilename: true,
    },
  });
  if (!attachment) {
    throw new SubmissionAttachmentAccessError("NOT_FOUND");
  }
  return attachment;
}
