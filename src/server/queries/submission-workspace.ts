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

const queryInputSchema = z
  .object({
    releaseId: z.uuid(),
  })
  .strict();

const releaseStatusSchema = z.enum(["ACTIVE", "CLOSED", "ARCHIVED"]);
const isoDateSchema = z.iso.datetime({ offset: true });
const preservedNonBlankTextSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "Text must not be blank");

const studentWorkspaceSchema = z.strictObject({
  actor: z.strictObject({
    displayName: preservedNonBlankTextSchema,
  }),
  access: z.strictObject({
    canWrite: z.boolean(),
  }),
  release: z.strictObject({
    id: z.uuid(),
    title: preservedNonBlankTextSchema,
    classroomName: preservedNonBlankTextSchema,
    status: releaseStatusSchema,
    publishedAt: isoDateSchema,
    dueAt: isoDateSchema.nullable(),
    snapshot: z.strictObject({
      sourceDraftVersion: z.int().positive(),
      contentHash: z.string().regex(/^[0-9a-f]{64}$/),
      content: activityContentSchema,
    }),
  }),
  submission: z
    .strictObject({
      id: z.uuid(),
      latestRevisionNumber: z.int().nonnegative(),
      workingCopy: z
        .strictObject({
          id: z.uuid(),
          baseRevisionNumber: z.int().nonnegative(),
          version: z.int().positive(),
          textEvidence: z.string(),
          updatedAt: isoDateSchema,
        })
        .nullable(),
      revisions: z.array(
        z.strictObject({
          id: z.uuid(),
          revisionNumber: z.int().positive(),
          textEvidence: preservedNonBlankTextSchema,
          isLate: z.boolean(),
          submittedAt: isoDateSchema,
        }),
      ),
    })
    .nullable(),
});

const teacherReleaseSubmissionsSchema = z.strictObject({
  actor: z.strictObject({
    displayName: preservedNonBlankTextSchema,
  }),
  release: z.strictObject({
    id: z.uuid(),
    title: preservedNonBlankTextSchema,
    classroomName: preservedNonBlankTextSchema,
    status: releaseStatusSchema,
    publishedAt: isoDateSchema,
    dueAt: isoDateSchema.nullable(),
  }),
  submissions: z.array(
    z.strictObject({
      submissionId: z.uuid(),
      student: z.strictObject({
        id: z.uuid(),
        displayName: preservedNonBlankTextSchema,
      }),
      currentRevision: z.strictObject({
        id: z.uuid(),
        revisionNumber: z.int().positive(),
        isLate: z.boolean(),
        submittedAt: isoDateSchema,
        feedback: z
          .strictObject({ currentVersion: z.int().positive() })
          .nullable(),
      }),
    }),
  ),
});

export type SubmissionWorkspaceInput = z.input<typeof queryInputSchema>;
export type StudentReleaseWorkspace = z.infer<typeof studentWorkspaceSchema>;
export type TeacherReleaseSubmissions = z.infer<
  typeof teacherReleaseSubmissionsSchema
>;

export class SubmissionWorkspaceQueryError extends Error {
  constructor(public readonly code: "NOT_FOUND") {
    super(code);
    this.name = "SubmissionWorkspaceQueryError";
  }
}

export async function getStudentReleaseWorkspace(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: SubmissionWorkspaceInput,
): Promise<StudentReleaseWorkspace> {
  const input = queryInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI", "AGENT"]);

  const [actor, release] = await Promise.all([
    database.appUser.findUnique({
      where: { id: context.actorId },
      select: { role: true, displayName: true },
    }),
    database.activityRelease.findUnique({
      where: { id: input.releaseId },
      select: {
        id: true,
        status: true,
        publishedAt: true,
        dueAt: true,
        closedAt: true,
        snapshot: {
          select: {
            sourceDraftVersion: true,
            contentHash: true,
            content: true,
          },
        },
        classroom: {
          select: {
            name: true,
            memberships: {
              where: { studentId: context.actorId },
              select: { joinedAt: true, endedAt: true },
            },
          },
        },
        submissions: {
          where: { studentId: context.actorId },
          take: 1,
          select: {
            id: true,
            latestRevisionNumber: true,
            workingCopy: {
              select: {
                id: true,
                baseRevisionNumber: true,
                version: true,
                textEvidence: true,
                updatedAt: true,
              },
            },
            revisions: {
              orderBy: { revisionNumber: "asc" },
              select: {
                id: true,
                revisionNumber: true,
                textEvidence: true,
                isLate: true,
                submittedAt: true,
              },
            },
          },
        },
      },
    }),
  ]);

  if (!actor || actor.role !== "STUDENT" || !release) {
    throw new SubmissionWorkspaceQueryError("NOT_FOUND");
  }

  const submission = release.submissions[0] ?? null;
  const hasVisibleMembership =
    release.classroom.memberships.some((membership) =>
      membershipOverlapsRelease(membership, release, context.now),
    );
  const hasCurrentMembership = release.classroom.memberships.some(
    (membership) => membershipIsCurrent(membership, context.now),
  );

  if (!submission && !hasVisibleMembership) {
    throw new SubmissionWorkspaceQueryError("NOT_FOUND");
  }
  if (!release.snapshot) {
    throw new SubmissionWorkspaceQueryError("NOT_FOUND");
  }
  const content = activityContentSchema.parse(release.snapshot.content);

  const workspace = {
    actor: { displayName: actor.displayName },
    access: {
      canWrite: release.status === "ACTIVE" && hasCurrentMembership,
    },
    release: {
      id: release.id,
      title: content.title,
      classroomName: release.classroom.name,
      status: release.status,
      publishedAt: release.publishedAt.toISOString(),
      dueAt: release.dueAt?.toISOString() ?? null,
      snapshot: {
        sourceDraftVersion: release.snapshot.sourceDraftVersion,
        contentHash: release.snapshot.contentHash,
        content,
      },
    },
    submission: submission
      ? {
          id: submission.id,
          latestRevisionNumber: submission.latestRevisionNumber,
          workingCopy: submission.workingCopy
            ? {
                id: submission.workingCopy.id,
                baseRevisionNumber:
                  submission.workingCopy.baseRevisionNumber,
                version: submission.workingCopy.version,
                textEvidence: submission.workingCopy.textEvidence,
                updatedAt: submission.workingCopy.updatedAt.toISOString(),
              }
            : null,
          revisions: submission.revisions.map((revision) => ({
            id: revision.id,
            revisionNumber: revision.revisionNumber,
            textEvidence: revision.textEvidence,
            isLate: revision.isLate,
            submittedAt: revision.submittedAt.toISOString(),
          })),
        }
      : null,
  } satisfies StudentReleaseWorkspace;

  return studentWorkspaceSchema.parse(workspace);
}

export async function getTeacherReleaseSubmissions(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: SubmissionWorkspaceInput,
): Promise<TeacherReleaseSubmissions> {
  const input = queryInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI", "AGENT"]);

  const release = await database.activityRelease.findUnique({
    where: { id: input.releaseId },
    select: {
      id: true,
      publisherId: true,
      publisher: { select: { role: true, displayName: true } },
      status: true,
      publishedAt: true,
      dueAt: true,
      classroom: { select: { managerId: true, name: true } },
      snapshot: { select: { content: true } },
      submissions: {
        where: { latestRevisionNumber: { gt: 0 } },
        select: {
          id: true,
          latestRevisionNumber: true,
          student: { select: { id: true, displayName: true } },
          revisions: {
            orderBy: { revisionNumber: "desc" },
            take: 1,
            select: {
              id: true,
              revisionNumber: true,
              isLate: true,
              submittedAt: true,
              feedback: { select: { version: true } },
            },
          },
        },
      },
    },
  });

  if (
    !release ||
    release.publisher.role !== "TEACHER" ||
    release.publisherId !== context.actorId ||
    release.classroom.managerId !== context.actorId ||
    !release.snapshot
  ) {
    throw new SubmissionWorkspaceQueryError("NOT_FOUND");
  }

  const submissions: TeacherReleaseSubmissions["submissions"] =
    release.submissions.map((submission) => {
    const currentRevision = submission.revisions[0];
    if (
      !currentRevision ||
      currentRevision.revisionNumber !== submission.latestRevisionNumber
    ) {
      throw new Error(
        `Submission ${submission.id} has no exact current formal revision`,
      );
    }

    return {
      submissionId: submission.id,
      student: submission.student,
      currentRevision: {
        id: currentRevision.id,
        revisionNumber: currentRevision.revisionNumber,
        isLate: currentRevision.isLate,
        submittedAt: currentRevision.submittedAt.toISOString(),
        feedback: currentRevision.feedback
          ? { currentVersion: currentRevision.feedback.version }
          : null,
      },
    };
    });

  submissions.sort((left, right) => {
    const byTime = right.currentRevision.submittedAt.localeCompare(
      left.currentRevision.submittedAt,
    );
    return (
      byTime ||
      left.student.displayName.localeCompare(right.student.displayName)
    );
  });

  const workspace = {
    actor: { displayName: release.publisher.displayName },
    release: {
      id: release.id,
      title: activityContentSchema.parse(release.snapshot.content).title,
      classroomName: release.classroom.name,
      status: release.status,
      publishedAt: release.publishedAt.toISOString(),
      dueAt: release.dueAt?.toISOString() ?? null,
    },
    submissions,
  } satisfies TeacherReleaseSubmissions;

  return teacherReleaseSubmissionsSchema.parse(workspace);
}
