import "server-only";

import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client";
import type { CommandContext } from "../commands/command-context";
import { TeacherActivityQueryError } from "../queries/teacher-activity-workspace";
import type { TeacherActivityDashboard } from "../queries/teacher-activity-workspace";
import { getTeacherInsights } from "../queries/teacher-insights";

/**
 * One release's process diagnostics, exactly as the first-party page computes
 * them: how many objects sit in each stage, how the frozen rubric's levels are
 * distributed, and whether resubmissions moved. Every number is a count over
 * the cohort. No student, group, submission, evidence, feedback or written
 * evaluation reaches this shape, so there is nothing here to attribute to an
 * individual.
 */
export const releaseInsightsOutputSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("FOUND"),
      releaseId: z.uuid(),
      title: z.string().trim().min(1),
      classroomName: z.string().trim().min(1),
      releaseStatus: z.enum(["ACTIVE", "CLOSED", "ARCHIVED"]),
      insightsHref: z.string().regex(/^\/teacher\/insights$/),
      audienceCount: z.int().nonnegative(),
      stageBuckets: z.array(
        z
          .object({
            key: z.string().trim().min(1),
            label: z.string().trim().min(1),
            count: z.int().nonnegative(),
          })
          .strict(),
      ),
      rubricStatus: z.enum(["no_rubric", "no_evaluations", "ready"]),
      evaluatedCount: z.int().nonnegative(),
      rubricDimensions: z.array(
        z
          .object({
            dimensionName: z.string().trim().min(1),
            excellent: z.int().nonnegative(),
            good: z.int().nonnegative(),
            pass: z.int().nonnegative(),
            improve: z.int().nonnegative(),
            insufficient: z.int().nonnegative(),
            weakest: z.boolean(),
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
    .strict(),
  z
    .object({
      status: z.literal("NOT_FOUND"),
      releaseId: z.uuid(),
    })
    .strict(),
]);

export type ReleaseInsightsOutput = z.infer<typeof releaseInsightsOutputSchema>;

export type TeacherReleaseInsightsReader = (
  releaseId: string,
) => Promise<ReleaseInsightsOutput>;

export type TeacherReleaseInsightsDependencies = Readonly<{
  database: PrismaClient;
  agentContext: CommandContext;
  workspace: TeacherActivityDashboard;
  getInsights?: typeof getTeacherInsights;
}>;

export function createTeacherReleaseInsightsReader({
  database,
  agentContext,
  workspace,
  getInsights = getTeacherInsights,
}: TeacherReleaseInsightsDependencies): TeacherReleaseInsightsReader {
  const pending = new Map<string, Promise<ReleaseInsightsOutput>>();

  const read = async (releaseId: string): Promise<ReleaseInsightsOutput> => {
    const absent = releaseInsightsOutputSchema.parse({
      status: "NOT_FOUND",
      releaseId,
    });
    // The already-authorized workspace is the outer gate, so another teacher's
    // release and an invented identifier never reach the database and cannot
    // be told apart from a release that does not exist.
    if (!workspace.releases.some((release) => release.id === releaseId)) {
      return absent;
    }

    let dashboard;
    try {
      dashboard = await getInsights(database, agentContext, { releaseId });
    } catch (error) {
      if (error instanceof TeacherActivityQueryError) {
        return absent;
      }
      throw error;
    }

    const option = dashboard.releaseOptions.find(
      (candidate) => candidate.id === releaseId,
    );
    const stages = dashboard.stages.find(
      (candidate) => candidate.releaseId === releaseId,
    );
    const rubric = dashboard.rubric.find(
      (candidate) => candidate.releaseId === releaseId,
    );
    if (!option || !stages || !rubric) {
      return absent;
    }

    return releaseInsightsOutputSchema.parse({
      status: "FOUND",
      releaseId,
      title: option.title,
      classroomName: option.classroomName,
      releaseStatus: option.status,
      insightsHref: "/teacher/insights",
      audienceCount: stages.audienceCount,
      stageBuckets: stages.buckets,
      rubricStatus: rubric.status,
      evaluatedCount: rubric.sampleCount,
      rubricDimensions: rubric.dimensions.map((dimension) => ({
        dimensionName: dimension.dimensionName,
        excellent: dimension.excellent,
        good: dimension.good,
        pass: dimension.pass,
        improve: dimension.improve,
        insufficient: dimension.insufficient,
        weakest: dimension.weak,
      })),
      improvement: dashboard.improvement,
    });
  };

  return (releaseId: string) => {
    const existing = pending.get(releaseId);
    if (existing) return existing;
    const result = read(releaseId);
    pending.set(releaseId, result);
    return result;
  };
}
