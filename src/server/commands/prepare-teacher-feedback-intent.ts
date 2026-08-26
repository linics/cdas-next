import { z } from "zod";
import {
  createTeacherFeedbackPayload,
  hashTeacherFeedbackPayload,
  TEACHER_FEEDBACK_INTENT_TTL_MS,
} from "../../domain/feedback/teacher-feedback-intent";
import {
  teacherFeedbackNextSteps,
  teacherFeedbackSupportLevels,
} from "../../domain/feedback/teacher-feedback-policy";
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
    expectedFeedbackVersion: z.int().nonnegative(),
    body: z.string(),
    nextStep: z.enum(teacherFeedbackNextSteps),
    supportLevel: z.enum(teacherFeedbackSupportLevels),
    suggestionAgentRunId: z.uuid().nullable().default(null),
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .strict();

const commandResponseSchema = z.object({
  actionIntentId: z.uuid(),
  submissionRevisionId: z.uuid(),
  expectedFeedbackVersion: z.int().nonnegative(),
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
  expiresAt: z.iso.datetime({ offset: true }),
});

export type PrepareTeacherFeedbackIntentInput = z.input<
  typeof commandInputSchema
>;
export type PrepareTeacherFeedbackIntentResult = z.infer<
  typeof commandResponseSchema
>;

export class PrepareTeacherFeedbackIntentError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "NO_SUBMITTED_REVISION"
      | "STALE_SUBMISSION_REVISION"
      | "FEEDBACK_VERSION_CONFLICT"
      | "INVALID_AGENT_RUN"
      | "IDEMPOTENCY_MISMATCH"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "PrepareTeacherFeedbackIntentError";
  }
}

const commandName = "prepare_teacher_feedback_intent";

async function recordFailureAudit(
  database: PrismaClient,
  context: ResolvedCommandContext,
  input: z.infer<typeof commandInputSchema>,
  requestHash: string,
  error: PrepareTeacherFeedbackIntentError,
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
    console.error("Failed to record feedback-intent failure audit", {
      errorCode: error.code,
      traceId: context.traceId,
    });
  }
}

async function runTransaction(
  database: PrismaClient,
  context: ResolvedCommandContext,
  input: z.infer<typeof commandInputSchema>,
  payload: ReturnType<typeof createTeacherFeedbackPayload>,
  requestHash: string,
): Promise<PrepareTeacherFeedbackIntentResult> {
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
          throw new PrepareTeacherFeedbackIntentError(
            "IDEMPOTENCY_MISMATCH",
          );
        }
        return commandResponseSchema.parse(existing.response);
      }

      const [actor, submission] = await Promise.all([
        transaction.appUser.findUnique({
          where: { id: context.actorId },
          select: { role: true },
        }),
        transaction.submission.findUnique({
          where: { id: input.submissionId },
          select: {
            id: true,
            latestRevisionNumber: true,
            release: {
              select: {
                publisherId: true,
                classroom: { select: { managerId: true } },
              },
            },
          },
        }),
      ]);

      if (!actor) {
        throw new PrepareTeacherFeedbackIntentError("NOT_FOUND");
      }
      if (actor.role !== "TEACHER") {
        throw new PrepareTeacherFeedbackIntentError("FORBIDDEN");
      }
      if (
        !submission ||
        submission.release.publisherId !== context.actorId ||
        submission.release.classroom.managerId !== context.actorId
      ) {
        throw new PrepareTeacherFeedbackIntentError("NOT_FOUND");
      }
      if (submission.latestRevisionNumber === 0) {
        throw new PrepareTeacherFeedbackIntentError(
          "NO_SUBMITTED_REVISION",
        );
      }
      if (
        submission.latestRevisionNumber !==
        input.expectedSubmissionRevisionNumber
      ) {
        throw new PrepareTeacherFeedbackIntentError(
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
        select: { id: true },
      });

      if (!revision) {
        throw new PrepareTeacherFeedbackIntentError("NOT_FOUND");
      }
      if (revision.id !== input.expectedSubmissionRevisionId) {
        throw new PrepareTeacherFeedbackIntentError(
          "STALE_SUBMISSION_REVISION",
        );
      }

      const feedback = await transaction.teacherFeedback.findUnique({
        where: { submissionRevisionId: revision.id },
        select: { teacherId: true, version: true },
      });
      if (feedback && feedback.teacherId !== context.actorId) {
        throw new PrepareTeacherFeedbackIntentError("NOT_FOUND");
      }
      const feedbackVersion = feedback?.version ?? 0;
      if (feedbackVersion !== input.expectedFeedbackVersion) {
        throw new PrepareTeacherFeedbackIntentError(
          "FEEDBACK_VERSION_CONFLICT",
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
          throw new PrepareTeacherFeedbackIntentError("INVALID_AGENT_RUN");
        }
      }

      const expiresAt = new Date(
        now.getTime() + TEACHER_FEEDBACK_INTENT_TTL_MS,
      );
      const intent = await transaction.actionIntent.create({
        data: {
          actorId: context.actorId,
          agentRunId: payload.suggestionAgentRunId,
          actionName: "save_teacher_feedback",
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
        expectedFeedbackVersion: feedbackVersion,
        payloadHash: requestHash,
        expiresAt: expiresAt.toISOString(),
      } satisfies PrepareTeacherFeedbackIntentResult;

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
          beforeVersion: feedbackVersion,
          afterVersion: feedbackVersion,
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

export async function prepareTeacherFeedbackIntent(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: PrepareTeacherFeedbackIntentInput,
): Promise<PrepareTeacherFeedbackIntentResult> {
  const input = commandInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI", "AGENT"]);
  const payload = createTeacherFeedbackPayload({
    submissionId: input.submissionId,
    submissionRevisionId: input.expectedSubmissionRevisionId,
    expectedSubmissionRevisionNumber:
      input.expectedSubmissionRevisionNumber,
    expectedFeedbackVersion: input.expectedFeedbackVersion,
    body: input.body,
    nextStep: input.nextStep,
    supportLevel: input.supportLevel,
    suggestionAgentRunId: input.suggestionAgentRunId,
  });
  const requestHash = hashTeacherFeedbackPayload(payload);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await runTransaction(
        database,
        context,
        input,
        payload,
        requestHash,
      );
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" || error.code === "P2002");

      if (retryable && attempt < 3) {
        continue;
      }

      const domainError =
        error instanceof PrepareTeacherFeedbackIntentError
          ? error
          : retryable
            ? new PrepareTeacherFeedbackIntentError("CONCURRENT_WRITE")
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

  throw new PrepareTeacherFeedbackIntentError("CONCURRENT_WRITE");
}
