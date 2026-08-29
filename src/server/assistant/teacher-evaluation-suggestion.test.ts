import type { LanguageModel } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { waterConservationTaskBook } from "../../fixtures/water-conservation";
import type { PrismaClient } from "../../generated/prisma/client";
import type { CommandContext } from "../commands/command-context";
import { FeedbackWorkspaceQueryError } from "../queries/feedback-workspace";
import { ActivityAssistantConfigError } from "./assistant-config";
import { zodFieldNames } from "../../test/zod-field-names";
import {
  buildTeacherEvaluationSuggestionPrompt,
  teacherEvaluationSuggestionModelOutputSchema,
  suggestTeacherEvaluation,
  TeacherEvaluationSuggestionError,
  type TeacherEvaluationSuggestionDependencies,
} from "./teacher-evaluation-suggestion";

const actorId = "10000000-0000-4000-8000-000000000001";
const submissionId = "20000000-0000-4000-8000-000000000002";
const revisionId = "30000000-0000-4000-8000-000000000003";
const runId = "40000000-0000-4000-8000-000000000004";
const hiddenAttachmentId = "50000000-0000-4000-8000-000000000005";
const now = new Date("2026-08-28T05:00:00.000Z");
const database = { kind: "evaluation-suggestion-database" } as unknown as PrismaClient;
const model = { specificationVersion: "v4" } as unknown as LanguageModel;
const context: CommandContext = {
  actorId,
  source: "UI",
  traceId: "evaluation-suggestion-test",
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
            currentVersion: 1,
            teacher: { id: actorId, displayName: "林老师" },
            revisions: [
              {
                id: "a0000000-0000-4000-8000-00000000000a",
                version: 1,
                body: "不得发送给模型的旧反馈",
                nextStep: "CONTINUE",
                supportLevel: "STANDARD",
                source: "MANUAL",
                confirmedAt: "2026-08-28T04:40:00.000Z",
              },
            ],
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

function dependencies(): TeacherEvaluationSuggestionDependencies {
  return mocks as unknown as TeacherEvaluationSuggestionDependencies;
}

describe("teacher evaluation suggestion prompt", () => {
  it("names every output field, because the schema is not enforced by the provider", () => {
    const prompt = buildTeacherEvaluationSuggestionPrompt({
      rubricDimensions: waterConservationTaskBook.rubricDimensions,
      textEvidence: "我记录了三次用水读数。",
      checkpoints: [],
    });

    // Derived from the schema, so adding a field without naming it in the
    // prompt fails here instead of failing every real model call.
    const fields = zodFieldNames(teacherEvaluationSuggestionModelOutputSchema);
    expect(fields).toEqual(
      expect.arrayContaining([
        "outcomes",
        "summary",
        "dimensionIndex",
        "dimensionName",
        "citations",
        "evidenceIndex",
      ]),
    );
    for (const field of fields) {
      expect(prompt).toContain(field);
    }
    // The provider requires the word JSON to accept json_object responses.
    expect(prompt).toContain("JSON");
  });
});

describe("teacher evaluation suggestion boundary", () => {
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
      expectedEvaluationVersion: 0,
      completedAt: now.toISOString(),
    });
    mocks.generateSuggestion.mockResolvedValue({
      outcomes: validOutcomes(),
      summary: "现有文字和检查点支持部分量规判断，仍请教师逐维核对。",
    });
  });

  it("uses only current readable evidence and closes a valid run as succeeded", async () => {
    const result = await suggestTeacherEvaluation(
      database,
      context,
      {
        submissionId,
        submissionRevisionId: revisionId,
        submissionRevisionNumber: 1,
      },
      dependencies(),
    );

    expect(result).toMatchObject({
      agentRunId: runId,
      submissionRevisionId: revisionId,
      submissionRevisionNumber: 1,
    });
    expect(mocks.getWorkspace).toHaveBeenCalledTimes(2);
    const safeInput = mocks.generateSuggestion.mock.calls[0]?.[1];
    const serializedInput = JSON.stringify(safeInput);
    expect(serializedInput).toContain("三次用水读数");
    expect(serializedInput).toContain("evidenceIndex");
    expect(serializedInput).not.toContain("不得发送给模型的附件名");
    expect(serializedInput).not.toContain(hiddenAttachmentId);
    expect(serializedInput).not.toContain("不得发送给模型的旧反馈");
    expect(serializedInput).not.toContain("不得发送给模型的旧评价");
    expect(mocks.completeRun).toHaveBeenCalledWith(
      database,
      { ...context, source: "AGENT" },
      {
        agentRunId: runId,
        submissionId,
        submissionRevisionId: revisionId,
        submissionRevisionNumber: 1,
        expectedEvaluationVersion: 0,
      },
    );
    expect(mocks.finishRun).not.toHaveBeenCalled();
  });

  it("fails before provider construction or AgentRun creation when AI is disabled", async () => {
    mocks.getConfig.mockImplementation(() => {
      throw new ActivityAssistantConfigError("AI_DISABLED");
    });

    await expect(
      suggestTeacherEvaluation(
        database,
        context,
        {
          submissionId,
          submissionRevisionId: revisionId,
          submissionRevisionNumber: 1,
        },
        dependencies(),
      ),
    ).rejects.toEqual(new TeacherEvaluationSuggestionError("AI_UNAVAILABLE"));
    expect(mocks.getWorkspace).not.toHaveBeenCalled();
    expect(mocks.createModel).not.toHaveBeenCalled();
    expect(mocks.startRun).not.toHaveBeenCalled();
  });

  it("preserves resource-level not-found before provider or run creation", async () => {
    mocks.getWorkspace.mockRejectedValue(new FeedbackWorkspaceQueryError("NOT_FOUND"));

    await expect(
      suggestTeacherEvaluation(
        database,
        context,
        {
          submissionId,
          submissionRevisionId: revisionId,
          submissionRevisionNumber: 1,
        },
        dependencies(),
      ),
    ).rejects.toEqual(new TeacherEvaluationSuggestionError("NOT_FOUND"));
    expect(mocks.createModel).not.toHaveBeenCalled();
    expect(mocks.startRun).not.toHaveBeenCalled();
  });

  it("rejects v1 and stale pages before opening an AgentRun", async () => {
    mocks.getWorkspace.mockResolvedValueOnce(
      workspace({
        content: {
          schemaVersion: 1,
          title: "旧活动",
          summary: "旧摘要",
          learningObjectives: ["旧目标"],
          taskInstructions: "旧任务",
          evidenceRequirements: ["旧证据"],
          feedbackCriteria: ["旧标准"],
        },
      }),
    );
    await expect(
      suggestTeacherEvaluation(
        database,
        context,
        {
          submissionId,
          submissionRevisionId: revisionId,
          submissionRevisionNumber: 1,
        },
        dependencies(),
      ),
    ).rejects.toEqual(new TeacherEvaluationSuggestionError("RUBRIC_UNAVAILABLE"));

    mocks.getWorkspace.mockResolvedValueOnce(workspace({ revisionNumber: 2 }));
    await expect(
      suggestTeacherEvaluation(
        database,
        context,
        {
          submissionId,
          submissionRevisionId: revisionId,
          submissionRevisionNumber: 1,
        },
        dependencies(),
      ),
    ).rejects.toEqual(
      new TeacherEvaluationSuggestionError("STALE_SUBMISSION_REVISION"),
    );
    expect(mocks.startRun).not.toHaveBeenCalled();
  });

  it("rejects attachment citations and closes the run as invalid output", async () => {
    mocks.generateSuggestion.mockResolvedValue({
      outcomes: validOutcomes().map((outcome, index) =>
        index === 0
          ? {
              ...outcome,
              citations: [{ kind: "attachment", attachmentId: hiddenAttachmentId }],
            }
          : outcome,
      ),
      summary: "模型不得引用附件。",
    });

    await expect(
      suggestTeacherEvaluation(
        database,
        context,
        {
          submissionId,
          submissionRevisionId: revisionId,
          submissionRevisionNumber: 1,
        },
        dependencies(),
      ),
    ).rejects.toEqual(new TeacherEvaluationSuggestionError("INVALID_OUTPUT"));
    expect(mocks.finishRun).toHaveBeenCalledWith(
      database,
      { ...context, source: "AGENT" },
      {
        agentRunId: runId,
        status: "FAILED",
        failureCode: "EVALUATION_SUGGESTION_INVALID_OUTPUT",
      },
    );
  });

  it("requires insufficient evidence when no readable evidence exists", async () => {
    mocks.getWorkspace.mockResolvedValue(
      workspace({ textEvidence: " \n ", completedEvidenceIndexes: [] }),
    );

    await expect(
      suggestTeacherEvaluation(
        database,
        context,
        {
          submissionId,
          submissionRevisionId: revisionId,
          submissionRevisionNumber: 1,
        },
        dependencies(),
      ),
    ).rejects.toEqual(new TeacherEvaluationSuggestionError("INVALID_OUTPUT"));
    expect(mocks.finishRun).toHaveBeenCalledWith(
      database,
      { ...context, source: "AGENT" },
      expect.objectContaining({
        status: "FAILED",
        failureCode: "EVALUATION_SUGGESTION_INVALID_OUTPUT",
      }),
    );
  });

  it("fails a completed model result when the current revision changes before return", async () => {
    mocks.getWorkspace
      .mockResolvedValueOnce(workspace())
      .mockResolvedValueOnce(
        workspace({
          revisionId: "d0000000-0000-4000-8000-00000000000d",
          revisionNumber: 2,
        }),
      );

    await expect(
      suggestTeacherEvaluation(
        database,
        context,
        {
          submissionId,
          submissionRevisionId: revisionId,
          submissionRevisionNumber: 1,
        },
        dependencies(),
      ),
    ).rejects.toEqual(
      new TeacherEvaluationSuggestionError("STALE_SUBMISSION_REVISION"),
    );
    expect(mocks.finishRun).toHaveBeenCalledWith(
      database,
      { ...context, source: "AGENT" },
      expect.objectContaining({
        status: "FAILED",
        failureCode: "EVALUATION_SUGGESTION_STALE_REVISION",
      }),
    );
  });

  it("closes provider failures without creating an evaluation intent", async () => {
    mocks.generateSuggestion.mockRejectedValue(new Error("provider secret detail"));

    await expect(
      suggestTeacherEvaluation(
        database,
        context,
        {
          submissionId,
          submissionRevisionId: revisionId,
          submissionRevisionNumber: 1,
        },
        dependencies(),
      ),
    ).rejects.toEqual(
      new TeacherEvaluationSuggestionError("PROVIDER_FAILED"),
    );
    expect(mocks.finishRun).toHaveBeenCalledWith(
      database,
      { ...context, source: "AGENT" },
      expect.objectContaining({
        status: "FAILED",
        failureCode: "EVALUATION_SUGGESTION_PROVIDER_FAILED",
      }),
    );
  });
});
