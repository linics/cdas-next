import "server-only";

import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import {
  type CommandContext,
  resolveCommandContext,
} from "./command-context";
import { isActiveSchoolMember } from "../school/teacher-authorization";

const commandInputSchema = z
  .object({
    agentRunId: z.uuid(),
    submissionId: z.uuid(),
    submissionRevisionId: z.uuid(),
    submissionRevisionNumber: z.int().positive(),
    expectedFeedbackVersion: z.int().nonnegative(),
  })
  .strict();

export const teacherFeedbackSuggestionActionName =
  "suggest_teacher_feedback";

export type CompleteTeacherFeedbackSuggestionInput = z.input<
  typeof commandInputSchema
>;

export type CompleteTeacherFeedbackSuggestionResult = Readonly<{
  agentRunId: string;
  submissionRevisionId: string;
  submissionRevisionNumber: number;
  expectedFeedbackVersion: number;
  completedAt: string;
}>;

export class CompleteTeacherFeedbackSuggestionError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "STALE_SUBMISSION_REVISION"
      | "FEEDBACK_VERSION_CONFLICT"
      | "INVALID_AGENT_RUN"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "CompleteTeacherFeedbackSuggestionError";
  }
}
function bindingHash(input: z.infer<typeof commandInputSchema>): string {
  const canonical = canonicalize({
    actionName: teacherFeedbackSuggestionActionName,
    agentRunId: input.agentRunId,
    submissionId: input.submissionId,
    submissionRevisionId: input.submissionRevisionId,
    submissionRevisionNumber: input.submissionRevisionNumber,
    expectedFeedbackVersion: input.expectedFeedbackVersion,
  });
  if (canonical === undefined) {
    throw new TypeError("Suggestion provenance binding cannot be canonicalized");
  }
  return createHash("sha256").update(canonical).digest("hex");
}

export async function completeTeacherFeedbackSuggestion(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: CompleteTeacherFeedbackSuggestionInput,
): Promise<CompleteTeacherFeedbackSuggestionResult> {
  const input = commandInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["AGENT"]);
  const requestHash = bindingHash(input);

  try {
    return await database.$transaction(
      async (transaction) => {
        if (!(await isActiveSchoolMember(transaction, context.actorId))) {
          throw new CompleteTeacherFeedbackSuggestionError("NOT_FOUND");
        }
        const submission = await transaction.submission.findFirst({
          where: {
            id: input.submissionId,
            release: {
              publisherId: context.actorId,
              classroom: { managerId: context.actorId },
            },
          },
          select: {
            latestRevisionNumber: true,
            revisions: {
              where: { id: input.submissionRevisionId },
              select: {
                id: true,
                revisionNumber: true,
                feedback: { select: { version: true } },
              },
            },
          },
        });
        if (!submission) {
          throw new CompleteTeacherFeedbackSuggestionError("NOT_FOUND");
        }
        const revision = submission.revisions[0];
        if (
          !revision ||
          revision.revisionNumber !== input.submissionRevisionNumber ||
          submission.latestRevisionNumber !== input.submissionRevisionNumber
        ) {
          throw new CompleteTeacherFeedbackSuggestionError(
            "STALE_SUBMISSION_REVISION",
          );
        }
        if (
          (revision.feedback?.version ?? 0) !==
          input.expectedFeedbackVersion
        ) {
          throw new CompleteTeacherFeedbackSuggestionError(
            "FEEDBACK_VERSION_CONFLICT",
          );
        }

        const updated = await transaction.agentRun.updateMany({
          where: {
            id: input.agentRunId,
            actorId: context.actorId,
            status: "RUNNING",
          },
          data: {
            status: "SUCCEEDED",
            completedAt: context.now,
            failureCode: null,
          },
        });

        if (updated.count === 0) {
          const [run, audit] = await Promise.all([
            transaction.agentRun.findUnique({
              where: { id: input.agentRunId },
              select: {
                actorId: true,
                status: true,
                completedAt: true,
                failureCode: true,
              },
            }),
            transaction.actionAudit.findFirst({
              where: {
                actorId: context.actorId,
                agentRunId: input.agentRunId,
                source: "AGENT",
                actionName: teacherFeedbackSuggestionActionName,
                targetType: "SubmissionRevision",
                targetId: input.submissionRevisionId,
                requestHash,
                outcome: "SUCCEEDED",
                beforeVersion: input.expectedFeedbackVersion,
                afterVersion: input.expectedFeedbackVersion,
              },
              select: { id: true },
            }),
          ]);
          if (
            run?.actorId !== context.actorId ||
            run.status !== "SUCCEEDED" ||
            !run.completedAt ||
            run.failureCode !== null ||
            !audit
          ) {
            throw new CompleteTeacherFeedbackSuggestionError(
              "INVALID_AGENT_RUN",
            );
          }
          return {
            agentRunId: input.agentRunId,
            submissionRevisionId: revision.id,
            submissionRevisionNumber: revision.revisionNumber,
            expectedFeedbackVersion: input.expectedFeedbackVersion,
            completedAt: run.completedAt.toISOString(),
          };
        }

        await transaction.actionAudit.create({
          data: {
            actorId: context.actorId,
            agentRunId: input.agentRunId,
            source: "AGENT",
            actionName: teacherFeedbackSuggestionActionName,
            targetType: "SubmissionRevision",
            targetId: revision.id,
            requestHash,
            outcome: "SUCCEEDED",
            beforeVersion: input.expectedFeedbackVersion,
            afterVersion: input.expectedFeedbackVersion,
            traceId: context.traceId,
            createdAt: context.now,
          },
        });

        return {
          agentRunId: input.agentRunId,
          submissionRevisionId: revision.id,
          submissionRevisionNumber: revision.revisionNumber,
          expectedFeedbackVersion: input.expectedFeedbackVersion,
          completedAt: context.now.toISOString(),
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 10_000,
      },
    );
  } catch (error) {
    if (error instanceof CompleteTeacherFeedbackSuggestionError) {
      throw error;
    }
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2034"
    ) {
      throw new CompleteTeacherFeedbackSuggestionError("CONCURRENT_WRITE");
    }
    throw error;
  }
}
