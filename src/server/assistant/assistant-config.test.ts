import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ActivityAssistantConfigError,
  getActivityAssistantConfig,
  isActivityAssistantEnabled,
} from "./assistant-config";

const validEnvironment = {
  AI_PROVIDER_DISABLED: "0",
  DEEPSEEK_API_KEY: "deepseek-test-key",
  AI_MODEL: "deepseek-v4-flash",
  AI_TOOL_APPROVAL_SECRET: "s".repeat(32),
};

describe("activity assistant configuration", () => {
  it("returns the complete DeepSeek and approval boundary", () => {
    expect(getActivityAssistantConfig(validEnvironment)).toEqual({
      apiKey: "deepseek-test-key",
      model: "deepseek-v4-flash",
      attachmentVisionModel: "deepseek-v4-flash-vision-exp",
      approvalSecret: "s".repeat(32),
    });
  });

  it("offers a provider-free server-component gate", () => {
    expect(isActivityAssistantEnabled(validEnvironment)).toBe(true);
    expect(
      isActivityAssistantEnabled({
        ...validEnvironment,
        AI_PROVIDER_DISABLED: "1",
      }),
    ).toBe(false);
    expect(
      isActivityAssistantEnabled({
        ...validEnvironment,
        DEEPSEEK_API_KEY: "k".repeat(2_001),
      }),
    ).toBe(false);
  });

  it.each([
    [
      { ...validEnvironment, AI_PROVIDER_DISABLED: "true" },
      "AI_DISABLED",
    ],
    [
      { ...validEnvironment, DEEPSEEK_API_KEY: "" },
      "DEEPSEEK_API_NOT_CONFIGURED",
    ],
    [
      { ...validEnvironment, AI_MODEL: "openai/gpt-5-mini" },
      "AI_MODEL_NOT_CONFIGURED",
    ],
    [
      { ...validEnvironment, AI_ATTACHMENT_VISION_MODEL: "openai/gpt-5" },
      "AI_MODEL_NOT_CONFIGURED",
    ],
    [
      { ...validEnvironment, AI_TOOL_APPROVAL_SECRET: "too-short" },
      "AI_APPROVAL_SECRET_NOT_CONFIGURED",
    ],
  ] as const)("fails closed for incomplete provider settings", (environment, code) => {
    expect(() => getActivityAssistantConfig(environment)).toThrowError(
      new ActivityAssistantConfigError(code),
    );
  });
});
