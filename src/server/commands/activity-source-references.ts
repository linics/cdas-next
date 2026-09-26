import "server-only";

import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { officialKnowledgeFingerprint } from "../knowledge/official-corpus";
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

export const sourceReferenceRationaleMaxLength = 600;

const adoptInputSchema = z
  .object({
    draftId: z.uuid(),
    sourceId: z.string().trim().min(1).max(80),
    sectionId: z.string().trim().min(1).max(120),
    rationale: z.string().trim().min(1).max(sourceReferenceRationaleMaxLength),
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .strict();

const adoptResultSchema = z.object({
  referenceId: z.uuid(),
  draftId: z.uuid(),
  revisionVersion: z.int().positive(),
});

export type AdoptActivitySourceInput = z.input<typeof adoptInputSchema>;
export type AdoptActivitySourceResult = z.infer<typeof adoptResultSchema>;

export class ActivitySourceReferenceError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "DRAFT_SEALED"
      | "UNSUPPORTED_SCHEMA"
      | "SOURCE_NOT_FOUND"
      | "SOURCE_NOT_APPLICABLE"
      | "ALREADY_ADOPTED"
      | "IDEMPOTENCY_MISMATCH"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "ActivitySourceReferenceError";
  }
}

const adoptCommandName = "adopt_activity_source";
const withdrawCommandName = "withdraw_activity_source";

function hashValue(value: unknown): string {
  const canonical = canonicalize(value);
  if (canonical === undefined) {
    throw new TypeError("Source reference input cannot be canonicalized");
  }
  return createHash("sha256").update(canonical).digest("hex");
}

const draftScopeSchema = z.object({
  schoolStage: z.enum(["PRIMARY", "MIDDLE"]),
  mainDisciplineCode: z.string(),
  integratedDisciplineCodes: z.array(z.string()),
});

async function withSerializableRetry<T>(
  run: () => Promise<T>,
  onDomainError: (error: ActivitySourceReferenceError) => Promise<void>,
): Promise<T> {
  for (let attempt = 1; attempt <= serializableRetryAttempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const retryable = isRetryableSerializationError(error);
      if (retryable && attempt < serializableRetryAttempts) {
        await waitBeforeSerializableRetry(attempt);
        continue;
      }
      const domainError =
        error instanceof ActivitySourceReferenceError
          ? error
          : retryable
            ? new ActivitySourceReferenceError("CONCURRENT_WRITE")
            : null;
      if (domainError) {
        await onDomainError(domainError);
        throw domainError;
      }
      throw error;
    }
  }
  throw new ActivitySourceReferenceError("CONCURRENT_WRITE");
}

async function recordFailure(
  database: PrismaClient,
  context: ResolvedCommandContext,
  details: {
    actionName: string;
    targetType: string;
    targetId: string;
    requestHash: string;
    idempotencyKey?: string;
  },
  error: ActivitySourceReferenceError,
) {
  try {
    await database.actionAudit.create({
      data: {
        actorId: context.actorId,
        source: context.source,
        actionName: details.actionName,
        targetType: details.targetType,
        targetId: details.targetId,
        requestHash: details.requestHash,
        idempotencyKey: details.idempotencyKey,
        outcome:
          error.code === "NOT_FOUND" || error.code === "FORBIDDEN"
            ? "DENIED"
            : "CONFLICTED",
        errorCode: error.code,
        traceId: context.traceId,
      },
    });
  } catch {
    console.error("Failed to record source reference failure audit", {
      errorCode: error.code,
      traceId: context.traceId,
    });
  }
}

async function requireOwnedOpenDraft(
  transaction: Prisma.TransactionClient,
  context: ResolvedCommandContext,
  draftId: string,
) {
  if (!(await isActiveSchoolMember(transaction, context.actorId))) {
    throw new ActivitySourceReferenceError("NOT_FOUND");
  }
  const actor = await transaction.appUser.findUnique({
    where: { id: context.actorId },
    select: { role: true },
  });
  if (!actor) throw new ActivitySourceReferenceError("NOT_FOUND");
  if (actor.role !== "TEACHER") {
    throw new ActivitySourceReferenceError("FORBIDDEN");
  }
  const draft = await transaction.activityDraft.findUnique({
    where: { id: draftId },
    select: {
      ownerId: true,
      status: true,
      version: true,
      schemaVersion: true,
      taskBook: true,
      revisions: {
        orderBy: { version: "desc" },
        take: 1,
        select: { id: true, version: true },
      },
    },
  });
  if (!draft || draft.ownerId !== context.actorId) {
    throw new ActivitySourceReferenceError("NOT_FOUND");
  }
  if (draft.status === "SEALED") {
    throw new ActivitySourceReferenceError("DRAFT_SEALED");
  }
  if (draft.schemaVersion !== 3) {
    throw new ActivitySourceReferenceError("UNSUPPORTED_SCHEMA");
  }
  const revision = draft.revisions[0];
  if (!revision || revision.version !== draft.version) {
    throw new ActivitySourceReferenceError("CONCURRENT_WRITE");
  }
  return { draft, revision };
}

/**
 * A teacher adopts one official section for their own open v3 draft (D-067).
 * The reference binds to the draft's current revision and is marked as the
 * teacher's own selection; it never borrows an Agent conversation's reads.
 */
export async function adoptActivitySource(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: AdoptActivitySourceInput,
): Promise<AdoptActivitySourceResult> {
  const input = adoptInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const requestHash = hashValue({
    draftId: input.draftId,
    sourceId: input.sourceId,
    sectionId: input.sectionId,
    rationale: input.rationale,
  });

  return withSerializableRetry(
    () =>
      database.$transaction(
        async (transaction) => {
          const existing = await transaction.idempotencyRecord.findUnique({
            where: {
              actorId_commandName_idempotencyKey: {
                actorId: context.actorId,
                commandName: adoptCommandName,
                idempotencyKey: input.idempotencyKey,
              },
            },
          });
          if (existing) {
            if (existing.requestHash !== requestHash) {
              throw new ActivitySourceReferenceError("IDEMPOTENCY_MISMATCH");
            }
            return adoptResultSchema.parse(existing.response);
          }

          const { draft, revision } = await requireOwnedOpenDraft(
            transaction,
            context,
            input.draftId,
          );
          const fingerprint = officialKnowledgeFingerprint(
            input.sourceId,
            input.sectionId,
          );
          if (!fingerprint) {
            throw new ActivitySourceReferenceError("SOURCE_NOT_FOUND");
          }
          const scope = draftScopeSchema.parse(draft.taskBook);
          const disciplines = new Set([
            scope.mainDisciplineCode,
            ...scope.integratedDisciplineCodes,
          ]);
          if (
            !fingerprint.schoolStages.includes(scope.schoolStage) ||
            (fingerprint.disciplineCodes.length > 0 &&
              !fingerprint.disciplineCodes.some((code) => disciplines.has(code)))
          ) {
            throw new ActivitySourceReferenceError("SOURCE_NOT_APPLICABLE");
          }

          const active = await transaction.activityDraftSourceReference.findFirst({
            where: {
              draftId: input.draftId,
              sectionId: input.sectionId,
              withdrawal: null,
            },
            select: { id: true },
          });
          if (active) {
            throw new ActivitySourceReferenceError("ALREADY_ADOPTED");
          }

          const reference = await transaction.activityDraftSourceReference.create({
            data: {
              draftId: input.draftId,
              revisionId: revision.id,
              origin: "TEACHER_SELECTION",
              adoptedById: context.actorId,
              sourceId: fingerprint.sourceId,
              sectionId: fingerprint.sectionId,
              sourceHash: fingerprint.sourceHash,
              contentHash: fingerprint.contentHash,
              citationLabel: fingerprint.citationLabel,
              rationale: input.rationale,
              createdAt: context.now,
            },
            select: { id: true },
          });
          const response = {
            referenceId: reference.id,
            draftId: input.draftId,
            revisionVersion: revision.version,
          } satisfies AdoptActivitySourceResult;

          await transaction.actionAudit.create({
            data: {
              actorId: context.actorId,
              source: context.source,
              actionName: adoptCommandName,
              targetType: "ActivityDraft",
              targetId: input.draftId,
              requestHash,
              idempotencyKey: input.idempotencyKey,
              outcome: "SUCCEEDED",
              beforeVersion: revision.version,
              afterVersion: revision.version,
              resultResourceId: reference.id,
              traceId: context.traceId,
            },
          });
          await transaction.idempotencyRecord.create({
            data: {
              actorId: context.actorId,
              commandName: adoptCommandName,
              idempotencyKey: input.idempotencyKey,
              requestHash,
              response,
              resourceType: "ActivityDraftSourceReference",
              resourceId: reference.id,
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
    (error) =>
      recordFailure(
        database,
        context,
        {
          actionName: adoptCommandName,
          targetType: "ActivityDraft",
          targetId: input.draftId,
          requestHash,
          idempotencyKey: input.idempotencyKey,
        },
        error,
      ),
  );
}

/**
 * Withdraw an adopted reference. The reference stays in history; the
 * withdrawal is its own append-only row. Withdrawing twice is a no-op.
 */
export async function withdrawActivitySource(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: { referenceId: string },
): Promise<{ referenceId: string; withdrawnAt: string }> {
  const { referenceId } = z
    .object({ referenceId: z.uuid() })
    .strict()
    .parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const requestHash = hashValue({ referenceId });

  return withSerializableRetry(
    () =>
      database.$transaction(
        async (transaction) => {
          const reference =
            await transaction.activityDraftSourceReference.findUnique({
              where: { id: referenceId },
              select: {
                draftId: true,
                withdrawal: { select: { createdAt: true } },
              },
            });
          if (!reference) {
            throw new ActivitySourceReferenceError("NOT_FOUND");
          }
          const { revision } = await requireOwnedOpenDraft(
            transaction,
            context,
            reference.draftId,
          );
          if (reference.withdrawal) {
            return {
              referenceId,
              withdrawnAt: reference.withdrawal.createdAt.toISOString(),
            };
          }
          await transaction.activityDraftSourceWithdrawal.create({
            data: {
              referenceId,
              withdrawnById: context.actorId,
              createdAt: context.now,
            },
          });
          await transaction.actionAudit.create({
            data: {
              actorId: context.actorId,
              source: context.source,
              actionName: withdrawCommandName,
              targetType: "ActivityDraftSourceReference",
              targetId: referenceId,
              requestHash,
              outcome: "SUCCEEDED",
              beforeVersion: revision.version,
              afterVersion: revision.version,
              traceId: context.traceId,
            },
          });
          return { referenceId, withdrawnAt: context.now.toISOString() };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 10_000,
        },
      ),
    (error) =>
      recordFailure(
        database,
        context,
        {
          actionName: withdrawCommandName,
          targetType: "ActivityDraftSourceReference",
          targetId: referenceId,
          requestHash,
        },
        error,
      ),
  );
}
