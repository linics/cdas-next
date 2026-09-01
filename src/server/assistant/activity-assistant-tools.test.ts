import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityContentV3 } from "../../domain/activity/activity-content";
import type { PrismaClient } from "../../generated/prisma/client";
import { DecideActionIntentError } from "../commands/decide-action-intent";
import { PreparePublishActivityIntentError } from "../commands/prepare-publish-activity-intent";
import { SaveActivityDraftError } from "../commands/save-activity-draft";
import type { CommandContext } from "../commands/command-context";
import { searchOfficialKnowledge } from "../knowledge/official-corpus";
import {
  activityDraftProposalSchema,
  createActivityAssistantTools,
  mapCurrentTeacherContext,
  type ActivityDraftProposal,
} from "./activity-assistant-tools";
import type { TeacherActivityDashboard } from "../queries/teacher-activity-workspace";

vi.mock("server-only", () => ({}));

const actorId = "10000000-0000-4000-8000-000000000001";
const runId = "20000000-0000-4000-8000-000000000002";
const draftId = "30000000-0000-4000-8000-000000000003";
const classroomId = "40000000-0000-4000-8000-000000000004";
const intentId = "50000000-0000-4000-8000-000000000005";
const releaseId = "60000000-0000-4000-8000-000000000006";
const revisionId = "70000000-0000-4000-8000-000000000007";
const now = new Date("2026-08-20T04:00:00.000Z");
const workspace: TeacherActivityDashboard = {
  actor: { displayName: "林老师" },
  classrooms: [
    { id: classroomId, name: "七年一班", currentMemberCount: 28 },
  ],
  drafts: [
    {
      id: draftId,
      title: "校园节水行动",
      status: "READY_FOR_PREVIEW",
      version: 3,
      updatedAt: now.toISOString(),
      releaseId: null,
    },
  ],
  releases: [
    {
      id: releaseId,
      title: "校园节水行动",
      classroomName: "七年一班",
      status: "ACTIVE",
      publishedAt: now.toISOString(),
      dueAt: null,
      canViewSubmissions: true,
      progress: { submittedCount: 10, cohortSize: 28 },
      attention: {
        pendingFeedbackCount: 2,
        pendingEvaluationCount: 3,
        awaitingResubmissionCount: 1,
      },
    },
  ],
};

const agentContext: CommandContext = {
  actorId,
  source: "AGENT",
  traceId: "agent-tool-trace",
  clock: () => now,
};
const approvalContext: CommandContext = {
  actorId,
  source: "UI",
  traceId: "approval-tool-trace",
  clock: () => now,
};
const content: ActivityContentV3 = {
  schemaVersion: 3,
  title: "校園節水行動",
  topic: "校園節水",
  summary: "記錄水表並提出改善建議",
  schoolStage: "MIDDLE",
  grade: 7,
  mainDisciplineCode: "physics",
  integratedDisciplineCodes: ["math"],
  disciplineContributions: [
    { disciplineCode: "physics", contribution: "解釋用水裝置與流量。", necessity: "沒有物理解釋，建議說不清機理。" },
    { disciplineCode: "math", contribution: "整理與比較水表讀數。", necessity: "沒有數據分析，判斷無法核驗。" },
  ],
  assignmentType: "inquiry",
  assignmentSubtype: "survey",
  inquiryDepth: "intermediate",
  submissionMode: "once",
  durationWeeks: 2,
  backgroundSetting: "學校要改善用水，同學們以真實場景完成調查。",
  taskInstructions: "記錄兩次水表讀數並解釋差異。",
  learningGoals: [
    {
      id: "goal-physics",
      description: "能說明一個用水問題及其可能機理。",
      competencyReferences: [
        { disciplineCode: "physics", competencyCode: "physical_concept" },
      ],
    },
    {
      id: "goal-math",
      description: "能整理並解釋調查數據以支持判斷。",
      competencyReferences: [
        { disciplineCode: "math", competencyCode: "data_concept" },
      ],
    },
  ],
  phases: [
    { name: "觀察", action: "記錄用水。", context: "在校園觀察。", support: "使用記錄表。", learningGoalIds: ["goal-physics"], evidence: [{ type: "text", description: "時間與讀數" }], evaluationFocus: "資料完整。", suggestedLessons: 1 },
    { name: "分析", action: "整理資料。", context: "比較讀數。", support: "使用表格。", learningGoalIds: ["goal-math"], evidence: [{ type: "document", description: "分析表" }], evaluationFocus: "結論有據。", suggestedLessons: 1 },
    { name: "建議", action: "提出建議。", context: "面向校園。", support: "使用建議模板。", learningGoalIds: ["goal-physics", "goal-math"], evidence: [{ type: "text", description: "建議稿" }], evaluationFocus: "方案可行。", suggestedLessons: 1 },
  ],
  rubricDimensions: [
    { name: "問題意識", excellent: "清楚", good: "較清楚", pass: "基本", improve: "需補充", learningGoalIds: ["goal-physics"] },
    { name: "證據品質", excellent: "完整", good: "較完整", pass: "基本", improve: "需補充", learningGoalIds: ["goal-math"] },
    { name: "跨學科連結", excellent: "清楚", good: "較清楚", pass: "基本", improve: "需補充", learningGoalIds: ["goal-physics", "goal-math"] },
    { name: "方案表達", excellent: "可行", good: "較可行", pass: "基本", improve: "需補充", learningGoalIds: ["goal-math"] },
  ],
};

const proposal: ActivityDraftProposal = {
  taskUnderstandingSummary: {
    realWorldContext: "校園需要改善用水。",
    studentAction: "記錄水表並整理資料。",
    intendedOutcome: "提出有證據的節水建議。",
    evidenceAndAssessment: "以讀數、分析表與建議稿判斷。",
  },
  teacherRequirements: ["七年級", "校園節水", "記錄兩次水表讀數"],
  assumptions: [],
  sourceReferences: searchOfficialKnowledge({
    query: "初中跨学科实践 数据分析 评价",
    schoolStage: "MIDDLE",
    disciplineCodes: ["physics", "math"],
    limit: 8,
  }).results
    .filter(
      (result, index, results) =>
        results.findIndex((item) => item.sourceId === result.sourceId) === index,
    )
    .slice(0, 2)
    .map((result) => ({
      sourceId: result.sourceId,
      sectionId: result.sectionId,
      reason: "用于校准活动目标、证据与评价。",
    })),
  content,
};

const mocks = {
  saveDraft: vi.fn(),
  preparePublish: vi.fn(),
  decideIntent: vi.fn(),
  publishRelease: vi.fn(),
  onToolFailure: vi.fn(),
  onBusinessWriteSuccess: vi.fn(),
  readDraftDetail: vi.fn(),
  readReleaseInsights: vi.fn(),
  readReleaseRoster: vi.fn(),
};

function database(): PrismaClient {
  return { kind: "assistant-tools-database" } as unknown as PrismaClient;
}

function options(toolCallId: string) {
  return {
    toolCallId,
    messages: [],
    context: {},
  };
}

function tools({ seedReadSections = true, draftReads }: {
  seedReadSections?: boolean;
  draftReads?: Map<string, number>;
} = {}) {
  return createActivityAssistantTools({
    ...(draftReads ? { draftReads } : {}),
    database: database(),
    agentContext,
    approvalContext,
    pageContext: { kind: "ACTIVITY_DRAFT", resourceId: draftId },
    workspace,
    readDraftDetail: mocks.readDraftDetail,
    readReleaseInsights: mocks.readReleaseInsights,
    readReleaseRoster: mocks.readReleaseRoster,
    agentRunId: runId,
    onToolFailure: mocks.onToolFailure,
    onBusinessWriteSuccess: mocks.onBusinessWriteSuccess,
    ...(seedReadSections
      ? {
          initialKnowledgeSearchResults: proposal.sourceReferences,
          initialKnowledgeReadSections: proposal.sourceReferences,
        }
      : {}),
    commands: {
      saveDraft: mocks.saveDraft,
      preparePublish: mocks.preparePublish,
      decideIntent: mocks.decideIntent,
      publishRelease: mocks.publishRelease,
    },
  });
}

describe("activity assistant tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saveDraft.mockResolvedValue({
      draftId,
      revisionId,
      version: 1,
      status: "READY_FOR_PREVIEW",
      savedAt: now.toISOString(),
    });
    mocks.preparePublish.mockResolvedValue({
      actionIntentId: intentId,
      draftId,
      expectedDraftVersion: 1,
      payloadHash: "a".repeat(64),
      expiresAt: "2026-08-20T04:10:00.000Z",
    });
    mocks.decideIntent.mockResolvedValue({
      actionIntentId: intentId,
      status: "CONFIRMED",
      decidedAt: now,
    });
    mocks.publishRelease.mockResolvedValue({
      releaseId,
      snapshotHash: "b".repeat(64),
      publishedAt: now.toISOString(),
    });
  });

  it("maps current context and read-only workspace tools to canonical links", async () => {
    const registry = tools();

    expect(
      registry.get_current_context.execute!({}, options("context_call")),
    ).toEqual({
      status: "AVAILABLE",
      kind: "ACTIVITY_DRAFT",
      label: "活动草稿：校园节水行动",
      href: `/teacher/activities/${draftId}`,
    });
    expect(
      registry.list_my_classrooms.execute!({}, options("classrooms_call")),
    ).toMatchObject({
      classrooms: [
        {
          id: classroomId,
          currentMemberCount: 28,
          href: `/teacher/classrooms/${classroomId}/members`,
        },
      ],
    });
    expect(
      registry.list_my_activity_drafts.execute!({}, options("drafts_call")),
    ).toMatchObject({
      drafts: [
        {
          id: draftId,
          version: 3,
          previewHref: `/teacher/activities/${draftId}/preview`,
        },
      ],
    });
    expect(
      registry.list_my_releases.execute!({}, options("releases_call")),
    ).toMatchObject({
      releases: [
        {
          id: releaseId,
          attention: { pendingFeedbackCount: 2 },
          submissionsHref: `/teacher/releases/${releaseId}/submissions`,
        },
      ],
    });
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });

  it("reads one owned draft only through the authorized detail reader", async () => {
    mocks.readDraftDetail.mockResolvedValue({
      status: "NOT_FOUND",
      draftId: "90000000-0000-4000-8000-000000000009",
    });
    const registry = tools();

    await expect(
      registry.get_activity_draft.execute!(
        { draftId: "90000000-0000-4000-8000-000000000009" },
        options("draft_read_call"),
      ),
    ).resolves.toEqual({
      status: "NOT_FOUND",
      draftId: "90000000-0000-4000-8000-000000000009",
    });
    expect(mocks.readDraftDetail).toHaveBeenCalledWith(
      "90000000-0000-4000-8000-000000000009",
    );
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });

  it("reads a release roster only through the authorized reader", async () => {
    mocks.readReleaseRoster.mockResolvedValue({
      status: "NOT_FOUND",
      releaseId,
    });
    const registry = tools();

    await expect(
      registry.list_release_submissions.execute!(
        { releaseId },
        options("roster_call"),
      ),
    ).resolves.toEqual({ status: "NOT_FOUND", releaseId });
    expect(mocks.readReleaseRoster).toHaveBeenCalledWith(releaseId);
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });

  it("does not reflect an unauthorized dynamic page resource", () => {
    expect(
      mapCurrentTeacherContext(
        {
          kind: "ACTIVITY_DRAFT",
          resourceId: "90000000-0000-4000-8000-000000000009",
        },
        workspace,
      ),
    ).toEqual({
      status: "UNAVAILABLE",
      kind: "ACTIVITY_DRAFT",
      label: "当前页面资源不可用或你已无权查看",
      href: null,
    });
  });

  it("removes release links and attention after classroom management is lost", () => {
    const revokedWorkspace: TeacherActivityDashboard = {
      ...workspace,
      releases: workspace.releases.map((release) => ({
        ...release,
        canViewSubmissions: false,
        progress: null,
        attention: null,
      })),
    };

    expect(
      tools().list_my_releases.execute!({}, options("revoked_releases")),
    ).toMatchObject({
      releases: [
        {
          submissionsHref: `/teacher/releases/${releaseId}/submissions`,
        },
      ],
    });
    expect(
      mapCurrentTeacherContext(
        { kind: "RELEASE_SUBMISSIONS", resourceId: releaseId },
        revokedWorkspace,
      ),
    ).toMatchObject({ status: "UNAVAILABLE", href: null });
    expect(
      createActivityAssistantTools({
        database: database(),
        agentContext,
        approvalContext,
        pageContext: { kind: "TEACHER_DASHBOARD" },
        workspace: revokedWorkspace,
        readDraftDetail: mocks.readDraftDetail,
        readReleaseInsights: mocks.readReleaseInsights,
        readReleaseRoster: mocks.readReleaseRoster,
        agentRunId: runId,
        onToolFailure: mocks.onToolFailure,
        onBusinessWriteSuccess: mocks.onBusinessWriteSuccess,
        commands: {
          saveDraft: mocks.saveDraft,
          preparePublish: mocks.preparePublish,
          decideIntent: mocks.decideIntent,
          publishRelease: mocks.publishRelease,
        },
      }).list_my_releases.execute!({}, options("revoked_list")),
    ).toMatchObject({
      releases: [
        {
          attention: null,
          progress: null,
          submissionsHref: null,
        },
      ],
    });
  });

  it("requires exact integrated-discipline coverage and three unique alignment chains", () => {
    expect(activityDraftProposalSchema.safeParse(proposal).success).toBe(true);
    expect(
      activityDraftProposalSchema.safeParse({
        ...proposal,
        integratedDisciplineContributions: [],
      }).success,
    ).toBe(false);
    expect(
      activityDraftProposalSchema.safeParse({
        ...proposal,
        content: {
          ...proposal.content,
          disciplineContributions: [
            proposal.content.disciplineContributions[0]!,
            proposal.content.disciplineContributions[0]!,
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      activityDraftProposalSchema.safeParse({
        ...proposal,
        content: {
          ...proposal.content,
          phases: proposal.content.phases.map((phase) => ({
            ...phase,
            learningGoalIds: ["goal-physics"],
          })),
        },
      }).success,
    ).toBe(false);
    expect(
      activityDraftProposalSchema.safeParse({
        ...proposal,
        sourceReferences: [],
      }).success,
    ).toBe(false);
    // The model no longer supplies wording, so the fabrication that matters is
    // pointing at a section the corpus does not have.
    expect(
      activityDraftProposalSchema.safeParse({
        ...proposal,
        sourceReferences: proposal.sourceReferences.map((reference, index) =>
          index === 0
            ? { ...reference, sectionId: "invented-section-id" }
            : reference,
        ),
      }).success,
    ).toBe(false);
    expect(
      activityDraftProposalSchema.safeParse({
        ...proposal,
        sourceReferences: proposal.sourceReferences.map((reference, index) =>
          index === 0
            ? { ...reference, citationLabel: "伪造的课程标准章节" }
            : reference,
        ),
      }).success,
    ).toBe(false);
  });

  it("fills in the constants the model should not have to restate", async () => {
    const partialContent: Record<string, unknown> = { ...proposal.content };
    delete partialContent.schemaVersion;
    delete partialContent.integratedDisciplineCodes;

    const parsed = activityDraftProposalSchema.safeParse({
      ...proposal,
      content: partialContent,
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.content.schemaVersion).toBe(3);
    expect(parsed.data?.content.integratedDisciplineCodes).toEqual(
      proposal.content.disciplineContributions
        .map((item) => item.disciplineCode)
        .filter((code) => code !== proposal.content.mainDisciplineCode),
    );
  });

  it("lets the contributions decide the disciplines, whatever list the model also wrote", async () => {
    // The instructions tell the model to leave this list alone, and it writes it
    // anyway. Rejecting the proposal for that disagreement cost a whole design
    // run in practice; deriving the list instead makes the disagreement
    // impossible. The contributions are the activity's disciplines.
    const parsed = activityDraftProposalSchema.safeParse({
      ...proposal,
      content: { ...proposal.content, integratedDisciplineCodes: ["chinese"] },
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.content.integratedDisciplineCodes).toEqual(
      proposal.content.disciplineContributions
        .map((item) => item.disciplineCode)
        .filter((code) => code !== proposal.content.mainDisciplineCode),
    );
  });

  it("adds a discipline the model contributed for, rather than refusing the draft", async () => {
    const parsed = activityDraftProposalSchema.safeParse({
      ...proposal,
      content: {
        ...proposal.content,
        disciplineContributions: [
          ...proposal.content.disciplineContributions,
          { disciplineCode: "chinese", contribution: "公开表达建议。", necessity: "没有公共表达，方案无法被采纳。" },
        ],
      },
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.content.integratedDisciplineCodes).toContain("chinese");
  });

  it("keeps every other rule about those codes biting", async () => {
    // Deriving the list removes one failure mode, not the invariants. Each of
    // these now reports against the contributions, which is the field the model
    // can actually correct.
    expect(
      activityDraftProposalSchema.safeParse({
        ...proposal,
        content: {
          ...proposal.content,
          disciplineContributions: [
            ...proposal.content.disciplineContributions,
            { disciplineCode: "math", contribution: "重复的学科贡献。", necessity: "重复。" },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      activityDraftProposalSchema.safeParse({
        ...proposal,
        integratedDisciplineContributions: [
          {
            disciplineCode: proposal.content.mainDisciplineCode,
            necessaryContribution: "主学科不能同时是融合学科。",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("creates a READY draft through the shared command with AGENT provenance", async () => {
    const registry = tools();
    const result = await registry.create_activity_draft.execute!(
      proposal,
      options("draft_call_1"),
    );

    expect(mocks.saveDraft).toHaveBeenCalledWith(
      expect.anything(),
      agentContext,
      expect.objectContaining({
        draftId: null,
        expectedVersion: null,
        desiredStatus: "READY_FOR_PREVIEW",
        content,
        agentRunId: runId,
      }),
    );
    expect(result).toEqual({
      draftId,
      version: 1,
      status: "READY_FOR_PREVIEW",
      editHref: `/teacher/activities/${draftId}`,
      previewHref: `/teacher/activities/${draftId}/preview`,
    });
    expect(mocks.onBusinessWriteSuccess).toHaveBeenCalledWith("DRAFT_SAVED");
  });

  it("rejects a draft whose cited official sections were not searched and read", async () => {
    const registry = tools({ seedReadSections: false });

    await expect(
      registry.create_activity_draft.execute!(
        proposal,
        options("draft_without_reading"),
      ),
    ).rejects.toThrow("ACTIVITY_DRAFT_OFFICIAL_SOURCES_NOT_READ");

    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(mocks.onToolFailure).toHaveBeenCalledWith(
      "DRAFT_OFFICIAL_SOURCES_NOT_READ",
    );
  });

  it("only records a source read after that section appeared in search results", async () => {
    const registry = tools({ seedReadSections: false });
    const firstReference = proposal.sourceReferences[0];
    expect(firstReference).toBeDefined();
    if (!firstReference) return;

    expect(
      registry.read_source_section.execute!(
        {
          sourceId: firstReference.sourceId,
          sectionId: firstReference.sectionId,
        },
        options("read_before_search"),
      ),
    ).toMatchObject({ status: "NOT_FOUND" });

    await registry.search_knowledge.execute!(
      {
        query: "初中跨学科实践 数据分析 评价",
        schoolStage: "MIDDLE",
        disciplineCodes: ["physics", "math"],
        limit: 8,
      },
      options("search_before_read"),
    );
    expect(
      registry.read_source_section.execute!(
        {
          sourceId: firstReference.sourceId,
          sectionId: firstReference.sectionId,
        },
        options("read_after_search"),
      ),
    ).toMatchObject({ status: "FOUND" });
  });

  it("keeps a committed draft authoritative when response mapping fails", async () => {
    mocks.saveDraft.mockResolvedValue({
      draftId,
      revisionId,
      version: 0,
      status: "READY_FOR_PREVIEW",
      savedAt: now.toISOString(),
    });
    const registry = tools();

    await expect(
      registry.create_activity_draft.execute!(
        proposal,
        options("draft_call_bad_response"),
      ),
    ).rejects.toThrow("ACTIVITY_DRAFT_COMMAND_FAILED");

    expect(mocks.saveDraft).toHaveBeenCalledTimes(1);
    expect(mocks.onBusinessWriteSuccess).toHaveBeenCalledWith("DRAFT_SAVED");
    expect(mocks.onToolFailure).toHaveBeenCalledWith("DRAFT_COMMAND_FAILED");
  });

  it("allows command replay of one call but rejects a second create call", async () => {
    const registry = tools();

    await registry.create_activity_draft.execute!(
      proposal,
      options("draft_call_same"),
    );
    await registry.create_activity_draft.execute!(
      proposal,
      options("draft_call_same"),
    );
    await expect(
      registry.create_activity_draft.execute!(
        proposal,
        options("draft_call_different"),
      ),
    ).rejects.toThrow("ACTIVITY_DRAFT_MULTIPLE_CREATE_ATTEMPTS");

    expect(mocks.saveDraft).toHaveBeenCalledTimes(2);
    expect(mocks.onToolFailure).toHaveBeenCalledWith(
      "DRAFT_MULTIPLE_CREATE_ATTEMPTS",
    );
  });

  it("publishes only through prepare, first-party decision, then publish", async () => {
    const order: string[] = [];
    mocks.preparePublish.mockImplementation(async () => {
      order.push("prepare");
      return {
        actionIntentId: intentId,
        draftId,
        expectedDraftVersion: 1,
        payloadHash: "a".repeat(64),
        expiresAt: "2026-08-20T04:10:00.000Z",
      };
    });
    mocks.decideIntent.mockImplementation(async () => {
      order.push("decide");
      return { actionIntentId: intentId, status: "CONFIRMED", decidedAt: now };
    });
    mocks.publishRelease.mockImplementation(async () => {
      order.push("publish");
      return {
        releaseId,
        snapshotHash: "b".repeat(64),
        publishedAt: now.toISOString(),
      };
    });
    const registry = tools();

    await expect(
      registry.publish_activity_release.execute!(
        {
          draftId,
          expectedDraftVersion: 1,
          classroomId,
          dueAt: null,
        },
        options("publish_call_1"),
      ),
    ).resolves.toMatchObject({ releaseId, status: "PUBLISHED" });

    expect(order).toEqual(["prepare", "decide", "publish"]);
    expect(mocks.preparePublish.mock.calls[0]?.[1]).toBe(agentContext);
    expect(mocks.preparePublish.mock.calls[0]?.[2]).toMatchObject({
      agentRunId: runId,
    });
    expect(mocks.decideIntent).toHaveBeenCalledWith(
      expect.anything(),
      approvalContext,
      { actionIntentId: intentId, decision: "CONFIRM" },
    );
    expect(mocks.onBusinessWriteSuccess).toHaveBeenCalledWith(
      "RELEASE_PUBLISHED",
    );
  });

  it("keeps a committed publish authoritative when response mapping fails", async () => {
    mocks.publishRelease.mockResolvedValue({
      releaseId,
      snapshotHash: "b".repeat(64),
      publishedAt: "not-an-iso-instant",
    });
    const registry = tools();

    await expect(
      registry.publish_activity_release.execute!(
        {
          draftId,
          expectedDraftVersion: 1,
          classroomId,
          dueAt: null,
        },
        options("publish_call_bad_response"),
      ),
    ).rejects.toThrow("ACTIVITY_PUBLISH_COMMAND_FAILED");

    expect(mocks.publishRelease).toHaveBeenCalledTimes(1);
    expect(mocks.onBusinessWriteSuccess).toHaveBeenCalledWith(
      "RELEASE_PUBLISHED",
    );
    expect(mocks.onToolFailure).toHaveBeenCalledWith(
      "PUBLISH_COMMAND_FAILED",
    );
  });

  it("continues an already-confirmed retry to the idempotent publish command", async () => {
    mocks.decideIntent
      .mockResolvedValueOnce({
        actionIntentId: intentId,
        status: "CONFIRMED",
        decidedAt: now,
      })
      .mockRejectedValueOnce(new DecideActionIntentError("ALREADY_DECIDED"));
    const registry = tools();
    const input = {
      draftId,
      expectedDraftVersion: 1,
      classroomId,
      dueAt: null,
    };

    const first = await registry.publish_activity_release.execute!(
      input,
      options("publish_call_retry"),
    );
    const replay = await registry.publish_activity_release.execute!(
      input,
      options("publish_call_retry"),
    );

    expect(replay).toEqual(first);
    expect(mocks.publishRelease).toHaveBeenCalledTimes(2);
    expect(new Set(mocks.publishRelease.mock.results.map(() => releaseId))).toEqual(
      new Set([releaseId]),
    );
  });

  it.each([
    new PreparePublishActivityIntentError("NOT_FOUND"),
    new PreparePublishActivityIntentError("STALE_VERSION"),
  ])("fails before confirmation for unauthorized or version-drift input", async (error) => {
    mocks.preparePublish.mockRejectedValue(error);
    const registry = tools();

    await expect(
      registry.publish_activity_release.execute!(
        {
          draftId,
          expectedDraftVersion: 1,
          classroomId,
          dueAt: null,
        },
        options("publish_call_denied"),
      ),
    ).rejects.toThrow(`ACTIVITY_PUBLISH_${error.code}`);
    expect(mocks.decideIntent).not.toHaveBeenCalled();
    expect(mocks.publishRelease).not.toHaveBeenCalled();
  });
});

const currentDraftDetail = {
  status: "FOUND" as const,
  draftId,
  draftStatus: "READY_FOR_PREVIEW" as const,
  version: 3,
  updatedAt: now.toISOString(),
  published: false,
  editHref: `/teacher/activities/${draftId}`,
  previewHref: `/teacher/activities/${draftId}/preview`,
  content,
};

function revisedPhases() {
  return content.phases.map((phase, index) =>
    index === 1
      ? { ...phase, context: "你們在上一階段發現了讀數差異，現在總務處希望你們解釋它。" }
      : phase,
  );
}

function revision(overrides: Record<string, unknown> = {}) {
  return {
    draftId,
    expectedVersion: 3,
    changes: [
      {
        area: "PHASES" as const,
        change: "把第二階段的情境改成承接第一階段的發現。",
        reason: "原本三個階段讀起來像三道並列的題。",
      },
    ],
    content: { ...content, phases: revisedPhases() },
    ...overrides,
  };
}

describe("activity assistant draft revision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readDraftDetail.mockResolvedValue(currentDraftDetail);
    mocks.saveDraft.mockResolvedValue({
      draftId,
      revisionId,
      version: 4,
      status: "READY_FOR_PREVIEW",
      savedAt: now.toISOString(),
    });
  });

  it("writes a new version of the draft it just read", async () => {
    const registry = tools();
    await registry.get_activity_draft.execute!(
      { draftId },
      options("read_before_revise"),
    );

    await expect(
      registry.update_activity_draft.execute!(revision(), options("revise_1")),
    ).resolves.toEqual({
      draftId,
      previousVersion: 3,
      version: 4,
      status: "READY_FOR_PREVIEW",
      editHref: `/teacher/activities/${draftId}`,
      previewHref: `/teacher/activities/${draftId}/preview`,
    });
    expect(mocks.saveDraft).toHaveBeenCalledWith(
      expect.anything(),
      agentContext,
      expect.objectContaining({
        draftId,
        expectedVersion: 3,
        desiredStatus: "READY_FOR_PREVIEW",
        agentRunId: runId,
      }),
    );
    expect(mocks.onBusinessWriteSuccess).toHaveBeenCalledWith("DRAFT_UPDATED");
  });

  it("refuses to revise a draft that was never read in this conversation", async () => {
    const registry = tools();

    await expect(
      registry.update_activity_draft.execute!(revision(), options("revise_1")),
    ).rejects.toThrow("ACTIVITY_REVISE_DRAFT_NOT_READ");
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(mocks.readDraftDetail).not.toHaveBeenCalled();
  });

  it("accepts a read recovered from earlier turns of the same conversation", async () => {
    const registry = tools({ draftReads: new Map([[draftId, 3]]) });

    await expect(
      registry.update_activity_draft.execute!(revision(), options("revise_1")),
    ).resolves.toMatchObject({ version: 4 });
  });

  it("refuses a revision aimed at a version the model did not see", async () => {
    const registry = tools({ draftReads: new Map([[draftId, 2]]) });

    await expect(
      registry.update_activity_draft.execute!(revision(), options("revise_1")),
    ).rejects.toThrow("ACTIVITY_REVISE_STALE_READ");
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });

  it("refuses when the draft moved on between the read and the write", async () => {
    mocks.readDraftDetail.mockResolvedValue({
      ...currentDraftDetail,
      version: 4,
    });
    const registry = tools({ draftReads: new Map([[draftId, 3]]) });

    await expect(
      registry.update_activity_draft.execute!(revision(), options("revise_1")),
    ).rejects.toThrow("ACTIVITY_REVISE_STALE_READ");
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });

  it("refuses when the draft is no longer readable at write time", async () => {
    mocks.readDraftDetail.mockResolvedValue({ status: "NOT_FOUND", draftId });
    const registry = tools({ draftReads: new Map([[draftId, 3]]) });

    await expect(
      registry.update_activity_draft.execute!(revision(), options("revise_1")),
    ).rejects.toThrow("ACTIVITY_REVISE_DRAFT_UNAVAILABLE");
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });

  it("refuses a revision that quietly reaches past the areas it declared", async () => {
    const registry = tools({ draftReads: new Map([[draftId, 3]]) });

    await expect(
      registry.update_activity_draft.execute!(
        revision({
          content: {
            ...content,
            phases: revisedPhases(),
            rubricDimensions: content.rubricDimensions.map((dimension) => ({
              ...dimension,
              improve: "需要更多證據支持。",
            })),
          },
        }),
        options("revise_1"),
      ),
    ).rejects.toThrow("ACTIVITY_REVISE_UNDECLARED_CHANGE");
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });

  it("refuses a revision that claims an area it did not touch", async () => {
    const registry = tools({ draftReads: new Map([[draftId, 3]]) });

    await expect(
      registry.update_activity_draft.execute!(
        revision({
          changes: [
            {
              area: "PHASES" as const,
              change: "把第二階段的情境改成承接第一階段的發現。",
              reason: "原本三個階段讀起來像三道並列的題。",
            },
            {
              area: "RUBRIC" as const,
              change: "重寫四檔描述。",
              reason: "教師說量規太籠統。",
            },
          ],
        }),
        options("revise_1"),
      ),
    ).rejects.toThrow("ACTIVITY_REVISE_UNDECLARED_CHANGE");
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });

  it("refuses a revision that changes nothing", async () => {
    const registry = tools({ draftReads: new Map([[draftId, 3]]) });

    await expect(
      registry.update_activity_draft.execute!(
        revision({ content }),
        options("revise_1"),
      ),
    ).rejects.toThrow("ACTIVITY_REVISE_NO_CHANGE");
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });

  it("allows only one revision per request", async () => {
    const registry = tools({ draftReads: new Map([[draftId, 3]]) });
    await registry.update_activity_draft.execute!(
      revision(),
      options("revise_1"),
    );

    await expect(
      registry.update_activity_draft.execute!(
        revision({ expectedVersion: 4 }),
        options("revise_2"),
      ),
    ).rejects.toThrow("ACTIVITY_REVISE_MULTIPLE_UPDATE_ATTEMPTS");
    expect(mocks.saveDraft).toHaveBeenCalledTimes(1);
  });

  it("reports the underlying command refusal without writing", async () => {
    mocks.saveDraft.mockRejectedValue(
      new SaveActivityDraftError("STALE_VERSION"),
    );
    const registry = tools({ draftReads: new Map([[draftId, 3]]) });

    await expect(
      registry.update_activity_draft.execute!(revision(), options("revise_1")),
    ).rejects.toThrow("ACTIVITY_REVISE_STALE_VERSION");
    expect(mocks.onToolFailure).toHaveBeenCalledWith("REVISE_STALE_VERSION");
    expect(mocks.onBusinessWriteSuccess).not.toHaveBeenCalled();
  });
});
