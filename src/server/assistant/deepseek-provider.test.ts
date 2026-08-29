import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chatModel: vi.fn(),
  createOpenAICompatible: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: mocks.createOpenAICompatible,
}));

import {
  createDeepSeekAttachmentVisionModel,
  createDeepSeekModel,
  deepSeekAgentLoopProviderOptions,
  deepSeekNamedToolProviderOptions,
  deepSeekProviderOptionsForToolChoice,
  deepSeekThinkingProviderOptions,
} from "./deepseek-provider";

describe("DeepSeek provider boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createOpenAICompatible.mockReturnValue({
      chatModel: mocks.chatModel,
    });
    mocks.chatModel.mockReturnValue({ provider: "deepseek.chat" });
  });

  it("sends the server-only key and direct model ID to the official API", () => {
    const model = createDeepSeekModel({
      apiKey: "deepseek-secret-key",
      model: "deepseek-v4-flash",
    });

    expect(mocks.createOpenAICompatible).toHaveBeenCalledWith({
      name: "deepseek",
      baseURL: "https://api.deepseek.com",
      apiKey: "deepseek-secret-key",
    });
    expect(mocks.chatModel).toHaveBeenCalledWith(
      "deepseek-v4-flash",
    );
    expect(model).toEqual({ provider: "deepseek.chat" });
  });

  it("keeps the experimental vision model inside the attachment subcall", () => {
    createDeepSeekAttachmentVisionModel({
      apiKey: "deepseek-secret-key",
      attachmentVisionModel: "deepseek-v4-flash-vision-exp",
    });

    expect(mocks.chatModel).toHaveBeenCalledWith(
      "deepseek-v4-flash-vision-exp",
    );
  });

  it("uses V4 non-thinking mode for the named publish tool choice", () => {
    expect(deepSeekNamedToolProviderOptions).toEqual({
      deepseek: { thinking: { type: "disabled" } },
    });
  });

  it("lets everything else think, and keeps the two settings apart", () => {
    expect(deepSeekThinkingProviderOptions).toEqual({
      deepseek: { reasoningEffort: "high" },
    });
    // Sharing one constant is what silently spread the named-tool constraint to
    // calls that never name a tool.
    expect(deepSeekThinkingProviderOptions).not.toEqual(
      deepSeekNamedToolProviderOptions,
    );
  });

  it("spends less reasoning per step in the multi-step loop than in a one-shot draft", () => {
    // Both think; the loop pays its gear on every retrieval step and the whole
    // stream shares one 90s budget. Measured on a full activity design: 61s
    // here against 100s at the drafters' gear, which overran and cancelled.
    expect(deepSeekAgentLoopProviderOptions).toEqual({
      deepseek: { reasoningEffort: "low" },
    });
    expect(deepSeekThinkingProviderOptions).toEqual({
      deepseek: { reasoningEffort: "high" },
    });
  });

  it("withholds thinking from exactly the turns that name a tool", () => {
    expect(deepSeekProviderOptionsForToolChoice("auto")).toBe(
      deepSeekAgentLoopProviderOptions,
    );
    expect(
      deepSeekProviderOptionsForToolChoice({
        type: "tool",
        toolName: "publish_activity_release",
      }),
    ).toBe(deepSeekNamedToolProviderOptions);
  });
});
