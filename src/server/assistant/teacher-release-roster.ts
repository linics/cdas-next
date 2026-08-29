import "server-only";

import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client";
import type { CommandContext } from "../commands/command-context";
import type { TeacherActivityDashboard } from "../queries/teacher-activity-workspace";
import {
  getTeacherReleaseSubmissions,
  SubmissionWorkspaceQueryError,
  type TeacherReleaseSubmissions,
} from "../queries/submission-workspace";

/**
 * D-054 caps one response at this many objects. A class can be larger than a
 * useful conversational list, and an untruncated roster would crowd out the
 * rest of the context for no added judgement.
 */
export const RELEASE_ROSTER_MAX_OBJECTS = 60;

const reviewHrefSchema = z
  .string()
  .regex(/^\/teacher\/submissions\/[0-9a-f-]{36}$/);

/**
 * One release's review roster, as the first-party page orders it, with every
 * display name removed.
 *
 * D-054 makes the anonymity a boundary of the decision rather than a detail of
 * this file: student names, group names and any other display name must not
 * reach the model. Each object is an ordinal assigned per response — it is not
 * stable across requests and must never be treated as an identifier. A teacher
 * who needs to know who an object is follows the row's link to the first-party
 * page, where the name lives.
 */
export const releaseRosterOutputSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("FOUND"),
      releaseId: z.uuid(),
      title: z.string().trim().min(1),
      classroomName: z.string().trim().min(1),
      releaseStatus: z.enum(["ACTIVE", "CLOSED", "ARCHIVED"]),
      submissionMode: z.enum(["once", "phased", "mixed"]),
      phaseCount: z.int().nonnegative(),
      submissionsHref: z
        .string()
        .regex(/^\/teacher\/releases\/[0-9a-f-]{36}\/submissions$/),
      objectCount: z.int().nonnegative(),
      truncated: z.boolean(),
      objects: z.array(
        z
          .object({
            objectOrdinal: z.int().positive(),
            objectKind: z.enum(["STUDENT", "GROUP"]),
            started: z.boolean(),
            complete: z.boolean(),
            currentPhaseIndex: z.int().nonnegative(),
            completedPhaseCount: z.int().nonnegative(),
            totalPhaseCount: z.int().nonnegative(),
            awaitingFormalRevision: z.boolean(),
            submissions: z.array(
              z
                .object({
                  phaseIndex: z.int().nonnegative(),
                  phaseName: z.string().trim().min(1).nullable(),
                  revisionNumber: z.int().positive(),
                  isLate: z.boolean(),
                  feedback: z.enum(["PENDING", "DONE"]),
                  feedbackVersion: z.int().positive().nullable(),
                  evaluation: z.enum(["PENDING", "DONE", "NO_RUBRIC"]),
                  evaluationVersion: z.int().positive().nullable(),
                  followUp: z
                    .enum(["AWAITING_RESUBMISSION", "RESUBMISSION_IN_PROGRESS"])
                    .nullable(),
                  reviewHref: reviewHrefSchema,
                })
                .strict(),
            ),
          })
          .strict(),
      ),
      reviewCoverage: z
        .object({
          currentRevisionCount: z.int().nonnegative(),
          feedbackCount: z.int().nonnegative(),
          evaluationCount: z.int().nonnegative(),
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

export type ReleaseRosterOutput = z.infer<typeof releaseRosterOutputSchema>;

export type TeacherReleaseRosterReader = (
  releaseId: string,
) => Promise<ReleaseRosterOutput>;

export type TeacherReleaseRosterDependencies = Readonly<{
  database: PrismaClient;
  agentContext: CommandContext;
  workspace: TeacherActivityDashboard;
  getSubmissions?: typeof getTeacherReleaseSubmissions;
}>;

function mapRoster(
  releaseId: string,
  workspace: TeacherReleaseSubmissions,
): ReleaseRosterOutput {
  const rubricAvailable = workspace.release.rubricAvailable;
  const visible = workspace.progress.slice(0, RELEASE_ROSTER_MAX_OBJECTS);

  return releaseRosterOutputSchema.parse({
    status: "FOUND",
    releaseId,
    title: workspace.release.title,
    classroomName: workspace.release.classroomName,
    releaseStatus: workspace.release.status,
    submissionMode: workspace.release.submissionMode,
    phaseCount: workspace.release.phaseCount,
    submissionsHref: `/teacher/releases/${releaseId}/submissions`,
    objectCount: workspace.progress.length,
    truncated: workspace.progress.length > visible.length,
    objects: visible.map((entry, index) => {
      // `progress` keys a group row by the group id, so this one identifier
      // matches both shapes. It is used only to join here and never returned.
      const objectId = entry.group?.id ?? entry.student.id;
      const own = workspace.submissions.filter((submission) =>
        entry.group
          ? submission.group?.id === objectId
          : submission.group === null && submission.student.id === objectId,
      );
      return {
        objectOrdinal: index + 1,
        objectKind: entry.group ? "GROUP" : "STUDENT",
        started: entry.started,
        complete: entry.complete,
        currentPhaseIndex: entry.currentPhaseIndex,
        completedPhaseCount: entry.completedPhaseCount,
        totalPhaseCount: entry.totalPhaseCount,
        awaitingFormalRevision: entry.awaitingFormalRevision,
        submissions: own
          .slice()
          .sort((left, right) => left.phaseIndex - right.phaseIndex)
          .map((submission) => ({
            phaseIndex: submission.phaseIndex,
            phaseName: submission.phaseName,
            revisionNumber: submission.currentRevision.revisionNumber,
            isLate: submission.currentRevision.isLate,
            feedback: submission.currentRevision.feedback ? "DONE" : "PENDING",
            feedbackVersion:
              submission.currentRevision.feedback?.currentVersion ?? null,
            evaluation: !rubricAvailable
              ? "NO_RUBRIC"
              : submission.currentRevision.evaluation
                ? "DONE"
                : "PENDING",
            evaluationVersion:
              submission.currentRevision.evaluation?.currentVersion ?? null,
            followUp: submission.currentRevision.followUp,
            reviewHref: `/teacher/submissions/${submission.submissionId}`,
          })),
      };
    }),
    reviewCoverage: workspace.reviewCoverage,
  });
}

export function createTeacherReleaseRosterReader({
  database,
  agentContext,
  workspace,
  getSubmissions = getTeacherReleaseSubmissions,
}: TeacherReleaseRosterDependencies): TeacherReleaseRosterReader {
  const pending = new Map<string, Promise<ReleaseRosterOutput>>();

  const read = async (releaseId: string): Promise<ReleaseRosterOutput> => {
    const absent = releaseRosterOutputSchema.parse({
      status: "NOT_FOUND",
      releaseId,
    });
    // The already-authorized workspace is the outer gate, and the roster is
    // only offered while the teacher still manages the classroom. A release
    // belonging to someone else, one whose management was handed over, and an
    // invented identifier are all indistinguishable and none reaches the
    // database.
    if (
      !workspace.releases.some(
        (release) => release.id === releaseId && release.canViewSubmissions,
      )
    ) {
      return absent;
    }

    try {
      return mapRoster(
        releaseId,
        await getSubmissions(database, agentContext, { releaseId }),
      );
    } catch (error) {
      if (error instanceof SubmissionWorkspaceQueryError) {
        return absent;
      }
      throw error;
    }
  };

  return (releaseId: string) => {
    const existing = pending.get(releaseId);
    if (existing) return existing;
    const result = read(releaseId);
    pending.set(releaseId, result);
    return result;
  };
}
