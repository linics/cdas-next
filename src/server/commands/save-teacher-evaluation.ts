import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import {
  isRetryableSerializationError,
  serializableRetryAttempts,
  waitBeforeSerializableRetry,
} from "./serializable-retry";
import {
  hashTeacherEvaluationPayload,
  hashTeacherEvaluationSummary,
  teacherEvaluationPayloadSchema,
} from "../../domain/evaluation/teacher-evaluation-intent";
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
  teacherEvaluationId: z.uuid(),
  teacherEvaluationRevisionId: z.uuid(),
  submissionRevisionId: z.uuid(),
  releaseId: z.uuid(),
  version: z.int().positive(),
  confirmedAt: z.iso.datetime({ offset: true }),
});

export type SaveTeacherEvaluationInput = z.input<typeof commandInputSchema>;
export type SaveTeacherEvaluationResult = z.infer<
  typeof commandResponseSchema
>;

export class SaveTeacherEvaluationError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "ACTION_NOT_CONFIRMED"
      | "ACTION_EXPIRED"
      | "INTENT_TAMPERED"
      | "STALE_SUBMISSION_REVISION"
      | "EVALUATION_VERSION_CONFLICT"
      | "INVALID_AGENT_RUN"
      | "IDEMPOTENCY_MISMATCH"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "SaveTeacherEvaluationError";
  }
}

const commandName = "save_teacher_evaluation";

function hashValue(value: unknown): string {
  const canonicalValue = canonicalize(value);
  if (canonicalValue === undefined) {
    throw new TypeError("Evaluation command input cannot be canonicalized");
  }
  return createHash("sha256").update(canonicalValue).digest("hex");
}

async function recordFailureAudit(
  database: PrismaClient,
  context: ResolvedCommandContext,
  input: z.infer<typeof commandInputSchema>,
  requestHash: string,
  error: SaveTeacherEvaluationError,
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
    console.error("Failed to record teacher-evaluation failure audit", {
      errorCode: error.code,
      traceId: context.traceId,
    });
  }
}

async function lockSubmission(
  transaction: Prisma.TransactionClient,
  submissionId: string,
) {
  return transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "submissions"
    WHERE "id" = ${submissionId}::uuid
    FOR UPDATE
  `);
}

async function lockTeacherEvaluation(
  transaction: Prisma.TransactionClient,
  submissionRevisionId: string,
) {
  return transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "teacher_evaluations"
    WHERE "submission_revision_id" = ${submissionRevisionId}::uuid
    FOR UPDATE
  `);
}

async function runTransaction(
  database: PrismaClient,
  context: ResolvedCommandContext,
  input: z.infer<typeof commandInputSchema>,
  requestHash: string,
): Promise<SaveTeacherEvaluationResult> {
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
          throw new SaveTeacherEvaluationError("IDEMPOTENCY_MISMATCH");
        }
        return commandResponseSchema.parse(existing.response);
      }

      if (!(await isActiveSchoolMember(transaction, context.actorId))) {
        throw new SaveTeacherEvaluationError("NOT_FOUND");
      }

      const intent = await transaction.actionIntent.findUnique({
        where: { id: input.actionIntentId },
        include: {
          actor: { select: { role: true } },
          agentRun: { select: { actorId: true, status: true } },
        },
      });

      if (!intent) {
        throw new SaveTeacherEvaluationError("NOT_FOUND");
      }
      if (
        intent.actorId !== context.actorId ||
        intent.decidedById !== context.actorId
      ) {
        throw new SaveTeacherEvaluationError("FORBIDDEN");
      }
      if (intent.actor.role !== "TEACHER") {
        throw new SaveTeacherEvaluationError("FORBIDDEN");
      }
      if (intent.status !== "CONFIRMED") {
        throw new SaveTeacherEvaluationError("ACTION_NOT_CONFIRMED");
      }
      if (intent.expiresAt <= now) {
        throw new SaveTeacherEvaluationError("ACTION_EXPIRED");
      }

      const parsedPayload = teacherEvaluationPayloadSchema.safeParse(
        intent.payload,
      );
      if (!parsedPayload.success) {
        throw new SaveTeacherEvaluationError("INTENT_TAMPERED");
      }
      const payload = parsedPayload.data;

      if (
        intent.actionName !== commandName ||
        intent.targetType !== "Submission" ||
        intent.targetId !== payload.submissionId ||
        intent.expectedVersion !==
          payload.expectedSubmissionRevisionNumber ||
        intent.agentRunId !== payload.suggestionAgentRunId ||
        hashTeacherEvaluationPayload(payload) !== intent.payloadHash
      ) {
        throw new SaveTeacherEvaluationError("INTENT_TAMPERED");
      }

      if (
        payload.suggestionAgentRunId !== null &&
        (!intent.agentRun ||
          intent.agentRun.actorId !== context.actorId ||
          intent.agentRun.status !== "SUCCEEDED")
      ) {
        throw new SaveTeacherEvaluationError("INVALID_AGENT_RUN");
      }

      const lockedSubmission = await lockSubmission(
        transaction,
        payload.submissionId,
      );
      if (lockedSubmission.length !== 1) {
        throw new SaveTeacherEvaluationError("NOT_FOUND");
      }

      const submission = await transaction.submission.findUnique({
        where: { id: payload.submissionId },
        select: {
          id: true,
          releaseId: true,
          latestRevisionNumber: true,
          release: {
            select: {
              publisherId: true,
              classroom: { select: { managerId: true } },
            },
          },
        },
      });

      if (
        !submission ||
        submission.release.publisherId !== context.actorId ||
        submission.release.classroom.managerId !== context.actorId
      ) {
        throw new SaveTeacherEvaluationError("NOT_FOUND");
      }
      if (
        submission.latestRevisionNumber !==
        payload.expectedSubmissionRevisionNumber
      ) {
        throw new SaveTeacherEvaluationError("STALE_SUBMISSION_REVISION");
      }

      const revision = await transaction.submissionRevision.findUnique({
        where: {
          submissionId_revisionNumber: {
            submissionId: submission.id,
            revisionNumber: submission.latestRevisionNumber,
          },
        },
        select: { id: true },
      });
      if (!revision) {
        throw new SaveTeacherEvaluationError("NOT_FOUND");
      }
      if (revision.id !== payload.submissionRevisionId) {
        throw new SaveTeacherEvaluationError("STALE_SUBMISSION_REVISION");
      }

      await lockTeacherEvaluation(transaction, revision.id);
      const currentEvaluation =
        await transaction.teacherEvaluation.findUnique({
          where: { submissionRevisionId: revision.id },
          select: { id: true, teacherId: true, version: true },
        });
      if (
        currentEvaluation &&
        currentEvaluation.teacherId !== context.actorId
      ) {
        throw new SaveTeacherEvaluationError("NOT_FOUND");
      }
      const currentEvaluationVersion = currentEvaluation?.version ?? 0;
      if (currentEvaluationVersion !== payload.expectedEvaluationVersion) {
        throw new SaveTeacherEvaluationError("EVALUATION_VERSION_CONFLICT");
      }

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
      if (consumedIntent.count !== 1) {
        throw new SaveTeacherEvaluationError("CONCURRENT_WRITE");
      }

      const nextVersion = currentEvaluationVersion + 1;
      const summaryHash = hashTeacherEvaluationSummary(payload.summary);
      const source = intent.agentRunId ? "AI_ASSISTED" : "MANUAL";
      let teacherEvaluationId: string;
      let evaluationRevisionId: string;

      if (!currentEvaluation) {
        const created = await transaction.teacherEvaluation.create({
          data: {
            submissionRevisionId: revision.id,
            teacherId: context.actorId,
            version: nextVersion,
            createdAt: now,
            updatedAt: now,
            revisions: {
              create: {
                version: nextVersion,
                summary: payload.summary,
                summaryHash,
                outcomes: payload.outcomes,
                source,
                confirmedById: context.actorId,
                actionIntentId: intent.id,
                agentRunId: intent.agentRunId,
                confirmedAt: now,
              },
            },
          },
          select: {
            id: true,
            revisions: { select: { id: true } },
          },
        });
        const createdRevision = created.revisions[0];
        if (!createdRevision) {
          throw new SaveTeacherEvaluationError("CONCURRENT_WRITE");
        }
        teacherEvaluationId = created.id;
        evaluationRevisionId = createdRevision.id;
      } else {
        const advanced = await transaction.teacherEvaluation.updateMany({
          where: {
            id: currentEvaluation.id,
            submissionRevisionId: revision.id,
            teacherId: context.actorId,
            version: currentEvaluationVersion,
          },
          data: { version: nextVersion, updatedAt: now },
        });
        if (advanced.count !== 1) {
          throw new SaveTeacherEvaluationError("CONCURRENT_WRITE");
        }

        const createdRevision =
          await transaction.teacherEvaluationRevision.create({
            data: {
              teacherEvaluationId: currentEvaluation.id,
              version: nextVersion,
              summary: payload.summary,
              summaryHash,
              outcomes: payload.outcomes,
              source,
              confirmedById: context.actorId,
              actionIntentId: intent.id,
              agentRunId: intent.agentRunId,
              confirmedAt: now,
            },
          });
        teacherEvaluationId = currentEvaluation.id;
        evaluationRevisionId = createdRevision.id;
      }

      const response = {
        teacherEvaluationId,
        teacherEvaluationRevisionId: evaluationRevisionId,
        submissionRevisionId: revision.id,
        releaseId: submission.releaseId,
        version: nextVersion,
        confirmedAt: now.toISOString(),
      } satisfies SaveTeacherEvaluationResult;

      await transaction.actionAudit.create({
        data: {
          actorId: context.actorId,
          agentRunId: intent.agentRunId,
          actionIntentId: intent.id,
          source: context.source,
          actionName: commandName,
          targetType: "TeacherEvaluation",
          targetId: teacherEvaluationId,
          requestHash,
          idempotencyKey: input.idempotencyKey,
          outcome: "SUCCEEDED",
          beforeVersion: currentEvaluationVersion,
          afterVersion: nextVersion,
          resultResourceId: evaluationRevisionId,
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
          resourceType: "TeacherEvaluationRevision",
          resourceId: evaluationRevisionId,
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

export async function saveTeacherEvaluation(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: SaveTeacherEvaluationInput,
): Promise<SaveTeacherEvaluationResult> {
  const input = commandInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI", "AGENT"]);
  const requestHash = hashValue({ actionIntentId: input.actionIntentId });

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
        error instanceof SaveTeacherEvaluationError
          ? error
          : retryable
            ? new SaveTeacherEvaluationError("CONCURRENT_WRITE")
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

  throw new SaveTeacherEvaluationError("CONCURRENT_WRITE");
}
