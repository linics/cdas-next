import "server-only";

import { z } from "zod";
import {
  activityContentSchema,
  isStructuredContent,
} from "../../domain/activity/activity-content";
import type { PrismaClient } from "../../generated/prisma/client";
import {
  type CommandContext,
  resolveCommandContext,
} from "../commands/command-context";
import {
  membershipIsCurrent,
  membershipOverlapsRelease,
} from "./release-membership-visibility";
import { reviewFollowUp } from "../../domain/feedback/review-follow-up";
import { isSubmissionAudienceMemberWhere } from "../submissions/submission-audience";
import { isActiveSchoolMember } from "../school/teacher-authorization";

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
const attachmentSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(["IMAGE", "PDF", "WORD"]),
  filename: preservedNonBlankTextSchema,
  mediaType: preservedNonBlankTextSchema,
  byteSize: z.int().positive(),
  status: z.enum(["UPLOAD_PENDING", "SCAN_PENDING", "READY", "REJECTED"]),
});

const studentSubmissionSchema = z.strictObject({
  id: z.uuid(),
  phaseIndex: z.int().nonnegative(),
  latestRevisionNumber: z.int().nonnegative(),
  workingCopy: z
    .strictObject({
      id: z.uuid(),
      baseRevisionNumber: z.int().nonnegative(),
      version: z.int().positive(),
      textEvidence: z.string(),
      completedEvidenceIndexes: z.array(z.int().positive()).max(4),
      updatedAt: isoDateSchema,
      attachments: z.array(attachmentSchema).max(5),
    })
    .nullable(),
  revisions: z.array(
    z.strictObject({
      id: z.uuid(),
      revisionNumber: z.int().positive(),
      textEvidence: z.string(),
      completedEvidenceIndexes: z.array(z.int().positive()).max(4),
      isLate: z.boolean(),
      submittedAt: isoDateSchema,
      attachments: z.array(
        attachmentSchema.extend({ status: z.literal("READY") }),
      ).max(5),
    }),
  ),
});

const studentWorkspaceSchema = z.strictObject({
  actor: z.strictObject({
    displayName: preservedNonBlankTextSchema,
  }),
  group: z
    .strictObject({
      id: z.uuid(),
      name: preservedNonBlankTextSchema,
      members: z.array(
        z.strictObject({
          student: z.strictObject({
            id: z.uuid(),
            displayName: preservedNonBlankTextSchema,
          }),
          roleLabel: preservedNonBlankTextSchema.nullable(),
        }),
      ),
    })
    .nullable(),
  access: z.strictObject({
    canWrite: z.boolean(),
  }),
  execution: z.strictObject({
    version: z.int().min(0).max(1),
    mode: z.enum(["once", "phased", "mixed"]),
    phaseCount: z.int().nonnegative(),
    currentPhaseIndex: z.int().nonnegative(),
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
  submission: studentSubmissionSchema.nullable(),
  submissions: z.array(studentSubmissionSchema),
});

const teacherReleaseSubmissionsSchema = z.strictObject({
  actor: z.strictObject({
    displayName: preservedNonBlankTextSchema,
  }),
  release: z.strictObject({
    id: z.uuid(),
    title: preservedNonBlankTextSchema,
    classroomId: z.uuid(),
    classroomName: preservedNonBlankTextSchema,
    status: releaseStatusSchema,
    publishedAt: isoDateSchema,
    dueAt: isoDateSchema.nullable(),
    executionVersion: z.int().min(0).max(1),
    submissionMode: z.enum(["once", "phased", "mixed"]),
    phaseCount: z.int().nonnegative(),
    rubricAvailable: z.boolean(),
  }),
  submissions: z.array(
    z.strictObject({
      submissionId: z.uuid(),
      phaseIndex: z.int().nonnegative(),
      phaseName: preservedNonBlankTextSchema.nullable(),
      student: z.strictObject({
        id: z.uuid(),
        displayName: preservedNonBlankTextSchema,
      }),
      group: z.strictObject({
        id: z.uuid(),
        name: preservedNonBlankTextSchema,
        members: z.array(z.strictObject({
          student: z.strictObject({ id: z.uuid(), displayName: preservedNonBlankTextSchema }),
          roleLabel: preservedNonBlankTextSchema.nullable(),
        })),
      }).nullable(),
      currentRevision: z.strictObject({
        id: z.uuid(),
        revisionNumber: z.int().positive(),
        isLate: z.boolean(),
        submittedAt: isoDateSchema,
        feedback: z
          .strictObject({ currentVersion: z.int().positive() })
          .nullable(),
        evaluation: z
          .strictObject({ currentVersion: z.int().positive() })
          .nullable(),
        followUp: z
          .enum(["AWAITING_RESUBMISSION", "RESUBMISSION_IN_PROGRESS"])
          .nullable(),
      }),
    }),
  ),
  progress: z.array(
    z.strictObject({
      student: z.strictObject({
        id: z.uuid(),
        displayName: preservedNonBlankTextSchema,
      }),
      started: z.boolean(),
      completedPhaseCount: z.int().nonnegative(),
      totalPhaseCount: z.int().nonnegative(),
      currentPhaseIndex: z.int().nonnegative(),
      complete: z.boolean(),
      awaitingFormalRevision: z.boolean(),
      group: z.strictObject({
        id: z.uuid(),
        name: preservedNonBlankTextSchema,
        members: z.array(z.strictObject({
          student: z.strictObject({ id: z.uuid(), displayName: preservedNonBlankTextSchema }),
          roleLabel: preservedNonBlankTextSchema.nullable(),
        })),
      }).nullable(),
    }),
  ),
  reviewCoverage: z.strictObject({
    currentRevisionCount: z.int().nonnegative(),
    feedbackCount: z.int().nonnegative(),
    evaluationCount: z.int().nonnegative(),
  }),
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

function formalAttachmentStatus(status: string): "READY" {
  if (status !== "READY") {
    throw new Error("Formal revision references a non-ready attachment");
  }
  return "READY";
}

function awaitingFormalRevision(
  submissions: ReadonlyArray<{
    phaseIndex: number;
    latestRevisionNumber: number;
  }>,
  currentPhaseIndex: number,
  complete: boolean,
): boolean {
  return (
    !complete &&
    submissions.some(
      (submission) =>
        submission.phaseIndex === currentPhaseIndex &&
        submission.latestRevisionNumber === 0,
    )
  );
}

export async function getStudentReleaseWorkspace(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: SubmissionWorkspaceInput,
): Promise<StudentReleaseWorkspace> {
  const input = queryInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI", "AGENT"]);

  if (!(await isActiveSchoolMember(database, context.actorId))) {
    throw new SubmissionWorkspaceQueryError("NOT_FOUND");
  }

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
        executionVersion: true,
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
          where: isSubmissionAudienceMemberWhere(context.actorId),
          orderBy: { phaseIndex: "asc" },
          select: {
            id: true,
            phaseIndex: true,
            latestRevisionNumber: true,
            workingCopy: {
              select: {
                id: true,
                baseRevisionNumber: true,
                version: true,
                textEvidence: true,
                completedEvidenceIndexes: true,
                updatedAt: true,
                attachments: {
                  orderBy: { position: "asc" },
                  select: {
                    attachment: {
                      select: {
                        id: true,
                        kind: true,
                        originalFilename: true,
                        mediaType: true,
                        byteSize: true,
                        status: true,
                      },
                    },
                  },
                },
              },
            },
            revisions: {
              orderBy: { revisionNumber: "asc" },
              select: {
                id: true,
                revisionNumber: true,
                textEvidence: true,
                completedEvidenceIndexes: true,
                isLate: true,
                submittedAt: true,
                attachments: {
                  orderBy: { position: "asc" },
                  select: {
                    attachment: {
                      select: {
                        id: true,
                        kind: true,
                        originalFilename: true,
                        mediaType: true,
                        byteSize: true,
                        status: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        groups: {
          where: { members: { some: { studentId: context.actorId } } },
          take: 1,
          select: {
            id: true,
            name: true,
            members: {
              orderBy: { createdAt: "asc" },
              select: {
                roleLabel: true,
                student: { select: { id: true, displayName: true } },
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

  const hasVisibleMembership =
    release.classroom.memberships.some((membership) =>
      membershipOverlapsRelease(membership, release, context.now),
    );
  const hasCurrentMembership = release.classroom.memberships.some(
    (membership) => membershipIsCurrent(membership, context.now),
  );

  if (release.submissions.length === 0 && !hasVisibleMembership) {
    throw new SubmissionWorkspaceQueryError("NOT_FOUND");
  }
  if (!release.snapshot) {
    throw new SubmissionWorkspaceQueryError("NOT_FOUND");
  }
  const content = activityContentSchema.parse(release.snapshot.content);
  const phaseCount =
    release.executionVersion === 1 && isStructuredContent(content)
      ? content.phases.length
      : 0;
  const submissionMode =
    release.executionVersion === 1 && isStructuredContent(content)
      ? content.submissionMode
      : "once";
  const submissionByPhase = new Map(
    release.submissions.map((submission) => [submission.phaseIndex, submission]),
  );
  const firstIncompletePhase = Array.from(
    { length: phaseCount },
    (_, index) => index + 1,
  ).find(
    (phaseIndex) =>
      (submissionByPhase.get(phaseIndex)?.latestRevisionNumber ?? 0) === 0,
  );
  const currentPhaseIndex =
    release.executionVersion === 0
      ? 0
      : firstIncompletePhase ??
        (submissionMode === "mixed" ? 0 : Math.max(1, phaseCount));

  const mapSubmission = (
    submission: (typeof release.submissions)[number],
  ): z.infer<typeof studentSubmissionSchema> => ({
    id: submission.id,
    phaseIndex: submission.phaseIndex,
    latestRevisionNumber: submission.latestRevisionNumber,
    workingCopy: submission.workingCopy
      ? {
          id: submission.workingCopy.id,
          baseRevisionNumber: submission.workingCopy.baseRevisionNumber,
          version: submission.workingCopy.version,
          textEvidence: submission.workingCopy.textEvidence,
          completedEvidenceIndexes:
            submission.workingCopy.completedEvidenceIndexes,
          updatedAt: submission.workingCopy.updatedAt.toISOString(),
          attachments: submission.workingCopy.attachments.map(
            ({ attachment }) => ({
              id: attachment.id,
              kind: attachment.kind,
              filename: attachment.originalFilename,
              mediaType: attachment.mediaType,
              byteSize: attachment.byteSize,
              status: attachment.status,
            }),
          ),
        }
      : null,
    revisions: submission.revisions.map((revision) => ({
      id: revision.id,
      revisionNumber: revision.revisionNumber,
      textEvidence: revision.textEvidence,
      completedEvidenceIndexes: revision.completedEvidenceIndexes,
      isLate: revision.isLate,
      submittedAt: revision.submittedAt.toISOString(),
      attachments: revision.attachments.map(({ attachment }) => ({
        id: attachment.id,
        kind: attachment.kind,
        filename: attachment.originalFilename,
        mediaType: attachment.mediaType,
        byteSize: attachment.byteSize,
        status: formalAttachmentStatus(attachment.status),
      })),
    })),
  });
  const currentSubmission = submissionByPhase.get(currentPhaseIndex) ?? null;

  const workspace = {
    actor: { displayName: actor.displayName },
    group: release.groups[0] ?? null,
    access: {
      canWrite: release.status === "ACTIVE" && hasCurrentMembership,
    },
    execution: {
      version: release.executionVersion,
      mode: submissionMode,
      phaseCount,
      currentPhaseIndex,
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
    submission: currentSubmission ? mapSubmission(currentSubmission) : null,
    submissions: release.submissions.map(mapSubmission),
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

  if (!(await isActiveSchoolMember(database, context.actorId))) {
    throw new SubmissionWorkspaceQueryError("NOT_FOUND");
  }

  const release = await database.activityRelease.findUnique({
    where: { id: input.releaseId },
    select: {
      id: true,
      publisherId: true,
      publisher: { select: { role: true, displayName: true } },
      status: true,
      publishedAt: true,
      dueAt: true,
      executionVersion: true,
      snapshot: { select: { content: true } },
      submissions: {
        select: {
          id: true,
          phaseIndex: true,
          latestRevisionNumber: true,
          workingCopy: { select: { id: true } },
          student: { select: { id: true, displayName: true } },
          group: {
            select: {
              id: true,
              name: true,
              members: { select: { roleLabel: true, student: { select: { id: true, displayName: true } } } },
            },
          },
          revisions: {
            orderBy: { revisionNumber: "desc" },
            take: 1,
            select: {
              id: true,
              revisionNumber: true,
              isLate: true,
              submittedAt: true,
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
              evaluation: { select: { version: true } },
            },
          },
        },
      },
      classroom: {
        select: {
          id: true,
          managerId: true,
          name: true,
          memberships: {
            where: {
              joinedAt: { lte: context.now },
              OR: [{ endedAt: null }, { endedAt: { gt: context.now } }],
            },
            select: {
              student: { select: { id: true, displayName: true } },
            },
          },
        },
      },
      groups: {
        select: {
          id: true,
          name: true,
          members: { select: { roleLabel: true, student: { select: { id: true, displayName: true } } } },
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

  const content = activityContentSchema.parse(release.snapshot.content);
  const submissionMode =
    release.executionVersion === 1 && isStructuredContent(content)
      ? content.submissionMode
      : "once";
  const phaseCount =
    release.executionVersion === 1 && isStructuredContent(content)
      ? content.phases.length
      : 0;

  const rubricAvailable = isStructuredContent(content);
  const submissions: TeacherReleaseSubmissions["submissions"] =
    release.submissions
      .filter((submission) => submission.latestRevisionNumber > 0)
      .map((submission) => {
    const currentRevision = submission.revisions[0];
    if (
      !currentRevision ||
      currentRevision.revisionNumber !== submission.latestRevisionNumber
    ) {
      throw new Error(
        `Submission ${submission.id} has no exact current formal revision`,
      );
    }

    const currentFeedback = currentRevision.feedback;
    const currentFeedbackRevision = currentFeedback?.revisions[0];
    if (
      currentFeedback &&
      (!currentFeedbackRevision ||
        currentFeedbackRevision.version !== currentFeedback.version)
    ) {
      throw new Error(
        `Submission ${submission.id} has no exact current feedback revision`,
      );
    }

    return {
      submissionId: submission.id,
      phaseIndex: submission.phaseIndex,
      phaseName:
        submission.phaseIndex === 0
          ? release.executionVersion === 1
            ? "整项终稿"
            : null
          : isStructuredContent(content)
            ? (content.phases[submission.phaseIndex - 1]?.name ?? null)
            : null,
      student: submission.student ?? {
        id: submission.group?.id ?? submission.id,
        displayName: submission.group?.name ?? "小组提交",
      },
      group: submission.group,
      currentRevision: {
        id: currentRevision.id,
        revisionNumber: currentRevision.revisionNumber,
        isLate: currentRevision.isLate,
        submittedAt: currentRevision.submittedAt.toISOString(),
        feedback: currentFeedback
          ? { currentVersion: currentFeedback.version }
          : null,
        evaluation:
          rubricAvailable && currentRevision.evaluation
            ? { currentVersion: currentRevision.evaluation.version }
            : null,
        followUp: reviewFollowUp({
          nextStep: currentFeedbackRevision?.nextStep,
          hasWorkingCopy: submission.workingCopy !== null,
        }),
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

  const groupedStudentIds = new Set(
    release.groups.flatMap((group) => group.members.map((member) => member.student.id)),
  );
  const progress: TeacherReleaseSubmissions["progress"] = [
    ...release.groups.map((group) => {
      const groupSubmissions = release.submissions.filter(
        (submission) => submission.group?.id === group.id,
      );
      const completedPhaseIndexes = new Set(groupSubmissions.filter((submission) => submission.phaseIndex > 0 && submission.latestRevisionNumber > 0).map((submission) => submission.phaseIndex));
      const finalSubmitted = groupSubmissions.some((submission) => submission.phaseIndex === 0 && submission.latestRevisionNumber > 0);
      const firstIncompletePhase = Array.from({ length: phaseCount }, (_, index) => index + 1).find((phaseIndex) => !completedPhaseIndexes.has(phaseIndex));
      const complete = release.executionVersion === 0 ? finalSubmitted : completedPhaseIndexes.size === phaseCount && (submissionMode === "phased" || finalSubmitted);
      const currentPhaseIndex = release.executionVersion === 0 ? 0 : firstIncompletePhase ?? (submissionMode === "mixed" ? 0 : Math.max(1, phaseCount));
      return {
        student: { id: group.id, displayName: group.name },
        group,
        started: groupSubmissions.length > 0,
        completedPhaseCount: completedPhaseIndexes.size,
        totalPhaseCount: phaseCount,
        currentPhaseIndex,
        complete,
        awaitingFormalRevision: awaitingFormalRevision(
          groupSubmissions,
          currentPhaseIndex,
          complete,
        ),
      };
    }),
    ...release.classroom.memberships
      .filter(({ student }) => !groupedStudentIds.has(student.id))
      .map(({ student }) => {
      const studentSubmissions = release.submissions.filter(
        (submission) => submission.student?.id === student.id,
      );
      const completedPhaseIndexes = new Set(
        studentSubmissions
          .filter(
            (submission) =>
              submission.phaseIndex > 0 &&
              submission.latestRevisionNumber > 0,
          )
          .map((submission) => submission.phaseIndex),
      );
      const finalSubmitted = studentSubmissions.some(
        (submission) =>
          submission.phaseIndex === 0 &&
          submission.latestRevisionNumber > 0,
      );
      const firstIncompletePhase = Array.from(
        { length: phaseCount },
        (_, index) => index + 1,
      ).find((phaseIndex) => !completedPhaseIndexes.has(phaseIndex));
      const complete =
        release.executionVersion === 0
          ? finalSubmitted
          : completedPhaseIndexes.size === phaseCount &&
            (submissionMode === "phased" || finalSubmitted);
      const currentPhaseIndex =
        release.executionVersion === 0
          ? 0
          : firstIncompletePhase ??
            (submissionMode === "mixed" ? 0 : Math.max(1, phaseCount));

      return {
        student,
        group: null,
        started: studentSubmissions.length > 0,
        completedPhaseCount: completedPhaseIndexes.size,
        totalPhaseCount: phaseCount,
        currentPhaseIndex,
        complete,
        awaitingFormalRevision: awaitingFormalRevision(
          studentSubmissions,
          currentPhaseIndex,
          complete,
        ),
      };
    }),
  ];
  progress.sort((left, right) =>
    left.student.displayName.localeCompare(right.student.displayName),
  );

  const reviewCoverage = {
    currentRevisionCount: submissions.length,
    feedbackCount: submissions.filter(
      (submission) => submission.currentRevision.feedback !== null,
    ).length,
    evaluationCount: submissions.filter(
      (submission) => submission.currentRevision.evaluation !== null,
    ).length,
  };

  const workspace = {
    actor: { displayName: release.publisher.displayName },
    release: {
      id: release.id,
      title: content.title,
      classroomId: release.classroom.id,
      classroomName: release.classroom.name,
      status: release.status,
      publishedAt: release.publishedAt.toISOString(),
      dueAt: release.dueAt?.toISOString() ?? null,
      executionVersion: release.executionVersion,
      submissionMode,
      phaseCount,
      rubricAvailable,
    },
    submissions,
    progress,
    reviewCoverage,
  } satisfies TeacherReleaseSubmissions;

  return teacherReleaseSubmissionsSchema.parse(workspace);
}
