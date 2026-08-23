import "server-only";

import { z } from "zod";
import { activityContentSchema } from "../../domain/activity/activity-content";
import { hasMeaningfulTextEvidence } from "../../domain/submission/text-evidence";
import type { PrismaClient } from "../../generated/prisma/client";
import {
  type CommandContext,
  resolveCommandContext,
} from "../commands/command-context";

const queryInputSchema = z
  .object({
    submissionId: z.uuid(),
  })
  .strict();

const isoDateSchema = z.iso.datetime({ offset: true });
const releaseStatusSchema = z.enum(["ACTIVE", "CLOSED", "ARCHIVED"]);
const feedbackSourceSchema = z.enum(["MANUAL", "AI_ASSISTED"]);
const visibleTextSchema = z
  .string()
  .refine(hasMeaningfulTextEvidence, "Text must contain visible content");

const releaseSchema = z
  .object({
    id: z.uuid(),
    status: releaseStatusSchema,
    publishedAt: isoDateSchema,
    dueAt: isoDateSchema.nullable(),
    classroom: z
      .object({
        id: z.uuid(),
        name: visibleTextSchema,
      })
      .strict(),
    snapshot: z
      .object({
        sourceDraftVersion: z.int().positive(),
        contentHash: z.string().regex(/^[0-9a-f]{64}$/),
        content: activityContentSchema,
      })
      .strict(),
  })
  .strict();

const confirmedFeedbackRevisionSchema = z
  .object({
    id: z.uuid(),
    version: z.int().positive(),
    body: visibleTextSchema,
    source: feedbackSourceSchema,
    confirmedAt: isoDateSchema,
  })
  .strict();

const confirmedFeedbackSchema = z
  .object({
    id: z.uuid(),
    currentVersion: z.int().positive(),
    teacher: z
      .object({
        id: z.uuid(),
        displayName: visibleTextSchema,
      })
      .strict(),
    revisions: z.array(confirmedFeedbackRevisionSchema).min(1),
  })
  .strict()
  .superRefine((feedback, context) => {
    if (feedback.revisions.length !== feedback.currentVersion) {
      context.addIssue({
        code: "custom",
        message: "Feedback history must match its current version",
      });
    }
    feedback.revisions.forEach((revision, index) => {
      if (revision.version !== index + 1) {
        context.addIssue({
          code: "custom",
          message: "Feedback revision versions must be contiguous",
          path: ["revisions", index, "version"],
        });
      }
    });
  });

const formalSubmissionRevisionSchema = z
  .object({
    id: z.uuid(),
    revisionNumber: z.int().positive(),
    textEvidence: visibleTextSchema,
    isLate: z.boolean(),
    submittedAt: isoDateSchema,
    feedback: confirmedFeedbackSchema.nullable(),
  })
  .strict();

const submissionHistorySchema = z
  .object({
    id: z.uuid(),
    latestRevisionNumber: z.int().nonnegative(),
    release: releaseSchema,
    revisions: z.array(formalSubmissionRevisionSchema),
  })
  .strict()
  .superRefine((submission, context) => {
    if (submission.revisions.length !== submission.latestRevisionNumber) {
      context.addIssue({
        code: "custom",
        message: "Formal revision history must match the latest revision",
      });
    }
    submission.revisions.forEach((revision, index) => {
      if (revision.revisionNumber !== index + 1) {
        context.addIssue({
          code: "custom",
          message: "Submission revision numbers must be contiguous",
          path: ["revisions", index, "revisionNumber"],
        });
      }
    });
  });

export const teacherFeedbackWorkspaceSchema = z
  .object({
    student: z
      .object({
        id: z.uuid(),
        displayName: visibleTextSchema,
      })
      .strict(),
    submission: submissionHistorySchema,
  })
  .strict();

export const studentFeedbackWorkspaceSchema = z
  .object({
    submission: submissionHistorySchema,
  })
  .strict();

export type FeedbackWorkspaceInput = z.input<typeof queryInputSchema>;
export type TeacherFeedbackWorkspace = z.infer<
  typeof teacherFeedbackWorkspaceSchema
>;
export type StudentFeedbackWorkspace = z.infer<
  typeof studentFeedbackWorkspaceSchema
>;

export class FeedbackWorkspaceQueryError extends Error {
  constructor(public readonly code: "NOT_FOUND") {
    super(code);
    this.name = "FeedbackWorkspaceQueryError";
  }
}

const safeSubmissionSelect = {
  id: true,
  latestRevisionNumber: true,
  release: {
    select: {
      id: true,
      status: true,
      publishedAt: true,
      dueAt: true,
      classroom: {
        select: {
          id: true,
          name: true,
        },
      },
      snapshot: {
        select: {
          sourceDraftVersion: true,
          contentHash: true,
          content: true,
        },
      },
    },
  },
  revisions: {
    orderBy: { revisionNumber: "asc" as const },
    select: {
      id: true,
      revisionNumber: true,
      textEvidence: true,
      isLate: true,
      submittedAt: true,
      feedback: {
        select: {
          id: true,
          version: true,
          teacher: {
            select: {
              id: true,
              displayName: true,
            },
          },
          revisions: {
            orderBy: { version: "asc" as const },
            select: {
              id: true,
              version: true,
              body: true,
              source: true,
              confirmedAt: true,
            },
          },
        },
      },
    },
  },
} as const;

function mapSubmissionHistory(
  submission: {
    id: string;
    latestRevisionNumber: number;
    release: {
      id: string;
      status: "ACTIVE" | "CLOSED" | "ARCHIVED";
      publishedAt: Date;
      dueAt: Date | null;
      classroom: { id: string; name: string };
      snapshot: {
        sourceDraftVersion: number;
        contentHash: string;
        content: unknown;
      } | null;
    };
    revisions: Array<{
      id: string;
      revisionNumber: number;
      textEvidence: string;
      isLate: boolean;
      submittedAt: Date;
      feedback: {
        id: string;
        version: number;
        teacher: { id: string; displayName: string };
        revisions: Array<{
          id: string;
          version: number;
          body: string;
          source: "MANUAL" | "AI_ASSISTED";
          confirmedAt: Date;
        }>;
      } | null;
    }>;
  },
) {
  if (!submission.release.snapshot) {
    throw new FeedbackWorkspaceQueryError("NOT_FOUND");
  }

  return {
    id: submission.id,
    latestRevisionNumber: submission.latestRevisionNumber,
    release: {
      id: submission.release.id,
      status: submission.release.status,
      publishedAt: submission.release.publishedAt.toISOString(),
      dueAt: submission.release.dueAt?.toISOString() ?? null,
      classroom: submission.release.classroom,
      snapshot: {
        sourceDraftVersion:
          submission.release.snapshot.sourceDraftVersion,
        contentHash: submission.release.snapshot.contentHash,
        content: activityContentSchema.parse(
          submission.release.snapshot.content,
        ),
      },
    },
    revisions: submission.revisions.map((revision) => ({
      id: revision.id,
      revisionNumber: revision.revisionNumber,
      textEvidence: revision.textEvidence,
      isLate: revision.isLate,
      submittedAt: revision.submittedAt.toISOString(),
      feedback: revision.feedback
          ? {
            id: revision.feedback.id,
            currentVersion: revision.feedback.version,
            teacher: revision.feedback.teacher,
            revisions: revision.feedback.revisions.map(
              (feedbackRevision) => ({
                id: feedbackRevision.id,
                version: feedbackRevision.version,
                body: feedbackRevision.body,
                source: feedbackRevision.source,
                confirmedAt:
                  feedbackRevision.confirmedAt.toISOString(),
              }),
            ),
          }
        : null,
    })),
  };
}

export async function getTeacherFeedbackWorkspace(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: FeedbackWorkspaceInput,
): Promise<TeacherFeedbackWorkspace> {
  const input = queryInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI", "AGENT"]);

  const [actor, submission] = await Promise.all([
    database.appUser.findFirst({
      where: { id: context.actorId, role: "TEACHER" },
      select: { id: true },
    }),
    database.submission.findFirst({
      where: {
        id: input.submissionId,
        latestRevisionNumber: { gt: 0 },
        release: {
          publisherId: context.actorId,
          classroom: { managerId: context.actorId },
        },
      },
      select: {
        ...safeSubmissionSelect,
        student: {
          select: {
            id: true,
            displayName: true,
          },
        },
      },
    }),
  ]);

  if (!actor || !submission) {
    throw new FeedbackWorkspaceQueryError("NOT_FOUND");
  }

  return teacherFeedbackWorkspaceSchema.parse({
    student: submission.student,
    submission: mapSubmissionHistory(submission),
  });
}

export async function getStudentFeedbackWorkspace(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: FeedbackWorkspaceInput,
): Promise<StudentFeedbackWorkspace> {
  const input = queryInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI", "AGENT"]);

  const [actor, submission] = await Promise.all([
    database.appUser.findFirst({
      where: { id: context.actorId, role: "STUDENT" },
      select: { id: true },
    }),
    database.submission.findFirst({
      where: {
        id: input.submissionId,
        studentId: context.actorId,
      },
      select: safeSubmissionSelect,
    }),
  ]);

  if (!actor || !submission) {
    throw new FeedbackWorkspaceQueryError("NOT_FOUND");
  }

  return studentFeedbackWorkspaceSchema.parse({
    submission: mapSubmissionHistory(submission),
  });
}
