import "server-only";

import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import { storedDiagnosisFindingsSchema } from "../../domain/activity/draft-diagnosis";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import {
  type CommandContext,
  resolveCommandContext,
} from "./command-context";
import { isActiveSchoolMember } from "../school/teacher-authorization";

const commandInputSchema = z
  .object({
    agentRunId: z.uuid(),
    draftId: z.uuid(),
    revisionVersion: z.int().positive(),
    summary: z.string().trim().min(1).max(400),
    findings: storedDiagnosisFindingsSchema,
  })
  .strict();

export const draftDiagnosisActionName = "diagnose_activity_draft";

export class RecordActivityDraftDiagnosisError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "STALE_VERSION"
      | "INVALID_AGENT_RUN"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "RecordActivityDraftDiagnosisError";
  }
}

/**
 * Store a validated diagnosis for exactly the revision it read. Authorization
 * and the version are re-proved here, after the model call, and the run
 * succeeds in the same transaction as the record and its audit.
 */
export async function recordActivityDraftDiagnosis(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: z.input<typeof commandInputSchema>,
): Promise<{ diagnosisId: string }> {
  const input = commandInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["AGENT"]);
  const canonical = canonicalize({
    actionName: draftDiagnosisActionName,
    ...input,
  });
  if (canonical === undefined) {
    throw new TypeError("Diagnosis cannot be canonicalized");
  }
  const requestHash = createHash("sha256").update(canonical).digest("hex");

  try {
    return await database.$transaction(
      async (transaction) => {
        if (!(await isActiveSchoolMember(transaction, context.actorId))) {
          throw new RecordActivityDraftDiagnosisError("NOT_FOUND");
        }
        const draft = await transaction.activityDraft.findUnique({
          where: { id: input.draftId },
          select: {
            ownerId: true,
            status: true,
            version: true,
            revisions: {
              where: { version: input.revisionVersion },
              select: { id: true },
            },
          },
        });
        if (!draft || draft.ownerId !== context.actorId) {
          throw new RecordActivityDraftDiagnosisError("NOT_FOUND");
        }
        const revision = draft.revisions[0];
        if (
          !revision ||
          draft.version !== input.revisionVersion ||
          draft.status === "SEALED"
        ) {
          throw new RecordActivityDraftDiagnosisError("STALE_VERSION");
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
          throw new RecordActivityDraftDiagnosisError("INVALID_AGENT_RUN");
        }

        const diagnosis = await transaction.activityDraftDiagnosis.create({
          data: {
            draftId: input.draftId,
            revisionId: revision.id,
            agentRunId: input.agentRunId,
            requestedById: context.actorId,
            summary: input.summary,
            findings: input.findings,
            createdAt: context.now,
          },
          select: { id: true },
        });
        await transaction.actionAudit.create({
          data: {
            actorId: context.actorId,
            agentRunId: input.agentRunId,
            source: "AGENT",
            actionName: draftDiagnosisActionName,
            targetType: "ActivityDraftRevision",
            targetId: revision.id,
            requestHash,
            outcome: "SUCCEEDED",
            beforeVersion: input.revisionVersion,
            afterVersion: input.revisionVersion,
            resultResourceId: diagnosis.id,
            traceId: context.traceId,
            createdAt: context.now,
          },
        });
        return { diagnosisId: diagnosis.id };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 10_000,
      },
    );
  } catch (error) {
    if (error instanceof RecordActivityDraftDiagnosisError) throw error;
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2034"
    ) {
      throw new RecordActivityDraftDiagnosisError("CONCURRENT_WRITE");
    }
    throw error;
  }
}
