import "server-only";

import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client";
import {
  type CommandContext,
  resolveCommandContext,
} from "../commands/command-context";

const inputSchema = z.strictObject({ attachmentId: z.uuid() });

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
            studentId: context.actorId,
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
