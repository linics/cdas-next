import "server-only";

import { z } from "zod";
import { activityContentSchema } from "../../domain/activity/activity-content";
import { teacherEvaluationOutcomeSchema } from "../../domain/evaluation/teacher-evaluation-intent";
import {
  buildTeacherInsightsView,
  type InsightsOutcome,
  type InsightsReleaseInput,
  type InsightsSubmissionRevisionInput,
} from "../../domain/insights/teacher-insights";
import type { PrismaClient } from "../../generated/prisma/client";
import {
  type CommandContext,
  resolveCommandContext,
} from "../commands/command-context";
import {
  TeacherActivityQueryError,
  teacherIdentitySchema,
  type TeacherIdentity,
} from "./teacher-activity-workspace";

const queryInputSchema = z
  .object({
    releaseId: z.uuid().optional(),
  })
  .strict();

const isoDateSchema = z.iso.datetime({ offset: true });
const releaseStatusSchema = z.enum(["ACTIVE", "CLOSED", "ARCHIVED"]);

const rubricDimensionSchema = z
  .object({
    dimensionIndex: z.int().positive(),
    dimensionName: z.string().trim().min(1),
    excellent: z.int().nonnegative(),
    good: z.int().nonnegative(),
    pass: z.int().nonnegative(),
    improve: z.int().nonnegative(),
    insufficient: z.int().nonnegative(),
    weak: z.boolean(),
  })
  .strict();

export const teacherInsightsDashboardSchema = z
  .object({
    actor: teacherIdentitySchema,
    selectedReleaseId: z.uuid().nullable(),
    releaseOptions: z.array(
      z
        .object({
          id: z.uuid(),
          title: z.string().trim().min(1),
          classroomName: z.string().trim().min(1),
          status: releaseStatusSchema,
          publishedAt: isoDateSchema,
        })
        .strict(),
    ),
    rubric: z.array(
      z
        .object({
          releaseId: z.uuid(),
          title: z.string().trim().min(1),
          classroomName: z.string().trim().min(1),
          status: z.enum(["no_rubric", "no_evaluations", "ready"]),
          sampleCount: z.int().nonnegative(),
          dimensions: z.array(rubricDimensionSchema),
        })
        .strict(),
    ),
    stages: z.array(
      z
        .object({
          releaseId: z.uuid(),
          title: z.string().trim().min(1),
          classroomName: z.string().trim().min(1),
          audienceCount: z.int().nonnegative(),
          buckets: z.array(
            z
              .object({
                key: z.string().trim().min(1),
                label: z.string().trim().min(1),
                count: z.int().nonnegative(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    improvement: z
      .object({
        reviseCount: z.int().nonnegative(),
        resubmittedCount: z.int().nonnegative(),
        evaluationPairs: z.int().nonnegative(),
        rose: z.int().nonnegative(),
        unchanged: z.int().nonnegative(),
        fell: z.int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type TeacherInsightsDashboard = z.infer<
  typeof teacherInsightsDashboardSchema
>;

function isCurrentMembership(
  membership: { joinedAt: Date; endedAt: Date | null },
  now: Date,
): boolean {
  return (
    membership.joinedAt <= now &&
    (membership.endedAt === null || membership.endedAt > now)
  );
}

function compactOutcomes(value: unknown): InsightsOutcome[] {
  return z.array(teacherEvaluationOutcomeSchema).parse(value).map((outcome) =>
    outcome.status === "LEVEL"
      ? {
          dimensionIndex: outcome.dimensionIndex,
          dimensionName: outcome.dimensionName,
          status: "LEVEL" as const,
          level: outcome.level,
        }
      : {
          dimensionIndex: outcome.dimensionIndex,
          dimensionName: outcome.dimensionName,
          status: "INSUFFICIENT_EVIDENCE" as const,
        },
  );
}

async function requireTeacher(
  database: PrismaClient,
  actorId: string,
): Promise<TeacherIdentity> {
  const actor = await database.appUser.findUnique({
    where: { id: actorId },
    select: { role: true, displayName: true },
  });
  if (!actor) {
    throw new TeacherActivityQueryError("NOT_FOUND");
  }
  if (actor.role !== "TEACHER") {
    throw new TeacherActivityQueryError("WRONG_ROLE", actor.displayName);
  }
  return teacherIdentitySchema.parse({ displayName: actor.displayName });
}

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
    throw new Error("Insights query expected an exact current feedback revision");
  }
  const currentEvaluation = revision.evaluation?.revisions[0];
  if (
    revision.evaluation &&
    (!currentEvaluation ||
      currentEvaluation.version !== revision.evaluation.version)
  ) {
    throw new Error("Insights query expected an exact current evaluation revision");
  }
  return {
    revisionNumber: revision.revisionNumber,
    nextStep: currentFeedback?.nextStep ?? null,
    outcomes: currentEvaluation ? compactOutcomes(currentEvaluation.outcomes) : null,
  };
}

export async function getTeacherInsights(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: unknown,
): Promise<TeacherInsightsDashboard> {
  const input = queryInputSchema.parse(rawInput);
  // The process diagnostics page and the global Agent read the same aggregate
  // through this one query. It is scoped to releases this teacher published and
  // returns counts only, so widening the source does not widen what is visible.
  const context = resolveCommandContext(commandContext, ["UI", "AGENT"]);
  const actor = await requireTeacher(database, context.actorId);
  const rows = await database.activityRelease.findMany({
    where: { publisherId: context.actorId },
    orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      status: true,
      publishedAt: true,
      executionVersion: true,
      classroom: {
        select: {
          name: true,
          managerId: true,
          memberships: {
            select: {
              studentId: true,
              joinedAt: true,
              endedAt: true,
            },
          },
        },
      },
      snapshot: { select: { content: true } },
      groups: {
        select: {
          id: true,
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
          revisions: {
            orderBy: { revisionNumber: "asc" },
            select: {
              revisionNumber: true,
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

  const visible = rows.flatMap((row): InsightsReleaseInput[] => {
    if (row.classroom.managerId !== context.actorId || !row.snapshot) {
      return [];
    }
    const content = activityContentSchema.parse(row.snapshot.content);
    const executionVersion = row.executionVersion === 1 ? 1 : 0;
    const submissionMode =
      executionVersion === 1 && (content.schemaVersion === 2 || content.schemaVersion === 3)
        ? content.submissionMode
        : "once";
    const phases =
      executionVersion === 1 && (content.schemaVersion === 2 || content.schemaVersion === 3)
        ? content.phases.map((phase) => ({ name: phase.name }))
        : [];
    const rubricDimensions =
      content.schemaVersion === 2 || content.schemaVersion === 3
        ? content.rubricDimensions.map((dimension) => ({ name: dimension.name }))
        : null;
    return [
      {
        id: row.id,
        title: content.title,
        classroomName: row.classroom.name,
        executionVersion,
        submissionMode,
        phases,
        rubricDimensions,
        groups: row.groups.map((group) => ({
          id: group.id,
          memberIds: group.members.map((member) => member.studentId),
        })),
        currentMemberIds: row.classroom.memberships
          .filter((membership) => isCurrentMembership(membership, context.now))
          .map((membership) => membership.studentId),
        submissions: row.submissions.map((submission) => ({
          id: submission.id,
          phaseIndex: submission.phaseIndex,
          latestRevisionNumber: submission.latestRevisionNumber,
          studentId: submission.studentId,
          groupId: submission.groupId,
          revisions: submission.revisions.map(mapRevision),
        })),
      },
    ];
  });

  const options = rows.flatMap((row) => {
    if (row.classroom.managerId !== context.actorId || !row.snapshot) {
      return [];
    }
    const content = activityContentSchema.parse(row.snapshot.content);
    return [
      {
        id: row.id,
        title: content.title,
        classroomName: row.classroom.name,
        status: row.status,
        publishedAt: row.publishedAt.toISOString(),
      },
    ];
  });
  const selectedReleaseId =
    input.releaseId && options.some((option) => option.id === input.releaseId)
      ? input.releaseId
      : null;
  const view = buildTeacherInsightsView(visible, selectedReleaseId);

  return teacherInsightsDashboardSchema.parse({
    actor,
    selectedReleaseId,
    releaseOptions: options,
    rubric: view.rubric,
    stages: view.stages,
    improvement: view.improvement,
  });
}
