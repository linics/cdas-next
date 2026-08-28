import { readFileSync } from "node:fs";
import path from "node:path";
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

    // D-047 read, D-048 revision proposal, its confirmed execution, the D-033
    // proposal and its confirmed draft execution, the D-052 feedback and D-044
    // evaluation drafts, then the D-051 process diagnostics turn. Every run
    // that only read or proposed must have written nothing at all.
    invariant(runs.length === 8, "E2E_REAL_MODEL_RUN_COUNT_MISMATCH");
    const [readRun, revisionProposalRun, revisionRun, proposalRun, run] = runs;
    const insightsRun = runs[7];
    invariant(
      readRun && revisionProposalRun && revisionRun && proposalRun && run &&
        insightsRun,
      "E2E_REAL_MODEL_RUN_COUNT_MISMATCH",
    );
    const suggestionRunFor = (actionName: string) =>
      runs.find((candidate) =>
        candidate.auditEntries.some(
          (entry) => entry.actionName === actionName,
        ),
      );
    const feedbackSuggestionRun = suggestionRunFor("suggest_teacher_feedback");
    const evaluationSuggestionRun = suggestionRunFor(
      "suggest_teacher_evaluation",
    );
    invariant(
      feedbackSuggestionRun && evaluationSuggestionRun,
      "E2E_REAL_MODEL_SUGGESTION_RUN_MISSING",
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
        insightsRun.draftRevision === null &&
        insightsRun.intents.length === 0 &&
        insightsRun.auditEntries.length === 0 &&
        insightsRun.feedbackRevisions.length === 0 &&
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

    // Both drafters must have reached a confirmed business revision, marked
    // AI_ASSISTED and bound to the exact run that produced the draft.
    const feedbackRevision = await database.teacherFeedbackRevision.findFirst({
      where: { agentRunId: feedbackSuggestionRun.id },
    });
    invariant(
      feedbackRevision?.source === "AI_ASSISTED",
      "E2E_REAL_MODEL_FEEDBACK_PROVENANCE_MISSING",
    );
    const evaluationRevision =
      await database.teacherEvaluationRevision.findFirst({
        where: { agentRunId: evaluationSuggestionRun.id },
      });
    invariant(
      evaluationRevision?.source === "AI_ASSISTED",
      "E2E_REAL_MODEL_EVALUATION_PROVENANCE_MISSING",
    );

    const suggestionAudits = await database.actionAudit.findMany({
      where: {
        source: "AGENT",
        actionName: {
          in: ["suggest_teacher_feedback", "suggest_teacher_evaluation"],
        },
        outcome: "SUCCEEDED",
        targetType: "SubmissionRevision",
      },
    });
    invariant(
      suggestionAudits.length === 2,
      "E2E_REAL_MODEL_SUGGESTION_AUDIT_MISSING",
    );

    // The drafted text is a model output about a student's work. It may bind
    // provenance, but it must never be stored in the audit trail.
    const draftedFeedback = readFileSync(
      path.join(
        process.cwd(),
        "output",
        "e2e",
        marker,
        "drafted-feedback.txt",
      ),
      "utf8",
    ).trim();
    invariant(
      draftedFeedback.length >= 40,
      "E2E_REAL_MODEL_DRAFTED_FEEDBACK_MISSING",
    );
    const draftedNeedle = draftedFeedback.slice(0, 20);
    const [allAudits, bareRuns] = await Promise.all([
      database.actionAudit.findMany(),
      database.agentRun.findMany(),
    ]);
    // The confirmed TeacherFeedbackRevision does hold this text — that is the
    // feedback the teacher saved. The audit trail and the runs themselves must
    // not, so the provenance record cannot become a copy of the draft.
    invariant(
      !JSON.stringify(allAudits).includes(draftedNeedle) &&
        !JSON.stringify(bareRuns).includes(draftedNeedle),
      "E2E_REAL_MODEL_SUGGESTION_BODY_PERSISTED_IN_AUDIT",
    );
    const savedFeedbackBody = await database.teacherFeedbackRevision.findFirst({
      where: { agentRunId: feedbackSuggestionRun.id },
      select: { body: true },
    });
    invariant(
      savedFeedbackBody?.body.includes(draftedNeedle),
      "E2E_REAL_MODEL_CONFIRMED_FEEDBACK_BODY_MISMATCH",
    );

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
        database.actionIntent.count({ where: { agentRunId: null } }),
        database.activityRelease.count(),
      ]);
    invariant(idempotencyCount === 1, "E2E_REAL_MODEL_IDEMPOTENCY_MISSING");
    invariant(runCount === 8, "E2E_REAL_MODEL_RUN_COUNT_MISMATCH");
    // The teacher published and confirmed through the first-party UI, so those
    // intents carry no agent run. The model published nothing on its own.
    invariant(intentCount > 0, "E2E_REAL_MODEL_TEACHER_INTENT_MISSING");
    invariant(releaseCount === 1, "E2E_REAL_MODEL_RELEASE_COUNT_MISMATCH");
    const agentPublishIntents = await database.actionIntent.count({
      where: { actionName: "publish_activity_release", agentRunId: { not: null } },
    });
    invariant(
      agentPublishIntents === 0,
      "E2E_REAL_MODEL_AGENT_PUBLISHED_RELEASE",
    );

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
            processInsightsAgentRunStatus: insightsRun.status,
            feedbackSuggestionAgentRunStatus: feedbackSuggestionRun.status,
            evaluationSuggestionAgentRunStatus: evaluationSuggestionRun.status,
            feedbackRevisionSource: feedbackRevision.source,
            evaluationRevisionSource: evaluationRevision.source,
            suggestionAudits: suggestionAudits.length,
            suggestionBodyPersisted: false,
            executionAgentRunStatus: run.status,
            successfulAgentRuns: runCount,
            draftStatus: draft.status,
            draftRevisionSource: revision.source,
            successfulAgentAudits: 1,
            idempotencyRecords: idempotencyCount,
            teacherConfirmedIntents: intentCount,
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
