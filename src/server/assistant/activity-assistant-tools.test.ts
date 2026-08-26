import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityContentV2 } from "../../domain/activity/activity-content";
import type { PrismaClient } from "../../generated/prisma/client";
import { DecideActionIntentError } from "../commands/decide-action-intent";
import { PreparePublishActivityIntentError } from "../commands/prepare-publish-activity-intent";
import type { CommandContext } from "../commands/command-context";
import {
  activityDraftProposalSchema,
  createActivityAssistantTools,
  type ActivityDraftProposal,
} from "./activity-assistant-tools";

vi.mock("server-only", () => ({}));

const actorId = "10000000-0000-4000-8000-000000000001";
const runId = "20000000-0000-4000-8000-000000000002";
const draftId = "30000000-0000-4000-8000-000000000003";
const classroomId = "40000000-0000-4000-8000-000000000004";
const intentId = "50000000-0000-4000-8000-000000000005";
const releaseId = "60000000-0000-4000-8000-000000000006";
const revisionId = "70000000-0000-4000-8000-000000000007";
const now = new Date("2026-08-20T04:00:00.000Z");

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
const content: ActivityContentV2 = {
  schemaVersion: 2, title: "校園節水行動", topic: "校園節水", summary: "記錄水表並提出改善建議", schoolStage: "MIDDLE", grade: 7, mainDisciplineCode: "physics", integratedDisciplineCodes: ["math"], crossDisciplinaryConceptCodes: [], assignmentType: "inquiry", assignmentSubtype: "survey", inquiryDepth: "intermediate", submissionMode: "once", durationWeeks: 2, backgroundSetting: "學校要改善用水，同學們以真實場景完成調查。", objectiveKnowledge: "理解用水資料。", objectiveProcess: "使用資料支持結論。", objectiveEmotion: "願意參與校園節水。", learningObjectives: ["理解用水資料。", "使用資料支持結論。", "願意參與校園節水。"], taskInstructions: "記錄兩次水表讀數並解釋差異。", evidenceRequirements: ["時間與讀數", "分析結論", "改善建議"], feedbackCriteria: ["問題意識", "證據品質", "跨學科連結", "方案表達"], phases: [
    { name: "觀察", action: "記錄用水。", context: "在校園觀察。", support: "使用記錄表。", evidence: [{ type: "text", description: "時間與讀數" }], evaluationFocus: "資料完整。", suggestedLessons: 1 },
    { name: "分析", action: "整理資料。", context: "比較讀數。", support: "使用表格。", evidence: [{ type: "document", description: "分析表" }], evaluationFocus: "結論有據。", suggestedLessons: 1 },
    { name: "建議", action: "提出建議。", context: "面向校園。", support: "使用建議模板。", evidence: [{ type: "text", description: "建議稿" }], evaluationFocus: "方案可行。", suggestedLessons: 1 },
  ], rubricDimensions: [
    { name: "問題意識", excellent: "清楚", good: "較清楚", pass: "基本", improve: "需補充" }, { name: "證據品質", excellent: "完整", good: "較完整", pass: "基本", improve: "需補充" }, { name: "跨學科連結", excellent: "清楚", good: "較清楚", pass: "基本", improve: "需補充" }, { name: "方案表達", excellent: "可行", good: "較可行", pass: "基本", improve: "需補充" },
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
  integratedDisciplineContributions: [
    { disciplineCode: "math", necessaryContribution: "整理與比較水表讀數。" },
  ],
  alignmentChains: [
    { objectiveKind: "knowledge", objective: "理解用水資料。", task: "辨識讀數差異。", evidence: "讀數紀錄。", assessment: "資料完整。" },
    { objectiveKind: "process", objective: "使用資料支持結論。", task: "整理資料。", evidence: "分析表。", assessment: "結論有據。" },
    { objectiveKind: "emotion", objective: "願意參與校園節水。", task: "提出建議。", evidence: "建議稿。", assessment: "方案可行。" },
  ],
  content,
};

const mocks = {
  saveDraft: vi.fn(),
  preparePublish: vi.fn(),
  decideIntent: vi.fn(),
  publishRelease: vi.fn(),
  onToolFailure: vi.fn(),
  onBusinessWriteSuccess: vi.fn(),
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

function tools() {
  return createActivityAssistantTools({
    database: database(),
    agentContext,
    approvalContext,
    agentRunId: runId,
    onToolFailure: mocks.onToolFailure,
    onBusinessWriteSuccess: mocks.onBusinessWriteSuccess,
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
        integratedDisciplineContributions: [
          { disciplineCode: "math", necessaryContribution: "整理数据。" },
          { disciplineCode: "math", necessaryContribution: "重复。" },
        ],
      }).success,
    ).toBe(false);
    expect(
      activityDraftProposalSchema.safeParse({
        ...proposal,
        alignmentChains: [
          proposal.alignmentChains[0],
          proposal.alignmentChains[0],
          proposal.alignmentChains[2],
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
