import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import { activityContentSchema } from "../../domain/activity/activity-content";
import {
  createTeacherEvaluationPayload,
  hashTeacherEvaluationPayload,
  TEACHER_EVALUATION_INTENT_TTL_MS,
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

const commandInputSchema = z
  .object({
    submissionId: z.uuid(),
    expectedSubmissionRevisionId: z.uuid(),
    expectedSubmissionRevisionNumber: z.int().positive(),
    expectedEvaluationVersion: z.int().nonnegative(),
    summary: z.string(),
    outcomes: z.array(z.unknown()).min(1).max(8),
    suggestionAgentRunId: z.uuid().nullable().default(null),
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .strict();

const commandResponseSchema = z.object({
  actionIntentId: z.uuid(),
  submissionRevisionId: z.uuid(),
  expectedEvaluationVersion: z.int().nonnegative(),
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
  expiresAt: z.iso.datetime({ offset: true }),
});

export type PrepareTeacherEvaluationIntentInput = z.input<
  typeof commandInputSchema
>;
export type PrepareTeacherEvaluationIntentResult = z.infer<
  typeof commandResponseSchema
>;

export class PrepareTeacherEvaluationIntentError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "NO_SUBMITTED_REVISION"
      | "STALE_SUBMISSION_REVISION"
      | "EVALUATION_VERSION_CONFLICT"
      | "RUBRIC_UNAVAILABLE"
      | "INVALID_EVALUATION"
      | "INVALID_AGENT_RUN"
      | "IDEMPOTENCY_MISMATCH"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "PrepareTeacherEvaluationIntentError";
  }
}

const commandName = "prepare_teacher_evaluation_intent";

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
  error: PrepareTeacherEvaluationIntentError,
) {
  try {
    await database.actionAudit.create({
      data: {
        actorId: context.actorId,
        agentRunId: input.suggestionAgentRunId,
        source: context.source,
        actionName: commandName,
        targetType: "Submission",
        targetId: input.submissionId,
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
    console.error("Failed to record evaluation-intent failure audit", {
      errorCode: error.code,
      traceId: context.traceId,
    });
  }
}

async function runTransaction(
  database: PrismaClient,
  context: ResolvedCommandContext,
  input: z.infer<typeof commandInputSchema>,
): Promise<PrepareTeacherEvaluationIntentResult> {
  const { now } = context;

  return database.$transaction(
    async (transaction) => {
      const actor = await transaction.appUser.findUnique({
        where: { id: context.actorId },
        select: { role: true },
      });
      if (!actor) {
        throw new PrepareTeacherEvaluationIntentError("NOT_FOUND");
      }
      if (actor.role !== "TEACHER") {
        throw new PrepareTeacherEvaluationIntentError("FORBIDDEN");
      }

      const submission = await transaction.submission.findUnique({
        where: { id: input.submissionId },
        select: {
          id: true,
          latestRevisionNumber: true,
          release: {
            select: {
              publisherId: true,
              classroom: { select: { managerId: true } },
              snapshot: { select: { content: true } },
            },
          },
        },
      });

      if (
        !submission ||
        !submission.release.snapshot ||
        submission.release.publisherId !== context.actorId ||
        submission.release.classroom.managerId !== context.actorId
      ) {
        throw new PrepareTeacherEvaluationIntentError("NOT_FOUND");
      }
      if (submission.latestRevisionNumber === 0) {
        throw new PrepareTeacherEvaluationIntentError("NO_SUBMITTED_REVISION");
      }
      if (
        submission.latestRevisionNumber !==
        input.expectedSubmissionRevisionNumber
      ) {
        throw new PrepareTeacherEvaluationIntentError(
          "STALE_SUBMISSION_REVISION",
        );
      }

      const revision = await transaction.submissionRevision.findUnique({
        where: {
          submissionId_revisionNumber: {
            submissionId: submission.id,
            revisionNumber: submission.latestRevisionNumber,
          },
        },
        select: {
          id: true,
          textEvidence: true,
          completedEvidenceIndexes: true,
          attachments: {
            select: {
              attachment: { select: { id: true, status: true } },
            },
          },
        },
      });

      if (!revision) {
        throw new PrepareTeacherEvaluationIntentError("NOT_FOUND");
      }
      if (revision.id !== input.expectedSubmissionRevisionId) {
        throw new PrepareTeacherEvaluationIntentError(
          "STALE_SUBMISSION_REVISION",
        );
      }

      const content = activityContentSchema.parse(
        submission.release.snapshot.content,
      );
      if (content.schemaVersion !== 2) {
        throw new PrepareTeacherEvaluationIntentError("RUBRIC_UNAVAILABLE");
      }

      const evaluation = await transaction.teacherEvaluation.findUnique({
        where: { submissionRevisionId: revision.id },
        select: { teacherId: true, version: true },
      });
      if (evaluation && evaluation.teacherId !== context.actorId) {
        throw new PrepareTeacherEvaluationIntentError("NOT_FOUND");
      }
      const evaluationVersion = evaluation?.version ?? 0;
      if (evaluationVersion !== input.expectedEvaluationVersion) {
        throw new PrepareTeacherEvaluationIntentError(
          "EVALUATION_VERSION_CONFLICT",
        );
      }

      if (input.suggestionAgentRunId) {
        const agentRun = await transaction.agentRun.findUnique({
          where: { id: input.suggestionAgentRunId },
          select: { actorId: true, status: true },
        });
        if (
          !agentRun ||
          agentRun.actorId !== context.actorId ||
          agentRun.status !== "SUCCEEDED"
        ) {
          throw new PrepareTeacherEvaluationIntentError("INVALID_AGENT_RUN");
        }
      }

      let payload: ReturnType<typeof createTeacherEvaluationPayload>;
      try {
        payload = createTeacherEvaluationPayload(
          {
            submissionId: submission.id,
            submissionRevisionId: revision.id,
            expectedSubmissionRevisionNumber:
              submission.latestRevisionNumber,
            expectedEvaluationVersion: evaluationVersion,
            summary: input.summary,
            outcomes: input.outcomes,
            suggestionAgentRunId: input.suggestionAgentRunId,
          },
          {
            content,
            textEvidence: revision.textEvidence,
            attachmentIds: revision.attachments
              .filter(({ attachment }) => attachment.status === "READY")
              .map(({ attachment }) => attachment.id),
            completedEvidenceIndexes: revision.completedEvidenceIndexes,
          },
        );
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new PrepareTeacherEvaluationIntentError("INVALID_EVALUATION");
        }
        throw error;
      }

      const requestHash = hashTeacherEvaluationPayload(payload);
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
          throw new PrepareTeacherEvaluationIntentError(
            "IDEMPOTENCY_MISMATCH",
          );
        }
        return commandResponseSchema.parse(existing.response);
      }

      const expiresAt = new Date(
        now.getTime() + TEACHER_EVALUATION_INTENT_TTL_MS,
      );
      const intent = await transaction.actionIntent.create({
        data: {
          actorId: context.actorId,
          agentRunId: payload.suggestionAgentRunId,
          actionName: "save_teacher_evaluation",
          payload,
          payloadHash: requestHash,
          targetType: "Submission",
          targetId: submission.id,
          expectedVersion: submission.latestRevisionNumber,
          expiresAt,
          createdAt: now,
        },
      });

      const response = {
        actionIntentId: intent.id,
        submissionRevisionId: revision.id,
        expectedEvaluationVersion: evaluationVersion,
        payloadHash: requestHash,
        expiresAt: expiresAt.toISOString(),
      } satisfies PrepareTeacherEvaluationIntentResult;

      await transaction.actionAudit.create({
        data: {
          actorId: context.actorId,
          agentRunId: payload.suggestionAgentRunId,
          actionIntentId: intent.id,
          source: context.source,
          actionName: commandName,
          targetType: "ActionIntent",
          targetId: intent.id,
          requestHash,
          idempotencyKey: input.idempotencyKey,
          outcome: "SUCCEEDED",
          beforeVersion: evaluationVersion,
          afterVersion: evaluationVersion,
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

export async function prepareTeacherEvaluationIntent(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: PrepareTeacherEvaluationIntentInput,
): Promise<PrepareTeacherEvaluationIntentResult> {
  const input = commandInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI", "AGENT"]);
  const requestHash = hashValue({
    submissionId: input.submissionId,
    expectedSubmissionRevisionId: input.expectedSubmissionRevisionId,
    expectedSubmissionRevisionNumber:
      input.expectedSubmissionRevisionNumber,
    expectedEvaluationVersion: input.expectedEvaluationVersion,
    summary: input.summary,
    outcomes: input.outcomes,
    suggestionAgentRunId: input.suggestionAgentRunId,
  });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await runTransaction(database, context, input);
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" || error.code === "P2002");

      if (retryable && attempt < 3) {
        continue;
      }

      const domainError =
        error instanceof PrepareTeacherEvaluationIntentError
          ? error
          : retryable
            ? new PrepareTeacherEvaluationIntentError("CONCURRENT_WRITE")
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

  throw new PrepareTeacherEvaluationIntentError("CONCURRENT_WRITE");
}
