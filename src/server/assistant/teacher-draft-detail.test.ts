import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityContentV2 } from "../../domain/activity/activity-content";
import type { PrismaClient } from "../../generated/prisma/client";
import type { CommandContext } from "../commands/command-context";
import {
  TeacherActivityQueryError,
  type TeacherActivityDashboard,
  type TeacherActivityDraft,
} from "../queries/teacher-activity-workspace";
import { createTeacherDraftDetailReader } from "./teacher-draft-detail";

vi.mock("server-only", () => ({}));

const actorId = "10000000-0000-4000-8000-000000000001";
const draftId = "30000000-0000-4000-8000-000000000003";
const foreignDraftId = "90000000-0000-4000-8000-000000000009";
const revisionId = "70000000-0000-4000-8000-000000000007";
const releaseId = "60000000-0000-4000-8000-000000000006";
const now = new Date("2026-08-28T04:00:00.000Z");

const content: ActivityContentV2 = {
  schemaVersion: 2,
  title: "校园节水行动",
  topic: "校园节水",
  summary: "记录水表并提出改善建议",
  schoolStage: "MIDDLE",
  grade: 7,
  mainDisciplineCode: "physics",
  integratedDisciplineCodes: ["math"],
  crossDisciplinaryConceptCodes: [],
  assignmentType: "inquiry",
  assignmentSubtype: "survey",
  inquiryDepth: "intermediate",
  submissionMode: "once",
  durationWeeks: 2,
  backgroundSetting: "你们是校园节水顾问，要向总务处提出可执行的节水方案。",
  objectiveKnowledge: "理解用水数据。",
  objectiveProcess: "使用数据支持结论。",
  objectiveEmotion: "愿意参与校园节水。",
  learningObjectives: ["理解用水数据。", "使用数据支持结论。", "愿意参与校园节水。"],
  taskInstructions: "记录两次水表读数并解释差异。",
  evidenceRequirements: ["时间与读数", "分析结论", "改善建议"],
  feedbackCriteria: ["问题意识", "证据品质", "跨学科连结", "方案表达"],
  phases: [
    { name: "观察", action: "记录用水。", context: "在校园观察。", support: "使用记录表。", evidence: [{ type: "text", description: "时间与读数" }], evaluationFocus: "资料完整。", suggestedLessons: 1 },
    { name: "分析", action: "整理资料。", context: "比较读数。", support: "使用表格。", evidence: [{ type: "document", description: "分析表" }], evaluationFocus: "结论有据。", suggestedLessons: 1 },
    { name: "建议", action: "提出建议。", context: "面向总务处。", support: "使用建议模板。", evidence: [{ type: "text", description: "建议稿" }], evaluationFocus: "方案可行。", suggestedLessons: 1 },
  ],
  rubricDimensions: [
    { name: "问题意识", excellent: "清楚", good: "较清楚", pass: "基本", improve: "需补充" },
    { name: "证据品质", excellent: "完整", good: "较完整", pass: "基本", improve: "需补充" },
    { name: "跨学科连结", excellent: "清楚", good: "较清楚", pass: "基本", improve: "需补充" },
    { name: "方案表达", excellent: "可行", good: "较可行", pass: "基本", improve: "需补充" },
  ],
};

const workspace: TeacherActivityDashboard = {
  actor: { displayName: "林老师" },
  classrooms: [],
  releases: [],
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
};

const agentContext: CommandContext = {
  actorId,
  source: "AGENT",
  traceId: "draft-detail-trace",
  clock: () => now,
};

function draft(
  overrides: Partial<TeacherActivityDraft> = {},
): TeacherActivityDraft {
  return {
    id: draftId,
    status: "READY_FOR_PREVIEW",
    version: 3,
    updatedAt: now.toISOString(),
    sealedAt: null,
    releaseId: null,
    revision: {
      id: revisionId,
      version: 3,
      source: "MANUAL",
      createdAt: now.toISOString(),
      content,
    },
    ...overrides,
  };
}

function database(): PrismaClient {
  return { kind: "draft-detail-database" } as unknown as PrismaClient;
}

const getDraft = vi.fn();

function reader(dashboard: TeacherActivityDashboard = workspace) {
  return createTeacherDraftDetailReader({
    database: database(),
    agentContext,
    workspace: dashboard,
    getDraft: getDraft as never,
  });
}

describe("teacher draft detail reader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDraft.mockResolvedValue({
      actor: { displayName: "林老师" },
      draft: draft(),
    });
  });

  it("returns the exact current task book with canonical links", async () => {
    await expect(reader()(draftId)).resolves.toEqual({
      status: "FOUND",
      draftId,
      draftStatus: "READY_FOR_PREVIEW",
      version: 3,
      updatedAt: now.toISOString(),
      published: false,
      editHref: `/teacher/activities/${draftId}`,
      previewHref: `/teacher/activities/${draftId}/preview`,
      content,
    });
    expect(getDraft).toHaveBeenCalledWith(expect.anything(), agentContext, {
      draftId,
    });
  });

  it("marks an already published draft without exposing the release", async () => {
    getDraft.mockResolvedValue({
      actor: { displayName: "林老师" },
      draft: draft({ releaseId, status: "SEALED", sealedAt: now.toISOString() }),
    });

    const output = await reader()(draftId);

    expect(output).toMatchObject({
      status: "FOUND",
      draftStatus: "SEALED",
      published: true,
    });
    expect(JSON.stringify(output)).not.toContain(releaseId);
  });

  it("does not query a draft outside the authorized workspace", async () => {
    await expect(reader()(foreignDraftId)).resolves.toEqual({
      status: "NOT_FOUND",
      draftId: foreignDraftId,
    });
    expect(getDraft).not.toHaveBeenCalled();
  });

  it("keeps a draft that disappeared between turns resource-level absent", async () => {
    getDraft.mockRejectedValue(new TeacherActivityQueryError("NOT_FOUND"));

    await expect(reader()(draftId)).resolves.toEqual({
      status: "NOT_FOUND",
      draftId,
    });
  });

  it("names a legacy snapshot without returning its body", async () => {
    getDraft.mockResolvedValue({
      actor: { displayName: "林老师" },
      draft: draft({
        revision: {
          id: revisionId,
          version: 3,
          source: "MANUAL",
          createdAt: now.toISOString(),
          content: {
            schemaVersion: 1,
            title: "旧版校园节水",
            summary: "旧版摘要",
            learningObjectives: ["理解用水资料。"],
            taskInstructions: "旧版任务说明正文。",
            evidenceRequirements: ["读数记录"],
            feedbackCriteria: ["资料完整"],
          },
        },
      }),
    });

    const output = await reader()(draftId);

    expect(output).toEqual({
      status: "LEGACY_SNAPSHOT",
      draftId,
      title: "旧版校园节水",
      editHref: `/teacher/activities/${draftId}`,
      previewHref: `/teacher/activities/${draftId}/preview`,
    });
    expect(JSON.stringify(output)).not.toContain("旧版任务说明正文");
  });

  it("resolves one authorization decision per draft in a request", async () => {
    const read = reader();

    const [first, second] = await Promise.all([
      read(draftId),
      read(draftId),
    ]);

    expect(first).toEqual(second);
    expect(getDraft).toHaveBeenCalledTimes(1);
  });

  it("propagates an infrastructure failure instead of reporting absence", async () => {
    getDraft.mockRejectedValue(new Error("database unavailable"));

    await expect(reader()(draftId)).rejects.toThrow("database unavailable");
  });
});
