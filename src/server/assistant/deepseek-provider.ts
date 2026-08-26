import "server-only";

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { ActivityAssistantConfig } from "./assistant-config";

const deepSeekBaseUrl = "https://api.deepseek.com";

// DeepSeek V4 defaults to thinking mode, which rejects named tool_choice.
// This bounded teacher workflow needs named tool selection for an explicit
// publish request, so keep it in the provider's supported non-thinking mode.
export const deepSeekActivityAssistantProviderOptions = {
  deepseek: { thinking: { type: "disabled" } },
} as const;

/**
 * Construct the model at the external-provider boundary. The API key stays
 * server-only and is sent directly to DeepSeek; Vercel AI Gateway is not used.
 */
export function createDeepSeekModel(
  config: Pick<ActivityAssistantConfig, "apiKey" | "model">,
): LanguageModel {
  return createOpenAICompatible({
    name: "deepseek",
    baseURL: deepSeekBaseUrl,
    apiKey: config.apiKey,
  }).chatModel(config.model);
}
