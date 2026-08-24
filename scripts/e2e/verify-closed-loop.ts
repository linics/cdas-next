import { randomUUID } from "node:crypto";
import { createDatabaseClient } from "../../src/server/db/client";
import { closeActivityRelease } from "../../src/server/commands/close-activity-release";
import {
  requireE2eRunMarker,
  resolveE2eDatabaseUrl,
} from "./environment";
import {
  foreignDraftId,
  foreignDraftTitle,
  foreignTeacherId,
} from "./fixtures";

function invariant(condition: unknown, code: string): asserts condition {
  if (!condition) {
    throw new Error(code);
  }
}

async function main(): Promise<void> {
  const marker = requireE2eRunMarker();
  const database = createDatabaseClient(resolveE2eDatabaseUrl());

  try {
    const draft = await database.activityDraft.findFirst({
      where: { title: `E2E 闭环 ${marker}` },
      orderBy: { createdAt: "desc" },
      include: {
        revisions: { orderBy: { version: "asc" } },
        release: {
          include: {
            snapshot: true,
            submissions: {
              include: {
                workingCopy: true,
                revisions: {
                  orderBy: { revisionNumber: "asc" },
                  include: {
                    feedback: {
                      include: {
                        revisions: { orderBy: { version: "asc" } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    invariant(draft, "E2E_DRAFT_NOT_FOUND");
    invariant(draft.status === "SEALED", "E2E_DRAFT_NOT_SEALED");
    invariant(draft.version === 2, "E2E_DRAFT_VERSION_MISMATCH");
    invariant(draft.revisions.length === 2, "E2E_DRAFT_HISTORY_MISMATCH");
    invariant(
      draft.revisions.every(
        (revision, index) =>
          revision.version === index + 1 &&
          revision.source === "MANUAL" &&
          revision.agentRunId === null,
      ),
      "E2E_DRAFT_PROVENANCE_MISMATCH",
    );

    const release = draft.release;
    invariant(release, "E2E_RELEASE_NOT_FOUND");
    invariant(release.status === "CLOSED", "E2E_RELEASE_NOT_CLOSED");
    invariant(release.closeActionIntentId, "E2E_CLOSE_INTENT_NOT_BOUND");
    invariant(release.snapshot, "E2E_RELEASE_SNAPSHOT_NOT_FOUND");
    invariant(
      release.snapshot.sourceDraftVersion === 2,
      "E2E_RELEASE_SNAPSHOT_VERSION_MISMATCH",
    );
    invariant(
      release.submissions.length === 1,
      "E2E_SUBMISSION_COUNT_MISMATCH",
    );

    const submission = release.submissions[0];
    invariant(submission, "E2E_SUBMISSION_NOT_FOUND");
    invariant(submission.studentId !== null, "E2E_EXPECTED_PERSONAL_SUBMISSION");
    invariant(
      submission.latestRevisionNumber === 2,
      "E2E_SUBMISSION_LATEST_REVISION_MISMATCH",
    );
    invariant(
      submission.revisions.length === 2,
      "E2E_SUBMISSION_HISTORY_MISMATCH",
    );
    invariant(
      submission.workingCopy?.baseRevisionNumber === 2 &&
        submission.workingCopy.version === 2 &&
        submission.workingCopy.textEvidence ===
          `${marker} 第三版工作草稿：成员结束后只能读取。`,
      "E2E_HISTORICAL_WORKING_COPY_MISMATCH",
    );
    invariant(
      submission.revisions.every(
        (revision, index) =>
          revision.revisionNumber === index + 1 &&
          revision.feedback?.version === 1 &&
          revision.feedback.revisions.length === 1 &&
          revision.feedback.revisions[0]?.source === "MANUAL" &&
          revision.feedback.revisions[0]?.agentRunId === null,
      ),
      "E2E_FEEDBACK_HISTORY_MISMATCH",
    );

    const membership = await database.classroomMembership.findFirst({
      where: {
        classroomId: release.classroomId,
        studentId: submission.studentId,
      },
      orderBy: { joinedAt: "desc" },
      select: { joinedAt: true, endedAt: true },
    });
    invariant(membership?.endedAt, "E2E_HISTORICAL_MEMBERSHIP_NOT_ENDED");
    invariant(
      membership.joinedAt <= release.publishedAt &&
        membership.endedAt > release.publishedAt &&
        release.closedAt !== null &&
        membership.endedAt < release.closedAt,
      "E2E_HISTORICAL_MEMBERSHIP_WINDOW_MISMATCH",
    );

    const foreignDraft = await database.activityDraft.findUnique({
      where: { id: foreignDraftId },
      include: { revisions: true, release: true },
    });
    invariant(foreignDraft, "E2E_FOREIGN_DRAFT_NOT_FOUND");
    invariant(
      foreignDraft.ownerId === foreignTeacherId &&
        foreignDraft.title === foreignDraftTitle &&
        foreignDraft.status === "EDITING" &&
        foreignDraft.version === 1 &&
        foreignDraft.revisions.length === 1 &&
        foreignDraft.release === null,
      "E2E_FOREIGN_DRAFT_WAS_EXPOSED_OR_CHANGED",
    );

    const concurrencyDraft = await database.activityDraft.findFirst({
      where: { title: `E2E 并发 ${marker}` },
      include: { revisions: true, release: true },
    });
    invariant(concurrencyDraft, "E2E_CONCURRENCY_DRAFT_NOT_FOUND");
    invariant(
      concurrencyDraft.status === "READY_FOR_PREVIEW" &&
        concurrencyDraft.version === 2 &&
        concurrencyDraft.revisions.length === 2 &&
        concurrencyDraft.release === null,
      "E2E_STALE_CONFIRMATION_CHANGED_DRAFT_OR_RELEASED",
    );

    const concurrencyIntents = await database.actionIntent.findMany({
      where: {
        actionName: "publish_activity_release",
        targetType: "ActivityDraft",
        targetId: concurrencyDraft.id,
      },
      select: { id: true, status: true, expectedVersion: true },
    });
    invariant(
      concurrencyIntents.length === 1 &&
        concurrencyIntents[0]?.status === "CONFIRMED" &&
        concurrencyIntents[0]?.expectedVersion === 1,
      "E2E_STALE_CONFIRMATION_INTENT_MISMATCH",
    );
    const staleIntent = concurrencyIntents[0];
    invariant(staleIntent, "E2E_STALE_CONFIRMATION_INTENT_NOT_FOUND");
    const staleConflictCount = await database.actionAudit.count({
      where: {
        actionIntentId: staleIntent.id,
        actionName: "publish_activity_release",
        outcome: "CONFLICTED",
        errorCode: "STALE_VERSION",
      },
    });
    invariant(
      staleConflictCount === 1,
      "E2E_STALE_CONFIRMATION_AUDIT_MISMATCH",
    );

    const [agentRunCount, intents, successfulAuditCount, idempotencyCount] =
      await Promise.all([
        database.agentRun.count(),
        database.actionIntent.findMany({
          orderBy: { createdAt: "asc" },
          select: {
            actionName: true,
            status: true,
            agentRunId: true,
            decidedById: true,
          },
        }),
        database.actionAudit.count({ where: { outcome: "SUCCEEDED" } }),
        database.idempotencyRecord.count(),
      ]);

    invariant(agentRunCount === 0, "E2E_AI_DISABLED_CREATED_AGENT_RUN");
    const executedIntents = intents.filter(
      (intent) => intent.status === "EXECUTED",
    );
    invariant(
      executedIntents.length === 4 &&
        executedIntents.every(
          (intent) =>
            intent.agentRunId === null &&
            intent.decidedById !== null,
        ),
      "E2E_ACTION_INTENT_HISTORY_MISMATCH",
    );
    invariant(successfulAuditCount >= 12, "E2E_AUDIT_HISTORY_INCOMPLETE");
    invariant(idempotencyCount >= 12, "E2E_IDEMPOTENCY_HISTORY_INCOMPLETE");

    const closeIdempotency = await database.idempotencyRecord.findFirst({
      where: {
        actorId: release.publisherId,
        commandName: "close_activity_release",
        resourceType: "ActivityRelease",
        resourceId: release.id,
      },
      select: { idempotencyKey: true },
    });
    invariant(closeIdempotency, "E2E_CLOSE_IDEMPOTENCY_RECORD_NOT_FOUND");
    const replayAuditCountBefore = await database.actionAudit.count({
      where: {
        actorId: release.publisherId,
        actionName: "close_activity_release",
        idempotencyKey: closeIdempotency.idempotencyKey,
      },
    });
    const replay = await closeActivityRelease(
      database,
      {
        actorId: release.publisherId,
        source: "UI",
        traceId: `e2e-replay-${randomUUID()}`,
        clock: () => new Date(),
      },
      {
        actionIntentId: release.closeActionIntentId,
        idempotencyKey: closeIdempotency.idempotencyKey,
      },
    );
    const [replayAuditCountAfter, idempotencyCountAfter] = await Promise.all([
      database.actionAudit.count({
        where: {
          actorId: release.publisherId,
          actionName: "close_activity_release",
          idempotencyKey: closeIdempotency.idempotencyKey,
        },
      }),
      database.idempotencyRecord.count(),
    ]);
    invariant(
      replay.releaseId === release.id &&
        replay.status === "CLOSED" &&
        replay.closedAt === release.closedAt?.toISOString() &&
        replayAuditCountBefore === 1 &&
        replayAuditCountAfter === replayAuditCountBefore &&
        idempotencyCountAfter === idempotencyCount,
      "E2E_IDEMPOTENCY_REPLAY_MISMATCH",
    );

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          marker,
          evidence: {
            draftVersions: draft.revisions.length,
            releaseStatus: release.status,
            submissionRevisions: submission.revisions.length,
            feedbackRevisions: submission.revisions.map(
              (revision) => revision.feedback?.revisions.length ?? 0,
            ),
            executedActionIntents: executedIntents.length,
            stalePublishConflicts: staleConflictCount,
            successfulAudits: successfulAuditCount,
            idempotencyRecords: idempotencyCount,
            idempotencyReplay: true,
            historicalMembershipReadOnly: true,
            historicalWorkingCopyReadOnly: true,
            sameRoleForeignResourceHidden: true,
            agentRuns: agentRunCount,
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
