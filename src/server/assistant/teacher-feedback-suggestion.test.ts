import type { LanguageModel } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { waterConservationTaskBook } from "../../fixtures/water-conservation";
import type { PrismaClient } from "../../generated/prisma/client";
import type { CommandContext } from "../commands/command-context";
import { FeedbackWorkspaceQueryError } from "../queries/feedback-workspace";
import { ActivityAssistantConfigError } from "./assistant-config";
import {
  buildTeacherFeedbackSuggestionPrompt,
  suggestTeacherFeedback,
  TeacherFeedbackSuggestionError,
  type TeacherFeedbackSuggestionDependencies,
} from "./teacher-feedback-suggestion";

const actorId = "10000000-0000-4000-8000-000000000001";
const submissionId = "20000000-0000-4000-8000-000000000002";
const revisionId = "30000000-0000-4000-8000-000000000003";
const runId = "40000000-0000-4000-8000-000000000004";
const hiddenAttachmentId = "50000000-0000-4000-8000-000000000005";
const now = new Date("2026-08-28T05:00:00.000Z");
const database = { kind: "feedback-suggestion-database" } as unknown as PrismaClient;
const model = { specificationVersion: "v4" } as unknown as LanguageModel;
const context: CommandContext = {
  actorId,
  source: "UI",
  traceId: "feedback-suggestion-test",
  clock: () => now,
};

function validOutcomes() {
  return waterConservationTaskBook.rubricDimensions.map((dimension, index) => ({
    dimensionIndex: index + 1,
    dimensionName: dimension.name,
    status: "LEVEL" as const,
    level: "good" as const,
    citations:
      index === 0
        ? [{ kind: "checkpoint" as const, evidenceIndex: 1 }]
        : [{ kind: "text" as const }],
  }));
}

function workspace(overrides?: {
  revisionId?: string;
  revisionNumber?: number;
  textEvidence?: string;
  completedEvidenceIndexes?: number[];
  content?: unknown;
  evaluationVersion?: number;
  feedbackVersion?: number;
}) {
  const revisionNumber = overrides?.revisionNumber ?? 1;
  return {
    actor: { displayName: "林老师" },
    student: {
      id: "60000000-0000-4000-8000-000000000006",
      displayName: "陈同学",
    },
    group: null,
    submission: {
      id: submissionId,
      phaseIndex: 1,
      phaseName: "发现问题",
      latestRevisionNumber: revisionNumber,
      release: {
        id: "70000000-0000-4000-8000-000000000007",
        status: "ACTIVE",
        publishedAt: "2026-08-28T04:00:00.000Z",
        dueAt: null,
        classroom: {
          id: "80000000-0000-4000-8000-000000000008",
          name: "七年一班",
        },
        snapshot: {
          sourceDraftVersion: 1,
          contentHash: "a".repeat(64),
          content: overrides?.content ?? waterConservationTaskBook,
        },
      },
      revisions: [
        {
          id: overrides?.revisionId ?? revisionId,
          revisionNumber,
          textEvidence:
            overrides?.textEvidence ?? "我记录了三次用水读数，并比较了变化。",
          completedEvidenceIndexes:
            overrides?.completedEvidenceIndexes ?? [1],
          isLate: false,
          submittedAt: "2026-08-28T04:30:00.000Z",
          attachments: [
            {
              id: hiddenAttachmentId,
              kind: "IMAGE",
              filename: "不得发送给模型的附件名.png",
              mediaType: "image/png",
              byteSize: 512,
            },
          ],
          feedback: {
            id: "90000000-0000-4000-8000-000000000009",
            currentVersion: overrides?.feedbackVersion ?? 1,
            teacher: { id: actorId, displayName: "林老师" },
            revisions: Array.from(
              { length: overrides?.feedbackVersion ?? 1 },
              (_, index) => ({
                id: `a0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
                version: index + 1,
                body: "不得发送给模型的旧反馈",
                nextStep: "CONTINUE",
                supportLevel: "STANDARD",
                source: "MANUAL",
                confirmedAt: "2026-08-28T04:40:00.000Z",
              }),
            ),
          },
          evaluation:
            overrides?.evaluationVersion === undefined
              ? null
              : {
                  id: "b0000000-0000-4000-8000-00000000000b",
                  currentVersion: overrides.evaluationVersion,
                  teacher: { id: actorId, displayName: "林老师" },
                  revisions: Array.from(
                    { length: overrides.evaluationVersion },
                    (_, index) => ({
                      id: `c0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
                      version: index + 1,
                      summary: "不得发送给模型的旧评价",
                      outcomes: validOutcomes(),
                      source: "MANUAL",
                      confirmedAt: "2026-08-28T04:45:00.000Z",
                    }),
                  ),
                },
        },
      ],
    },
  };
}

const mocks = {
  getConfig: vi.fn(),
  createModel: vi.fn(),
  getWorkspace: vi.fn(),
  startRun: vi.fn(),
  finishRun: vi.fn(),
  completeRun: vi.fn(),
  generateSuggestion: vi.fn(),
};

function dependencies(): TeacherFeedbackSuggestionDependencies {
  return mocks as unknown as TeacherFeedbackSuggestionDependencies;
}

describe("teacher feedback suggestion prompt", () => {
  it("names every output field, because the schema is not enforced by the provider", () => {
    const prompt = buildTeacherFeedbackSuggestionPrompt({
      phase: null,
      textEvidence: "我记录了三次用水读数。",
      confirmedCheckpoints: [],
      attachmentCount: 0,
    });

    for (const field of ["body", "nextStep", "supportLevel"]) {
      expect(prompt).toContain(field);
    }
    // The provider requires the word JSON to accept json_object responses.
    expect(prompt).toContain("JSON");
  });
});

describe("teacher feedback suggestion boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConfig.mockReturnValue({
      apiKey: "test-key",
      model: "deepseek-v4-flash",
      approvalSecret: "s".repeat(32),
    });
    mocks.createModel.mockReturnValue(model);
    mocks.getWorkspace.mockResolvedValue(workspace());
    mocks.startRun.mockResolvedValue({
      id: runId,
      actorId,
      status: "RUNNING",
      model: "deepseek-v4-flash",
      startedAt: now.toISOString(),
    });
    mocks.finishRun.mockResolvedValue({
      id: runId,
      actorId,
      status: "SUCCEEDED",
      completedAt: now.toISOString(),
      failureCode: null,
    });
    mocks.completeRun.mockResolvedValue({
      agentRunId: runId,
      submissionRevisionId: revisionId,
      submissionRevisionNumber: 1,
      expectedFeedbackVersion: 1,
      completedAt: now.toISOString(),
    });
    mocks.generateSuggestion.mockResolvedValue({
      body: "你记录了三次用水读数并比较了变化，这一步的证据是清楚的。下一步请说明这些差异说明了什么问题，再据此提出一条可执行的节水建议。",
      nextStep: "REVISE",
      supportLevel: "STANDARD",
    });
  });

  function input(overrides?: Partial<{ submissionRevisionNumber: number }>) {
    return {
      submissionId,
      submissionRevisionId: revisionId,
      submissionRevisionNumber: overrides?.submissionRevisionNumber ?? 1,
    };
  }

  it("sends only this revision's own visible evidence and closes the run", async () => {
    const result = await suggestTeacherFeedback(
      database,
      context,
      input(),
      dependencies(),
    );

    expect(result).toMatchObject({
      agentRunId: runId,
      submissionRevisionId: revisionId,
      nextStep: "REVISE",
      supportLevel: "STANDARD",
    });
    const [, modelInput] = mocks.generateSuggestion.mock.calls[0] ?? [];
    const serialized = JSON.stringify(modelInput);
    expect(serialized).toContain("我记录了三次用水读数");
    // Prior feedback, attachment names and the student identity never leave.
    expect(serialized).not.toContain("不得发送给模型的附件名");
    expect(serialized).not.toContain("不得发送给模型的旧反馈");
    expect(serialized).not.toContain("陈同学");
    expect(serialized).toContain('"attachmentCount":1');
    expect(mocks.completeRun).toHaveBeenCalledWith(
      database,
      expect.objectContaining({ source: "AGENT", actorId }),
      expect.objectContaining({
        agentRunId: runId,
        submissionId,
        expectedFeedbackVersion: 1,
      }),
    );
  });

  it("fails before provider construction or AgentRun creation when AI is disabled", async () => {
    mocks.getConfig.mockImplementation(() => {
      throw new ActivityAssistantConfigError("AI_DISABLED");
    });

    await expect(
      suggestTeacherFeedback(database, context, input(), dependencies()),
    ).rejects.toEqual(new TeacherFeedbackSuggestionError("AI_UNAVAILABLE"));
    expect(mocks.createModel).not.toHaveBeenCalled();
    expect(mocks.startRun).not.toHaveBeenCalled();
    expect(mocks.generateSuggestion).not.toHaveBeenCalled();
  });

  it("preserves resource-level not-found before provider or run creation", async () => {
    mocks.getWorkspace.mockRejectedValue(
      new FeedbackWorkspaceQueryError("NOT_FOUND"),
    );

    await expect(
      suggestTeacherFeedback(database, context, input(), dependencies()),
    ).rejects.toEqual(new TeacherFeedbackSuggestionError("NOT_FOUND"));
    expect(mocks.createModel).not.toHaveBeenCalled();
    expect(mocks.startRun).not.toHaveBeenCalled();
  });

  it("refuses a stale page before opening an AgentRun", async () => {
    await expect(
      suggestTeacherFeedback(
        database,
        context,
        input({ submissionRevisionNumber: 2 }),
        dependencies(),
      ),
    ).rejects.toEqual(
      new TeacherFeedbackSuggestionError("STALE_SUBMISSION_REVISION"),
    );
    expect(mocks.startRun).not.toHaveBeenCalled();
    expect(mocks.generateSuggestion).not.toHaveBeenCalled();
  });

  it("still drafts against a v1 snapshot without inventing phase requirements", async () => {
    mocks.getWorkspace.mockResolvedValue(
      workspace({
        content: {
          schemaVersion: 1,
          title: "旧版活动",
          summary: "旧版摘要",
          learningObjectives: ["理解用水"],
          taskInstructions: "记录用水",
          evidenceRequirements: ["读数"],
          feedbackCriteria: ["资料完整"],
        },
      }),
    );

    await expect(
      suggestTeacherFeedback(database, context, input(), dependencies()),
    ).resolves.toMatchObject({ agentRunId: runId });
    const [, modelInput] = mocks.generateSuggestion.mock.calls[0] ?? [];
    expect((modelInput as { phase: unknown }).phase).toBeNull();
    expect(
      (modelInput as { confirmedCheckpoints: unknown[] }).confirmedCheckpoints,
    ).toEqual([]);
  });

  it("closes the run as invalid output when the draft breaks the feedback contract", async () => {
    mocks.generateSuggestion.mockResolvedValue({
      body: "太短",
      nextStep: "REVISE",
      supportLevel: "STANDARD",
    });

    await expect(
      suggestTeacherFeedback(database, context, input(), dependencies()),
    ).rejects.toEqual(new TeacherFeedbackSuggestionError("INVALID_OUTPUT"));
    expect(mocks.finishRun).toHaveBeenCalledWith(
      database,
      expect.objectContaining({ source: "AGENT" }),
      expect.objectContaining({
        status: "FAILED",
        failureCode: "FEEDBACK_SUGGESTION_INVALID_OUTPUT",
      }),
    );
    expect(mocks.completeRun).not.toHaveBeenCalled();
  });

  it("rejects an unknown next step instead of coercing it", async () => {
    mocks.generateSuggestion.mockResolvedValue({
      body: "你记录了三次用水读数并比较了变化，请再说明这些差异说明了什么问题。",
      nextStep: "APPROVE",
      supportLevel: "STANDARD",
    });

    await expect(
      suggestTeacherFeedback(database, context, input(), dependencies()),
    ).rejects.toEqual(new TeacherFeedbackSuggestionError("INVALID_OUTPUT"));
    expect(mocks.completeRun).not.toHaveBeenCalled();
  });

  it("fails a completed draft when the feedback version moved before return", async () => {
    mocks.getWorkspace
      .mockResolvedValueOnce(workspace())
      .mockResolvedValueOnce(workspace({ feedbackVersion: 2 }));

    await expect(
      suggestTeacherFeedback(database, context, input(), dependencies()),
    ).rejects.toEqual(
      new TeacherFeedbackSuggestionError("STALE_SUBMISSION_REVISION"),
    );
    expect(mocks.completeRun).not.toHaveBeenCalled();
    expect(mocks.finishRun).toHaveBeenCalledWith(
      database,
      expect.objectContaining({ source: "AGENT" }),
      expect.objectContaining({
        status: "FAILED",
        failureCode: "FEEDBACK_SUGGESTION_STALE_REVISION",
      }),
    );
  });

  it("closes provider failures without writing any feedback", async () => {
    mocks.generateSuggestion.mockRejectedValue(new Error("provider down"));

    await expect(
      suggestTeacherFeedback(database, context, input(), dependencies()),
    ).rejects.toEqual(new TeacherFeedbackSuggestionError("PROVIDER_FAILED"));
    expect(mocks.completeRun).not.toHaveBeenCalled();
    expect(mocks.finishRun).toHaveBeenCalledWith(
      database,
      expect.objectContaining({ source: "AGENT" }),
      expect.objectContaining({
        status: "FAILED",
        failureCode: "FEEDBACK_SUGGESTION_PROVIDER_FAILED",
      }),
    );
  });
});
