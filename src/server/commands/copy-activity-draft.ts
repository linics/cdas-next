import "server-only";
import { createHash, randomUUID } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import { activityContentV3Schema, projectionColumns } from "../../domain/activity/activity-content";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { activityCopySourceSchema, ActivityCopyError, readActivityCopySource, requireCopyTeacher } from "../activity/activity-copy-source";
import { resolveCommandContext, type CommandContext } from "./command-context";
import { isRetryableSerializationError, serializableRetryAttempts, waitBeforeSerializableRetry } from "./serializable-retry";

const inputSchema = z.object({
  source: activityCopySourceSchema,
  title: activityContentV3Schema.shape.title,
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict();
const resultSchema = z.object({ draftId: z.uuid(), revisionId: z.uuid(), version: z.literal(1) });
export type CopyActivityDraftInput = z.input<typeof inputSchema>;
const commandName = "copy_activity_draft";

export async function copyActivityDraft(database: PrismaClient, commandContext: CommandContext, rawInput: CopyActivityDraftInput) {
  const input = inputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const draftId = randomUUID();
  const requestHash = createHash("sha256").update(canonicalize({ source: input.source, title: input.title })!).digest("hex");
  for (let attempt = 1; attempt <= serializableRetryAttempts; attempt++) {
    try {
      return await database.$transaction(async (tx) => {
        await requireCopyTeacher(tx, context.actorId);
        const existing = await tx.idempotencyRecord.findUnique({ where: {
          actorId_commandName_idempotencyKey: { actorId: context.actorId, commandName, idempotencyKey: input.idempotencyKey },
        } });
        if (existing && existing.requestHash !== requestHash) throw new ActivityCopyError("IDEMPOTENCY_MISMATCH");
        const original = await readActivityCopySource(tx, context.actorId, input.source, { replay: !!existing });
        if (existing) return resultSchema.parse(existing.response);
        const content = activityContentV3Schema.parse({ ...original.content, title: input.title });
        const columns = { schemaVersion: 3, taskBook: content, title: content.title, summary: content.summary, ...projectionColumns(content) };
        const draft = await tx.activityDraft.create({ data: {
          id: draftId, ownerId: context.actorId, status: "EDITING", version: 1,
          ...columns, createdAt: context.now, updatedAt: context.now,
          revisions: { create: { version: 1, source: "MANUAL", ...columns, createdAt: context.now } },
        }, select: { revisions: { select: { id: true } } } });
        await tx.activityDraftOrigin.create({ data: {
          draftId, sourceRevisionId: original.sourceRevisionId, sourceReleaseId: original.sourceReleaseId, createdAt: context.now,
        } });
        const response = resultSchema.parse({ draftId, revisionId: draft.revisions[0]?.id, version: 1 });
        await tx.actionAudit.create({ data: {
          actorId: context.actorId, source: context.source, actionName: commandName,
          targetType: "ActivityDraft", targetId: draftId, requestHash, idempotencyKey: input.idempotencyKey,
          outcome: "SUCCEEDED", afterVersion: 1, resultResourceId: response.revisionId, traceId: context.traceId,
        } });
        await tx.idempotencyRecord.create({ data: {
          actorId: context.actorId, commandName, idempotencyKey: input.idempotencyKey, requestHash,
          response, resourceType: "ActivityDraftRevision", resourceId: response.revisionId,
        } });
        return response;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 10_000 });
    } catch (error) {
      const retryable = isRetryableSerializationError(error);
      if (retryable && attempt < serializableRetryAttempts) { await waitBeforeSerializableRetry(attempt); continue; }
      const failure = error instanceof ActivityCopyError ? error : retryable ? new ActivityCopyError("CONCURRENT_WRITE") : null;
      if (failure) {
        await database.actionAudit.create({ data: {
          actorId: context.actorId, source: context.source, actionName: commandName,
          targetType: input.source.kind === "DRAFT" ? "ActivityDraft" : "ActivityRelease", targetId: input.source.id,
          requestHash, idempotencyKey: input.idempotencyKey, outcome: failure.code === "NOT_FOUND" ? "DENIED" : "CONFLICTED",
          errorCode: failure.code, traceId: context.traceId,
        } }).catch(() => { console.error("Activity copy failure audit unavailable", { traceId: context.traceId }); });
        throw failure;
      }
      throw error;
    }
  }
  throw new ActivityCopyError("CONCURRENT_WRITE");
}
