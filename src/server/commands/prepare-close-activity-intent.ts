import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import {
  isRetryableSerializationError,
  serializableRetryAttempts,
  waitBeforeSerializableRetry,
} from "./serializable-retry";
import {
  CloseReleaseIntentError,
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

const commandInputSchema = z
  .object({
    releaseId: z.uuid(),
    expectedStatus: z.literal("ACTIVE"),
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .strict();

const commandResponseSchema = z.object({
  actionIntentId: z.uuid(),
  releaseId: z.uuid(),
  classroomName: z.string(),
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
  expiresAt: z.iso.datetime({ offset: true }),
});

export type PrepareCloseActivityIntentInput = z.input<
  typeof commandInputSchema
>;
export type PrepareCloseActivityIntentResult = z.infer<
  typeof commandResponseSchema
>;

export class PrepareCloseActivityIntentError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "RELEASE_NOT_ACTIVE"
      | "IDEMPOTENCY_MISMATCH"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "PrepareCloseActivityIntentError";
  }
}

const commandName = "prepare_close_activity_intent";

function hashValue(value: unknown): string {
  const canonicalValue = canonicalize(value);
  if (canonicalValue === undefined) {
    throw new TypeError("Close preparation input cannot be canonicalized");
  }
  return createHash("sha256").update(canonicalValue).digest("hex");
}

async function recordFailureAudit(
  database: PrismaClient,
  context: ResolvedCommandContext,
  input: z.infer<typeof commandInputSchema>,
  requestHash: string,
  error: PrepareCloseActivityIntentError,
) {
  try {
    await database.actionAudit.create({
      data: {
        actorId: context.actorId,
        source: context.source,
        actionName: commandName,
        targetType: "ActivityRelease",
        targetId: input.releaseId,
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
    console.error("Failed to record close-preparation failure audit", {
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
): Promise<PrepareCloseActivityIntentResult> {
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
          throw new PrepareCloseActivityIntentError(
            "IDEMPOTENCY_MISMATCH",
          );
        }
        return commandResponseSchema.parse(existing.response);
      }

      const [actor, release] = await Promise.all([
        transaction.appUser.findUnique({
          where: { id: context.actorId },
          select: { role: true },
        }),
        transaction.activityRelease.findUnique({
          where: { id: input.releaseId },
          select: {
            id: true,
            publisherId: true,
            status: true,
            classroom: {
              select: { managerId: true, name: true },
            },
          },
        }),
      ]);

      if (!actor) {
        throw new PrepareCloseActivityIntentError("NOT_FOUND");
      }
      if (actor.role !== "TEACHER") {
        throw new PrepareCloseActivityIntentError("FORBIDDEN");
      }
      if (
        !release ||
        release.publisherId !== context.actorId ||
        release.classroom.managerId !== context.actorId
      ) {
        throw new PrepareCloseActivityIntentError("NOT_FOUND");
      }

      let prepared;
      try {
        prepared = prepareCloseReleaseIntent(
          {
            releaseId: input.releaseId,
            expectedStatus: input.expectedStatus,
          },
          {
            actor: { id: context.actorId, role: actor.role },
            release: {
              id: release.id,
              publisherId: release.publisherId,
              status: release.status,
            },
            classroom: { managerId: release.classroom.managerId },
            now: context.now,
          },
        );
      } catch (error) {
        if (error instanceof CloseReleaseIntentError) {
          throw new PrepareCloseActivityIntentError(error.code);
        }
        throw error;
      }

      const intent = await transaction.actionIntent.create({
        data: {
          id: prepared.id,
          actorId: context.actorId,
          actionName: prepared.actionName,
          payload: prepared.payload,
          payloadHash: prepared.payloadHash,
          targetType: "ActivityRelease",
          targetId: release.id,
          expectedVersion: null,
          expiresAt: prepared.expiresAt,
          createdAt: context.now,
        },
      });

      const response = {
        actionIntentId: intent.id,
        releaseId: release.id,
        classroomName: release.classroom.name,
        payloadHash: prepared.payloadHash,
        expiresAt: prepared.expiresAt.toISOString(),
      } satisfies PrepareCloseActivityIntentResult;

      await transaction.actionAudit.create({
        data: {
          actorId: context.actorId,
          actionIntentId: intent.id,
          source: context.source,
          actionName: commandName,
          targetType: "ActionIntent",
          targetId: intent.id,
          requestHash,
          idempotencyKey: input.idempotencyKey,
          outcome: "SUCCEEDED",
          resultResourceId: intent.id,
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
          resourceType: "ActionIntent",
          resourceId: intent.id,
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

export async function prepareCloseActivityIntent(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: PrepareCloseActivityIntentInput,
): Promise<PrepareCloseActivityIntentResult> {
  const input = commandInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const requestHash = hashValue({
    source: context.source,
    releaseId: input.releaseId,
    expectedStatus: input.expectedStatus,
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
        error instanceof PrepareCloseActivityIntentError
          ? error
          : retryable
            ? new PrepareCloseActivityIntentError("CONCURRENT_WRITE")
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

  throw new PrepareCloseActivityIntentError("CONCURRENT_WRITE");
}
