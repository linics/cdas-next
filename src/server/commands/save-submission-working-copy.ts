import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import { workingTextEvidenceSchema } from "../../domain/submission/text-evidence";
import {
  isSerializationFailure,
  serializableRetryAttempts,
  waitBeforeSerializableRetry,
} from "./serializable-retry";
import {
  completedEvidenceIndexesSchema,
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
import { isActiveSchoolMember } from "../school/teacher-authorization";
import {
  resolveSubmissionAudience,
  submissionAudienceData,
  submissionAudiencePhaseWhere,
  submissionAudienceWhere,
} from "../submissions/submission-audience";

const commandInputSchema = z
  .object({
    releaseId: z.uuid(),
    phaseIndex: phaseIndexSchema.default(0),
    expectedWorkingCopyId: z.uuid().nullable(),
    expectedWorkingVersion: z.int().positive().nullable(),
    textEvidence: workingTextEvidenceSchema,
    completedEvidenceIndexes: completedEvidenceIndexesSchema.default([]),
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      (input.expectedWorkingCopyId === null) !==
      (input.expectedWorkingVersion === null)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "expectedWorkingCopyId and expectedWorkingVersion must both be null or both be present",
        path: ["expectedWorkingCopyId"],
      });
    }
  });

const commandResponseSchema = z.object({
  submissionId: z.uuid(),
  workingCopyId: z.uuid(),
  workingVersion: z.int().positive(),
  baseRevisionNumber: z.int().nonnegative(),
  savedAt: z.iso.datetime({ offset: true }),
});

export type SaveSubmissionWorkingCopyInput = z.input<
  typeof commandInputSchema
>;
export type SaveSubmissionWorkingCopyResult = z.infer<
  typeof commandResponseSchema
>;

export class SaveSubmissionWorkingCopyError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "RELEASE_NOT_ACTIVE"
      | "INVALID_PHASE"
      | "PHASE_LOCKED"
      | "INVALID_CHECKPOINTS"
      | "STALE_WORKING_COPY"
      | "RESUBMISSION_NOT_STARTED"
      | "IDEMPOTENCY_MISMATCH"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "SaveSubmissionWorkingCopyError";
  }
}

const commandName = "save_submission_working_copy";

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
  error: SaveSubmissionWorkingCopyError,
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
    console.error("Failed to record working-copy save failure audit", {
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
): Promise<SaveSubmissionWorkingCopyResult> {
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
          throw new SaveSubmissionWorkingCopyError(
            "IDEMPOTENCY_MISMATCH",
          );
        }
        return commandResponseSchema.parse(existing.response);
      }

      if (!(await isActiveSchoolMember(transaction, context.actorId))) {
        throw new SaveSubmissionWorkingCopyError("NOT_FOUND");
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
        throw new SaveSubmissionWorkingCopyError("NOT_FOUND");
      }
      if (actor.role !== "STUDENT") {
        throw new SaveSubmissionWorkingCopyError("FORBIDDEN");
      }
      if (!release || release.classroom.memberships.length === 0) {
        throw new SaveSubmissionWorkingCopyError("NOT_FOUND");
      }
      if (release.status !== "ACTIVE") {
        throw new SaveSubmissionWorkingCopyError("RELEASE_NOT_ACTIVE");
      }

      if (!release.snapshot) {
        throw new SaveSubmissionWorkingCopyError("NOT_FOUND");
      }
      const audience = await resolveSubmissionAudience(
        transaction,
        input.releaseId,
        context.actorId,
      );
      try {
        resolveSubmissionExecutionScope(
          release.executionVersion,
          release.snapshot.content,
          input.phaseIndex,
          input.completedEvidenceIndexes,
        );
      } catch (error) {
        if (error instanceof SubmissionExecutionError) {
          throw new SaveSubmissionWorkingCopyError(error.code);
        }
        throw error;
      }

      if (release.executionVersion === 1 && input.phaseIndex > 1) {
        const prerequisite = await transaction.submission.findFirst({
          where: {
            ...submissionAudiencePhaseWhere(
              input.releaseId,
              input.phaseIndex - 1,
              audience,
            ),
          },
          select: { latestRevisionNumber: true },
        });
        if (!prerequisite || prerequisite.latestRevisionNumber === 0) {
          throw new SaveSubmissionWorkingCopyError("PHASE_LOCKED");
        }
      }

      if (release.executionVersion === 1 && input.phaseIndex === 0) {
        const content = release.snapshot.content as {
          phases?: unknown[];
        };
        const completedPhases = await transaction.submission.count({
          where: {
            ...submissionAudienceWhere(input.releaseId, audience),
            phaseIndex: { gt: 0 },
            latestRevisionNumber: { gt: 0 },
          },
        });
        if (completedPhases !== content.phases?.length) {
          throw new SaveSubmissionWorkingCopyError("PHASE_LOCKED");
        }
      }

      const submission = await transaction.submission.findFirst({
        where: {
          ...submissionAudiencePhaseWhere(
            input.releaseId,
            input.phaseIndex,
            audience,
          ),
        },
        include: { workingCopy: true },
      });

      let submissionId: string;
      let workingCopyId: string;
      let workingVersion: number;
      let baseRevisionNumber: number;
      let beforeVersion: number | undefined;

      if (!submission) {
        if (
          input.expectedWorkingCopyId !== null ||
          input.expectedWorkingVersion !== null
        ) {
          throw new SaveSubmissionWorkingCopyError("STALE_WORKING_COPY");
        }

        const created = await transaction.submission.create({
          data: {
            releaseId: input.releaseId,
            ...submissionAudienceData(audience),
            phaseIndex: input.phaseIndex,
            createdAt: now,
            updatedAt: now,
            workingCopy: {
              create: {
                textEvidence: input.textEvidence,
                completedEvidenceIndexes: input.completedEvidenceIndexes,
                createdAt: now,
                updatedAt: now,
              },
            },
          },
          include: { workingCopy: true },
        });

        if (!created.workingCopy) {
          throw new SaveSubmissionWorkingCopyError("CONCURRENT_WRITE");
        }

        submissionId = created.id;
        workingCopyId = created.workingCopy.id;
        workingVersion = created.workingCopy.version;
        baseRevisionNumber = created.workingCopy.baseRevisionNumber;
      } else {
        const workingCopy = submission.workingCopy;
        if (!workingCopy) {
          if (submission.latestRevisionNumber > 0) {
            throw new SaveSubmissionWorkingCopyError(
              "RESUBMISSION_NOT_STARTED",
            );
          }
          throw new SaveSubmissionWorkingCopyError("CONCURRENT_WRITE");
        }
        if (
          input.expectedWorkingCopyId !== workingCopy.id ||
          input.expectedWorkingVersion !== workingCopy.version
        ) {
          throw new SaveSubmissionWorkingCopyError("STALE_WORKING_COPY");
        }
        if (
          workingCopy.baseRevisionNumber !== submission.latestRevisionNumber
        ) {
          throw new SaveSubmissionWorkingCopyError("CONCURRENT_WRITE");
        }

        const nextVersion = workingCopy.version + 1;
        const [updatedWorkingCopy, updatedSubmission] = await Promise.all([
          transaction.submissionWorkingCopy.updateMany({
            where: {
              id: workingCopy.id,
              submissionId: submission.id,
              version: workingCopy.version,
            },
            data: {
              textEvidence: input.textEvidence,
              completedEvidenceIndexes: input.completedEvidenceIndexes,
              version: nextVersion,
              updatedAt: now,
            },
          }),
          transaction.submission.updateMany({
            where: {
              id: submission.id,
              ...submissionAudiencePhaseWhere(
                input.releaseId,
                input.phaseIndex,
                audience,
              ),
              latestRevisionNumber: workingCopy.baseRevisionNumber,
            },
            data: { updatedAt: now },
          }),
        ]);

        if (
          updatedWorkingCopy.count !== 1 ||
          updatedSubmission.count !== 1
        ) {
          throw new SaveSubmissionWorkingCopyError("CONCURRENT_WRITE");
        }

        submissionId = submission.id;
        workingCopyId = workingCopy.id;
        workingVersion = nextVersion;
        baseRevisionNumber = workingCopy.baseRevisionNumber;
        beforeVersion = workingCopy.version;
      }

      const response = {
        submissionId,
        workingCopyId,
        workingVersion,
        baseRevisionNumber,
        savedAt: now.toISOString(),
      } satisfies SaveSubmissionWorkingCopyResult;

      await transaction.actionAudit.create({
        data: {
          actorId: context.actorId,
          source: context.source,
          actionName: commandName,
          targetType: "Submission",
          targetId: submissionId,
          requestHash,
          idempotencyKey: input.idempotencyKey,
          outcome: "SUCCEEDED",
          beforeVersion,
          afterVersion: workingVersion,
          resultResourceId: workingCopyId,
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
          resourceType: "SubmissionWorkingCopy",
          resourceId: workingCopyId,
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

export async function saveSubmissionWorkingCopy(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: SaveSubmissionWorkingCopyInput,
): Promise<SaveSubmissionWorkingCopyResult> {
  const input = commandInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const requestHash = hashValue({
    releaseId: input.releaseId,
    phaseIndex: input.phaseIndex,
    expectedWorkingCopyId: input.expectedWorkingCopyId,
    expectedWorkingVersion: input.expectedWorkingVersion,
    textEvidence: input.textEvidence,
    completedEvidenceIndexes: input.completedEvidenceIndexes,
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
        error instanceof SaveSubmissionWorkingCopyError
          ? error
          : retryable
            ? new SaveSubmissionWorkingCopyError("CONCURRENT_WRITE")
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

  throw new SaveSubmissionWorkingCopyError("CONCURRENT_WRITE");
}
