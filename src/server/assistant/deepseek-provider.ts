import "server-only";

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { ActivityAssistantConfig } from "./assistant-config";

const deepSeekBaseUrl = "https://api.deepseek.com";

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
