import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import {
  isRetryableSerializationError,
  serializableRetryAttempts,
  waitBeforeSerializableRetry,
} from "./serializable-retry";
import {
  closeReleasePayloadSchema,
  CloseReleaseIntentError,
  hashCloseReleasePayload,
  prepareCloseReleaseIntent,
} from "../../domain/activity/close-release-intent";
import {
  Prisma,
  type PrismaClient,
} from "../../generated/prisma/client";
import {
  type CommandContext,
  type ResolvedCommandContext,
  resolveCommandContext,
} from "./command-context";
import { isActiveSchoolMember } from "../school/teacher-authorization";

const commandInputSchema = z
  .object({
    actionIntentId: z.uuid(),
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .strict();

const commandResponseSchema = z.object({
  releaseId: z.uuid(),
  status: z.literal("CLOSED"),
  closedAt: z.iso.datetime({ offset: true }),
});

export type CloseActivityReleaseInput = z.input<typeof commandInputSchema>;
export type CloseActivityReleaseResult = z.infer<
  typeof commandResponseSchema
>;

export class CloseActivityReleaseError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "ACTION_NOT_CONFIRMED"
      | "ACTION_EXPIRED"
      | "INTENT_TAMPERED"
      | "RELEASE_NOT_ACTIVE"
      | "IDEMPOTENCY_MISMATCH"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "CloseActivityReleaseError";
  }
}

const commandName = "close_activity_release";

function hashValue(value: unknown): string {
  const canonicalValue = canonicalize(value);
  if (canonicalValue === undefined) {
    throw new TypeError("Close command input cannot be canonicalized");
  }
  return createHash("sha256").update(canonicalValue).digest("hex");
}

async function recordFailureAudit(
  database: PrismaClient,
  context: ResolvedCommandContext,
  input: z.infer<typeof commandInputSchema>,
  requestHash: string,
  error: CloseActivityReleaseError,
) {
  try {
    await database.actionAudit.create({
      data: {
        actorId: context.actorId,
        actionIntentId:
          error.code === "NOT_FOUND" ? undefined : input.actionIntentId,
        source: context.source,
        actionName: commandName,
        targetType: "ActionIntent",
        targetId: input.actionIntentId,
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
    console.error("Failed to record close-release failure audit", {
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
): Promise<CloseActivityReleaseResult> {
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
          throw new CloseActivityReleaseError("IDEMPOTENCY_MISMATCH");
        }
        return commandResponseSchema.parse(existing.response);
      }

      if (!(await isActiveSchoolMember(transaction, context.actorId))) {
        throw new CloseActivityReleaseError("NOT_FOUND");
      }

      const [actor, intent] = await Promise.all([
        transaction.appUser.findUnique({
          where: { id: context.actorId },
          select: { role: true },
        }),
        transaction.actionIntent.findUnique({
          where: { id: input.actionIntentId },
        }),
      ]);
      if (!actor || !intent) {
        throw new CloseActivityReleaseError("NOT_FOUND");
      }
      if (actor.role !== "TEACHER") {
        throw new CloseActivityReleaseError("FORBIDDEN");
      }
      if (
        intent.actorId !== context.actorId ||
        intent.decidedById !== context.actorId
      ) {
        throw new CloseActivityReleaseError("FORBIDDEN");
      }
      if (intent.status !== "CONFIRMED") {
        throw new CloseActivityReleaseError("ACTION_NOT_CONFIRMED");
      }
      if (intent.expiresAt <= context.now) {
        throw new CloseActivityReleaseError("ACTION_EXPIRED");
      }

      let payload: z.infer<typeof closeReleasePayloadSchema>;
      try {
        payload = closeReleasePayloadSchema.parse(intent.payload);
      } catch {
        throw new CloseActivityReleaseError("INTENT_TAMPERED");
      }
      if (
        intent.agentRunId !== null ||
        intent.actionName !== commandName ||
        intent.targetType !== "ActivityRelease" ||
        intent.targetId !== payload.releaseId ||
        intent.expectedVersion !== null ||
        hashCloseReleasePayload(payload) !== intent.payloadHash
      ) {
        throw new CloseActivityReleaseError("INTENT_TAMPERED");
      }

      const release = await transaction.activityRelease.findUnique({
        where: { id: payload.releaseId },
        select: {
          id: true,
          publisherId: true,
          classroomId: true,
          status: true,
          classroom: { select: { managerId: true } },
        },
      });
      if (
        !release ||
        release.publisherId !== context.actorId ||
        release.classroom.managerId !== context.actorId
      ) {
        throw new CloseActivityReleaseError("NOT_FOUND");
      }

      try {
        const prepared = prepareCloseReleaseIntent(
          {
            releaseId: payload.releaseId,
            expectedStatus: payload.expectedStatus,
          },
          {
            actor: { id: context.actorId, role: "TEACHER" },
            release: {
              id: release.id,
              publisherId: release.publisherId,
              status: release.status,
            },
            classroom: { managerId: release.classroom.managerId },
            now: context.now,
          },
        );
        if (prepared.payloadHash !== intent.payloadHash) {
          throw new CloseActivityReleaseError("INTENT_TAMPERED");
        }
      } catch (error) {
        if (error instanceof CloseActivityReleaseError) {
          throw error;
        }
        if (error instanceof CloseReleaseIntentError) {
          throw new CloseActivityReleaseError(error.code);
        }
        throw error;
      }

      const consumedIntent = await transaction.actionIntent.updateMany({
        where: {
          id: intent.id,
          actorId: context.actorId,
          decidedById: context.actorId,
          agentRunId: null,
          status: "CONFIRMED",
          payloadHash: intent.payloadHash,
          expiresAt: { gt: context.now },
        },
        data: { status: "EXECUTED", executedAt: context.now },
      });
      const closedRelease = await transaction.activityRelease.updateMany({
        where: {
          id: release.id,
          publisherId: context.actorId,
          classroomId: release.classroomId,
          status: "ACTIVE",
          closedAt: null,
          archivedAt: null,
        },
        data: {
          status: "CLOSED",
          closedAt: context.now,
          closeActionIntentId: intent.id,
        },
      });
      if (consumedIntent.count !== 1 || closedRelease.count !== 1) {
        throw new CloseActivityReleaseError("CONCURRENT_WRITE");
      }

      const response = {
        releaseId: release.id,
        status: "CLOSED",
        closedAt: context.now.toISOString(),
      } satisfies CloseActivityReleaseResult;

      await transaction.actionAudit.create({
        data: {
          actorId: context.actorId,
          actionIntentId: intent.id,
          source: context.source,
          actionName: commandName,
          targetType: "ActivityRelease",
          targetId: release.id,
          requestHash,
          idempotencyKey: input.idempotencyKey,
          outcome: "SUCCEEDED",
          resultResourceId: release.id,
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
          resourceType: "ActivityRelease",
          resourceId: release.id,
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

export async function closeActivityRelease(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: CloseActivityReleaseInput,
): Promise<CloseActivityReleaseResult> {
  const input = commandInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const requestHash = hashValue({
    source: context.source,
    actionIntentId: input.actionIntentId,
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
        error instanceof CloseActivityReleaseError
          ? error
          : retryable
            ? new CloseActivityReleaseError("CONCURRENT_WRITE")
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

  throw new CloseActivityReleaseError("CONCURRENT_WRITE");
}
