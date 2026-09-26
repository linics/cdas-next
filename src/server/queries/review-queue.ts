import "server-only";

import {
  reviewQueuePosition,
  type ReviewQueueFilter,
  type ReviewQueueItem,
  type ReviewQueuePosition,
} from "../../domain/review/review-queue";
import type { PrismaClient } from "../../generated/prisma/client";
import type { CommandContext } from "../commands/command-context";
import {
  getTeacherReleaseSubmissions,
  type TeacherReleaseSubmissions,
} from "./submission-workspace";

export function reviewQueueItems(
  workspace: TeacherReleaseSubmissions,
): ReviewQueueItem[] {
  return workspace.submissions.map((submission) => ({
    submissionId: submission.submissionId,
    phaseIndex: submission.phaseIndex,
    hasFeedback: submission.currentRevision.feedback !== null,
    hasEvaluation: submission.currentRevision.evaluation !== null,
    awaitingResubmission:
      submission.currentRevision.followUp === "AWAITING_RESUBMISSION",
  }));
}

/**
 * Where the current submission sits in the teacher's filtered queue. The
 * roster is re-read with the release's own authorization every time; a
 * neighbour id from the client is never trusted, and the review page still
 * authorizes each submission it opens.
 */
export async function getReviewQueuePosition(
  database: PrismaClient,
  context: CommandContext,
  input: { releaseId: string; submissionId: string; filter: ReviewQueueFilter },
): Promise<ReviewQueuePosition> {
  const workspace = await getTeacherReleaseSubmissions(database, context, {
    releaseId: input.releaseId,
  });
  return reviewQueuePosition(
    reviewQueueItems(workspace),
    input.submissionId,
    input.filter,
    workspace.release.rubricAvailable,
  );
}
