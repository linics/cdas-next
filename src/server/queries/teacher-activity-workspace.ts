import "server-only";

import { z } from "zod";
import {
  activityContentSchema,
  type ActivityContent,
} from "../../domain/activity/activity-content";
import {
  hashPublishRequest,
  publishRequestSchema,
} from "../../domain/activity/prepare-publish-intent";
import type { PrismaClient } from "../../generated/prisma/client";
import { reviewFollowUp } from "../../domain/feedback/review-follow-up";
import {
  type CommandContext,
  resolveCommandContext,
} from "../commands/command-context";

const emptyInputSchema = z.object({}).strict();
const draftInputSchema = z.object({ draftId: z.uuid() }).strict();
const intentInputSchema = z.object({ actionIntentId: z.uuid() }).strict();
const isoDateSchema = z.iso.datetime({ offset: true });
const draftStatusSchema = z.enum([
  "EDITING",
  "READY_FOR_PREVIEW",
  "SEALED",
]);
const releaseStatusSchema = z.enum(["ACTIVE", "CLOSED", "ARCHIVED"]);
const intentStatusSchema = z.enum([
  "PREPARED",
  "CONFIRMED",
  "REJECTED",
  "EXECUTED",
  "EXPIRED",
]);

export const teacherIdentitySchema = z
  .object({
    displayName: z.string().trim().min(1),
  })
  .strict();

const classroomSummarySchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1),
    currentMemberCount: z.int().nonnegative(),
  })
  .strict();

export const teacherDraftSchema = z
  .object({
    id: z.uuid(),
    status: draftStatusSchema,
    version: z.int().positive(),
    updatedAt: isoDateSchema,
    sealedAt: isoDateSchema.nullable(),
    releaseId: z.uuid().nullable(),
    revision: z
      .object({
        id: z.uuid(),
        version: z.int().positive(),
        source: z.enum(["MANUAL", "AGENT", "RESTORE"]),
        createdAt: isoDateSchema,
        content: activityContentSchema,
      })
      .strict(),
  })
  .strict();

export const teacherDashboardSchema = z
  .object({
    actor: teacherIdentitySchema,
    drafts: z.array(
      z
        .object({
          id: z.uuid(),
          title: z.string().trim().min(1),
          status: draftStatusSchema,
          version: z.int().positive(),
          updatedAt: isoDateSchema,
          releaseId: z.uuid().nullable(),
        })
        .strict(),
    ),
    releases: z.array(
      z
        .object({
          id: z.uuid(),
          title: z.string().trim().min(1),
          classroomName: z.string().trim().min(1),
          status: releaseStatusSchema,
          publishedAt: isoDateSchema,
          dueAt: isoDateSchema.nullable(),
          canViewSubmissions: z.boolean(),
          progress: z
            .strictObject({
              submittedCount: z.int().nonnegative(),
              cohortSize: z.int().nonnegative(),
            })
            .nullable(),
          attention: z
            .strictObject({
              pendingFeedbackCount: z.int().nonnegative(),
              pendingEvaluationCount: z.int().nonnegative(),
              awaitingResubmissionCount: z.int().nonnegative(),
            })
            .nullable(),
        })
        .strict(),
    ),
    classrooms: z.array(classroomSummarySchema),
  })
  .strict();

export const teacherActivityPreviewSchema = z
  .object({
    actor: teacherIdentitySchema,
    draft: teacherDraftSchema,
    classrooms: z.array(classroomSummarySchema),
  })
  .strict();

export const teacherPublishConfirmationSchema = z
  .object({
    actionIntentId: z.uuid(),
    status: intentStatusSchema,
    draftId: z.uuid(),
    draftVersion: z.int().positive(),
    classroom: z
      .object({
        id: z.uuid(),
        name: z.string().trim().min(1),
      })
      .strict(),
    dueAt: isoDateSchema.nullable(),
    payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
    expiresAt: isoDateSchema,
    content: activityContentSchema,
  })
  .strict();

export type TeacherIdentity = z.infer<typeof teacherIdentitySchema>;
export type TeacherActivityDraft = z.infer<typeof teacherDraftSchema>;
export type TeacherActivityDashboard = z.infer<
  typeof teacherDashboardSchema
>;
export type TeacherActivityPreview = z.infer<
  typeof teacherActivityPreviewSchema
>;
export type TeacherPublishConfirmation = z.infer<
  typeof teacherPublishConfirmationSchema
>;

export class TeacherActivityQueryError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "WRONG_ROLE",
    public readonly actorName?: string,
  ) {
    super(code);
    this.name = "TeacherActivityQueryError";
  }
}

function contentFromColumns(value: {
  schemaVersion: number;
  taskBook: unknown;
  title: string;
  summary: string;
  learningObjectives: string[];
  taskInstructions: string;
  evidenceRequirements: string[];
  feedbackCriteria: string[];
}): ActivityContent {
  if (value.schemaVersion === 2 || value.schemaVersion === 3) {
    return activityContentSchema.parse(value.taskBook);
  }
  return activityContentSchema.parse({
    schemaVersion: 1,
    title: value.title,
    summary: value.summary,
    learningObjectives: value.learningObjectives,
    taskInstructions: value.taskInstructions,
    evidenceRequirements: value.evidenceRequirements,
    feedbackCriteria: value.feedbackCriteria,
  });
}

function isCurrentMembership(
  membership: { joinedAt: Date; endedAt: Date | null },
  now: Date,
): boolean {
  return (
    membership.joinedAt <= now &&
    (membership.endedAt === null || membership.endedAt > now)
  );
}

function releaseAttention(
  releaseId: string,
  rubricAvailable: boolean,
  submissions: ReadonlyArray<{
    latestRevisionNumber: number;
    workingCopy: { id: string } | null;
    revisions: ReadonlyArray<{
      revisionNumber: number;
      feedback: {
        version: number;
        revisions: ReadonlyArray<{
          version: number;
          nextStep: "CONTINUE" | "REVISE" | null;
        }>;
      } | null;
      evaluation: { id: string } | null;
    }>;
  }>,
): {
  pendingFeedbackCount: number;
  pendingEvaluationCount: number;
  awaitingResubmissionCount: number;
} {
  const current = submissions.filter(
    (submission) => submission.latestRevisionNumber > 0,
  );
  let pendingFeedbackCount = 0;
  let pendingEvaluationCount = 0;
  let awaitingResubmissionCount = 0;
  for (const submission of current) {
    const revision = submission.revisions[0];
    if (
      !revision ||
      revision.revisionNumber !== submission.latestRevisionNumber
    ) {
      throw new Error(
        `Release ${releaseId} has a submission without an exact current formal revision`,
      );
    }
    const currentFeedback = revision.feedback;
    const currentFeedbackRevision = currentFeedback?.revisions[0];
    if (
      currentFeedback &&
      (!currentFeedbackRevision ||
        currentFeedbackRevision.version !== currentFeedback.version)
    ) {
      throw new Error(
        `Release ${releaseId} has a submission without an exact current feedback revision`,
      );
    }
    if (!currentFeedback) {
      pendingFeedbackCount += 1;
    }
    if (rubricAvailable && !revision.evaluation) {
      pendingEvaluationCount += 1;
    }
    if (
      reviewFollowUp({
        nextStep: currentFeedbackRevision?.nextStep,
        hasWorkingCopy: submission.workingCopy !== null,
      }) === "AWAITING_RESUBMISSION"
    ) {
      awaitingResubmissionCount += 1;
    }
  }
  return {
    pendingFeedbackCount,
    pendingEvaluationCount,
    awaitingResubmissionCount,
  };
}

async function requireTeacher(
  database: PrismaClient,
  actorId: string,
  wrongRoleCode: "NOT_FOUND" | "WRONG_ROLE" = "NOT_FOUND",
): Promise<TeacherIdentity> {
  const actor = await database.appUser.findUnique({
    where: { id: actorId },
    select: { role: true, displayName: true },
  });
  if (!actor) {
    throw new TeacherActivityQueryError("NOT_FOUND");
  }
  if (actor.role !== "TEACHER") {
    throw new TeacherActivityQueryError(
      wrongRoleCode,
      wrongRoleCode === "WRONG_ROLE" ? actor.displayName : undefined,
    );
  }
  return teacherIdentitySchema.parse({ displayName: actor.displayName });
}

export async function getTeacherIdentity(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: unknown,
): Promise<TeacherIdentity> {
  emptyInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  return requireTeacher(database, context.actorId);
}

export async function getTeacherActivityDashboard(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: unknown,
): Promise<TeacherActivityDashboard> {
  emptyInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI", "AGENT"]);
  const actor = await requireTeacher(
    database,
    context.actorId,
    "WRONG_ROLE",
  );
  const [drafts, releases, classrooms] = await Promise.all([
    database.activityDraft.findMany({
      where: { ownerId: context.actorId },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      select: {
        schemaVersion: true,
        taskBook: true,
        id: true,
        title: true,
        status: true,
        version: true,
        updatedAt: true,
        release: { select: { id: true } },
      },
    }),
    database.activityRelease.findMany({
      where: { publisherId: context.actorId },
      orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        status: true,
        publishedAt: true,
        dueAt: true,
        classroom: {
          select: {
            name: true,
            managerId: true,
            memberships: { select: { joinedAt: true, endedAt: true } },
          },
        },
        snapshot: { select: { content: true } },
        submissions: {
          select: {
            studentId: true,
            groupId: true,
            latestRevisionNumber: true,
            workingCopy: { select: { id: true } },
            revisions: {
              orderBy: { revisionNumber: "desc" },
              take: 1,
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
                evaluation: { select: { id: true } },
              },
            },
          },
        },
      },
    }),
    database.classroom.findMany({
      where: { managerId: context.actorId },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        memberships: { select: { joinedAt: true, endedAt: true } },
      },
    }),
  ]);

  return teacherDashboardSchema.parse({
    actor,
    drafts: drafts.map((draft) => ({
      id: draft.id,
      title: draft.title,
      status: draft.status,
      version: draft.version,
      updatedAt: draft.updatedAt.toISOString(),
      releaseId: draft.release?.id ?? null,
    })),
    releases: releases.map((release) => {
      if (!release.snapshot) {
        throw new Error(`Release ${release.id} has no immutable snapshot`);
      }
      const content = activityContentSchema.parse(release.snapshot.content);
      const canViewSubmissions =
        release.classroom.managerId === context.actorId;
      return {
        id: release.id,
        title: content.title,
        classroomName: release.classroom.name,
        status: release.status,
        publishedAt: release.publishedAt.toISOString(),
        dueAt: release.dueAt?.toISOString() ?? null,
        canViewSubmissions,
        progress: canViewSubmissions
          ? {
              // 分阶段活动里同一个学生每个阶段各有一行提交，直接数行会把
              // 「4 人的班」算成「7 份已提交」。按提交主体（学生或小组）去重。
              submittedCount: new Set(
                release.submissions
                  .filter((submission) => submission.latestRevisionNumber > 0)
                  .map(
                    (submission) =>
                      submission.groupId ?? submission.studentId ?? "",
                  ),
              ).size,
              cohortSize: release.classroom.memberships.filter((membership) =>
                isCurrentMembership(membership, context.now),
              ).length,
            }
          : null,
        attention: canViewSubmissions
          ? releaseAttention(
              release.id,
              content.schemaVersion === 2 || content.schemaVersion === 3,
              release.submissions,
            )
          : null,
      };
    }),
    classrooms: classrooms.map((classroom) => ({
      id: classroom.id,
      name: classroom.name,
      currentMemberCount: classroom.memberships.filter((membership) =>
        isCurrentMembership(membership, context.now),
      ).length,
    })),
  });
}

/**
 * The teacher draft page and the global Agent read the same owned draft
 * through this one query. AGENT is allowed as a source, but ownership is
 * still proved here on every call: a draft owned by another teacher stays
 * resource-level absent regardless of who asks.
 */
export async function getTeacherActivityDraft(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: unknown,
): Promise<{ actor: TeacherIdentity; draft: TeacherActivityDraft }> {
  const input = draftInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI", "AGENT"]);
  const [actor, draft] = await Promise.all([
    requireTeacher(database, context.actorId),
    database.activityDraft.findUnique({
      where: { id: input.draftId },
      select: {
        id: true,
        ownerId: true,
        status: true,
        version: true,
        updatedAt: true,
        sealedAt: true,
        release: { select: { id: true } },
        revisions: {
          orderBy: { version: "desc" },
          take: 1,
          select: {
            schemaVersion: true,
            taskBook: true,
            id: true,
            version: true,
            source: true,
            title: true,
            summary: true,
            learningObjectives: true,
            taskInstructions: true,
            evidenceRequirements: true,
            feedbackCriteria: true,
            createdAt: true,
          },
        },
      },
    }),
  ]);

  if (!draft || draft.ownerId !== context.actorId) {
    throw new TeacherActivityQueryError("NOT_FOUND");
  }
  const revision = draft.revisions[0];
  if (!revision || revision.version !== draft.version) {
    throw new Error(`Draft ${draft.id} has no exact current revision`);
  }

  const content = contentFromColumns(revision);
  return {
    actor,
    draft: teacherDraftSchema.parse({
      id: draft.id,
      status: draft.status,
      version: draft.version,
      updatedAt: draft.updatedAt.toISOString(),
      sealedAt: draft.sealedAt?.toISOString() ?? null,
      releaseId: draft.release?.id ?? null,
      revision: {
        id: revision.id,
        version: revision.version,
        source: revision.source,
        createdAt: revision.createdAt.toISOString(),
        content,
      },
    }),
  };
}

export async function getTeacherActivityPreview(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: unknown,
): Promise<TeacherActivityPreview> {
  const input = draftInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const [{ actor, draft }, classrooms] = await Promise.all([
    getTeacherActivityDraft(database, commandContext, input),
    database.classroom.findMany({
      where: { managerId: context.actorId },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        memberships: { select: { joinedAt: true, endedAt: true } },
      },
    }),
  ]);

  return teacherActivityPreviewSchema.parse({
    actor,
    draft,
    classrooms: classrooms.map((classroom) => ({
      id: classroom.id,
      name: classroom.name,
      currentMemberCount: classroom.memberships.filter((membership) =>
        isCurrentMembership(membership, context.now),
      ).length,
    })),
  });
}

export async function getTeacherPublishConfirmation(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: unknown,
): Promise<TeacherPublishConfirmation> {
  const input = intentInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const [actor, intent] = await Promise.all([
    requireTeacher(database, context.actorId),
    database.actionIntent.findUnique({
      where: { id: input.actionIntentId },
      select: {
        id: true,
        actorId: true,
        actionName: true,
        payload: true,
        payloadHash: true,
        targetType: true,
        targetId: true,
        expectedVersion: true,
        status: true,
        expiresAt: true,
      },
    }),
  ]);
  void actor;

  if (!intent || intent.actorId !== context.actorId) {
    throw new TeacherActivityQueryError("NOT_FOUND");
  }

  const payload = publishRequestSchema.safeParse(intent.payload);
  if (
    !payload.success ||
    intent.actionName !== "publish_activity_release" ||
    intent.targetType !== "ActivityDraft" ||
    intent.targetId !== payload.data.draftId ||
    intent.expectedVersion !== payload.data.expectedDraftVersion ||
    hashPublishRequest(payload.data) !== intent.payloadHash
  ) {
    throw new TeacherActivityQueryError("NOT_FOUND");
  }

  const [draft, revision, classroom] = await Promise.all([
    database.activityDraft.findUnique({
      where: { id: payload.data.draftId },
      select: { ownerId: true },
    }),
    database.activityDraftRevision.findUnique({
      where: {
        draftId_version: {
          draftId: payload.data.draftId,
          version: payload.data.expectedDraftVersion,
        },
      },
      select: {
        schemaVersion: true,
        taskBook: true,
        title: true,
        summary: true,
        learningObjectives: true,
        taskInstructions: true,
        evidenceRequirements: true,
        feedbackCriteria: true,
      },
    }),
    database.classroom.findUnique({
      where: { id: payload.data.classroomId },
      select: { id: true, name: true, managerId: true },
    }),
  ]);

  if (
    !draft ||
    draft.ownerId !== context.actorId ||
    !revision ||
    !classroom ||
    classroom.managerId !== context.actorId
  ) {
    throw new TeacherActivityQueryError("NOT_FOUND");
  }

  return teacherPublishConfirmationSchema.parse({
    actionIntentId: intent.id,
    status: intent.status,
    draftId: payload.data.draftId,
    draftVersion: payload.data.expectedDraftVersion,
    classroom: { id: classroom.id, name: classroom.name },
    dueAt: payload.data.dueAt,
    payloadHash: intent.payloadHash,
    expiresAt: intent.expiresAt.toISOString(),
    content: contentFromColumns(revision),
  });
}
