import "server-only";

import { z } from "zod";
import { activityContentV3Schema } from "../../domain/activity/activity-content";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import {
  activityAdaptationBindingHash,
  activityAdaptationSuggestionActionName,
} from "../activity/activity-adaptation-binding";
import {
  type CommandContext,
  resolveCommandContext,
} from "./command-context";
import { isActiveSchoolMember } from "../school/teacher-authorization";

const commandInputSchema = z
  .object({
    agentRunId: z.uuid(),
    draftId: z.uuid(),
    baseVersion: z.int().positive(),
    content: activityContentV3Schema,
  })
  .strict();

export type RecordActivityAdaptationSuggestionInput = z.input<
  typeof commandInputSchema
>;

export class RecordActivityAdaptationSuggestionError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "STALE_VERSION"
      | "DRAFT_SEALED"
      | "INVALID_AGENT_RUN"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "RecordActivityAdaptationSuggestionError";
  }
}

/**
 * Record a validated adaptation suggestion: one audit binds the live run to
 * the draft, the version it was based on and the hash of the proposed task
 * book. Nothing is written to the draft here; the teacher's confirmation does
 * that later through `applyActivityAdaptation`.
 */
export async function recordActivityAdaptationSuggestion(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: RecordActivityAdaptationSuggestionInput,
): Promise<{ completedAt: string }> {
  const input = commandInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["AGENT"]);
  const requestHash = activityAdaptationBindingHash(input);

  try {
    return await database.$transaction(
      async (transaction) => {
        if (!(await isActiveSchoolMember(transaction, context.actorId))) {
          throw new RecordActivityAdaptationSuggestionError("NOT_FOUND");
        }
        const draft = await transaction.activityDraft.findUnique({
          where: { id: input.draftId },
          select: { ownerId: true, status: true, version: true },
        });
        if (!draft || draft.ownerId !== context.actorId) {
          throw new RecordActivityAdaptationSuggestionError("NOT_FOUND");
        }
        if (draft.status === "SEALED") {
          throw new RecordActivityAdaptationSuggestionError("DRAFT_SEALED");
        }
        if (draft.version !== input.baseVersion) {
          throw new RecordActivityAdaptationSuggestionError("STALE_VERSION");
        }

        // The run stays RUNNING: the draft revision it may later produce has
        // to be written while the run is live (D-048), so it only succeeds
        // when the teacher confirms, or is cancelled when they discard.
        const [run, earlier] = await Promise.all([
          transaction.agentRun.findUnique({
            where: { id: input.agentRunId },
            select: { actorId: true, status: true },
          }),
          transaction.actionAudit.findFirst({
            where: {
              agentRunId: input.agentRunId,
              actionName: activityAdaptationSuggestionActionName,
            },
            select: { id: true },
          }),
        ]);
        if (
          run?.actorId !== context.actorId ||
          run.status !== "RUNNING" ||
          earlier
        ) {
          throw new RecordActivityAdaptationSuggestionError(
            "INVALID_AGENT_RUN",
          );
        }

        await transaction.actionAudit.create({
          data: {
            actorId: context.actorId,
            agentRunId: input.agentRunId,
            source: "AGENT",
            actionName: activityAdaptationSuggestionActionName,
            targetType: "ActivityDraft",
            targetId: input.draftId,
            requestHash,
            outcome: "SUCCEEDED",
            beforeVersion: input.baseVersion,
            afterVersion: input.baseVersion,
            traceId: context.traceId,
            createdAt: context.now,
          },
        });

        return { completedAt: context.now.toISOString() };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 10_000,
      },
    );
  } catch (error) {
    if (error instanceof RecordActivityAdaptationSuggestionError) {
      throw error;
    }
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2034"
    ) {
      throw new RecordActivityAdaptationSuggestionError("CONCURRENT_WRITE");
    }
    throw error;
  }
}
