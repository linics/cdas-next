import "server-only";

import { createHash } from "node:crypto";
import { tool } from "ai";
import { z } from "zod";
import {
  activityContentV2Schema,
  type DisciplineCode,
} from "../../domain/activity/activity-content";
import type { TeacherAgentPageContext } from "../../domain/assistant/teacher-agent-page-context";
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
  getOfficialKnowledgeReference,
  officialKnowledgeSectionKey,
  type OfficialKnowledgeSectionIdentity,
  officialKnowledgeReadInputSchema,
  officialKnowledgeReadOutputSchema,
  officialKnowledgeReferenceSchema,
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
const firstCorpusDisciplineCodes = new Set<DisciplineCode>([
  "chinese",
  "math",
  "physics",
  "infoTech",
]);

const taskUnderstandingSummarySchema = z
  .object({
    realWorldContext: proposalText,
    studentAction: proposalText,
    intendedOutcome: proposalText,
    evidenceAndAssessment: proposalText,
  })
  .strict();

const integratedDisciplineContributionSchema = z
  .object({
    disciplineCode: z.string().trim().min(1).max(40),
    necessaryContribution: proposalText,
  })
  .strict();

const alignmentChainSchema = z
  .object({
    objectiveKind: z.enum(["knowledge", "process", "emotion"]),
    objective: proposalText,
    task: proposalText,
    evidence: proposalText,
    assessment: proposalText,
  })
  .strict();

/**
 * The L1 design proposal is intentionally a narrow, one-shot artifact. It is
 * not stored as a separate business entity: the teacher either approves this
 * exact input and creates its editable v2 draft, or rejects it without a
 * write. The content remains the sole persisted task book.
 */
export const activityDraftProposalSchema = z
  .object({
    taskUnderstandingSummary: taskUnderstandingSummarySchema,
    teacherRequirements: z.array(proposalText).min(1).max(12),
    assumptions: z.array(proposalText).max(8),
    integratedDisciplineContributions: z
      .array(integratedDisciplineContributionSchema)
      .min(1)
      .max(14),
    alignmentChains: z.array(alignmentChainSchema).length(3),
    sourceReferences: z.array(officialKnowledgeReferenceSchema).max(8),
    content: activityContentV2Schema,
  })
  .strict()
  .superRefine((proposal, context) => {
    const expectedDisciplines = new Set(proposal.content.integratedDisciplineCodes);
    const suppliedDisciplines = proposal.integratedDisciplineContributions.map(
      (item) => item.disciplineCode,
    );
    const suppliedSet = new Set(suppliedDisciplines);
    if (
      suppliedSet.size !== suppliedDisciplines.length ||
      suppliedSet.size !== expectedDisciplines.size ||
      [...expectedDisciplines].some((code) => !suppliedSet.has(code))
    ) {
      context.addIssue({
        code: "custom",
        path: ["integratedDisciplineContributions"],
        message:
          "Integrated discipline contributions must cover each integrated discipline exactly once",
      });
    }

    const kinds = proposal.alignmentChains.map((chain) => chain.objectiveKind);
    if (
      new Set(kinds).size !== 3 ||
      !["knowledge", "process", "emotion"].every((kind) =>
        kinds.includes(kind as (typeof kinds)[number]),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["alignmentChains"],
        message:
          "Alignment chains must contain knowledge, process, and emotion exactly once",
      });
    }

    const sourceReferenceKeys = new Set<string>();
    const activityDisciplines = new Set([
      proposal.content.mainDisciplineCode,
      ...proposal.content.integratedDisciplineCodes,
    ]);
    const coveredByFirstCorpus = [...activityDisciplines].some((code) =>
      firstCorpusDisciplineCodes.has(code),
    );
    if (
      coveredByFirstCorpus &&
      (proposal.sourceReferences.length < 2 ||
        new Set(proposal.sourceReferences.map((reference) => reference.sourceId))
          .size < 2)
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceReferences"],
        message:
          "Activities covered by the first official corpus require two distinct official sources",
      });
    }
    proposal.sourceReferences.forEach((reference, index) => {
      const key = `${reference.sourceId}:${reference.sectionId}`;
      if (sourceReferenceKeys.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["sourceReferences", index],
          message: "Official source references must not repeat",
        });
        return;
      }
      sourceReferenceKeys.add(key);
      const canonical = getOfficialKnowledgeReference(
        reference.sourceId,
        reference.sectionId,
      );
      if (
        !canonical ||
        canonical.citationLabel !== reference.citationLabel ||
        canonical.href !== reference.href
      ) {
        context.addIssue({
          code: "custom",
          path: ["sourceReferences", index],
          message: "Official source reference must match the server corpus",
        });
        return;
      }
      if (!canonical.schoolStages.includes(proposal.content.schoolStage)) {
        context.addIssue({
          code: "custom",
          path: ["sourceReferences", index],
          message: "Official source reference does not cover the selected stage",
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
        });
      }
    });
  });

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
  const staticContexts: Partial<
    Record<TeacherAgentPageContext["kind"], CurrentTeacherContextOutput>
  > = {
    TEACHER_DASHBOARD: {
      status: "AVAILABLE",
      kind: "TEACHER_DASHBOARD",
      label: "教师工作台",
      href: "/teacher",
    },
    ACTIVITY_NEW: {
      status: "AVAILABLE",
      kind: "ACTIVITY_NEW",
      label: "新建学习活动",
      href: "/teacher/activities/new",
    },
    TEACHER_INSIGHTS: {
      status: "AVAILABLE",
      kind: "TEACHER_INSIGHTS",
      label: "过程诊断",
      href: "/teacher/insights",
    },
    TEACHER_KNOWLEDGE: {
      status: "AVAILABLE",
      kind: "TEACHER_KNOWLEDGE",
      label: "课程依据",
      href: "/teacher/knowledge",
    },
    SUBMISSION_REVIEW: {
      status: "AVAILABLE",
      kind: "SUBMISSION_REVIEW",
      label: "提交评阅页（本批不读取学生或提交详情）",
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
  agentRunId: string;
  onToolFailure: (failureCode: string) => void;
  onBusinessWriteSuccess: (
    result: "DRAFT_SAVED" | "RELEASE_PUBLISHED",
  ) => void;
  initialKnowledgeSearchResults?: readonly OfficialKnowledgeSectionIdentity[];
  initialKnowledgeReadSections?: readonly OfficialKnowledgeSectionIdentity[];
  commands?: ActivityAssistantCommands;
}>;

function idempotencyKey(kind: "draft" | "prepare" | "publish", callId: string) {
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
  agentRunId,
  onToolFailure,
  onBusinessWriteSuccess,
  initialKnowledgeSearchResults = [],
  initialKnowledgeReadSections = [],
  commands = defaultCommands,
}: ActivityAssistantToolDependencies) {
  let createToolCallId: string | null = null;
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
        "把教师已经说明清楚的完整跨学科任务书储存成可预览、可继续编辑的活动草稿。所有文字使用简体中文。content.schemaVersion 必须是数字 2。作业类型只用 practical、inquiry、project；practical 子类型只用 visit、simulation、observation；inquiry 子类型只用 literature、survey、experiment；project 的 assignmentSubtype 必须为 null。融合学科贡献必须与 content.integratedDisciplineCodes 恰好一一对应，且不得包含主学科。sourceReferences 每一条都必须是本轮 read_source_section 已返回 FOUND 的章节，数量不得超过已通读章节。必须包含三维目标、三至四个连续阶段、类型化证据及四档量规，不能臆造缺失事实。",
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
