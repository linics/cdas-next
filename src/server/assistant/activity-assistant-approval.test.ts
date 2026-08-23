import {
  generateText,
  InvalidToolApprovalSignatureError,
  tool,
  type ModelMessage,
  type ToolApprovalResponse,
} from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

const secret = "approval-secret-for-tests-32-bytes-minimum";
const toolCallId = "publish_call_signed_1";
const publishInput = {
  draftId: "10000000-0000-4000-8000-000000000001",
  expectedDraftVersion: 2,
  classroomId: "20000000-0000-4000-8000-000000000002",
  dueAt: null,
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

function model() {
  return new MockLanguageModelV4({
    doGenerate: [
      {
        content: [
          {
            type: "tool-call",
            toolCallId,
            toolName: "publish_activity_release",
            input: JSON.stringify(publishInput),
          },
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage,
        warnings: [],
      },
      {
        content: [{ type: "text", text: "完成" }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
    ],
  });
}

const publishSchema = z
  .object({
    draftId: z.uuid(),
    expectedDraftVersion: z.int().positive(),
    classroomId: z.uuid(),
    dueAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

type PublishInput = z.infer<typeof publishSchema>;

function registry(
  execute: (input: PublishInput) => Promise<{ status: string }>,
) {
  return {
    publish_activity_release: tool({
      inputSchema: publishSchema,
      strict: true,
      execute: async (input) => execute(input),
    }),
  };
}

async function approvalRequest(
  languageModel: MockLanguageModelV4,
  tools: ReturnType<typeof registry>,
) {
  const messages: ModelMessage[] = [
    { role: "user", content: "请发布这个活动" },
  ];
  const result = await generateText({
    model: languageModel,
    messages,
    tools,
    toolApproval: { publish_activity_release: "user-approval" },
    experimental_toolApprovalSecret: secret,
  });
  const approval = result.content.find(
    (part) =>
      part.type === "tool-approval-request" && !part.isAutomatic,
  );
  if (!approval || approval.type !== "tool-approval-request") {
    throw new Error("Expected a signed approval request");
  }
  return { messages, result, approval };
}

function approvalMessage(
  approvalId: string,
  approved: boolean,
): ModelMessage {
  const response: ToolApprovalResponse = {
    type: "tool-approval-response",
    approvalId,
    approved,
  };
  return { role: "tool", content: [response] };
}

describe("AI SDK signed publish approval", () => {
  it("does not execute until the exact signed approval is confirmed", async () => {
    const execute = vi.fn().mockResolvedValue({ status: "PUBLISHED" });
    const tools = registry(execute);
    const languageModel = model();
    const first = await approvalRequest(languageModel, tools);

    expect(execute).not.toHaveBeenCalled();
    expect(first.approval.signature).toBeTruthy();

    await generateText({
      model: languageModel,
      messages: [
        ...first.messages,
        ...first.result.responseMessages,
        approvalMessage(first.approval.approvalId, true),
      ],
      tools,
      toolApproval: { publish_activity_release: "user-approval" },
      experimental_toolApprovalSecret: secret,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(publishInput);
  });

  it("does not execute a rejected approval", async () => {
    const execute = vi.fn().mockResolvedValue({ status: "PUBLISHED" });
    const tools = registry(execute);
    const languageModel = model();
    const first = await approvalRequest(languageModel, tools);

    await generateText({
      model: languageModel,
      messages: [
        ...first.messages,
        ...first.result.responseMessages,
        approvalMessage(first.approval.approvalId, false),
      ],
      tools,
      toolApproval: { publish_activity_release: "user-approval" },
      experimental_toolApprovalSecret: secret,
    });

    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects a forged signature before tool execution", async () => {
    const execute = vi.fn().mockResolvedValue({ status: "PUBLISHED" });
    const tools = registry(execute);
    const languageModel = model();
    const first = await approvalRequest(languageModel, tools);
    const tampered = structuredClone(first.result.responseMessages);
    for (const message of tampered) {
      if (message.role !== "assistant" || !Array.isArray(message.content)) {
        continue;
      }
      for (const part of message.content) {
        if (part.type === "tool-approval-request") {
          part.signature = "forged-signature";
        }
      }
    }

    await expect(
      generateText({
        model: languageModel,
        messages: [
          ...first.messages,
          ...tampered,
          approvalMessage(first.approval.approvalId, true),
        ],
        tools,
        toolApproval: { publish_activity_release: "user-approval" },
        experimental_toolApprovalSecret: secret,
      }),
    ).rejects.toBeInstanceOf(InvalidToolApprovalSignatureError);
    expect(execute).not.toHaveBeenCalled();
    expect(languageModel.doGenerateCalls).toHaveLength(1);
  });
});
