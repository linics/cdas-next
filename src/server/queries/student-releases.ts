import "server-only";

import { z } from "zod";
import { activityContentSchema } from "../../domain/activity/activity-content";
import type { PrismaClient } from "../../generated/prisma/client";
import {
  type CommandContext,
  resolveCommandContext,
} from "../commands/command-context";
import {
  membershipIsCurrent,
  membershipOverlapsRelease,
} from "./release-membership-visibility";
import { isSubmissionAudienceMemberWhere } from "../submissions/submission-audience";

const queryInputSchema = z.object({}).strict();
const isoDateSchema = z.iso.datetime({ offset: true });
const releaseStatusSchema = z.enum(["ACTIVE", "CLOSED", "ARCHIVED"]);

export const studentReleaseListSchema = z
  .object({
    actor: z
      .object({
        displayName: z.string().trim().min(1),
      })
      .strict(),
    releases: z.array(
      z
        .object({
          id: z.uuid(),
          status: releaseStatusSchema,
          publishedAt: isoDateSchema,
          dueAt: isoDateSchema.nullable(),
          access: z
            .object({
              canWrite: z.boolean(),
            })
            .strict(),
          snapshot: z
            .object({
              title: z.string().trim().min(1).max(120),
              summary: z.string().trim().min(1).max(600),
            })
            .strict(),
          submission: z
            .object({
              latestRevisionNumber: z.int().nonnegative(),
              hasWorkingCopy: z.boolean(),
              hasCurrentFeedback: z.boolean(),
            })
            .strict(),
        })
        .strict()
        .superRefine((release, context) => {
          if (
            release.submission.latestRevisionNumber === 0 &&
            release.submission.hasCurrentFeedback
          ) {
            context.addIssue({
              code: "custom",
              message: "Feedback requires a formal submission revision",
              path: ["submission", "hasCurrentFeedback"],
            });
          }
        }),
    ),
  })
  .strict();

export type StudentReleaseListInput = z.input<typeof queryInputSchema>;
export type StudentReleaseList = z.infer<typeof studentReleaseListSchema>;

export class StudentReleaseListQueryError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "WRONG_ROLE",
    public readonly actorName?: string,
  ) {
    super(code);
    this.name = "StudentReleaseListQueryError";
  }
}

export async function listStudentReleases(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: StudentReleaseListInput,
): Promise<StudentReleaseList> {
  queryInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI", "AGENT"]);

  const actor = await database.appUser.findUnique({
    where: { id: context.actorId },
    select: { role: true, displayName: true },
  });
  if (!actor) {
    throw new StudentReleaseListQueryError("NOT_FOUND");
  }
  if (actor.role !== "STUDENT") {
    throw new StudentReleaseListQueryError(
      "WRONG_ROLE",
      actor.displayName,
    );
  }

  const candidates = await database.activityRelease.findMany({
    where: {
      OR: [
        {
          classroom: {
            memberships: { some: { studentId: context.actorId } },
          },
        },
        { submissions: { some: isSubmissionAudienceMemberWhere(context.actorId) } },
      ],
    },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      status: true,
      publishedAt: true,
      dueAt: true,
      closedAt: true,
      snapshot: {
        select: { content: true },
      },
      classroom: {
        select: {
          memberships: {
            where: { studentId: context.actorId },
            select: { joinedAt: true, endedAt: true },
          },
        },
      },
      submissions: {
        where: isSubmissionAudienceMemberWhere(context.actorId),
        take: 1,
        select: {
          latestRevisionNumber: true,
          workingCopy: { select: { id: true } },
          revisions: {
            orderBy: { revisionNumber: "desc" },
            take: 1,
            select: {
              revisionNumber: true,
              feedback: { select: { id: true } },
            },
          },
        },
      },
    },
  });

  const releases = candidates.flatMap((release) => {
    const submission = release.submissions[0] ?? null;
    const hasVisibleMembership = release.classroom.memberships.some(
      (membership) =>
        membershipOverlapsRelease(membership, release, context.now),
    );
    if (!submission && !hasVisibleMembership) {
      return [];
    }
    if (!release.snapshot) {
      throw new StudentReleaseListQueryError("NOT_FOUND");
    }

    const hasCurrentMembership = release.classroom.memberships.some(
      (membership) => membershipIsCurrent(membership, context.now),
    );
    const content = activityContentSchema.parse(release.snapshot.content);
    const currentRevision = submission?.revisions[0] ?? null;
    const hasCurrentFeedback = Boolean(
      submission &&
        submission.latestRevisionNumber > 0 &&
        currentRevision?.revisionNumber ===
          submission.latestRevisionNumber &&
        currentRevision.feedback,
    );

    return [
      {
        id: release.id,
        status: release.status,
        publishedAt: release.publishedAt.toISOString(),
        dueAt: release.dueAt?.toISOString() ?? null,
        access: {
          canWrite:
            release.status === "ACTIVE" && hasCurrentMembership,
        },
        snapshot: {
          title: content.title,
          summary: content.summary,
        },
        submission: {
          latestRevisionNumber:
            submission?.latestRevisionNumber ?? 0,
          hasWorkingCopy: submission?.workingCopy !== null &&
            submission?.workingCopy !== undefined,
          hasCurrentFeedback,
        },
      },
    ];
  });

  return studentReleaseListSchema.parse({
    actor: { displayName: actor.displayName },
    releases,
  });
}
