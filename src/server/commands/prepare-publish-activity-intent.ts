import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import {
  preparePublishIntent,
  publishDueAtSchema,
  PublishIntentError,
} from "../../domain/activity/prepare-publish-intent";
import {
  Prisma,
  type PrismaClient,
} from "../../generated/prisma/client";
import { hasValidAgentRunProvenance } from "./agent-run-provenance";
import {
  type CommandContext,
  type ResolvedCommandContext,
  resolveCommandContext,
} from "./command-context";

const commandInputSchema = z
  .object({
    draftId: z.uuid(),
    expectedDraftVersion: z.int().positive(),
    classroomId: z.uuid(),
    dueAt: publishDueAtSchema.nullable(),
    agentRunId: z.uuid().nullable().default(null),
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .strict();

const commandResponseSchema = z.object({
  actionIntentId: z.uuid(),
  draftId: z.uuid(),
  expectedDraftVersion: z.int().positive(),
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
  expiresAt: z.iso.datetime({ offset: true }),
});

export type PreparePublishActivityIntentInput = z.input<
  typeof commandInputSchema
>;
export type PreparePublishActivityIntentResult = z.infer<
  typeof commandResponseSchema
>;

export class PreparePublishActivityIntentError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "DRAFT_NOT_READY"
      | "STALE_VERSION"
      | "DUE_DATE_EXPIRED"
      | "INVALID_AGENT_RUN"
      | "IDEMPOTENCY_MISMATCH"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "PreparePublishActivityIntentError";
  }
}

const commandName = "prepare_publish_activity_intent";

function hashValue(value: unknown): string {
  const canonicalValue = canonicalize(value);
  if (canonicalValue === undefined) {
    throw new TypeError("Publish preparation input cannot be canonicalized");
  }
  return createHash("sha256").update(canonicalValue).digest("hex");
}

function mapPublishIntentError(
  error: PublishIntentError,
): PreparePublishActivityIntentError {
  return new PreparePublishActivityIntentError(error.code);
}

async function recordFailureAudit(
  database: PrismaClient,
  context: ResolvedCommandContext,
  input: z.infer<typeof commandInputSchema>,
  requestHash: string,
  error: PreparePublishActivityIntentError,
) {
  try {
    await database.actionAudit.create({
      data: {
        actorId: context.actorId,
        agentRunId:
          context.source === "AGENT" &&
          error.code !== "INVALID_AGENT_RUN" &&
          error.code !== "FORBIDDEN" &&
          error.code !== "NOT_FOUND"
            ? input.agentRunId
            : undefined,
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
    console.error("Failed to record publish-preparation failure audit", {
      errorCode: error.code,
      traceId: context.traceId,
    });
  }
}

async function readMatchingIdempotentResponse(
  database: PrismaClient,
  context: ResolvedCommandContext,
  input: z.infer<typeof commandInputSchema>,
  requestHash: string,
): Promise<PreparePublishActivityIntentResult | null> {
  const existing = await database.idempotencyRecord.findUnique({
    where: {
      actorId_commandName_idempotencyKey: {
        actorId: context.actorId,
        commandName,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  if (!existing) {
    return null;
  }
  if (existing.requestHash !== requestHash) {
    throw new PreparePublishActivityIntentError("IDEMPOTENCY_MISMATCH");
  }
  return commandResponseSchema.parse(existing.response);
}

async function runTransaction(
  database: PrismaClient,
  context: ResolvedCommandContext,
  input: z.infer<typeof commandInputSchema>,
  requestHash: string,
): Promise<PreparePublishActivityIntentResult> {
  const { now } = context;

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
          throw new PreparePublishActivityIntentError(
            "IDEMPOTENCY_MISMATCH",
          );
        }
        return commandResponseSchema.parse(existing.response);
      }

      const [actor, draft, classroom] = await Promise.all([
        transaction.appUser.findUnique({
          where: { id: context.actorId },
          select: { role: true },
        }),
        transaction.activityDraft.findUnique({
          where: { id: input.draftId },
          select: { id: true, ownerId: true, version: true, status: true },
        }),
        transaction.classroom.findUnique({
          where: { id: input.classroomId },
          select: { id: true, managerId: true },
        }),
      ]);

      if (!actor) {
        throw new PreparePublishActivityIntentError("NOT_FOUND");
      }
      if (actor.role !== "TEACHER") {
        throw new PreparePublishActivityIntentError("FORBIDDEN");
      }
      if (!draft || !classroom) {
        throw new PreparePublishActivityIntentError("NOT_FOUND");
      }
      if (
        draft.ownerId !== context.actorId ||
        classroom.managerId !== context.actorId
      ) {
        throw new PreparePublishActivityIntentError("NOT_FOUND");
      }

      if (
        !(await hasValidAgentRunProvenance(
          transaction,
          context,
          input.agentRunId,
        ))
      ) {
        throw new PreparePublishActivityIntentError("INVALID_AGENT_RUN");
      }

      let prepared;
      try {
        prepared = preparePublishIntent(
          {
            draftId: input.draftId,
            expectedDraftVersion: input.expectedDraftVersion,
            classroomId: input.classroomId,
            dueAt: input.dueAt,
          },
          {
            actor: { id: context.actorId, role: actor.role },
            draft,
            classroom,
            now,
          },
        );
      } catch (error) {
        if (error instanceof PublishIntentError) {
          throw mapPublishIntentError(error);
        }
        throw error;
      }

      const intent = await transaction.actionIntent.create({
        data: {
          id: prepared.id,
          actorId: context.actorId,
          agentRunId: input.agentRunId,
          actionName: prepared.actionName,
          payload: prepared.payload,
          payloadHash: prepared.payloadHash,
          targetType: "ActivityDraft",
          targetId: input.draftId,
          expectedVersion: prepared.expectedVersion,
          expiresAt: prepared.expiresAt,
          createdAt: now,
        },
      });

      const response = {
        actionIntentId: intent.id,
        draftId: input.draftId,
        expectedDraftVersion: prepared.expectedVersion,
        payloadHash: prepared.payloadHash,
        expiresAt: prepared.expiresAt.toISOString(),
      } satisfies PreparePublishActivityIntentResult;

      await transaction.actionAudit.create({
        data: {
          actorId: context.actorId,
          agentRunId: input.agentRunId,
          actionIntentId: intent.id,
          source: context.source,
          actionName: commandName,
          targetType: "ActionIntent",
          targetId: intent.id,
          requestHash,
          idempotencyKey: input.idempotencyKey,
          outcome: "SUCCEEDED",
          beforeVersion: draft.version,
          afterVersion: draft.version,
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

export async function preparePublishActivityIntent(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: PreparePublishActivityIntentInput,
): Promise<PreparePublishActivityIntentResult> {
  const input = commandInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI", "AGENT"]);
  const requestHash = hashValue({
    source: context.source,
    draftId: input.draftId,
    expectedDraftVersion: input.expectedDraftVersion,
    classroomId: input.classroomId,
    dueAt: input.dueAt,
    agentRunId: input.agentRunId,
  });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await runTransaction(database, context, input, requestHash);
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" || error.code === "P2002");

      if (retryable) {
        try {
          const replayed = await readMatchingIdempotentResponse(
            database,
            context,
            input,
            requestHash,
          );
          if (replayed) {
            return replayed;
          }
        } catch (replayError) {
          if (replayError instanceof PreparePublishActivityIntentError) {
            await recordFailureAudit(
              database,
              context,
              input,
              requestHash,
              replayError,
            );
            throw replayError;
          }
          throw replayError;
        }
        if (attempt < 3) {
          continue;
        }
      }

      const domainError =
        error instanceof PreparePublishActivityIntentError
          ? error
          : retryable
            ? new PreparePublishActivityIntentError("CONCURRENT_WRITE")
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

  throw new PreparePublishActivityIntentError("CONCURRENT_WRITE");
}
