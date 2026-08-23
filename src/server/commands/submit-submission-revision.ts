import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import { hasMeaningfulTextEvidence } from "../../domain/submission/text-evidence";
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
      | "NO_WORKING_COPY"
      | "STALE_WORKING_COPY"
      | "NO_EVIDENCE"
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

      const submission = await transaction.submission.findUnique({
        where: {
          releaseId_studentId: {
            releaseId: input.releaseId,
            studentId: context.actorId,
          },
        },
        include: { workingCopy: true },
      });

      if (!submission || !submission.workingCopy) {
        throw new SubmitSubmissionRevisionError("NO_WORKING_COPY");
      }

      const workingCopy = submission.workingCopy;
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
      if (!hasMeaningfulTextEvidence(workingCopy.textEvidence)) {
        throw new SubmitSubmissionRevisionError("NO_EVIDENCE");
      }

      const revisionNumber = submission.latestRevisionNumber + 1;
      const updatedSubmission = await transaction.submission.updateMany({
        where: {
          id: submission.id,
          releaseId: input.releaseId,
          studentId: context.actorId,
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
          isLate: release.dueAt !== null && now > release.dueAt,
          submittedAt: now,
        },
      });

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

      const response = {
        submissionId: submission.id,
        revisionId: revision.id,
        revisionNumber: revision.revisionNumber,
        isLate: revision.isLate,
        submittedAt: revision.submittedAt.toISOString(),
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
    expectedWorkingCopyId: input.expectedWorkingCopyId,
    expectedWorkingVersion: input.expectedWorkingVersion,
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
