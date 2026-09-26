import "server-only";

import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import {
  activityContentV3Schema,
  projectionColumns,
  type ActivityContentV3,
} from "../../domain/activity/activity-content";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import {
  activityAdaptationBindingHash,
  activityAdaptationSuggestionActionName,
} from "../activity/activity-adaptation-binding";
import {
  type CommandContext,
  type ResolvedCommandContext,
  resolveCommandContext,
} from "./command-context";
import {
  isRetryableSerializationError,
  serializableRetryAttempts,
  waitBeforeSerializableRetry,
} from "./serializable-retry";
import { isActiveSchoolMember } from "../school/teacher-authorization";

const commandInputSchema = z
  .object({
    draftId: z.uuid(),
    expectedVersion: z.int().positive(),
    agentRunId: z.uuid(),
    content: activityContentV3Schema,
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .strict();

const commandResponseSchema = z.object({
  draftId: z.uuid(),
  revisionId: z.uuid(),
  version: z.int().positive(),
  savedAt: z.iso.datetime({ offset: true }),
});

export type ApplyActivityAdaptationInput = z.input<typeof commandInputSchema>;
export type ApplyActivityAdaptationResult = z.infer<
  typeof commandResponseSchema
>;

export class ApplyActivityAdaptationError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "STALE_VERSION"
      | "DRAFT_SEALED"
      | "INVALID_SUGGESTION"
      | "ALREADY_APPLIED"
      | "IDEMPOTENCY_MISMATCH"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "ApplyActivityAdaptationError";
  }
}

const commandName = "apply_activity_adaptation";

function hashValue(value: unknown): string {
  const canonical = canonicalize(value);
  if (canonical === undefined) {
    throw new TypeError("Adaptation input cannot be canonicalized");
  }
  return createHash("sha256").update(canonical).digest("hex");
}

function contentColumns(content: ActivityContentV3) {
  return {
    schemaVersion: content.schemaVersion,
    taskBook: content,
    title: content.title,
    summary: content.summary,
    ...projectionColumns(content),
  };
}

async function recordFailureAudit(
  database: PrismaClient,
  context: ResolvedCommandContext,
  input: z.infer<typeof commandInputSchema>,
  requestHash: string,
  error: ApplyActivityAdaptationError,
) {
  try {
    await database.actionAudit.create({
      data: {
        actorId: context.actorId,
        source: context.source,
        actionName: commandName,
        targetType: "ActivityDraft",
        targetId: input.draftId,
        requestHash,
        idempotencyKey: input.idempotencyKey,
        outcome:
          error.code === "FORBIDDEN" || error.code === "NOT_FOUND"
            ? "DENIED"
            : "CONFLICTED",
        errorCode: error.code,
        traceId: context.traceId,
      },
    });
  } catch {
    console.error("Failed to record activity-adaptation failure audit", {
      errorCode: error.code,
      traceId: context.traceId,
    });
  }
}

async function runTransaction(
  database: PrismaClient,
  context: ResolvedCommandContext,
  input: z.infer<typeof commandInputSchema>,
  requestHash: string,
): Promise<ApplyActivityAdaptationResult> {
  const columns = contentColumns(input.content);
  const suggestionHash = activityAdaptationBindingHash({
    agentRunId: input.agentRunId,
    draftId: input.draftId,
    baseVersion: input.expectedVersion,
    content: input.content,
  });

  return database.$transaction(
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
          throw new ApplyActivityAdaptationError("IDEMPOTENCY_MISMATCH");
        }
        return commandResponseSchema.parse(existing.response);
      }

      if (!(await isActiveSchoolMember(transaction, context.actorId))) {
        throw new ApplyActivityAdaptationError("NOT_FOUND");
      }
      const actor = await transaction.appUser.findUnique({
        where: { id: context.actorId },
        select: { role: true },
      });
      if (!actor) {
        throw new ApplyActivityAdaptationError("NOT_FOUND");
      }
      if (actor.role !== "TEACHER") {
        throw new ApplyActivityAdaptationError("FORBIDDEN");
      }

      const draft = await transaction.activityDraft.findUnique({
        where: { id: input.draftId },
        select: {
          ownerId: true,
          status: true,
          version: true,
          schemaVersion: true,
        },
      });
      if (!draft || draft.ownerId !== context.actorId) {
        throw new ApplyActivityAdaptationError("NOT_FOUND");
      }
      if (draft.status === "SEALED") {
        throw new ApplyActivityAdaptationError("DRAFT_SEALED");
      }

      // The run must be this teacher's live suggestion for exactly this
      // draft, version and task book. A content edit on the way back, a
      // suggestion for another draft or a failed run all miss the audit.
      const [run, suggestionAudit, appliedRevision] = await Promise.all([
        transaction.agentRun.findUnique({
          where: { id: input.agentRunId },
          select: { actorId: true, status: true },
        }),
        transaction.actionAudit.findFirst({
          where: {
            actorId: context.actorId,
            agentRunId: input.agentRunId,
            source: "AGENT",
            actionName: activityAdaptationSuggestionActionName,
            targetType: "ActivityDraft",
            targetId: input.draftId,
            requestHash: suggestionHash,
            outcome: "SUCCEEDED",
          },
          select: { id: true },
        }),
        transaction.activityDraftRevision.findUnique({
          where: { agentRunId: input.agentRunId },
          select: { id: true },
        }),
      ]);
      if (appliedRevision) {
        throw new ApplyActivityAdaptationError("ALREADY_APPLIED");
      }
      if (
        draft.version !== input.expectedVersion ||
        draft.schemaVersion !== 3
      ) {
        throw new ApplyActivityAdaptationError("STALE_VERSION");
      }
      if (
        run?.actorId !== context.actorId ||
        run.status !== "RUNNING" ||
        !suggestionAudit
      ) {
        throw new ApplyActivityAdaptationError("INVALID_SUGGESTION");
      }

      const version = draft.version + 1;
      const advanced = await transaction.activityDraft.updateMany({
        where: {
          id: input.draftId,
          ownerId: context.actorId,
          version: draft.version,
          schemaVersion: 3,
          status: { not: "SEALED" },
        },
        data: {
          status: "READY_FOR_PREVIEW",
          version,
          ...columns,
          updatedAt: context.now,
        },
      });
      if (advanced.count !== 1) {
        throw new ApplyActivityAdaptationError("CONCURRENT_WRITE");
      }

      const revision = await transaction.activityDraftRevision.create({
        data: {
          draftId: input.draftId,
          version,
          source: "AGENT",
          ...columns,
          agentRunId: input.agentRunId,
          createdAt: context.now,
        },
        select: { id: true },
      });
      // The revision is inserted while the run is live and the run succeeds in
      // the same transaction; the database checks both at commit.
      const settled = await transaction.agentRun.updateMany({
        where: {
          id: input.agentRunId,
          actorId: context.actorId,
          status: "RUNNING",
        },
        data: {
          status: "SUCCEEDED",
          completedAt: context.now,
          failureCode: null,
        },
      });
      if (settled.count !== 1) {
        throw new ApplyActivityAdaptationError("CONCURRENT_WRITE");
      }

      const response = {
        draftId: input.draftId,
        revisionId: revision.id,
        version,
        savedAt: context.now.toISOString(),
      } satisfies ApplyActivityAdaptationResult;

      await transaction.actionAudit.create({
        data: {
          actorId: context.actorId,
          agentRunId: input.agentRunId,
          source: context.source,
          actionName: commandName,
          targetType: "ActivityDraft",
          targetId: input.draftId,
          requestHash,
          idempotencyKey: input.idempotencyKey,
          outcome: "SUCCEEDED",
          beforeVersion: draft.version,
          afterVersion: version,
          resultResourceId: revision.id,
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
          resourceType: "ActivityDraftRevision",
          resourceId: revision.id,
        },
      });

      return response;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 10_000,
    },
  );
}

/**
 * Write a teacher-confirmed AI adaptation as the draft's next revision. The
 * revision is AGENT-sourced and bound to the suggestion's run, so history
 * shows which version came from AI, and the run succeeds with it. One run
 * yields at most one revision.
 */
export async function applyActivityAdaptation(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: ApplyActivityAdaptationInput,
): Promise<ApplyActivityAdaptationResult> {
  const input = commandInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const requestHash = hashValue({
    draftId: input.draftId,
    expectedVersion: input.expectedVersion,
    agentRunId: input.agentRunId,
    content: input.content,
  });

  for (let attempt = 1; attempt <= serializableRetryAttempts; attempt += 1) {
    try {
      return await runTransaction(database, context, input, requestHash);
    } catch (error) {
      const retryable = isRetryableSerializationError(error);
      if (retryable && attempt < serializableRetryAttempts) {
        await waitBeforeSerializableRetry(attempt);
        continue;
      }
      const domainError =
        error instanceof ApplyActivityAdaptationError
          ? error
          : retryable
            ? new ApplyActivityAdaptationError("CONCURRENT_WRITE")
            : null;
      if (domainError) {
        await recordFailureAudit(
          database,
          context,
          input,
          requestHash,
          domainError,
        );
        throw domainError;
      }
      throw error;
    }
  }
  throw new ApplyActivityAdaptationError("CONCURRENT_WRITE");
}
