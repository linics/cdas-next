import "server-only";

import { z } from "zod";
import {
  activityContentSchema,
  isStructuredContent,
} from "../../domain/activity/activity-content";
import {
  buildReleaseDiagnosis,
  type DiagnosisReleaseInput,
  type ReleaseDiagnosis,
} from "../../domain/insights/release-diagnosis";
import type { InsightsSubmissionRevisionInput } from "../../domain/insights/teacher-insights";
import { isFinalSubmission } from "../../domain/submission/sequential-execution";
import type { PrismaClient } from "../../generated/prisma/client";
import {
  type CommandContext,
  resolveCommandContext,
} from "../commands/command-context";
import { compactOutcomes } from "./teacher-insights";

const queryInputSchema = z.strictObject({ releaseId: z.uuid() });

function mapRevision(revision: {
  revisionNumber: number;
  feedback: {
    version: number;
    revisions: { version: number; nextStep: "CONTINUE" | "REVISE" | null }[];
  } | null;
  evaluation: {
    version: number;
    revisions: { version: number; outcomes: unknown }[];
  } | null;
}): InsightsSubmissionRevisionInput {
  const currentFeedback = revision.feedback?.revisions[0];
  if (
    revision.feedback &&
    (!currentFeedback || currentFeedback.version !== revision.feedback.version)
  ) {
    throw new Error("Diagnosis query expected an exact current feedback revision");
  }
  const currentEvaluation = revision.evaluation?.revisions[0];
  if (
    revision.evaluation &&
    (!currentEvaluation ||
      currentEvaluation.version !== revision.evaluation.version)
  ) {
    throw new Error("Diagnosis query expected an exact current evaluation revision");
  }
  return {
    revisionNumber: revision.revisionNumber,
    nextStep: currentFeedback?.nextStep ?? null,
    outcomes: currentEvaluation ? compactOutcomes(currentEvaluation.outcomes) : null,
  };
}

/**
 * The per-release diagnosis for the first-party page (D-084). It names
 * students and groups, so unlike `getTeacherInsights` it accepts the UI source
 * only: the Agent keeps reading counts through D-051's aggregate.
 *
 * Authorization matches the roster: the actor published the release and still
 * manages its classroom. Anything else is `null`, which the page treats the
 * same as a release that does not exist.
 */
export async function getTeacherReleaseDiagnosis(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: unknown,
): Promise<ReleaseDiagnosis | null> {
  const input = queryInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const row = await database.activityRelease.findFirst({
    where: {
      id: input.releaseId,
      publisherId: context.actorId,
      classroom: { managerId: context.actorId },
    },
    select: {
      id: true,
      status: true,
      dueAt: true,
      executionVersion: true,
      classroom: {
        select: {
          name: true,
          memberships: {
            select: {
              joinedAt: true,
              endedAt: true,
              student: { select: { id: true, displayName: true } },
            },
          },
        },
      },
      snapshot: { select: { content: true } },
      groups: {
        select: {
          id: true,
          name: true,
          members: { select: { studentId: true } },
        },
      },
      submissions: {
        select: {
          id: true,
          phaseIndex: true,
          latestRevisionNumber: true,
          studentId: true,
          groupId: true,
          workingCopy: { select: { updatedAt: true } },
          revisions: {
            orderBy: { revisionNumber: "asc" },
            select: {
              revisionNumber: true,
              submittedAt: true,
              isLate: true,
              feedback: {
                select: {
                  version: true,
                  revisions: {
                    orderBy: { version: "desc" },
                    take: 1,
                    select: { version: true, nextStep: true },
                  },
                },
              },
              evaluation: {
                select: {
                  version: true,
                  revisions: {
                    orderBy: { version: "desc" },
                    take: 1,
                    select: { version: true, outcomes: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!row?.snapshot) {
    return null;
  }

  const content = activityContentSchema.parse(row.snapshot.content);
  const executionVersion = row.executionVersion === 1 ? 1 : 0;
  const structured = isStructuredContent(content);
  const release: DiagnosisReleaseInput = {
    id: row.id,
    title: content.title,
    classroomName: row.classroom.name,
    status: row.status,
    dueAt: row.dueAt?.toISOString() ?? null,
    executionVersion,
    submissionMode:
      executionVersion === 1 && structured ? content.submissionMode : "once",
    phases:
      executionVersion === 1 && structured
        ? content.phases.map((phase) => ({
            name: phase.name,
            learningGoalIds:
              "learningGoalIds" in phase ? phase.learningGoalIds : undefined,
          }))
        : [],
    rubricDimensions: structured
      ? content.rubricDimensions.map((dimension) => ({
          name: dimension.name,
          learningGoalIds:
            "learningGoalIds" in dimension ? dimension.learningGoalIds : undefined,
        }))
      : null,
    members: row.classroom.memberships
      .filter(
        (membership) =>
          membership.joinedAt <= context.now &&
          (membership.endedAt === null || membership.endedAt > context.now),
      )
      .map((membership) => ({
        id: membership.student.id,
        name: membership.student.displayName,
      })),
    groups: row.groups.map((group) => ({
      id: group.id,
      name: group.name,
      memberIds: group.members.map((member) => member.studentId),
    })),
    submissions: row.submissions.map((submission) => {
      const current = submission.revisions.find(
        (revision) => revision.revisionNumber === submission.latestRevisionNumber,
      );
      return {
        id: submission.id,
        phaseIndex: submission.phaseIndex,
        latestRevisionNumber: submission.latestRevisionNumber,
        studentId: submission.studentId,
        groupId: submission.groupId,
        final: isFinalSubmission(row.executionVersion, content, submission.phaseIndex),
        workingCopyUpdatedAt: submission.workingCopy?.updatedAt.toISOString() ?? null,
        currentRevision: current
          ? {
              submittedAt: current.submittedAt.toISOString(),
              isLate: current.isLate,
              hasFeedback: current.feedback !== null,
            }
          : null,
        revisions: submission.revisions.map(mapRevision),
      };
    }),
  };

  return buildReleaseDiagnosis(release, context.now);
}
