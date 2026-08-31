import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import { hasMeaningfulTextEvidence } from "../../domain/submission/text-evidence";
import {
  isSerializationFailure,
  serializableRetryAttempts,
  waitBeforeSerializableRetry,
} from "./serializable-retry";
import {
  phaseIndexSchema,
  resolveSubmissionExecutionScope,
  SubmissionExecutionError,
} from "../../domain/submission/sequential-execution";
import {
  Prisma,
  type PrismaClient,
} from "../../generated/prisma/client";
import {
  type CommandContext,
  type ResolvedCommandContext,
  resolveCommandContext,
} from "./command-context";
import {
  resolveSubmissionAudience,
  submissionAudienceData,
  submissionAudiencePhaseWhere,
} from "../submissions/submission-audience";

const commandInputSchema = z
  .object({
    releaseId: z.uuid(),
    phaseIndex: phaseIndexSchema.default(0),
    expectedWorkingCopyId: z.uuid(),
    expectedWorkingVersion: z.int().positive(),
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .strict();

const commandResponseSchema = z.object({
  submissionId: z.uuid(),
  revisionId: z.uuid(),
  revisionNumber: z.int().positive(),
  isLate: z.boolean(),
  submittedAt: z.iso.datetime({ offset: true }),
  nextSubmissionId: z.uuid().nullable().default(null),
  nextPhaseIndex: phaseIndexSchema.nullable().default(null),
});

export type SubmitSubmissionRevisionInput = z.input<typeof commandInputSchema>;
export type SubmitSubmissionRevisionResult = z.infer<
  typeof commandResponseSchema
>;

export class SubmitSubmissionRevisionError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "RELEASE_NOT_ACTIVE"
      | "INVALID_PHASE"
      | "INVALID_CHECKPOINTS"
      | "NO_WORKING_COPY"
      | "STALE_WORKING_COPY"
      | "NO_EVIDENCE"
      | "ATTACHMENTS_NOT_READY"
      | "IDEMPOTENCY_MISMATCH"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "SubmitSubmissionRevisionError";
  }
}

const commandName = "submit_submission_revision";

function hashValue(value: unknown): string {
  const canonicalValue = canonicalize(value);
  if (canonicalValue === undefined) {
    throw new TypeError("Command input cannot be canonicalized");
  }
  return createHash("sha256").update(canonicalValue).digest("hex");
}

async function recordFailureAudit(
  database: PrismaClient,
  context: ResolvedCommandContext,
  input: z.infer<typeof commandInputSchema>,
  requestHash: string,
  error: SubmitSubmissionRevisionError,
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
    console.error("Failed to record submission failure audit", {
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
): Promise<SubmitSubmissionRevisionResult> {
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
          throw new SubmitSubmissionRevisionError(
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
            status: true,
            dueAt: true,
            executionVersion: true,
            snapshot: { select: { content: true } },
            classroom: {
              select: {
                memberships: {
                  where: {
                    studentId: context.actorId,
                    joinedAt: { lte: now },
                    OR: [{ endedAt: null }, { endedAt: { gt: now } }],
                  },
                  select: { id: true },
                  take: 1,
                },
              },
            },
          },
        }),
      ]);

      if (!actor) {
        throw new SubmitSubmissionRevisionError("NOT_FOUND");
      }
      if (actor.role !== "STUDENT") {
        throw new SubmitSubmissionRevisionError("FORBIDDEN");
      }
      if (!release || release.classroom.memberships.length === 0) {
        throw new SubmitSubmissionRevisionError("NOT_FOUND");
      }
      if (release.status !== "ACTIVE") {
        throw new SubmitSubmissionRevisionError("RELEASE_NOT_ACTIVE");
      }
      const audience = await resolveSubmissionAudience(
        transaction,
        input.releaseId,
        context.actorId,
      );

      const submission = await transaction.submission.findFirst({
        where: {
          ...submissionAudiencePhaseWhere(
            input.releaseId,
            input.phaseIndex,
            audience,
          ),
        },
        include: {
          workingCopy: {
            include: {
              attachments: {
                orderBy: { position: "asc" },
                include: {
                  attachment: { select: { status: true } },
                },
              },
            },
          },
        },
      });

      if (!submission || !submission.workingCopy) {
        throw new SubmitSubmissionRevisionError("NO_WORKING_COPY");
      }

      const workingCopy = submission.workingCopy;
      if (!release.snapshot) {
        throw new SubmitSubmissionRevisionError("NOT_FOUND");
      }
      let executionScope;
      try {
        executionScope = resolveSubmissionExecutionScope(
          release.executionVersion,
          release.snapshot.content,
          input.phaseIndex,
          workingCopy.completedEvidenceIndexes,
        );
      } catch (error) {
        if (error instanceof SubmissionExecutionError) {
          throw new SubmitSubmissionRevisionError(error.code);
        }
        throw error;
      }
      if (
        workingCopy.id !== input.expectedWorkingCopyId ||
        workingCopy.version !== input.expectedWorkingVersion
      ) {
        throw new SubmitSubmissionRevisionError("STALE_WORKING_COPY");
      }
      if (
        workingCopy.baseRevisionNumber !== submission.latestRevisionNumber
      ) {
        throw new SubmitSubmissionRevisionError("CONCURRENT_WRITE");
      }
      if (
        !hasMeaningfulTextEvidence(workingCopy.textEvidence) &&
        workingCopy.attachments.length === 0 &&
        workingCopy.completedEvidenceIndexes.length === 0
      ) {
        throw new SubmitSubmissionRevisionError("NO_EVIDENCE");
      }
      if (
        workingCopy.attachments.some(
          ({ attachment }) => attachment.status !== "READY",
        )
      ) {
        throw new SubmitSubmissionRevisionError(
          "ATTACHMENTS_NOT_READY",
        );
      }

      const revisionNumber = submission.latestRevisionNumber + 1;
      const updatedSubmission = await transaction.submission.updateMany({
        where: {
          id: submission.id,
          ...submissionAudiencePhaseWhere(
            input.releaseId,
            input.phaseIndex,
            audience,
          ),
          latestRevisionNumber: workingCopy.baseRevisionNumber,
        },
        data: {
          latestRevisionNumber: revisionNumber,
          updatedAt: now,
        },
      });

      if (updatedSubmission.count !== 1) {
        throw new SubmitSubmissionRevisionError("CONCURRENT_WRITE");
      }

      const revision = await transaction.submissionRevision.create({
        data: {
          submissionId: submission.id,
          revisionNumber,
          baseRevisionNumber: workingCopy.baseRevisionNumber,
          sourceWorkingCopyId: workingCopy.id,
          sourceWorkingVersion: workingCopy.version,
          textEvidence: workingCopy.textEvidence,
          completedEvidenceIndexes:
            workingCopy.completedEvidenceIndexes,
          isLate: release.dueAt !== null && now > release.dueAt,
          submittedAt: now,
        },
      });

      if (workingCopy.attachments.length > 0) {
        const copiedAttachments =
          await transaction.submissionRevisionAttachment.createMany({
            data: workingCopy.attachments.map((entry) => ({
              submissionRevisionId: revision.id,
              attachmentId: entry.attachmentId,
              position: entry.position,
              createdAt: now,
            })),
          });
        if (copiedAttachments.count !== workingCopy.attachments.length) {
          throw new SubmitSubmissionRevisionError("CONCURRENT_WRITE");
        }

        const removedAttachmentLinks =
          await transaction.submissionWorkingCopyAttachment.deleteMany({
            where: { workingCopyId: workingCopy.id },
          });
        if (
          removedAttachmentLinks.count !== workingCopy.attachments.length
        ) {
          throw new SubmitSubmissionRevisionError("CONCURRENT_WRITE");
        }
      }

      const removedWorkingCopy =
        await transaction.submissionWorkingCopy.deleteMany({
          where: {
            id: workingCopy.id,
            submissionId: submission.id,
            version: workingCopy.version,
          },
        });

      if (removedWorkingCopy.count !== 1) {
        throw new SubmitSubmissionRevisionError("CONCURRENT_WRITE");
      }

      let nextSubmissionId: string | null = null;
      if (executionScope.nextPhaseIndex !== null) {
        const nextPhaseIndex = executionScope.nextPhaseIndex;
        const existingNext = await transaction.submission.findFirst({
          where: {
            ...submissionAudiencePhaseWhere(
              input.releaseId,
              nextPhaseIndex,
              audience,
            ),
          },
          include: { workingCopy: true },
        });

        if (existingNext) {
          if (
            existingNext.latestRevisionNumber === 0 &&
            !existingNext.workingCopy
          ) {
            throw new SubmitSubmissionRevisionError("CONCURRENT_WRITE");
          }
          nextSubmissionId = existingNext.id;
        } else {
          const nextSubmission = await transaction.submission.create({
            data: {
              releaseId: input.releaseId,
              ...submissionAudienceData(audience),
              phaseIndex: nextPhaseIndex,
              createdAt: now,
              updatedAt: now,
              workingCopy: {
                create: {
                  textEvidence: "",
                  completedEvidenceIndexes: [],
                  createdAt: now,
                  updatedAt: now,
                },
              },
            },
          });
          nextSubmissionId = nextSubmission.id;
        }
      }

      const response = {
        submissionId: submission.id,
        revisionId: revision.id,
        revisionNumber: revision.revisionNumber,
        isLate: revision.isLate,
        submittedAt: revision.submittedAt.toISOString(),
        nextSubmissionId,
        nextPhaseIndex: executionScope.nextPhaseIndex,
      } satisfies SubmitSubmissionRevisionResult;

      await transaction.actionAudit.create({
        data: {
          actorId: context.actorId,
          source: context.source,
          actionName: commandName,
          targetType: "Submission",
          targetId: submission.id,
          requestHash,
          idempotencyKey: input.idempotencyKey,
          outcome: "SUCCEEDED",
          beforeVersion: workingCopy.baseRevisionNumber,
          afterVersion: revision.revisionNumber,
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
          resourceType: "SubmissionRevision",
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

export async function submitSubmissionRevision(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: SubmitSubmissionRevisionInput,
): Promise<SubmitSubmissionRevisionResult> {
  const input = commandInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const requestHash = hashValue({
    releaseId: input.releaseId,
    phaseIndex: input.phaseIndex,
    expectedWorkingCopyId: input.expectedWorkingCopyId,
    expectedWorkingVersion: input.expectedWorkingVersion,
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
        error instanceof SubmitSubmissionRevisionError
          ? error
          : retryable
            ? new SubmitSubmissionRevisionError("CONCURRENT_WRITE")
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

  throw new SubmitSubmissionRevisionError("CONCURRENT_WRITE");
}
