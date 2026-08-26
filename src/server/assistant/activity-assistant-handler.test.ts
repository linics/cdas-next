import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { waterConservationTaskBook } from "../../fixtures/water-conservation";
import type { AppUser, PrismaClient } from "../../generated/prisma/client";

vi.mock("server-only", () => ({}));

import {
  finishActivityAssistantRun,
  startActivityAssistantRun,
} from "./agent-run-lifecycle";
import { ActivityAssistantConfigError } from "./assistant-config";
import { PreparePublishActivityIntentError } from "../commands/prepare-publish-activity-intent";
import {
  handleActivityAssistantRequest,
  selectActivityAssistantToolChoice,
  type ActivityAssistantHandlerDependencies,
} from "./activity-assistant-handler";
import {
  createActivityAssistantTools,
  type ActivityDraftProposal,
} from "./activity-assistant-tools";

const actorId = "10000000-0000-4000-8000-000000000001";
const runId = "20000000-0000-4000-8000-000000000002";
const draftId = "30000000-0000-4000-8000-000000000003";
const revisionId = "40000000-0000-4000-8000-000000000004";
const classroomId = "50000000-0000-4000-8000-000000000005";
const intentId = "60000000-0000-4000-8000-000000000006";
const releaseId = "70000000-0000-4000-8000-000000000007";
const approvalRunId = "80000000-0000-4000-8000-000000000008";
const executionRunId = "90000000-0000-4000-8000-000000000009";
const replayRunId = "a0000000-0000-4000-8000-00000000000a";
const now = new Date("2026-08-20T04:00:00.000Z");
const content = waterConservationTaskBook;
const proposal: ActivityDraftProposal = {
  taskUnderstandingSummary: {
    realWorldContext: "学校准备开展节水行动。",
    studentAction: "观察、调查并分析校园用水场景。",
    intendedOutcome: "形成有证据的节水行动建议。",
    evidenceAndAssessment: "以观察记录、统计表和建议稿进行评价。",
  },
  teacherRequirements: ["七年级", "校园节水", "有证据的改善建议"],
  assumptions: [],
  integratedDisciplineContributions: [
    { disciplineCode: "math", necessaryContribution: "整理和解释调查数据。" },
    { disciplineCode: "chinese", necessaryContribution: "公开表达有依据的建议。" },
  ],
  alignmentChains: [
    { objectiveKind: "knowledge", objective: content.objectiveKnowledge, task: content.phases[0].action, evidence: content.phases[0].evidence[0].description, assessment: content.phases[0].evaluationFocus },
    { objectiveKind: "process", objective: content.objectiveProcess, task: content.phases[1].action, evidence: content.phases[1].evidence[0].description, assessment: content.phases[1].evaluationFocus },
    { objectiveKind: "emotion", objective: content.objectiveEmotion, task: content.phases[2].action, evidence: content.phases[2].evidence[0].description, assessment: content.phases[2].evaluationFocus },
  ],
  content,
};
const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
};

const teacher: AppUser = {
  id: actorId,
  authSubject: "clerk_teacher",
  role: "TEACHER",
  displayName: "林老師",
  rosterKey: null,
  createdAt: now,
  updatedAt: now,
};

const publishInput = {
  draftId,
  expectedDraftVersion: 1,
  classroomId,
  dueAt: null,
};

const mocks = {
  authenticate: vi.fn(),
  getConfig: vi.fn(),
  createModel: vi.fn(),
  getClassrooms: vi.fn(),
  startRun: vi.fn<typeof startActivityAssistantRun>(),
  finishRun: vi.fn<typeof finishActivityAssistantRun>(),
  saveDraft: vi.fn(),
  preparePublish: vi.fn(),
  decideIntent: vi.fn(),
  publishRelease: vi.fn(),
};

function database(): PrismaClient {
  return { kind: "assistant-handler-database" } as unknown as PrismaClient;
}

function userRequest(text = "幫我設計一個校園節水活動"): Request {
  return messageRequest([
    {
      id: "message_1",
      role: "user",
      parts: [{ type: "text", text }],
    },
  ]);
}

function messageRequest(messages: unknown[], signal?: AbortSignal): Request {
  return new Request("http://localhost/api/assistant/activity-draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  });
}

function postDraftPublishConversation() {
  return [
    {
      id: "message_1",
      role: "user",
      parts: [{ type: "text", text: "建立這份活動草稿" }],
    },
    {
      id: "assistant_1",
      role: "assistant",
      parts: [
        {
          type: "tool-create_activity_draft",
          toolCallId: "draft_call",
          state: "output-available",
          input: proposal,
          output: {
            draftId,
            version: 1,
            status: "READY_FOR_PREVIEW",
            editHref: `/teacher/activities/${draftId}`,
            previewHref: `/teacher/activities/${draftId}/preview`,
          },
        },
      ],
    },
    {
      id: "message_2",
      role: "user",
      parts: [{ type: "text", text: "發佈這份活動" }],
    },
  ];
}

function publishApprovalModel() {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          {
            type: "tool-call",
            toolCallId: "publish_call_handler",
            toolName: "publish_activity_release",
            input: JSON.stringify(publishInput),
          },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: undefined },
            usage,
          },
        ],
      }),
    }),
  });
}

function sseEvents(body: string): Array<Record<string, unknown>> {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

function approvalMessage(body: string, approved: boolean) {
  const event = sseEvents(body).find(
    (candidate) => candidate.type === "tool-approval-request",
  );
  if (
    !event ||
    typeof event.toolCallId !== "string" ||
    typeof event.approvalId !== "string" ||
    typeof event.signature !== "string"
  ) {
    throw new Error("Expected a signed publish approval event");
  }
  return {
    id: "assistant_approval_1",
    role: "assistant",
    parts: [
      {
        type: "tool-publish_activity_release",
        toolCallId: event.toolCallId,
        state: "approval-responded",
        input: publishInput,
        approval: {
          id: event.approvalId,
          signature: event.signature,
          isAutomatic: false,
          approved,
          ...(approved ? {} : { reason: "教師取消發佈" }),
        },
      },
    ],
  };
}

function draftApprovalMessage(body: string, approved: boolean) {
  const event = sseEvents(body).find(
    (candidate) => candidate.type === "tool-approval-request",
  );
  if (
    !event ||
    typeof event.toolCallId !== "string" ||
    typeof event.approvalId !== "string" ||
    typeof event.signature !== "string"
  ) {
    throw new Error("Expected a signed draft approval event");
  }
  return {
    id: "assistant_draft_approval_1",
    role: "assistant",
    parts: [
      {
        type: "tool-create_activity_draft",
        toolCallId: event.toolCallId,
        state: "approval-responded",
        input: proposal,
        approval: {
          id: event.approvalId,
          signature: event.signature,
          isAutomatic: false,
          approved,
          ...(approved ? {} : { reason: "教師選擇繼續補充" }),
        },
      },
    ],
  };
}

function startedRun(id: string) {
  return {
    id,
    actorId,
    status: "RUNNING" as const,
    model: "deepseek-v4-flash",
    startedAt: now.toISOString(),
  };
}

function successfulModel() {
  return new MockLanguageModelV4({
    doStream: [
      {
        stream: simulateReadableStream({
          chunks: [
            {
              type: "tool-call",
              toolCallId: "draft_call_handler",
              toolName: "create_activity_draft",
              input: JSON.stringify(proposal),
            },
            {
              type: "finish",
              finishReason: { unified: "tool-calls", raw: undefined },
              usage,
            },
          ],
        }),
      },
      {
        stream: simulateReadableStream({
          chunks: [
            {
              type: "tool-call",
              toolCallId: "open_call_handler",
              toolName: "open_activity_draft",
              input: JSON.stringify({
                draftId,
                destination: "PREVIEW",
              }),
            },
            {
              type: "finish",
              finishReason: { unified: "tool-calls", raw: undefined },
              usage,
            },
          ],
        }),
      },
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "text_1" },
            { type: "text-delta", id: "text_1", delta: "草稿已建立。" },
            { type: "text-end", id: "text_1" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: undefined },
              usage,
            },
          ],
        }),
      },
    ],
  });
}

function dependencies(): ActivityAssistantHandlerDependencies {
  return {
    getDatabase: database,
    authenticate: mocks.authenticate,
    getConfig: mocks.getConfig,
    createModel: mocks.createModel,
    getClassrooms: mocks.getClassrooms,
    startRun: mocks.startRun,
    finishRun: mocks.finishRun,
    createTraceId: vi
      .fn()
      .mockReturnValueOnce("ui-trace")
      .mockReturnValueOnce("agent-trace")
      .mockReturnValueOnce("approval-trace"),
    clock: () => now,
    createTools: (options) =>
      createActivityAssistantTools({
        ...options,
        commands: {
          saveDraft: mocks.saveDraft,
          preparePublish: mocks.preparePublish,
          decideIntent: mocks.decideIntent,
          publishRelease: mocks.publishRelease,
        },
      }),
  };
}

describe("activity assistant route handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue(teacher);
    mocks.getConfig.mockReturnValue({
      apiKey: "deepseek-test-key",
      model: "deepseek-v4-flash",
      approvalSecret: "s".repeat(32),
    });
    mocks.createModel.mockReturnValue(successfulModel());
    mocks.getClassrooms.mockResolvedValue([]);
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
    mocks.saveDraft.mockResolvedValue({
      draftId,
      revisionId,
      version: 1,
      status: "READY_FOR_PREVIEW",
      savedAt: now.toISOString(),
    });
  });

  it("authenticates first and rejects a student without parsing or provider work", async () => {
    mocks.authenticate.mockResolvedValue({ ...teacher, role: "STUDENT" });
    const malformed = new Request("http://localhost", {
      method: "POST",
      body: "not-json",
    });

    const response = await handleActivityAssistantRequest(
      malformed,
      dependencies(),
    );

    expect(response.status).toBe(403);
    expect(mocks.getConfig).not.toHaveBeenCalled();
    expect(mocks.createModel).not.toHaveBeenCalled();
    expect(mocks.startRun).not.toHaveBeenCalled();
  });

  it("fails disabled or missing configuration before provider and writes", async () => {
    mocks.getConfig.mockImplementation(() => {
      throw new ActivityAssistantConfigError("AI_DISABLED");
    });

    const response = await handleActivityAssistantRequest(
      userRequest(),
      dependencies(),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "ASSISTANT_UNAVAILABLE",
    });
    expect(mocks.createModel).not.toHaveBeenCalled();
    expect(mocks.startRun).not.toHaveBeenCalled();
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(mocks.publishRelease).not.toHaveBeenCalled();
  });

  it("rejects invalid messages before provider and AgentRun creation", async () => {
    const invalid = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ messages: [], actorId }),
    });

    const response = await handleActivityAssistantRequest(
      invalid,
      dependencies(),
    );

    expect(response.status).toBe(400);
    expect(mocks.createModel).not.toHaveBeenCalled();
    expect(mocks.startRun).not.toHaveBeenCalled();
  });

  it("records a provider interruption before tools without a business write", async () => {
    const interruptedModel = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "error", error: new Error("private provider detail") },
          ],
        }),
      }),
    });
    mocks.createModel.mockReturnValue(interruptedModel);
    mocks.finishRun.mockResolvedValue({
      id: runId,
      actorId,
      status: "FAILED",
      completedAt: now.toISOString(),
      failureCode: "MODEL_STREAM_FAILED",
    });

    const response = await handleActivityAssistantRequest(
      userRequest(),
      dependencies(),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain("private provider detail");
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(mocks.preparePublish).not.toHaveBeenCalled();
    expect(mocks.publishRelease).not.toHaveBeenCalled();
    expect(mocks.finishRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: "AGENT", actorId }),
      {
        agentRunId: runId,
        status: "FAILED",
        failureCode: "MODEL_STREAM_FAILED",
      },
    );
  });

  it("streams a strict draft proposal without a business write", async () => {
    const languageModel = successfulModel();
    mocks.createModel.mockReturnValue(languageModel);
    const response = await handleActivityAssistantRequest(
      userRequest(),
      dependencies(),
    );

    expect(response.status).toBe(200);
    const streamText = await response.text();
    expect(streamText).toContain("tool-approval-request");
    expect(streamText).toContain("taskUnderstandingSummary");
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(mocks.finishRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: "AGENT", actorId }),
      {
        agentRunId: runId,
        status: "SUCCEEDED",
        failureCode: null,
      },
    );
    expect(mocks.publishRelease).not.toHaveBeenCalled();
    expect(languageModel.doStreamCalls).toHaveLength(1);
    expect(languageModel.doStreamCalls[0]?.toolChoice).toEqual({ type: "auto" });
    expect(languageModel.doStreamCalls[0]?.providerOptions).toEqual({
      deepseek: { thinking: { type: "disabled" } },
    });
    expect(languageModel.doStreamCalls[0]?.maxOutputTokens).toBe(4_000);
  });

  it("forces the publish tool only for an explicit post-draft publish request", () => {
    const draftMessage = {
      id: "assistant_1",
      role: "assistant" as const,
      parts: [
        {
          type: "tool-create_activity_draft" as const,
          toolCallId: "draft_call",
          state: "output-available" as const,
          input: proposal,
          output: {
            draftId,
            version: 1,
            status: "READY_FOR_PREVIEW" as const,
            editHref: `/teacher/activities/${draftId}`,
            previewHref: `/teacher/activities/${draftId}/preview`,
          },
        },
      ],
    };
    const request = (text: string) => [
      {
        id: "message_1",
        role: "user" as const,
        parts: [{ type: "text" as const, text }],
      },
      draftMessage,
      {
        id: "message_2",
        role: "user" as const,
        parts: [{ type: "text" as const, text }],
      },
    ];

    expect(selectActivityAssistantToolChoice(request("請立即發佈版本 2"))).toEqual({
      type: "tool",
      toolName: "publish_activity_release",
    });
    expect(selectActivityAssistantToolChoice(request("不要發佈，先保留草稿"))).toBe(
      "auto",
    );
    expect(
      selectActivityAssistantToolChoice(request("請解釋目前的活動內容")),
    ).toBe("auto");
  });

  it("executes an approved draft proposal once and saves only its content", async () => {
    const proposalModel = successfulModel();
    const providerAfterWrite = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error("provider must not run after the approved draft write");
      },
    });
    mocks.createModel
      .mockReturnValueOnce(proposalModel)
      .mockReturnValueOnce(providerAfterWrite);
    mocks.startRun
      .mockResolvedValueOnce(startedRun(approvalRunId))
      .mockResolvedValueOnce(startedRun(executionRunId));

    const proposalResponse = await handleActivityAssistantRequest(
      userRequest(),
      dependencies(),
    );
    const approvedMessage = draftApprovalMessage(
      await proposalResponse.text(),
      true,
    );
    const executionResponse = await handleActivityAssistantRequest(
      messageRequest([
        { id: "message_1", role: "user", parts: [{ type: "text", text: "設計校園節水活動" }] },
        approvedMessage,
      ]),
      dependencies(),
    );

    expect(executionResponse.status).toBe(200);
    expect(await executionResponse.text()).toContain(draftId);
    expect(mocks.saveDraft).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: "AGENT", actorId }),
      expect.objectContaining({
        desiredStatus: "READY_FOR_PREVIEW",
        content,
        agentRunId: executionRunId,
      }),
    );
    expect(mocks.saveDraft.mock.calls[0]?.[2]?.content).toEqual(content);
    expect(mocks.saveDraft.mock.calls[0]?.[2]?.content).not.toHaveProperty(
      "taskUnderstandingSummary",
    );
    expect(providerAfterWrite.doStreamCalls).toHaveLength(1);
    expect(providerAfterWrite.doStreamCalls[0]?.abortSignal?.aborted).toBe(true);
  });

  it("does not write a draft when the teacher rejects its signed proposal", async () => {
    const proposalModel = successfulModel();
    const rejectionModel = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "rejection_text" },
            { type: "text-delta", id: "rejection_text", delta: "請補充活動要求。" },
            { type: "text-end", id: "rejection_text" },
            { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
          ],
        }),
      }),
    });
    mocks.createModel
      .mockReturnValueOnce(proposalModel)
      .mockReturnValueOnce(rejectionModel);
    mocks.startRun
      .mockResolvedValueOnce(startedRun(approvalRunId))
      .mockResolvedValueOnce(startedRun(executionRunId));

    const proposalResponse = await handleActivityAssistantRequest(userRequest(), dependencies());
    const rejectedMessage = draftApprovalMessage(await proposalResponse.text(), false);
    const rejectionResponse = await handleActivityAssistantRequest(
      messageRequest([
        { id: "message_1", role: "user", parts: [{ type: "text", text: "設計校園節水活動" }] },
        rejectedMessage,
      ]),
      dependencies(),
    );

    expect(await rejectionResponse.text()).toContain("請補充活動要求");
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });

  it("suppresses a duplicate proposal only in the rejected continuation, then permits a later user supplement", async () => {
    const proposalModel = successfulModel();
    const rejectedContinuationModel = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            {
              type: "tool-call",
              toolCallId: "duplicate_after_rejection",
              toolName: "create_activity_draft",
              input: JSON.stringify(proposal),
            },
            {
              type: "finish",
              finishReason: { unified: "tool-calls", raw: undefined },
              usage,
            },
          ],
        }),
      }),
    });
    const revisedProposalModel = successfulModel();
    mocks.createModel
      .mockReturnValueOnce(proposalModel)
      .mockReturnValueOnce(rejectedContinuationModel)
      .mockReturnValueOnce(revisedProposalModel);
    mocks.startRun
      .mockResolvedValueOnce(startedRun(approvalRunId))
      .mockResolvedValueOnce(startedRun(executionRunId))
      .mockResolvedValueOnce(startedRun(replayRunId));

    const initialUserMessage = {
      id: "message_1",
      role: "user",
      parts: [{ type: "text", text: "设计校园节水活动" }],
    };
    const initialResponse = await handleActivityAssistantRequest(
      messageRequest([initialUserMessage]),
      dependencies(),
    );
    const rejectedMessage = draftApprovalMessage(
      await initialResponse.text(),
      false,
    );

    const continuationResponse = await handleActivityAssistantRequest(
      messageRequest([initialUserMessage, rejectedMessage]),
      dependencies(),
    );
    const continuationEvents = sseEvents(await continuationResponse.text());

    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(
      continuationEvents.some(
        (event) =>
          event.type === "tool-approval-request" &&
          event.isAutomatic !== true,
      ),
    ).toBe(false);

    const supplementedResponse = await handleActivityAssistantRequest(
      messageRequest([
        initialUserMessage,
        rejectedMessage,
        {
          id: "message_2",
          role: "user",
          parts: [{ type: "text", text: "补充：学生需要用两次水表读数比较变化。" }],
        },
      ]),
      dependencies(),
    );
    const supplementedEvents = sseEvents(await supplementedResponse.text());

    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(
      supplementedEvents.some(
        (event) =>
          event.type === "tool-approval-request" &&
          event.isAutomatic !== true,
      ),
    ).toBe(true);
  });

  it("rejects a forged draft approval before commands or provider transport", async () => {
    const proposalModel = successfulModel();
    const providerAfterForgery = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error("forged draft approval must not reach the provider");
      },
    });
    mocks.createModel
      .mockReturnValueOnce(proposalModel)
      .mockReturnValueOnce(providerAfterForgery);
    mocks.startRun
      .mockResolvedValueOnce(startedRun(approvalRunId))
      .mockResolvedValueOnce(startedRun(executionRunId));

    const proposalResponse = await handleActivityAssistantRequest(userRequest(), dependencies());
    const forgedMessage = draftApprovalMessage(await proposalResponse.text(), true);
    forgedMessage.parts[0]!.approval.signature = "forged-signature";
    const forgedResponse = await handleActivityAssistantRequest(
      messageRequest([
        { id: "message_1", role: "user", parts: [{ type: "text", text: "設計校園節水活動" }] },
        forgedMessage,
      ]),
      dependencies(),
    );

    expect(await forgedResponse.text()).not.toContain("forged-signature");
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(providerAfterForgery.doStreamCalls).toHaveLength(0);
  });

  it("executes a signed approval continuation once and aborts the post-write provider step", async () => {
    const approvalModel = publishApprovalModel();
    const providerAfterWrite = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error("provider must not run after the approved write");
      },
    });
    mocks.createModel
      .mockReturnValueOnce(approvalModel)
      .mockReturnValueOnce(providerAfterWrite)
      .mockReturnValueOnce(providerAfterWrite);
    mocks.startRun
      .mockResolvedValueOnce(startedRun(approvalRunId))
      .mockResolvedValueOnce(startedRun(executionRunId))
      .mockResolvedValueOnce(startedRun(replayRunId));
    mocks.preparePublish.mockResolvedValueOnce({
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

    const publishConversation = postDraftPublishConversation();
    const approvalResponse = await handleActivityAssistantRequest(
      messageRequest(publishConversation),
      dependencies(),
    );
    const approvalBody = await approvalResponse.text();
    const approvedMessage = approvalMessage(approvalBody, true);

    expect(mocks.publishRelease).not.toHaveBeenCalled();
    expect(approvalModel.doStreamCalls[0]?.toolChoice).toEqual({
      type: "tool",
      toolName: "publish_activity_release",
    });
    const executionResponse = await handleActivityAssistantRequest(
      messageRequest([...publishConversation, approvedMessage]),
      dependencies(),
    );
    const executionBody = await executionResponse.text();

    expect(executionResponse.status).toBe(200);
    expect(executionBody).toContain(releaseId);
    expect(executionBody).not.toContain("助手請求未完成");
    expect(mocks.preparePublish).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: "AGENT", actorId }),
      expect.objectContaining({
        draftId,
        classroomId,
        agentRunId: executionRunId,
      }),
    );
    expect(mocks.decideIntent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: "UI", actorId }),
      { actionIntentId: intentId, decision: "CONFIRM" },
    );
    expect(mocks.publishRelease).toHaveBeenCalledTimes(1);
    expect(providerAfterWrite.doStreamCalls).toHaveLength(1);
    expect(
      providerAfterWrite.doStreamCalls[0]?.abortSignal?.aborted,
    ).toBe(true);
    expect(mocks.finishRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: "AGENT", actorId }),
      {
        agentRunId: executionRunId,
        status: "SUCCEEDED",
        failureCode: null,
      },
    );

    mocks.preparePublish.mockRejectedValueOnce(
      new PreparePublishActivityIntentError("IDEMPOTENCY_MISMATCH"),
    );
    const replayResponse = await handleActivityAssistantRequest(
      messageRequest([...publishConversation, approvedMessage]),
      dependencies(),
    );
    await replayResponse.text();

    expect(mocks.publishRelease).toHaveBeenCalledTimes(1);
    expect(mocks.preparePublish).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ source: "AGENT", actorId }),
      expect.objectContaining({ agentRunId: replayRunId }),
    );
  });

  it("keeps a committed approved publish successful when the request aborts in flight", async () => {
    const approvalModel = publishApprovalModel();
    const providerAfterWrite = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error("post-write provider must remain non-authoritative");
      },
    });
    mocks.createModel
      .mockReturnValueOnce(approvalModel)
      .mockReturnValueOnce(providerAfterWrite);
    mocks.startRun
      .mockResolvedValueOnce(startedRun(approvalRunId))
      .mockResolvedValueOnce(startedRun(executionRunId));
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
    let resolvePublish!: (value: {
      releaseId: string;
      snapshotHash: string;
      publishedAt: string;
    }) => void;
    const publishStarted = Promise.withResolvers<void>();
    mocks.publishRelease.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePublish = resolve;
          publishStarted.resolve();
        }),
    );
    const userMessage = {
      id: "message_1",
      role: "user",
      parts: [{ type: "text", text: "發佈這份活動" }],
    };
    const approvalResponse = await handleActivityAssistantRequest(
      messageRequest([userMessage]),
      dependencies(),
    );
    const approvedMessage = approvalMessage(
      await approvalResponse.text(),
      true,
    );
    const abortController = new AbortController();
    const executionResponse = await handleActivityAssistantRequest(
      messageRequest([userMessage, approvedMessage], abortController.signal),
      dependencies(),
    );
    const responseBody = executionResponse.text();

    await publishStarted.promise;
    abortController.abort(new DOMException("client disconnected", "AbortError"));
    resolvePublish({
      releaseId,
      snapshotHash: "b".repeat(64),
      publishedAt: now.toISOString(),
    });
    await responseBody;

    expect(mocks.publishRelease).toHaveBeenCalledTimes(1);
    expect(mocks.finishRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: "AGENT", actorId }),
      {
        agentRunId: executionRunId,
        status: "SUCCEEDED",
        failureCode: null,
      },
    );
    expect(mocks.finishRun).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        agentRunId: executionRunId,
        status: "CANCELLED",
      }),
    );
  });

  it("keeps a rejected signed approval read-only through the full handler", async () => {
    const approvalModel = publishApprovalModel();
    const rejectionModel = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "rejection_text" },
            {
              type: "text-delta",
              id: "rejection_text",
              delta: "已取消發佈。",
            },
            { type: "text-end", id: "rejection_text" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: undefined },
              usage,
            },
          ],
        }),
      }),
    });
    mocks.createModel
      .mockReturnValueOnce(approvalModel)
      .mockReturnValueOnce(rejectionModel);
    mocks.startRun
      .mockResolvedValueOnce(startedRun(approvalRunId))
      .mockResolvedValueOnce(startedRun(executionRunId));
    const userMessage = {
      id: "message_1",
      role: "user",
      parts: [{ type: "text", text: "發佈這份活動" }],
    };
    const approvalResponse = await handleActivityAssistantRequest(
      messageRequest([userMessage]),
      dependencies(),
    );
    const rejectedMessage = approvalMessage(
      await approvalResponse.text(),
      false,
    );

    const rejectionResponse = await handleActivityAssistantRequest(
      messageRequest([userMessage, rejectedMessage]),
      dependencies(),
    );
    const rejectionBody = await rejectionResponse.text();

    expect(rejectionBody).toContain("已取消發佈");
    expect(mocks.preparePublish).not.toHaveBeenCalled();
    expect(mocks.decideIntent).not.toHaveBeenCalled();
    expect(mocks.publishRelease).not.toHaveBeenCalled();
    expect(mocks.finishRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: "AGENT", actorId }),
      {
        agentRunId: executionRunId,
        status: "SUCCEEDED",
        failureCode: null,
      },
    );
  });

  it("rejects a forged handler approval before commands or provider transport", async () => {
    const approvalModel = publishApprovalModel();
    const providerAfterForgery = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error("forged approval must not reach the provider");
      },
    });
    mocks.createModel
      .mockReturnValueOnce(approvalModel)
      .mockReturnValueOnce(providerAfterForgery);
    mocks.startRun
      .mockResolvedValueOnce(startedRun(approvalRunId))
      .mockResolvedValueOnce(startedRun(executionRunId));
    const userMessage = {
      id: "message_1",
      role: "user",
      parts: [{ type: "text", text: "發佈這份活動" }],
    };
    const approvalResponse = await handleActivityAssistantRequest(
      messageRequest([userMessage]),
      dependencies(),
    );
    const approvalBody = await approvalResponse.text();
    const forgedMessage = approvalMessage(approvalBody, true);
    forgedMessage.parts[0]!.approval.signature = "forged-signature";

    const forgedResponse = await handleActivityAssistantRequest(
      messageRequest([userMessage, forgedMessage]),
      dependencies(),
    );
    const forgedBody = await forgedResponse.text();

    expect(forgedResponse.status).toBe(200);
    expect(forgedBody).not.toContain("forged-signature");
    expect(mocks.preparePublish).not.toHaveBeenCalled();
    expect(mocks.decideIntent).not.toHaveBeenCalled();
    expect(mocks.publishRelease).not.toHaveBeenCalled();
    expect(providerAfterForgery.doStreamCalls).toHaveLength(0);
    expect(mocks.finishRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: "AGENT", actorId }),
      {
        agentRunId: executionRunId,
        status: "FAILED",
        failureCode: "MODEL_STREAM_FAILED",
      },
    );
  });
});
