import "server-only";

import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import {
  ANSWER_THEMES_MAX_ANSWERS,
  ANSWER_THEMES_MIN_ANSWERS,
  storedAnswerThemesSchema,
} from "../../domain/insights/answer-themes";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { isActiveSchoolMember } from "../school/teacher-authorization";
import {
  type CommandContext,
  resolveCommandContext,
} from "./command-context";

const commandInputSchema = z
  .object({
    agentRunId: z.uuid(),
    releaseId: z.uuid(),
    phaseIndex: z.int().min(0).max(99),
    summary: z.string().trim().min(1).max(400),
    themes: storedAnswerThemesSchema,
    basisRevisionIds: z
      .array(z.uuid())
      .min(ANSWER_THEMES_MIN_ANSWERS)
      .max(ANSWER_THEMES_MAX_ANSWERS),
  })
  .strict();

export const answerSummaryActionName = "summarize_release_answers";

export class RecordReleaseAnswerSummaryError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "STALE_ANSWERS"
      | "INVALID_AGENT_RUN"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "RecordReleaseAnswerSummaryError";
  }
}

/**
 * Store a validated summary for exactly the revisions it read (D-086).
 * Authorization is re-proved here, after the model call, and so is the basis:
 * if any answer was resubmitted meanwhile the summary describes text that is
 * no longer current, and nothing is written. The run succeeds in the same
 * transaction as the record and its audit.
 */
export async function recordReleaseAnswerSummary(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: z.input<typeof commandInputSchema>,
): Promise<{ summaryId: string }> {
  const input = commandInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["AGENT"]);
  const basis = new Set(input.basisRevisionIds);
  if (
    basis.size !== input.basisRevisionIds.length ||
    input.themes.some((theme) =>
      theme.sources.some((source) => !basis.has(source.revisionId)),
    )
  ) {
    throw new TypeError("Answer summary cites a revision outside its basis");
  }
  const canonical = canonicalize({
    actionName: answerSummaryActionName,
    ...input,
  });
  if (canonical === undefined) {
    throw new TypeError("Answer summary cannot be canonicalized");
  }
  const requestHash = createHash("sha256").update(canonical).digest("hex");

  try {
    return await database.$transaction(
      async (transaction) => {
        if (!(await isActiveSchoolMember(transaction, context.actorId))) {
          throw new RecordReleaseAnswerSummaryError("NOT_FOUND");
        }
        const release = await transaction.activityRelease.findFirst({
          where: {
            id: input.releaseId,
            publisherId: context.actorId,
            classroom: { managerId: context.actorId },
          },
          select: {
            submissions: {
              where: { phaseIndex: input.phaseIndex, latestRevisionNumber: { gt: 0 } },
              select: {
                latestRevisionNumber: true,
                revisions: {
                  orderBy: { revisionNumber: "desc" },
                  take: 1,
                  select: { id: true, revisionNumber: true },
                },
              },
            },
          },
        });
        if (!release) {
          throw new RecordReleaseAnswerSummaryError("NOT_FOUND");
        }
        const current = new Set(
          release.submissions.flatMap((submission) => {
            const revision = submission.revisions[0];
            return revision &&
              revision.revisionNumber === submission.latestRevisionNumber
              ? [revision.id]
              : [];
          }),
        );
        if (input.basisRevisionIds.some((id) => !current.has(id))) {
          throw new RecordReleaseAnswerSummaryError("STALE_ANSWERS");
        }

        const settled = await transaction.agentRun.updateMany({
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
        if (settled.count !== 1) {
          throw new RecordReleaseAnswerSummaryError("INVALID_AGENT_RUN");
        }

        const summary = await transaction.releaseAnswerSummary.create({
          data: {
            releaseId: input.releaseId,
            phaseIndex: input.phaseIndex,
            agentRunId: input.agentRunId,
            requestedById: context.actorId,
            summary: input.summary,
            themes: input.themes,
            basisRevisionIds: input.basisRevisionIds,
            createdAt: context.now,
          },
          select: { id: true },
        });
        await transaction.actionAudit.create({
          data: {
            actorId: context.actorId,
            agentRunId: input.agentRunId,
            source: "AGENT",
            actionName: answerSummaryActionName,
            targetType: "ActivityRelease",
            targetId: input.releaseId,
            requestHash,
            outcome: "SUCCEEDED",
            resultResourceId: summary.id,
            traceId: context.traceId,
            createdAt: context.now,
          },
        });
        return { summaryId: summary.id };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 10_000,
      },
    );
  } catch (error) {
    if (error instanceof RecordReleaseAnswerSummaryError) throw error;
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2034"
    ) {
      throw new RecordReleaseAnswerSummaryError("CONCURRENT_WRITE");
    }
    throw error;
  }
}
