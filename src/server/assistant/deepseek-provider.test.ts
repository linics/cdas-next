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
  createDeepSeekModel,
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

  it("withholds thinking from exactly the turns that name a tool", () => {
    expect(deepSeekProviderOptionsForToolChoice("auto")).toBe(
      deepSeekThinkingProviderOptions,
    );
    expect(
      deepSeekProviderOptionsForToolChoice({
        type: "tool",
        toolName: "publish_activity_release",
      }),
    ).toBe(deepSeekNamedToolProviderOptions);
  });
});
