import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import {
  hashTeacherFeedbackBody,
  hashTeacherFeedbackPayload,
  teacherFeedbackPayloadSchema,
} from "../../domain/feedback/teacher-feedback-intent";
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
    actionIntentId: z.uuid(),
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .strict();

const commandResponseSchema = z.object({
  teacherFeedbackId: z.uuid(),
  teacherFeedbackRevisionId: z.uuid(),
  submissionRevisionId: z.uuid(),
  version: z.int().positive(),
  confirmedAt: z.iso.datetime({ offset: true }),
});

export type SaveTeacherFeedbackInput = z.input<typeof commandInputSchema>;
export type SaveTeacherFeedbackResult = z.infer<typeof commandResponseSchema>;

export class SaveTeacherFeedbackError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "ACTION_NOT_CONFIRMED"
      | "ACTION_EXPIRED"
      | "INTENT_TAMPERED"
      | "STALE_SUBMISSION_REVISION"
      | "FEEDBACK_VERSION_CONFLICT"
      | "INVALID_AGENT_RUN"
      | "IDEMPOTENCY_MISMATCH"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "SaveTeacherFeedbackError";
  }
}

const commandName = "save_teacher_feedback";

function hashValue(value: unknown): string {
  const canonicalValue = canonicalize(value);
  if (canonicalValue === undefined) {
    throw new TypeError("Feedback command input cannot be canonicalized");
  }
  return createHash("sha256").update(canonicalValue).digest("hex");
}

async function recordFailureAudit(
  database: PrismaClient,
  context: ResolvedCommandContext,
  input: z.infer<typeof commandInputSchema>,
  requestHash: string,
  error: SaveTeacherFeedbackError,
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
    console.error("Failed to record teacher-feedback failure audit", {
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

async function lockTeacherFeedback(
  transaction: Prisma.TransactionClient,
  submissionRevisionId: string,
) {
  return transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "teacher_feedback"
    WHERE "submission_revision_id" = ${submissionRevisionId}::uuid
    FOR UPDATE
  `);
}

async function runTransaction(
  database: PrismaClient,
  context: ResolvedCommandContext,
  input: z.infer<typeof commandInputSchema>,
  requestHash: string,
): Promise<SaveTeacherFeedbackResult> {
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
          throw new SaveTeacherFeedbackError("IDEMPOTENCY_MISMATCH");
        }
        return commandResponseSchema.parse(existing.response);
      }

      const intent = await transaction.actionIntent.findUnique({
        where: { id: input.actionIntentId },
        include: {
          actor: { select: { role: true } },
          agentRun: { select: { actorId: true, status: true } },
        },
      });

      if (!intent) {
        throw new SaveTeacherFeedbackError("NOT_FOUND");
      }
      if (
        intent.actorId !== context.actorId ||
        intent.decidedById !== context.actorId
      ) {
        throw new SaveTeacherFeedbackError("FORBIDDEN");
      }
      if (intent.actor.role !== "TEACHER") {
        throw new SaveTeacherFeedbackError("FORBIDDEN");
      }
      if (intent.status !== "CONFIRMED") {
        throw new SaveTeacherFeedbackError("ACTION_NOT_CONFIRMED");
      }
      if (intent.expiresAt <= now) {
        throw new SaveTeacherFeedbackError("ACTION_EXPIRED");
      }

      const parsedPayload = teacherFeedbackPayloadSchema.safeParse(
        intent.payload,
      );
      if (!parsedPayload.success) {
        throw new SaveTeacherFeedbackError("INTENT_TAMPERED");
      }
      const payload = parsedPayload.data;

      if (
        intent.actionName !== commandName ||
        intent.targetType !== "Submission" ||
        intent.targetId !== payload.submissionId ||
        intent.expectedVersion !==
          payload.expectedSubmissionRevisionNumber ||
        intent.agentRunId !== payload.suggestionAgentRunId ||
        hashTeacherFeedbackPayload(payload) !== intent.payloadHash
      ) {
        throw new SaveTeacherFeedbackError("INTENT_TAMPERED");
      }

      if (
        payload.suggestionAgentRunId !== null &&
        (!intent.agentRun ||
          intent.agentRun.actorId !== context.actorId ||
          intent.agentRun.status !== "SUCCEEDED")
      ) {
        throw new SaveTeacherFeedbackError("INVALID_AGENT_RUN");
      }

      const lockedSubmission = await lockSubmission(
        transaction,
        payload.submissionId,
      );
      if (lockedSubmission.length !== 1) {
        throw new SaveTeacherFeedbackError("NOT_FOUND");
      }

      const submission = await transaction.submission.findUnique({
        where: { id: payload.submissionId },
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
      });

      if (
        !submission ||
        submission.release.publisherId !== context.actorId ||
        submission.release.classroom.managerId !== context.actorId
      ) {
        throw new SaveTeacherFeedbackError("NOT_FOUND");
      }
      if (
        submission.latestRevisionNumber !==
        payload.expectedSubmissionRevisionNumber
      ) {
        throw new SaveTeacherFeedbackError(
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
        throw new SaveTeacherFeedbackError("NOT_FOUND");
      }
      if (revision.id !== payload.submissionRevisionId) {
        throw new SaveTeacherFeedbackError(
          "STALE_SUBMISSION_REVISION",
        );
      }

      await lockTeacherFeedback(transaction, revision.id);
      const currentFeedback = await transaction.teacherFeedback.findUnique({
        where: { submissionRevisionId: revision.id },
        select: { id: true, teacherId: true, version: true },
      });
      if (currentFeedback && currentFeedback.teacherId !== context.actorId) {
        throw new SaveTeacherFeedbackError("NOT_FOUND");
      }
      const currentFeedbackVersion = currentFeedback?.version ?? 0;
      if (
        currentFeedbackVersion !== payload.expectedFeedbackVersion
      ) {
        throw new SaveTeacherFeedbackError(
          "FEEDBACK_VERSION_CONFLICT",
        );
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
        throw new SaveTeacherFeedbackError("CONCURRENT_WRITE");
      }

      const nextVersion = currentFeedbackVersion + 1;
      const bodyHash = hashTeacherFeedbackBody(payload.body);
      const source = intent.agentRunId ? "AI_ASSISTED" : "MANUAL";
      let teacherFeedbackId: string;
      let feedbackRevisionId: string;

      if (!currentFeedback) {
        const created = await transaction.teacherFeedback.create({
          data: {
            submissionRevisionId: revision.id,
            teacherId: context.actorId,
            version: nextVersion,
            createdAt: now,
            updatedAt: now,
            revisions: {
              create: {
                version: nextVersion,
                body: payload.body,
                bodyHash,
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
          throw new SaveTeacherFeedbackError("CONCURRENT_WRITE");
        }
        teacherFeedbackId = created.id;
        feedbackRevisionId = createdRevision.id;
      } else {
        const advanced = await transaction.teacherFeedback.updateMany({
          where: {
            id: currentFeedback.id,
            submissionRevisionId: revision.id,
            teacherId: context.actorId,
            version: currentFeedbackVersion,
          },
          data: { version: nextVersion, updatedAt: now },
        });
        if (advanced.count !== 1) {
          throw new SaveTeacherFeedbackError("CONCURRENT_WRITE");
        }

        const createdRevision =
          await transaction.teacherFeedbackRevision.create({
            data: {
              teacherFeedbackId: currentFeedback.id,
              version: nextVersion,
              body: payload.body,
              bodyHash,
              source,
              confirmedById: context.actorId,
              actionIntentId: intent.id,
              agentRunId: intent.agentRunId,
              confirmedAt: now,
            },
          });
        teacherFeedbackId = currentFeedback.id;
        feedbackRevisionId = createdRevision.id;
      }

      const response = {
        teacherFeedbackId,
        teacherFeedbackRevisionId: feedbackRevisionId,
        submissionRevisionId: revision.id,
        version: nextVersion,
        confirmedAt: now.toISOString(),
      } satisfies SaveTeacherFeedbackResult;

      await transaction.actionAudit.create({
        data: {
          actorId: context.actorId,
          agentRunId: intent.agentRunId,
          actionIntentId: intent.id,
          source: context.source,
          actionName: commandName,
          targetType: "TeacherFeedback",
          targetId: teacherFeedbackId,
          requestHash,
          idempotencyKey: input.idempotencyKey,
          outcome: "SUCCEEDED",
          beforeVersion: currentFeedbackVersion,
          afterVersion: nextVersion,
          resultResourceId: feedbackRevisionId,
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
          resourceType: "TeacherFeedbackRevision",
          resourceId: feedbackRevisionId,
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

export async function saveTeacherFeedback(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: SaveTeacherFeedbackInput,
): Promise<SaveTeacherFeedbackResult> {
  const input = commandInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI", "AGENT"]);
  const requestHash = hashValue({ actionIntentId: input.actionIntentId });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await runTransaction(database, context, input, requestHash);
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" || error.code === "P2002");

      if (retryable && attempt < 3) {
        continue;
      }

      const domainError =
        error instanceof SaveTeacherFeedbackError
          ? error
          : retryable
            ? new SaveTeacherFeedbackError("CONCURRENT_WRITE")
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

  throw new SaveTeacherFeedbackError("CONCURRENT_WRITE");
}
