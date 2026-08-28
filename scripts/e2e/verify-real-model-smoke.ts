import { createDatabaseClient } from "../../src/server/db/client";
import {
  loadE2eEnvironment,
  requireE2eRunMarker,
  resolveE2eDatabaseUrl,
} from "./environment";

function invariant(condition: unknown, code: string): asserts condition {
  if (!condition) {
    throw new Error(code);
  }
}

async function main(): Promise<void> {
  loadE2eEnvironment();
  const marker = requireE2eRunMarker();
  const configuredModel = process.env.AI_MODEL?.trim();
  invariant(configuredModel, "E2E_REAL_MODEL_ID_MISSING");
  const database = createDatabaseClient(resolveE2eDatabaseUrl());

  try {
    const draft = await database.activityDraft.findFirst({
      where: { title: `E2E AI 草稿 ${marker}` },
      include: { revisions: true, release: true },
    });
    invariant(draft, "E2E_REAL_MODEL_DRAFT_NOT_FOUND");
    invariant(
      draft.status === "READY_FOR_PREVIEW" &&
        draft.version === 1 &&
        draft.revisions.length === 1 &&
        draft.release === null,
      "E2E_REAL_MODEL_DRAFT_STATE_MISMATCH",
    );

    const revision = draft.revisions[0];
    invariant(
      revision?.source === "AGENT" && revision.agentRunId !== null,
      "E2E_REAL_MODEL_PROVENANCE_MISSING",
    );
    const runs = await database.agentRun.findMany({
      where: { actorId: draft.ownerId },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }],
      include: {
        draftRevision: true,
        intents: true,
        auditEntries: true,
        feedbackRevisions: true,
      },
    });
    // The hand-written draft the assistant read (D-047) and then revised on
    // confirmation (D-048). Version 1 must still exist as history.
    const readDraft = await database.activityDraft.findFirst({
      where: { title: { startsWith: "E2E AI 讀取 " } },
      include: { revisions: { orderBy: { version: "asc" } } },
    });
    invariant(readDraft, "E2E_REAL_MODEL_READ_DRAFT_NOT_FOUND");
    invariant(
      readDraft.version === 2 &&
        readDraft.revisions.length === 2 &&
        readDraft.revisions[0]?.source === "MANUAL" &&
        readDraft.revisions[0]?.version === 1 &&
        readDraft.revisions[1]?.source === "AGENT" &&
        readDraft.revisions[1]?.version === 2,
      "E2E_REAL_MODEL_REVISION_HISTORY_MISMATCH",
    );
    const agentRevision = readDraft.revisions[1];

    // D-047 read, D-048 revision proposal, its confirmed execution, then the
    // D-033 proposal and its confirmed draft execution. Every run that only
    // proposed must have written nothing at all.
    invariant(runs.length === 5, "E2E_REAL_MODEL_RUN_COUNT_MISMATCH");
    const [readRun, revisionProposalRun, revisionRun, proposalRun, run] = runs;
    invariant(
      readRun && revisionProposalRun && revisionRun && proposalRun && run,
      "E2E_REAL_MODEL_RUN_COUNT_MISMATCH",
    );
    invariant(
      revisionRun.id === agentRevision?.agentRunId,
      "E2E_REAL_MODEL_REVISION_PROVENANCE_MISSING",
    );
    invariant(
      runs.every(
        (candidate) =>
          candidate.actorId === draft.ownerId &&
          candidate.status === "SUCCEEDED" &&
          candidate.model === configuredModel &&
          candidate.completedAt !== null &&
          candidate.failureCode === null,
      ) &&
        readRun.draftRevision === null &&
        readRun.intents.length === 0 &&
        readRun.auditEntries.length === 0 &&
        readRun.feedbackRevisions.length === 0 &&
        revisionProposalRun.draftRevision === null &&
        revisionProposalRun.intents.length === 0 &&
        revisionProposalRun.auditEntries.length === 0 &&
        revisionProposalRun.feedbackRevisions.length === 0 &&
        revisionRun.intents.length === 0 &&
        proposalRun.draftRevision === null &&
        proposalRun.intents.length === 0 &&
        proposalRun.auditEntries.length === 0 &&
        proposalRun.feedbackRevisions.length === 0 &&
        run.id === revision.agentRunId &&
        run.status === "SUCCEEDED" &&
        run.model === configuredModel &&
        run.completedAt !== null &&
        run.failureCode === null,
      "E2E_REAL_MODEL_AGENT_RUN_MISMATCH",
    );

    const audit = await database.actionAudit.findFirst({
      where: {
        actorId: draft.ownerId,
        agentRunId: run.id,
        source: "AGENT",
        actionName: "save_activity_draft",
        targetType: "ActivityDraft",
        targetId: draft.id,
        outcome: "SUCCEEDED",
        afterVersion: 1,
      },
    });
    invariant(audit?.resultResourceId === revision.id, "E2E_REAL_MODEL_AUDIT_MISSING");

    const [idempotencyCount, runCount, intentCount, releaseCount] =
      await Promise.all([
        database.idempotencyRecord.count({
          where: {
            actorId: draft.ownerId,
            commandName: "save_activity_draft",
            resourceType: "ActivityDraftRevision",
            resourceId: revision.id,
          },
        }),
        database.agentRun.count({ where: { actorId: draft.ownerId } }),
        database.actionIntent.count(),
        database.activityRelease.count(),
      ]);
    invariant(idempotencyCount === 1, "E2E_REAL_MODEL_IDEMPOTENCY_MISSING");
    invariant(runCount === 5, "E2E_REAL_MODEL_RUN_COUNT_MISMATCH");
    invariant(intentCount === 0, "E2E_REAL_MODEL_CREATED_ACTION_INTENT");
    invariant(releaseCount === 0, "E2E_REAL_MODEL_CREATED_RELEASE");

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          marker,
          evidence: {
            model: run.model,
            draftReadAgentRunStatus: readRun.status,
            draftRevisionAgentRunStatus: revisionRun.status,
            revisedDraftVersion: readDraft.version,
            revisedDraftRevisionSources: readDraft.revisions.map(
              (candidate) => candidate.source,
            ),
            proposalAgentRunStatus: proposalRun.status,
            executionAgentRunStatus: run.status,
            successfulAgentRuns: runCount,
            draftStatus: draft.status,
            draftRevisionSource: revision.source,
            successfulAgentAudits: 1,
            idempotencyRecords: idempotencyCount,
            actionIntents: intentCount,
            releases: releaseCount,
            syntheticDataOnly: true,
          },
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await database.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify(
      {
        ok: false,
        error: {
          code: error instanceof Error ? error.message : "E2E_VERIFY_FAILED",
        },
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = 1;
});
