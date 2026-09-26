import { createHash, randomUUID } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import {
  activityContentSchema,
  projectionColumns,
  type ActivityContent,
} from "../../domain/activity/activity-content";
import {
  Prisma,
  type PrismaClient,
} from "../../generated/prisma/client";
import { hasValidAgentRunProvenance } from "./agent-run-provenance";
import { completeAgentRunBusinessWrite } from "./complete-agent-run-business-write";
import {
  isRetryableSerializationError,
  serializableRetryAttempts,
  waitBeforeSerializableRetry,
} from "./serializable-retry";
import {
  type CommandContext,
  type ResolvedCommandContext,
  resolveCommandContext,
} from "./command-context";
import { isActiveSchoolMember } from "../school/teacher-authorization";
import { officialKnowledgeFingerprint } from "../knowledge/official-corpus";

const commandInputSchema = z
  .object({
    draftId: z.uuid().nullable(),
    expectedVersion: z.int().positive().nullable(),
    desiredStatus: z.enum(["EDITING", "READY_FOR_PREVIEW"]),
    content: activityContentSchema,
    agentRunId: z.uuid().nullable().default(null),
    // D-067: official sources an approved Agent proposal adopted. Only an
    // AGENT creation may carry them; they are bound to its first revision.
    sourceReferences: z
      .array(
        z
          .object({
            sourceId: z.string().trim().min(1).max(80),
            sectionId: z.string().trim().min(1).max(120),
            rationale: z.string().trim().min(1).max(600),
          })
          .strict(),
      )
      .max(4)
      .default([]),
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .strict()
  .superRefine((input, context) => {
    if ((input.draftId === null) !== (input.expectedVersion === null)) {
      context.addIssue({
        code: "custom",
        message:
          "draftId and expectedVersion must both be null or both be present",
        path: ["draftId"],
      });
    }
  });

const commandResponseSchema = z.object({
  draftId: z.uuid(),
  revisionId: z.uuid(),
  version: z.int().positive(),
  status: z.enum(["EDITING", "READY_FOR_PREVIEW"]),
  savedAt: z.iso.datetime({ offset: true }),
});

export type SaveActivityDraftInput = z.input<typeof commandInputSchema>;
export type SaveActivityDraftResult = z.infer<typeof commandResponseSchema>;

export class SaveActivityDraftError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "STALE_VERSION"
      | "DRAFT_SEALED"
      | "LEGACY_SCHEMA_READ_ONLY"
      | "SCHEMA_VERSION_CHANGED"
      | "INVALID_AGENT_RUN"
      | "INVALID_SOURCE_REFERENCES"
      | "IDEMPOTENCY_MISMATCH"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "SaveActivityDraftError";
  }
}

const commandName = "save_activity_draft";

function hashValue(value: unknown): string {
  const canonicalValue = canonicalize(value);
  if (canonicalValue === undefined) {
    throw new TypeError("Activity draft input cannot be canonicalized");
  }
  return createHash("sha256").update(canonicalValue).digest("hex");
}

function contentColumns(content: ActivityContent) {
  // v3 keeps no second copy of goals, evidence or criteria: the scalar columns
  // are derived, and the database rejects the row if they drift.
  const projection = projectionColumns(content);
  return {
    schemaVersion: content.schemaVersion,
    taskBook: content.schemaVersion === 1 ? Prisma.DbNull : content,
    title: content.title,
    summary: content.summary,
    ...projection,
  };
}

/**
 * Turn the proposal's references into rows. The label and hashes come from
 * the server corpus; the caller only names a section and says why. The Agent
 * tool has already enforced the read ledger, stage and discipline coverage.
 */
function resolveSourceReferences(
  context: ResolvedCommandContext,
  input: z.infer<typeof commandInputSchema>,
) {
  if (input.sourceReferences.length === 0) return [];
  if (
    context.source !== "AGENT" ||
    input.agentRunId === null ||
    input.draftId !== null
  ) {
    throw new SaveActivityDraftError("INVALID_SOURCE_REFERENCES");
  }
  const seen = new Set<string>();
  return input.sourceReferences.map((reference) => {
    const fingerprint = officialKnowledgeFingerprint(
      reference.sourceId,
      reference.sectionId,
    );
    if (!fingerprint || seen.has(reference.sectionId)) {
      throw new SaveActivityDraftError("INVALID_SOURCE_REFERENCES");
    }
    seen.add(reference.sectionId);
    return {
      sourceId: fingerprint.sourceId,
      sectionId: fingerprint.sectionId,
      sourceHash: fingerprint.sourceHash,
      contentHash: fingerprint.contentHash,
      citationLabel: fingerprint.citationLabel,
      rationale: reference.rationale,
    };
  });
}

async function recordFailureAudit(
  database: PrismaClient,
  context: ResolvedCommandContext,
  input: z.infer<typeof commandInputSchema>,
  targetDraftId: string,
  requestHash: string,
  error: SaveActivityDraftError,
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
        targetId: targetDraftId,
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
    console.error("Failed to record activity-draft failure audit", {
      errorCode: error.code,
      traceId: context.traceId,
    });
  }
}

async function runTransaction(
  database: PrismaClient,
  context: ResolvedCommandContext,
  input: z.infer<typeof commandInputSchema>,
  targetDraftId: string,
  requestHash: string,
): Promise<SaveActivityDraftResult> {
  const { now } = context;
  const revisionSource = context.source === "AGENT" ? "AGENT" : "MANUAL";
  const columns = contentColumns(input.content);

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
          throw new SaveActivityDraftError("IDEMPOTENCY_MISMATCH");
        }
        const response = commandResponseSchema.parse(existing.response);
        if (
          !(await completeAgentRunBusinessWrite(
            transaction,
            context,
            input.agentRunId,
            { allowAlreadySucceeded: true },
          ))
        ) {
          throw new SaveActivityDraftError("INVALID_AGENT_RUN");
        }
        return response;
      }

      if (!(await isActiveSchoolMember(transaction, context.actorId))) {
        throw new SaveActivityDraftError("NOT_FOUND");
      }

      const actor = await transaction.appUser.findUnique({
        where: { id: context.actorId },
        select: { role: true },
      });
      if (!actor) {
        throw new SaveActivityDraftError("NOT_FOUND");
      }
      if (actor.role !== "TEACHER") {
        throw new SaveActivityDraftError("FORBIDDEN");
      }

      if (
        !(await hasValidAgentRunProvenance(
          transaction,
          context,
          input.agentRunId,
        ))
      ) {
        throw new SaveActivityDraftError("INVALID_AGENT_RUN");
      }

      // v1 remains a permanent read format and old idempotent successes above
      // remain replayable, but no new business write may extend the legacy
      // six-field shape after D-030.
      if (input.content.schemaVersion === 1) {
        throw new SaveActivityDraftError("LEGACY_SCHEMA_READ_ONLY");
      }

      const sourceReferences = resolveSourceReferences(context, input);

      let version: number;
      let revisionId: string;
      let beforeVersion: number | undefined;

      if (input.draftId === null) {
        const created = await transaction.activityDraft.create({
          data: {
            id: targetDraftId,
            ownerId: context.actorId,
            status: input.desiredStatus,
            version: 1,
            ...columns,
            createdAt: now,
            updatedAt: now,
            revisions: {
              create: {
                version: 1,
                source: revisionSource,
                ...columns,
                agentRunId: input.agentRunId,
                createdAt: now,
              },
            },
          },
          select: {
            id: true,
            version: true,
            revisions: { select: { id: true } },
          },
        });
        const createdRevision = created.revisions[0];
        if (!createdRevision) {
          throw new SaveActivityDraftError("CONCURRENT_WRITE");
        }
        version = created.version;
        revisionId = createdRevision.id;
        if (sourceReferences.length > 0) {
          await transaction.activityDraftSourceReference.createMany({
            data: sourceReferences.map((reference) => ({
              ...reference,
              draftId: targetDraftId,
              revisionId: createdRevision.id,
              origin: "AGENT_PROPOSAL" as const,
              agentRunId: input.agentRunId,
              adoptedById: context.actorId,
              createdAt: now,
            })),
          });
        }
      } else {
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
          throw new SaveActivityDraftError("NOT_FOUND");
        }
        if (draft.status === "SEALED") {
          throw new SaveActivityDraftError("DRAFT_SEALED");
        }
        if (draft.version !== input.expectedVersion) {
          throw new SaveActivityDraftError("STALE_VERSION");
        }
        if (draft.schemaVersion !== input.content.schemaVersion) {
          throw new SaveActivityDraftError("SCHEMA_VERSION_CHANGED");
        }

        version = draft.version + 1;
        beforeVersion = draft.version;
        const advanced = await transaction.activityDraft.updateMany({
          where: {
            id: input.draftId,
            ownerId: context.actorId,
            version: draft.version,
            schemaVersion: input.content.schemaVersion,
            status: { not: "SEALED" },
          },
          data: {
            status: input.desiredStatus,
            version,
            ...columns,
            updatedAt: now,
          },
        });
        if (advanced.count !== 1) {
          throw new SaveActivityDraftError("CONCURRENT_WRITE");
        }

        const revision = await transaction.activityDraftRevision.create({
          data: {
            draftId: input.draftId,
            version,
            source: revisionSource,
            ...columns,
            agentRunId: input.agentRunId,
            createdAt: now,
          },
          select: { id: true },
        });
        revisionId = revision.id;
      }

      const response = {
        draftId: targetDraftId,
        revisionId,
        version,
        status: input.desiredStatus,
        savedAt: now.toISOString(),
      } satisfies SaveActivityDraftResult;

      await transaction.actionAudit.create({
        data: {
          actorId: context.actorId,
          agentRunId: input.agentRunId,
          source: context.source,
          actionName: commandName,
          targetType: "ActivityDraft",
          targetId: targetDraftId,
          requestHash,
          idempotencyKey: input.idempotencyKey,
          outcome: "SUCCEEDED",
          beforeVersion,
          afterVersion: version,
          resultResourceId: revisionId,
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
          resourceId: revisionId,
        },
      });

      if (
        !(await completeAgentRunBusinessWrite(
          transaction,
          context,
          input.agentRunId,
        ))
      ) {
        throw new SaveActivityDraftError("INVALID_AGENT_RUN");
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

export async function saveActivityDraft(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: SaveActivityDraftInput,
): Promise<SaveActivityDraftResult> {
  const input = commandInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI", "AGENT"]);
  const targetDraftId = input.draftId ?? randomUUID();
  const requestHash = hashValue({
    source: context.source,
    draftId: input.draftId,
    expectedVersion: input.expectedVersion,
    desiredStatus: input.desiredStatus,
    content: input.content,
    agentRunId: input.agentRunId,
    // Omitted when empty so requests recorded before D-067 still replay.
    ...(input.sourceReferences.length > 0
      ? { sourceReferences: input.sourceReferences }
      : {}),
  });

  for (let attempt = 1; attempt <= serializableRetryAttempts; attempt += 1) {
    try {
      return await runTransaction(
        database,
        context,
        input,
        targetDraftId,
        requestHash,
      );
    } catch (error) {
      const retryable = isRetryableSerializationError(error);

      if (retryable && attempt < serializableRetryAttempts) {
        await waitBeforeSerializableRetry(attempt);
        continue;
      }

      const domainError =
        error instanceof SaveActivityDraftError
          ? error
          : retryable
            ? new SaveActivityDraftError("CONCURRENT_WRITE")
            : null;

      if (domainError) {
        await recordFailureAudit(
          database,
          context,
          input,
          targetDraftId,
          requestHash,
          domainError,
        );
        throw domainError;
      }

      throw error;
    }
  }

  throw new SaveActivityDraftError("CONCURRENT_WRITE");
}
