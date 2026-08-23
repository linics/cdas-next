import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ActivityAssistantConfigError,
  getActivityAssistantConfig,
  isActivityAssistantEnabled,
} from "./assistant-config";

const validEnvironment = {
  AI_PROVIDER_DISABLED: "0",
  AI_GATEWAY_API_KEY: "gateway-test-key",
  AI_MODEL: "openai/gpt-5-mini",
  AI_TOOL_APPROVAL_SECRET: "s".repeat(32),
};

describe("activity assistant configuration", () => {
  it("returns the complete gateway and approval boundary", () => {
    expect(getActivityAssistantConfig(validEnvironment)).toEqual({
      apiKey: "gateway-test-key",
      model: "openai/gpt-5-mini",
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
        AI_GATEWAY_API_KEY: "k".repeat(2_001),
      }),
    ).toBe(false);
  });

  it.each([
    [
      { ...validEnvironment, AI_PROVIDER_DISABLED: "true" },
      "AI_DISABLED",
    ],
    [
      { ...validEnvironment, AI_GATEWAY_API_KEY: "" },
      "AI_GATEWAY_NOT_CONFIGURED",
    ],
    [
      { ...validEnvironment, AI_MODEL: "not-a-gateway-model" },
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
