import "server-only";

import { createHash } from "node:crypto";
import { tool } from "ai";
import { z } from "zod";
import {
  activityContentV3Schema,
} from "../../domain/activity/activity-content";
import type { TeacherAgentPageContext } from "../../domain/assistant/teacher-agent-page-context";
import { teacherProductSurfaces } from "../../domain/assistant/teacher-product-surfaces";
import {
  changedTaskBookAreas,
  taskBookAreaSchema,
} from "../../domain/activity/task-book-areas";
import { publishDueAtSchema } from "../../domain/activity/prepare-publish-intent";
import type { PrismaClient } from "../../generated/prisma/client";
import {
  decideActionIntent,
  DecideActionIntentError,
} from "../commands/decide-action-intent";
import {
  preparePublishActivityIntent,
  PreparePublishActivityIntentError,
} from "../commands/prepare-publish-activity-intent";
import {
  publishActivityRelease,
  PublishActivityReleaseError,
} from "../commands/publish-activity-release";
import {
  saveActivityDraft,
  SaveActivityDraftError,
} from "../commands/save-activity-draft";
import type { CommandContext } from "../commands/command-context";
import type { TeacherActivityDashboard } from "../queries/teacher-activity-workspace";
import {
  teacherDraftDetailOutputSchema,
  type TeacherDraftDetailReader,
} from "./teacher-draft-detail";
import {
  releaseInsightsOutputSchema,
  type TeacherReleaseInsightsReader,
} from "./teacher-release-insights";
import {
  releaseRosterOutputSchema,
  type TeacherReleaseRosterReader,
} from "./teacher-release-roster";
import {
  getOfficialKnowledgeReference,
  officialKnowledgeCoversDiscipline,
  officialKnowledgeSectionKey,
  type OfficialKnowledgeSectionIdentity,
  officialKnowledgeReadInputSchema,
  officialKnowledgeReadOutputSchema,
  officialKnowledgeSearchInputSchema,
  officialKnowledgeSearchOutputSchema,
  readOfficialKnowledgeSection,
  searchOfficialKnowledge,
} from "../knowledge/official-corpus";

export const publishActivityToolInputSchema = z
  .object({
    draftId: z.uuid(),
    expectedDraftVersion: z.int().positive(),
    classroomId: z.uuid(),
    dueAt: publishDueAtSchema.nullable(),
  })
  .strict();

const proposalText = z.string().trim().min(1).max(600);

const taskUnderstandingSummarySchema = z
  .object({
    realWorldContext: proposalText,
    studentAction: proposalText,
    intendedOutcome: proposalText,
    evidenceAndAssessment: proposalText,
  })
  .strict();

/**
 * The model identifies a source; it does not restate it. Citation label and
 * link are server facts looked up from the same corpus the reference points
 * at, so a reference cannot be wrong about its own wording, and the proposal
 * payload stays small enough not to truncate.
 */
const activityDraftSourceReferenceSchema = z
  .object({
    sourceId: z.string().trim().min(1).max(80),
    sectionId: z.string().trim().min(1).max(120),
    reason: proposalText,
  })
  .strict();

/**
 * The L1 design proposal is intentionally a narrow, one-shot artifact. It is
 * not stored as a separate business entity: the teacher either approves this
 * exact input and creates its editable v2 draft, or rejects it without a
 * write. The content remains the sole persisted task book.
 */
/**
 * Two facts in this payload are not the model's to remember: the schema version
 * is a constant, and the integrated discipline codes are exactly the keys of the
 * contributions it already wrote. Asking for either again only creates a way to
 * be inconsistent, so both are filled in before validation.
 *
 * The derivation is authoritative, not a fallback. Keeping a list the model
 * supplied and then validating it against the contributions punished the model
 * for answering a field the instructions had already told it to leave alone —
 * and it did answer it, because a required-looking schema field almost always
 * gets filled. Measured on a real design run: asked for an activity spanning a
 * discipline outside the first-version corpus, the assistant honestly reported
 * it could cite no source for that discipline, dropped it from the
 * contributions, left it in the codes it was not supposed to write, and the
 * whole proposal was rejected. Deriving the codes makes that class of
 * disagreement impossible rather than merely detected. Every other rule about
 * these codes still runs — no repeats, never the main discipline, and each one
 * available for the school stage — and now reports against the contributions,
 * which is where the model can actually fix it.
 */
function completeDraftProposalInput(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const proposal = value as Record<string, unknown>;
  const content = proposal.content;
  if (!content || typeof content !== "object") return value;
  const draft = content as Record<string, unknown>;
  const contributions = Array.isArray(draft.disciplineContributions)
    ? draft.disciplineContributions
    : [];
  const main = typeof draft.mainDisciplineCode === "string" ? draft.mainDisciplineCode : null;
  const derivedCodes = contributions
    .map((item) =>
      item && typeof item === "object"
        ? (item as { disciplineCode?: unknown }).disciplineCode
        : undefined,
    )
    .filter((code): code is string => typeof code === "string" && code !== main);
  const codes = draft.integratedDisciplineCodes;
  return {
    ...proposal,
    content: {
      ...draft,
      schemaVersion: 3,
      // Only fall back to what the model wrote when there is nothing to derive
      // from, so a payload with no contributions fails on the contributions
      // rather than on a field the model was told not to write.
      integratedDisciplineCodes:
        derivedCodes.length > 0
          ? derivedCodes
          : Array.isArray(codes)
            ? codes
            : [],
    },
  };
}

export const activityDraftProposalSchema = z.preprocess(
  completeDraftProposalInput,
  z
  .object({
    taskUnderstandingSummary: taskUnderstandingSummarySchema,
    teacherRequirements: z.array(proposalText).min(1).max(12),
    assumptions: z.array(proposalText).max(8),
    sourceReferences: z.array(activityDraftSourceReferenceSchema).max(4),
    content: activityContentV3Schema,
  })
  .strict()
  .superRefine((proposal, context) => {
    const sourceReferenceKeys = new Set<string>();
    const activityDisciplines = new Set([
      proposal.content.mainDisciplineCode,
      ...proposal.content.integratedDisciplineCodes,
    ]);
    const coveredByOfficialCorpus = [...activityDisciplines].some((code) =>
      officialKnowledgeCoversDiscipline(code),
    );
    if (
      coveredByOfficialCorpus &&
      (proposal.sourceReferences.length < 2 ||
        new Set(proposal.sourceReferences.map((reference) => reference.sourceId))
          .size < 2)
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceReferences"],
        message:
          "Activities covered by the first official corpus require two distinct official sources",
        params: { reason: "TOO_FEW_SOURCES" },
      });
    }
    proposal.sourceReferences.forEach((reference, index) => {
      const key = `${reference.sourceId}:${reference.sectionId}`;
      if (sourceReferenceKeys.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["sourceReferences", index],
          message: "Official source references must not repeat",
          params: { reason: "SOURCE_REPEATED" },
        });
        return;
      }
      sourceReferenceKeys.add(key);
      const canonical = getOfficialKnowledgeReference(
        reference.sourceId,
        reference.sectionId,
      );
      if (!canonical) {
        context.addIssue({
          code: "custom",
          path: ["sourceReferences", index],
          message: "Official source reference must exist in the server corpus",
          params: { reason: "SOURCE_NOT_CANONICAL" },
        });
        return;
      }
      if (!canonical.schoolStages.includes(proposal.content.schoolStage)) {
        context.addIssue({
          code: "custom",
          path: ["sourceReferences", index],
          message: "Official source reference does not cover the selected stage",
          params: { reason: "SOURCE_STAGE_MISMATCH" },
        });
      }
      if (
        canonical.disciplineCodes.length > 0 &&
        !canonical.disciplineCodes.some((code) => activityDisciplines.has(code))
      ) {
        context.addIssue({
          code: "custom",
          path: ["sourceReferences", index],
          message: "Official source reference does not cover an activity discipline",
          params: { reason: "SOURCE_DISCIPLINE_MISMATCH" },
        });
      }
    });
  }),
);

export type ActivityDraftProposal = z.infer<typeof activityDraftProposalSchema>;

export const createdDraftToolOutputSchema = z
  .object({
    draftId: z.uuid(),
    version: z.int().positive(),
    status: z.literal("READY_FOR_PREVIEW"),
    editHref: z.string().regex(/^\/teacher\/activities\/[0-9a-f-]{36}$/),
    previewHref: z
      .string()
      .regex(/^\/teacher\/activities\/[0-9a-f-]{36}\/preview$/),
  })
  .strict();

export const publishActivityToolOutputSchema = z
  .object({
    releaseId: z.uuid(),
    status: z.literal("PUBLISHED"),
    publishedAt: z.iso.datetime({ offset: true }),
    releaseHref: z
      .string()
      .regex(/^\/teacher\/releases\/[0-9a-f-]{36}\/submissions$/),
  })
  .strict();

const emptyToolInputSchema = z.object({}).strict();
const teacherInternalHrefSchema = z
  .string()
  .regex(/^\/teacher(?:\/[a-z-]+)*(?:\/[0-9a-f-]{36})?(?:\/[a-z-]+)*$/);

export const currentTeacherContextOutputSchema = z
  .object({
    status: z.enum(["AVAILABLE", "UNAVAILABLE"]),
    kind: z.enum([
      "TEACHER_DASHBOARD",
      "ACTIVITY_NEW",
      "ACTIVITY_STUDIO",
      "ACTIVITY_DRAFT",
      "ACTIVITY_PREVIEW",
      "RELEASE_SUBMISSIONS",
      "SUBMISSION_REVIEW",
      "TEACHER_INSIGHTS",
      "TEACHER_KNOWLEDGE",
      "CLASSROOM_MEMBERS",
      "UNKNOWN_TEACHER_PAGE",
    ]),
    label: z.string().trim().min(1).max(240),
    href: teacherInternalHrefSchema.nullable(),
  })
  .strict();

export const teacherClassroomListOutputSchema = z
  .object({
    classrooms: z.array(
      z
        .object({
          id: z.uuid(),
          name: z.string().trim().min(1),
          currentMemberCount: z.int().nonnegative(),
          href: z
            .string()
            .regex(/^\/teacher\/classrooms\/[0-9a-f-]{36}\/members$/),
        })
        .strict(),
    ),
  })
  .strict();

export const teacherDraftListOutputSchema = z
  .object({
    drafts: z.array(
      z
        .object({
          id: z.uuid(),
          title: z.string().trim().min(1),
          status: z.enum(["EDITING", "READY_FOR_PREVIEW", "SEALED"]),
          version: z.int().positive(),
          updatedAt: z.iso.datetime({ offset: true }),
          editHref: z
            .string()
            .regex(/^\/teacher\/activities\/[0-9a-f-]{36}$/),
          previewHref: z
            .string()
            .regex(/^\/teacher\/activities\/[0-9a-f-]{36}\/preview$/),
        })
        .strict(),
    ),
  })
  .strict();

export const teacherReleaseListOutputSchema = z
  .object({
    releases: z.array(
      z
        .object({
          id: z.uuid(),
          title: z.string().trim().min(1),
          classroomName: z.string().trim().min(1),
          status: z.enum(["ACTIVE", "CLOSED", "ARCHIVED"]),
          publishedAt: z.iso.datetime({ offset: true }),
          dueAt: z.iso.datetime({ offset: true }).nullable(),
          progress: z
            .object({
              submittedCount: z.int().nonnegative(),
              cohortSize: z.int().nonnegative(),
            })
            .strict()
            .nullable(),
          attention: z
            .object({
              pendingFeedbackCount: z.int().nonnegative(),
              pendingEvaluationCount: z.int().nonnegative(),
              awaitingResubmissionCount: z.int().nonnegative(),
            })
            .strict()
            .nullable(),
          submissionsHref: z
            .string()
            .regex(/^\/teacher\/releases\/[0-9a-f-]{36}\/submissions$/)
            .nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export const activityDraftReadInputSchema = z
  .object({ draftId: z.uuid() })
  .strict();

export const releaseInsightsInputSchema = z
  .object({ releaseId: z.uuid() })
  .strict();

export const releaseRosterInputSchema = z
  .object({ releaseId: z.uuid() })
  .strict();

const revisionChangeSchema = z
  .object({
    area: taskBookAreaSchema,
    change: proposalText,
    reason: proposalText,
  })
  .strict();

/**
 * A revision proposal names the areas it touches. The server checks that claim
 * against the real difference before the teacher is asked to approve, so
 * "我只改了第二阶段" cannot quietly arrive with a rewritten rubric attached.
 */
export const activityDraftRevisionProposalSchema = z
  .object({
    draftId: z.uuid(),
    expectedVersion: z.int().positive(),
    changes: z.array(revisionChangeSchema).min(1).max(8),
    content: activityContentV3Schema,
  })
  .strict()
  .superRefine((proposal, context) => {
    const areas = proposal.changes.map((item) => item.area);
    if (new Set(areas).size !== areas.length) {
      context.addIssue({
        code: "custom",
        path: ["changes"],
        message: "Each task book area may be described at most once",
        params: { reason: "AREA_REPEATED" },
      });
    }
  });

export type ActivityDraftRevisionProposal = z.infer<
  typeof activityDraftRevisionProposalSchema
>;

export const updatedDraftToolOutputSchema = z
  .object({
    draftId: z.uuid(),
    previousVersion: z.int().positive(),
    version: z.int().positive(),
    status: z.literal("READY_FOR_PREVIEW"),
    editHref: z.string().regex(/^\/teacher\/activities\/[0-9a-f-]{36}$/),
    previewHref: z
      .string()
      .regex(/^\/teacher\/activities\/[0-9a-f-]{36}\/preview$/),
  })
  .strict();

export type CurrentTeacherContextOutput = z.infer<
  typeof currentTeacherContextOutputSchema
>;

export function mapTeacherClassroomList(
  workspace: TeacherActivityDashboard,
) {
  return teacherClassroomListOutputSchema.parse({
    classrooms: workspace.classrooms.map((classroom) => ({
      ...classroom,
      href: `/teacher/classrooms/${classroom.id}/members`,
    })),
  });
}

export function mapTeacherDraftList(workspace: TeacherActivityDashboard) {
  return teacherDraftListOutputSchema.parse({
    drafts: workspace.drafts.map((draft) => ({
      id: draft.id,
      title: draft.title,
      status: draft.status,
      version: draft.version,
      updatedAt: draft.updatedAt,
      editHref: `/teacher/activities/${draft.id}`,
      previewHref: `/teacher/activities/${draft.id}/preview`,
    })),
  });
}

export function mapTeacherReleaseList(workspace: TeacherActivityDashboard) {
  return teacherReleaseListOutputSchema.parse({
    releases: workspace.releases.map((release) => ({
      id: release.id,
      title: release.title,
      classroomName: release.classroomName,
      status: release.status,
      publishedAt: release.publishedAt,
      dueAt: release.dueAt,
      progress: release.progress,
      attention: release.attention,
      submissionsHref: release.canViewSubmissions
        ? `/teacher/releases/${release.id}/submissions`
        : null,
    })),
  });
}

export function mapCurrentTeacherContext(
  pageContext: TeacherAgentPageContext,
  workspace: TeacherActivityDashboard,
): CurrentTeacherContextOutput {
  // Labels and paths for the fixed pages come from the same catalogue the
  // instructions are generated from. Two hand-kept copies of a route is how the
  // assistant ends up naming a page that has moved.
  const fixedPage = (
    kind: Extract<
      TeacherAgentPageContext["kind"],
      | "TEACHER_DASHBOARD"
      | "ACTIVITY_NEW"
      | "ACTIVITY_STUDIO"
      | "TEACHER_INSIGHTS"
      | "TEACHER_KNOWLEDGE"
    >,
  ): CurrentTeacherContextOutput => {
    const surface = teacherProductSurfaces.find(
      (candidate) => candidate.kind === kind,
    );
    if (!surface) throw new Error("TEACHER_PRODUCT_SURFACE_MISSING");
    return {
      status: "AVAILABLE",
      kind,
      label: surface.label,
      href: surface.path,
    };
  };
  const staticContexts: Partial<
    Record<TeacherAgentPageContext["kind"], CurrentTeacherContextOutput>
  > = {
    TEACHER_DASHBOARD: fixedPage("TEACHER_DASHBOARD"),
    ACTIVITY_NEW: fixedPage("ACTIVITY_NEW"),
    ACTIVITY_STUDIO: fixedPage("ACTIVITY_STUDIO"),
    TEACHER_INSIGHTS: fixedPage("TEACHER_INSIGHTS"),
    TEACHER_KNOWLEDGE: fixedPage("TEACHER_KNOWLEDGE"),
    SUBMISSION_REVIEW: {
      status: "AVAILABLE",
      kind: "SUBMISSION_REVIEW",
      // No href: this chat is never given a submission id. The label says what
      // the page itself offers, because a teacher standing on it who asks for
      // help evaluating should be pointed at the drafters, not refused.
      label: "提交评阅台（本会话不读取学生或提交详情；反馈与评价起草按钮在该页上）",
      href: null,
    },
    UNKNOWN_TEACHER_PAGE: {
      status: "UNAVAILABLE",
      kind: "UNKNOWN_TEACHER_PAGE",
      label: "当前教师页面不在首批识别范围",
      href: null,
    },
  };
  const staticContext = staticContexts[pageContext.kind];
  if (staticContext) return currentTeacherContextOutputSchema.parse(staticContext);

  if (!("resourceId" in pageContext)) {
    return currentTeacherContextOutputSchema.parse(
      staticContexts.UNKNOWN_TEACHER_PAGE,
    );
  }

  if (
    pageContext.kind === "ACTIVITY_DRAFT" ||
    pageContext.kind === "ACTIVITY_PREVIEW"
  ) {
    const draft = workspace.drafts.find(
      (candidate) => candidate.id === pageContext.resourceId,
    );
    if (draft) {
      return currentTeacherContextOutputSchema.parse({
        status: "AVAILABLE",
        kind: pageContext.kind,
        label: `${pageContext.kind === "ACTIVITY_PREVIEW" ? "活动预览" : "活动草稿"}：${draft.title}`,
        href:
          pageContext.kind === "ACTIVITY_PREVIEW"
            ? `/teacher/activities/${draft.id}/preview`
            : `/teacher/activities/${draft.id}`,
      });
    }
  }

  if (pageContext.kind === "RELEASE_SUBMISSIONS") {
    const release = workspace.releases.find(
      (candidate) =>
        candidate.id === pageContext.resourceId &&
        candidate.canViewSubmissions,
    );
    if (release) {
      return currentTeacherContextOutputSchema.parse({
        status: "AVAILABLE",
        kind: pageContext.kind,
        label: `发布提交：${release.title}`,
        href: `/teacher/releases/${release.id}/submissions`,
      });
    }
  }

  if (pageContext.kind === "CLASSROOM_MEMBERS") {
    const classroom = workspace.classrooms.find(
      (candidate) => candidate.id === pageContext.resourceId,
    );
    if (classroom) {
      return currentTeacherContextOutputSchema.parse({
        status: "AVAILABLE",
        kind: pageContext.kind,
        label: `班级成员：${classroom.name}`,
        href: `/teacher/classrooms/${classroom.id}/members`,
      });
    }
  }

  return currentTeacherContextOutputSchema.parse({
    status: "UNAVAILABLE",
    kind: pageContext.kind,
    label: "当前页面资源不可用或你已无权查看",
    href: null,
  });
}

/**
 * Schema-only registry used to validate client-controlled UI message history
 * before an AgentRun is opened. It deliberately has no execute functions.
 */
export const activityAssistantMessageValidationTools = {
  get_current_context: tool({
    inputSchema: emptyToolInputSchema,
    outputSchema: currentTeacherContextOutputSchema,
    strict: true,
  }),
  list_my_classrooms: tool({
    inputSchema: emptyToolInputSchema,
    outputSchema: teacherClassroomListOutputSchema,
    strict: true,
  }),
  list_my_activity_drafts: tool({
    inputSchema: emptyToolInputSchema,
    outputSchema: teacherDraftListOutputSchema,
    strict: true,
  }),
  list_my_releases: tool({
    inputSchema: emptyToolInputSchema,
    outputSchema: teacherReleaseListOutputSchema,
    strict: true,
  }),
  get_activity_draft: tool({
    inputSchema: activityDraftReadInputSchema,
    outputSchema: teacherDraftDetailOutputSchema,
    strict: true,
  }),
  get_process_insights: tool({
    inputSchema: releaseInsightsInputSchema,
    outputSchema: releaseInsightsOutputSchema,
    strict: true,
  }),
  list_release_submissions: tool({
    inputSchema: releaseRosterInputSchema,
    outputSchema: releaseRosterOutputSchema,
    strict: true,
  }),
  update_activity_draft: tool({
    inputSchema: activityDraftRevisionProposalSchema,
    outputSchema: updatedDraftToolOutputSchema,
    strict: true,
  }),
  search_knowledge: tool({
    inputSchema: officialKnowledgeSearchInputSchema,
    outputSchema: officialKnowledgeSearchOutputSchema,
    strict: true,
  }),
  read_source_section: tool({
    inputSchema: officialKnowledgeReadInputSchema,
    outputSchema: officialKnowledgeReadOutputSchema,
    strict: true,
  }),
  create_activity_draft: tool({
    inputSchema: activityDraftProposalSchema,
    outputSchema: createdDraftToolOutputSchema,
    strict: true,
  }),
  publish_activity_release: tool({
    inputSchema: publishActivityToolInputSchema,
    outputSchema: publishActivityToolOutputSchema,
    strict: true,
  }),
};

type ActivityAssistantCommands = Readonly<{
  saveDraft: typeof saveActivityDraft;
  preparePublish: typeof preparePublishActivityIntent;
  decideIntent: typeof decideActionIntent;
  publishRelease: typeof publishActivityRelease;
}>;

const defaultCommands: ActivityAssistantCommands = {
  saveDraft: saveActivityDraft,
  preparePublish: preparePublishActivityIntent,
  decideIntent: decideActionIntent,
  publishRelease: publishActivityRelease,
};

export type ActivityAssistantToolDependencies = Readonly<{
  database: PrismaClient;
  agentContext: CommandContext;
  approvalContext: CommandContext;
  pageContext: TeacherAgentPageContext;
  workspace: TeacherActivityDashboard;
  readDraftDetail: TeacherDraftDetailReader;
  readReleaseInsights: TeacherReleaseInsightsReader;
  readReleaseRoster: TeacherReleaseRosterReader;
  /**
   * Draft versions the model has been shown, shared with the caller so the
   * approval gate and the tool agree on one ledger. The tools write to it.
   */
  draftReads?: Map<string, number>;
  agentRunId: string;
  onToolFailure: (failureCode: string) => void;
  onBusinessWriteSuccess: (
    result: "DRAFT_SAVED" | "DRAFT_UPDATED" | "RELEASE_PUBLISHED",
  ) => void;
  initialKnowledgeSearchResults?: readonly OfficialKnowledgeSectionIdentity[];
  initialKnowledgeReadSections?: readonly OfficialKnowledgeSectionIdentity[];
  commands?: ActivityAssistantCommands;
}>;

function idempotencyKey(
  kind: "draft" | "revise" | "prepare" | "publish",
  callId: string,
) {
  const digest = createHash("sha256").update(callId).digest("hex");
  return `assistant_${kind}_${digest.slice(0, 40)}`;
}

function stableCommandFailure(error: unknown): string {
  if (
    error instanceof SaveActivityDraftError ||
    error instanceof PreparePublishActivityIntentError ||
    error instanceof DecideActionIntentError ||
    error instanceof PublishActivityReleaseError
  ) {
    return error.code;
  }
  return "COMMAND_FAILED";
}

export function createActivityAssistantTools({
  database,
  agentContext,
  approvalContext,
  pageContext,
  workspace,
  readDraftDetail,
  readReleaseInsights,
  readReleaseRoster,
  draftReads,
  agentRunId,
  onToolFailure,
  onBusinessWriteSuccess,
  initialKnowledgeSearchResults = [],
  initialKnowledgeReadSections = [],
  commands = defaultCommands,
}: ActivityAssistantToolDependencies) {
  let createToolCallId: string | null = null;
  let updateToolCallId: string | null = null;
  // Version the model has actually seen, per draft. A revision may only be
  // proposed against a task book that was read in this same conversation.
  const readDraftVersions = draftReads ?? new Map<string, number>();
  const searchedSectionKeys = new Set(
    initialKnowledgeSearchResults.map(officialKnowledgeSectionKey),
  );
  const readSectionKeys = new Set(
    initialKnowledgeReadSections.map(officialKnowledgeSectionKey),
  );
  const proposalAfterReadingSchema = activityDraftProposalSchema.superRefine(
    (proposal, context) => {
      proposal.sourceReferences.forEach((reference, index) => {
        if (!readSectionKeys.has(officialKnowledgeSectionKey(reference))) {
          context.addIssue({
            code: "custom",
            path: ["sourceReferences", index],
            message:
              "Every official source reference must be read in the current conversation before draft creation",
            params: { reason: "SOURCE_NOT_READ" },
          });
        }
      });
    },
  );

  return {
    get_current_context: tool({
      description:
        "识别教师当前所在的白名单页面。动态资源只有在服务端确认仍属于当前教师工作区时才返回名称与站内链接；不可用时必须如实说明，不得猜测路径。",
      inputSchema: emptyToolInputSchema,
      outputSchema: currentTeacherContextOutputSchema,
      strict: true,
      execute: () => mapCurrentTeacherContext(pageContext, workspace),
    }),

    list_my_classrooms: tool({
      description:
        "列出当前教师管理的班级、当前成员人数与班级成员页链接。不返回成员姓名或其他教师的班级。",
      inputSchema: emptyToolInputSchema,
      outputSchema: teacherClassroomListOutputSchema,
      strict: true,
      execute: () => mapTeacherClassroomList(workspace),
    }),

    list_my_activity_drafts: tool({
      description:
        "列出当前教师拥有的活动草稿摘要与精确编辑、预览链接。不读取或返回草稿正文。",
      inputSchema: emptyToolInputSchema,
      outputSchema: teacherDraftListOutputSchema,
      strict: true,
      execute: () => mapTeacherDraftList(workspace),
    }),

    list_my_releases: tool({
      description:
        "列出当前教师发布的活动摘要、提交进度以及待反馈、待评价、待重交计数。只有仍管理目标班级时才返回提交页链接与待办，不返回学生或评阅详情。",
      inputSchema: emptyToolInputSchema,
      outputSchema: teacherReleaseListOutputSchema,
      strict: true,
      execute: () => mapTeacherReleaseList(workspace),
    }),

    get_activity_draft: tool({
      description:
        "读取当前教师本人某一份活动草稿的完整任务书，用于回答、诊断或改写建议。draftId 必须来自 list_my_activity_drafts 或 get_current_context 的结果，不得猜测。不属于本人工作区的草稿一律返回 NOT_FOUND；旧版快照只返回标题与链接。本工具只读，不修改草稿，也不读取学生、提交、反馈或评价数据。",
      inputSchema: activityDraftReadInputSchema,
      outputSchema: teacherDraftDetailOutputSchema,
      strict: true,
      execute: async ({ draftId }) => {
        const detail = await readDraftDetail(draftId);
        if (detail.status === "FOUND") {
          readDraftVersions.set(detail.draftId, detail.version);
        } else {
          readDraftVersions.delete(draftId);
        }
        return detail;
      },
    }),

    search_knowledge: tool({
      description:
        "检索 CDAS 首版白名单中的教育部官方 2022 年义务教育课程方案与学科课程标准。用于为活动目标、学科贡献、任务证据和评价找到可引用依据；其中不含设计理论、AI 生成案例或教师私有材料。",
      inputSchema: officialKnowledgeSearchInputSchema,
      outputSchema: officialKnowledgeSearchOutputSchema,
      strict: true,
      execute: (input) => {
        const output = searchOfficialKnowledge(input);
        output.results.forEach((result) => {
          searchedSectionKeys.add(officialKnowledgeSectionKey(result));
        });
        return output;
      },
    }),

    read_source_section: tool({
      description:
        "读取 search_knowledge 返回的一个官方来源章节原文。只能使用检索结果中的 sourceId 与 sectionId，不得猜测编号或引用未读取的材料。",
      inputSchema: officialKnowledgeReadInputSchema,
      outputSchema: officialKnowledgeReadOutputSchema,
      strict: true,
      execute: (input) => {
        const key = officialKnowledgeSectionKey(input);
        if (!searchedSectionKeys.has(key)) {
          return { status: "NOT_FOUND" as const, ...input };
        }
        const output = readOfficialKnowledgeSection(input);
        if (output.status === "FOUND") {
          readSectionKeys.add(key);
        }
        return output;
      },
    }),

    create_activity_draft: tool({
      description:
        "把教师已经说明清楚的完整跨学科任务书储存成可预览、可继续编辑的 v3 草稿。所有文字使用简体中文。content.schemaVersion 与 content.integratedDisciplineCodes 由服务端补齐，不要自己填：学科名单以你写的 disciplineContributions 为准。作业类型只用 practical、inquiry、project；practical 子类型只用 visit、simulation、observation；inquiry 子类型只用 literature、survey、experiment；project 的 assignmentSubtype 必须为 null；inquiryDepth 只有 inquiry 才填，其余必须为 null。disciplineContributions 要覆盖主学科和每个融合学科各一条，写清该学科的贡献与不可替代性；教师要求的学科即使在语料里找不到依据也要写，把缺依据讲在贡献说明里，漏写等于把这个学科从活动里删掉。learningGoals 写 2–8 条可观察目标，每条挂 1–3 条适配该学段年级的官方核心素养 competencyCode，且该学科必须在本活动已选学科之内。每条目标都必须至少被一个阶段的 learningGoalIds 承担、被一个量规维度的 learningGoalIds 评价，否则整份提案会被拒绝。阶段三到四个，证据类型只用 text、document、image、confirm。量规四到八个维度，四档描述齐全。sourceReferences 每一条都必须是本轮 read_source_section 已返回 FOUND 的章节，数量不得超过已通读章节。不能臆造缺失事实。",
      inputSchema: proposalAfterReadingSchema,
      outputSchema: createdDraftToolOutputSchema,
      strict: true,
      execute: async (proposal, { toolCallId }) => {
        if (
          proposal.sourceReferences.some(
            (reference) =>
              !readSectionKeys.has(officialKnowledgeSectionKey(reference)),
          )
        ) {
          onToolFailure("DRAFT_OFFICIAL_SOURCES_NOT_READ");
          throw new Error("ACTIVITY_DRAFT_OFFICIAL_SOURCES_NOT_READ");
        }
        if (createToolCallId !== null && createToolCallId !== toolCallId) {
          onToolFailure("DRAFT_MULTIPLE_CREATE_ATTEMPTS");
          throw new Error("ACTIVITY_DRAFT_MULTIPLE_CREATE_ATTEMPTS");
        }
        createToolCallId = toolCallId;
        try {
          const result = await commands.saveDraft(database, agentContext, {
            draftId: null,
            expectedVersion: null,
            desiredStatus: "READY_FOR_PREVIEW",
            content: proposal.content,
            agentRunId,
            idempotencyKey: idempotencyKey("draft", toolCallId),
          });
          // A resolved command means the transaction and its provenance are
          // already durable. Mark that fact before response-only mapping so a
          // later serialization defect cannot rewrite the AgentRun as failed.
          onBusinessWriteSuccess("DRAFT_SAVED");
          const output = createdDraftToolOutputSchema.parse({
            draftId: result.draftId,
            version: result.version,
            status: result.status,
            editHref: `/teacher/activities/${result.draftId}`,
            previewHref: `/teacher/activities/${result.draftId}/preview`,
          });
          return output;
        } catch (error) {
          const code = stableCommandFailure(error);
          onToolFailure(`DRAFT_${code}`);
          throw new Error(`ACTIVITY_DRAFT_${code}`);
        }
      },
    }),

    get_process_insights: tool({
      description:
        "读取当前教师某一次发布的过程诊断：各阶段有多少对象、冻结量规各维度的档位分布与最弱维度、以及重交后评价上升/持平/下降的计数。releaseId 必须来自 list_my_releases 的结果。只返回人数与计数，不含任何学生、小组、提交、证据、反馈或评价正文，因此无法也不应据此判断某个学生。",
      inputSchema: releaseInsightsInputSchema,
      outputSchema: releaseInsightsOutputSchema,
      strict: true,
      execute: ({ releaseId }) => readReleaseInsights(releaseId),
    }),

    list_release_submissions: tool({
      description:
        "读取当前教师某一次发布的提交名册，用于回答「哪几个需要我先看」。releaseId 必须来自 list_my_releases 的结果。每个对象只用匿名序号 objectOrdinal 呈现（配合 objectKind 说成「对象 n」或「小组 n」），学生姓名与小组名都不会提供、也不存在于结果中，你无从得知也不得猜测；序号只在本次结果内有效，跨轮不得沿用。返回每个对象的阶段位置、是否已正式提交、各次正式提交的修订号、迟交、反馈与评价状态、跟进状态和精确的评阅链接。最多列 60 个对象，truncated 为真时必须如实说明只列出了前 60 个。名册状态只是「谁需要教师优先看」的工作信号，不得据此对任何学生的能力、态度或表现下结论，也不得推断原因或排名次；要看具体情况请教师点开链接。",
      inputSchema: releaseRosterInputSchema,
      outputSchema: releaseRosterOutputSchema,
      strict: true,
      execute: ({ releaseId }) => readReleaseRoster(releaseId),
    }),

    update_activity_draft: tool({
      description:
        "把教师要求的修改写成这份已有草稿的新版本。只能改写本人的、未封存的草稿，且必须先用 get_activity_draft 读过同一版本。content 必须是改写后的完整 schema v3 任务书，不是片段；未被要求改动的部分必须逐字保留教师原文。changes 必须如实列出你改动的每一个区域及理由；服务端会把它与真实差异逐一核对，谎报或漏报会直接失败。此操作会暂停并展示你声明的改动，只有教师明确确认后才写入，且原版本作为历史修订保留。",
      inputSchema: activityDraftRevisionProposalSchema,
      outputSchema: updatedDraftToolOutputSchema,
      strict: true,
      execute: async (proposal, { toolCallId }) => {
        if (updateToolCallId !== null && updateToolCallId !== toolCallId) {
          onToolFailure("REVISE_MULTIPLE_UPDATE_ATTEMPTS");
          throw new Error("ACTIVITY_REVISE_MULTIPLE_UPDATE_ATTEMPTS");
        }
        updateToolCallId = toolCallId;

        const readVersion = readDraftVersions.get(proposal.draftId);
        if (readVersion === undefined) {
          onToolFailure("REVISE_DRAFT_NOT_READ");
          throw new Error("ACTIVITY_REVISE_DRAFT_NOT_READ");
        }
        if (readVersion !== proposal.expectedVersion) {
          onToolFailure("REVISE_STALE_READ");
          throw new Error("ACTIVITY_REVISE_STALE_READ");
        }

        // Re-read rather than trusting the conversation: the current task book
        // is both the base of the diff and the proof that authorization still
        // holds at execution time, not only when the model read it.
        const current = await readDraftDetail(proposal.draftId);
        if (current.status !== "FOUND") {
          onToolFailure("REVISE_DRAFT_UNAVAILABLE");
          throw new Error("ACTIVITY_REVISE_DRAFT_UNAVAILABLE");
        }
        if (current.version !== proposal.expectedVersion) {
          onToolFailure("REVISE_STALE_READ");
          throw new Error("ACTIVITY_REVISE_STALE_READ");
        }

        const actuallyChanged = changedTaskBookAreas(
          current.content,
          proposal.content,
        );
        if (actuallyChanged.length === 0) {
          onToolFailure("REVISE_NO_CHANGE");
          throw new Error("ACTIVITY_REVISE_NO_CHANGE");
        }
        const declared = new Set(proposal.changes.map((item) => item.area));
        if (
          actuallyChanged.some((area) => !declared.has(area)) ||
          [...declared].some((area) => !actuallyChanged.includes(area))
        ) {
          onToolFailure("REVISE_UNDECLARED_CHANGE");
          throw new Error("ACTIVITY_REVISE_UNDECLARED_CHANGE");
        }

        try {
          const result = await commands.saveDraft(database, agentContext, {
            draftId: proposal.draftId,
            expectedVersion: proposal.expectedVersion,
            desiredStatus: "READY_FOR_PREVIEW",
            content: proposal.content,
            agentRunId,
            idempotencyKey: idempotencyKey("revise", toolCallId),
          });
          onBusinessWriteSuccess("DRAFT_UPDATED");
          // The stored task book moved on; a later revision in the same
          // conversation must read the new version before it may propose one.
          readDraftVersions.set(proposal.draftId, result.version);
          return updatedDraftToolOutputSchema.parse({
            draftId: result.draftId,
            previousVersion: proposal.expectedVersion,
            version: result.version,
            status: result.status,
            editHref: `/teacher/activities/${result.draftId}`,
            previewHref: `/teacher/activities/${result.draftId}/preview`,
          });
        } catch (error) {
          const code = stableCommandFailure(error);
          onToolFailure(`REVISE_${code}`);
          throw new Error(`ACTIVITY_REVISE_${code}`);
        }
      },
    }),

    publish_activity_release: tool({
      description:
        "发布一个已处于可预览状态的活动草稿。此操作会先暂停并展示精确参数，只有目前教师明确批准后才会执行。",
      inputSchema: publishActivityToolInputSchema,
      outputSchema: publishActivityToolOutputSchema,
      strict: true,
      execute: async (input, { toolCallId }) => {
        try {
          // The AI SDK verifies the signed user approval before entering this
          // function. ActionIntent remains the business trust boundary: exact
          // parameters are prepared, decided by a trusted UI context, and only
          // then consumed by the publish command.
          const prepared = await commands.preparePublish(
            database,
            agentContext,
            {
              ...input,
              agentRunId,
              idempotencyKey: idempotencyKey("prepare", toolCallId),
            },
          );
          try {
            await commands.decideIntent(database, approvalContext, {
              actionIntentId: prepared.actionIntentId,
              decision: "CONFIRM",
            });
          } catch (error) {
            // Match the established first-party UI retry behavior. Only an
            // already-decided intent proceeds; publishActivityRelease then
            // proves it was CONFIRMED by this actor and still matches the
            // exact persisted parameters. Rejected/expired/foreign intents
            // therefore still fail closed.
            if (
              !(error instanceof DecideActionIntentError) ||
              error.code !== "ALREADY_DECIDED"
            ) {
              throw error;
            }
          }
          const release = await commands.publishRelease(
            database,
            agentContext,
            {
              actionIntentId: prepared.actionIntentId,
              idempotencyKey: idempotencyKey("publish", toolCallId),
            },
          );
          // The Release is immutable and committed when the shared command
          // resolves. Response mapping is not part of that business commit.
          onBusinessWriteSuccess("RELEASE_PUBLISHED");
          const output = publishActivityToolOutputSchema.parse({
            releaseId: release.releaseId,
            status: "PUBLISHED",
            publishedAt: release.publishedAt,
            releaseHref: `/teacher/releases/${release.releaseId}/submissions`,
          });
          return output;
        } catch (error) {
          const code = stableCommandFailure(error);
          onToolFailure(`PUBLISH_${code}`);
          throw new Error(`ACTIVITY_PUBLISH_${code}`);
        }
      },
    }),
  };
}

export type ActivityAssistantTools = ReturnType<
  typeof createActivityAssistantTools
>;
