import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import { createActivitySnapshot } from "../../domain/activity/activity-snapshot";
import { executionVersionForContent } from "../../domain/submission/sequential-execution";
import {
  preparePublishIntent,
  publishRequestSchema,
  PublishIntentError,
} from "../../domain/activity/prepare-publish-intent";
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
import { completeAgentRunBusinessWrite } from "./complete-agent-run-business-write";
import {
  isSerializationFailure,
  serializableRetryAttempts,
  waitBeforeSerializableRetry,
} from "./serializable-retry";

const commandInputSchema = z.object({
  actionIntentId: z.uuid(),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict();

const commandResponseSchema = z.object({
  releaseId: z.uuid(),
  snapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
  publishedAt: z.iso.datetime({ offset: true }),
});

export type PublishActivityReleaseInput = z.input<typeof commandInputSchema>;
export type PublishActivityReleaseResult = z.infer<typeof commandResponseSchema>;

export class PublishActivityReleaseError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN"
      | "ACTION_NOT_CONFIRMED"
      | "ACTION_EXPIRED"
      | "INTENT_TAMPERED"
      | "DRAFT_NOT_READY"
      | "STALE_VERSION"
      | "DUE_DATE_EXPIRED"
      | "INVALID_AGENT_RUN"
      | "IDEMPOTENCY_MISMATCH"
      | "NOT_FOUND"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "PublishActivityReleaseError";
  }
}

const commandName = "publish_activity_release";

function hashValue(value: unknown): string {
  const canonicalValue = canonicalize(value);
  if (canonicalValue === undefined) {
    throw new TypeError("Command input cannot be canonicalized");
  }
  return createHash("sha256").update(canonicalValue).digest("hex");
}

function mapIntentError(error: PublishIntentError): PublishActivityReleaseError {
  return new PublishActivityReleaseError(error.code);
}

async function recordFailureAudit(
  database: PrismaClient,
  context: ResolvedCommandContext,
  input: z.infer<typeof commandInputSchema>,
  requestHash: string,
  error: PublishActivityReleaseError,
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
    // A failed audit write must not hide the original domain result. Database
    // observability reports this secondary failure separately.
    console.error("Failed to record publish failure audit", {
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
): Promise<PublishActivityReleaseResult> {
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
          throw new PublishActivityReleaseError("IDEMPOTENCY_MISMATCH");
        }
        const intent = await transaction.actionIntent.findUnique({
          where: { id: input.actionIntentId },
          select: { agentRunId: true },
        });
        if (!intent) {
          throw new PublishActivityReleaseError("NOT_FOUND");
        }
        if (
          !(await completeAgentRunBusinessWrite(
            transaction,
            context,
            intent.agentRunId,
            { allowAlreadySucceeded: true },
          ))
        ) {
          throw new PublishActivityReleaseError("INVALID_AGENT_RUN");
        }
        return commandResponseSchema.parse(existing.response);
      }

      if (!(await isActiveSchoolMember(transaction, context.actorId))) {
        throw new PublishActivityReleaseError("NOT_FOUND");
      }

      const intent = await transaction.actionIntent.findUnique({
        where: { id: input.actionIntentId },
        include: { actor: true },
      });

      if (!intent) {
        throw new PublishActivityReleaseError("NOT_FOUND");
      }
      if (
        intent.actorId !== context.actorId ||
        intent.decidedById !== context.actorId
      ) {
        throw new PublishActivityReleaseError("FORBIDDEN");
      }
      if (intent.status !== "CONFIRMED") {
        throw new PublishActivityReleaseError("ACTION_NOT_CONFIRMED");
      }
      if (intent.expiresAt <= now) {
        throw new PublishActivityReleaseError("ACTION_EXPIRED");
      }

      let payload: z.infer<typeof publishRequestSchema>;
      try {
        payload = publishRequestSchema.parse(intent.payload);
      } catch {
        throw new PublishActivityReleaseError("INTENT_TAMPERED");
      }

      if (
        intent.actionName !== commandName ||
        intent.targetType !== "ActivityDraft" ||
        intent.targetId !== payload.draftId ||
        intent.expectedVersion !== payload.expectedDraftVersion
      ) {
        throw new PublishActivityReleaseError("INTENT_TAMPERED");
      }
      const [draft, classroom, revision] = await Promise.all([
        transaction.activityDraft.findUnique({
          where: { id: payload.draftId },
        }),
        transaction.classroom.findUnique({
          where: { id: payload.classroomId },
        }),
        transaction.activityDraftRevision.findUnique({
          where: {
            draftId_version: {
              draftId: payload.draftId,
              version: payload.expectedDraftVersion,
            },
          },
        }),
      ]);

      if (!draft || !classroom || !revision) {
        throw new PublishActivityReleaseError("NOT_FOUND");
      }
      if (intent.actor.role !== "TEACHER") {
        throw new PublishActivityReleaseError("NOT_FOUND");
      }

      let prepared;
      try {
        prepared = preparePublishIntent(payload, {
          actor: { id: intent.actor.id, role: "TEACHER" },
          draft: {
            id: draft.id,
            ownerId: draft.ownerId,
            version: draft.version,
            status: draft.status,
          },
          classroom: { id: classroom.id, managerId: classroom.managerId },
          now,
        });
      } catch (error) {
        if (error instanceof PublishIntentError) {
          throw mapIntentError(error);
        }
        throw error;
      }

      if (prepared.payloadHash !== intent.payloadHash) {
        throw new PublishActivityReleaseError("INTENT_TAMPERED");
      }

      const snapshot = createActivitySnapshot(
        revision.schemaVersion === 2 || revision.schemaVersion === 3
          ? revision.taskBook
          : {
              schemaVersion: 1,
              title: revision.title,
              summary: revision.summary,
              learningObjectives: revision.learningObjectives,
              taskInstructions: revision.taskInstructions,
              evidenceRequirements: revision.evidenceRequirements,
              feedbackCriteria: revision.feedbackCriteria,
            },
      );

      const consumedIntent = await transaction.actionIntent.updateMany({
        where: {
          id: intent.id,
          actorId: context.actorId,
          decidedById: context.actorId,
          status: "CONFIRMED",
          payloadHash: intent.payloadHash,
          expiresAt: { gt: now },
        },
        data: { status: "EXECUTED", executedAt: now },
      });
      const sealedDraft = await transaction.activityDraft.updateMany({
        where: {
          id: draft.id,
          ownerId: context.actorId,
          version: payload.expectedDraftVersion,
          status: "READY_FOR_PREVIEW",
          sealedAt: null,
        },
        data: { status: "SEALED", sealedAt: now },
      });

      if (consumedIntent.count !== 1 || sealedDraft.count !== 1) {
        throw new PublishActivityReleaseError("CONCURRENT_WRITE");
      }

      const release = await transaction.activityRelease.create({
        data: {
          sourceDraftId: draft.id,
          publisherId: context.actorId,
          classroomId: classroom.id,
          actionIntentId: intent.id,
          executionVersion: executionVersionForContent(snapshot.content),
          publishedAt: now,
          dueAt: payload.dueAt ? new Date(payload.dueAt) : null,
          snapshot: {
            create: {
              sourceDraftVersion: payload.expectedDraftVersion,
              schemaVersion: snapshot.content.schemaVersion,
              content: snapshot.content,
              contentHash: snapshot.contentHash,
            },
          },
        },
      });

      const response = {
        releaseId: release.id,
        snapshotHash: snapshot.contentHash,
        publishedAt: release.publishedAt.toISOString(),
      } satisfies PublishActivityReleaseResult;

      await transaction.actionAudit.create({
        data: {
          actorId: context.actorId,
          agentRunId: intent.agentRunId,
          actionIntentId: intent.id,
          source: context.source,
          actionName: commandName,
          targetType: "ActivityRelease",
          targetId: release.id,
          requestHash,
          idempotencyKey: input.idempotencyKey,
          outcome: "SUCCEEDED",
          beforeVersion: draft.version,
          afterVersion: draft.version,
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

      if (
        !(await completeAgentRunBusinessWrite(
          transaction,
          context,
          intent.agentRunId,
        ))
      ) {
        throw new PublishActivityReleaseError("INVALID_AGENT_RUN");
      }

      return response;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 10_000,
    },
  );
}

export async function publishActivityRelease(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: PublishActivityReleaseInput,
): Promise<PublishActivityReleaseResult> {
  const input = commandInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI", "AGENT"]);
  const requestHash = hashValue({
    source: context.source,
    actionIntentId: input.actionIntentId,
  });

  for (let attempt = 1; attempt <= serializableRetryAttempts; attempt += 1) {
    try {
      return await runTransaction(database, context, input, requestHash);
    } catch (error) {
      const retryable = isSerializationFailure(error);

      if (retryable && attempt < serializableRetryAttempts) {
        await waitBeforeSerializableRetry(attempt);
        continue;
      }

      const domainError =
        error instanceof PublishActivityReleaseError
          ? error
          : retryable
            ? new PublishActivityReleaseError("CONCURRENT_WRITE")
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

  throw new PublishActivityReleaseError("CONCURRENT_WRITE");
}
