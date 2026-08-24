import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
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

const commandInputSchema = z
  .object({
    releaseId: z.uuid(),
    phaseIndex: phaseIndexSchema.default(0),
    expectedLatestRevisionNumber: z.int().positive(),
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .strict();

const commandResponseSchema = z.object({
  submissionId: z.uuid(),
  workingCopyId: z.uuid(),
  workingVersion: z.int().positive(),
  baseRevisionNumber: z.int().positive(),
  startedAt: z.iso.datetime({ offset: true }),
});

export type StartSubmissionResubmissionInput = z.input<
  typeof commandInputSchema
>;
export type StartSubmissionResubmissionResult = z.infer<
  typeof commandResponseSchema
>;

export class StartSubmissionResubmissionError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "RELEASE_NOT_ACTIVE"
      | "INVALID_PHASE"
      | "NO_SUBMITTED_REVISION"
      | "STALE_REVISION"
      | "IDEMPOTENCY_MISMATCH"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "StartSubmissionResubmissionError";
  }
}

const commandName = "start_submission_resubmission";

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
  error: StartSubmissionResubmissionError,
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
    console.error("Failed to record resubmission-start failure audit", {
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
): Promise<StartSubmissionResubmissionResult> {
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
          throw new StartSubmissionResubmissionError(
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
        throw new StartSubmissionResubmissionError("NOT_FOUND");
      }
      if (actor.role !== "STUDENT") {
        throw new StartSubmissionResubmissionError("FORBIDDEN");
      }
      if (!release || release.classroom.memberships.length === 0) {
        throw new StartSubmissionResubmissionError("NOT_FOUND");
      }
      if (release.status !== "ACTIVE") {
        throw new StartSubmissionResubmissionError("RELEASE_NOT_ACTIVE");
      }

      if (!release.snapshot) {
        throw new StartSubmissionResubmissionError("NOT_FOUND");
      }
      try {
        resolveSubmissionExecutionScope(
          release.executionVersion,
          release.snapshot.content,
          input.phaseIndex,
        );
      } catch (error) {
        if (error instanceof SubmissionExecutionError) {
          throw new StartSubmissionResubmissionError("INVALID_PHASE");
        }
        throw error;
      }

      const submission = await transaction.submission.findUnique({
        where: {
          releaseId_studentId_phaseIndex: {
            releaseId: input.releaseId,
            studentId: context.actorId,
            phaseIndex: input.phaseIndex,
          },
        },
        include: { workingCopy: true },
      });

      if (!submission || submission.latestRevisionNumber === 0) {
        throw new StartSubmissionResubmissionError(
          "NO_SUBMITTED_REVISION",
        );
      }
      if (
        submission.latestRevisionNumber !==
        input.expectedLatestRevisionNumber
      ) {
        throw new StartSubmissionResubmissionError("STALE_REVISION");
      }

      let workingCopyId: string;
      let workingVersion: number;
      let startedAt: Date;

      if (submission.workingCopy) {
        if (
          submission.workingCopy.baseRevisionNumber !==
          submission.latestRevisionNumber
        ) {
          throw new StartSubmissionResubmissionError("CONCURRENT_WRITE");
        }

        workingCopyId = submission.workingCopy.id;
        workingVersion = submission.workingCopy.version;
        startedAt = submission.workingCopy.createdAt;
      } else {
        const currentRevision =
          await transaction.submissionRevision.findUnique({
            where: {
              submissionId_revisionNumber: {
                submissionId: submission.id,
                revisionNumber: submission.latestRevisionNumber,
              },
            },
            include: {
              attachments: {
                orderBy: { position: "asc" },
                select: { attachmentId: true, position: true },
              },
            },
          });

        if (!currentRevision) {
          throw new StartSubmissionResubmissionError("CONCURRENT_WRITE");
        }

        const touchedSubmission = await transaction.submission.updateMany({
          where: {
            id: submission.id,
            releaseId: input.releaseId,
            studentId: context.actorId,
            phaseIndex: input.phaseIndex,
            latestRevisionNumber: input.expectedLatestRevisionNumber,
          },
          data: { updatedAt: now },
        });

        if (touchedSubmission.count !== 1) {
          throw new StartSubmissionResubmissionError("CONCURRENT_WRITE");
        }

        const created = await transaction.submissionWorkingCopy.create({
          data: {
            submissionId: submission.id,
            baseRevisionNumber: submission.latestRevisionNumber,
            textEvidence: currentRevision.textEvidence,
            completedEvidenceIndexes:
              currentRevision.completedEvidenceIndexes,
            createdAt: now,
            updatedAt: now,
          },
        });

        if (currentRevision.attachments.length > 0) {
          const copiedAttachments =
            await transaction.submissionWorkingCopyAttachment.createMany({
              data: currentRevision.attachments.map((entry) => ({
                workingCopyId: created.id,
                attachmentId: entry.attachmentId,
                position: entry.position,
                addedAt: now,
              })),
            });
          if (copiedAttachments.count !== currentRevision.attachments.length) {
            throw new StartSubmissionResubmissionError("CONCURRENT_WRITE");
          }
        }

        workingCopyId = created.id;
        workingVersion = created.version;
        startedAt = created.createdAt;
      }

      const response = {
        submissionId: submission.id,
        workingCopyId,
        workingVersion,
        baseRevisionNumber: submission.latestRevisionNumber,
        startedAt: startedAt.toISOString(),
      } satisfies StartSubmissionResubmissionResult;

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
          beforeVersion: submission.latestRevisionNumber,
          afterVersion: submission.latestRevisionNumber,
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

export async function startSubmissionResubmission(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: StartSubmissionResubmissionInput,
): Promise<StartSubmissionResubmissionResult> {
  const input = commandInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const requestHash = hashValue({
    releaseId: input.releaseId,
    phaseIndex: input.phaseIndex,
    expectedLatestRevisionNumber: input.expectedLatestRevisionNumber,
  });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await runTransaction(database, context, input, requestHash);
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";

      if (retryable && attempt < 3) {
        continue;
      }

      const domainError =
        error instanceof StartSubmissionResubmissionError
          ? error
          : retryable
            ? new StartSubmissionResubmissionError("CONCURRENT_WRITE")
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

  throw new StartSubmissionResubmissionError("CONCURRENT_WRITE");
}
