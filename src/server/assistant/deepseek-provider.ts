import "server-only";

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { ActivityAssistantConfig } from "./assistant-config";

const deepSeekBaseUrl = "https://api.deepseek.com";

// DeepSeek V4 defaults to thinking mode, which rejects named tool_choice. The
// agent loop needs named tool selection twice — forcing publish_activity_release
// on an explicit request, and D-050's single repair retry — so it stays in the
// provider's supported non-thinking mode. This is a hard requirement, not a
// tuning choice: without it those two behaviours have no mechanism.
export const deepSeekAgentLoopProviderOptions = {
  deepseek: { thinking: { type: "disabled" } },
} as const;

// The drafters call no tools, so the constraint above does not reach them; they
// were only sharing the agent loop's constant. Measured on an ambiguous
// submission — a student who admitted estimating one of their readings — the
// gears differ where it matters. Every gear named the estimate in its prose, but
// only the thinking ones carried it into the level: across five runs, dimension
// one landed on the correct "improve" 2/5 times without thinking, 4/5 at low and
// 5/5 at high, and the spread of whole outcomes narrowed from five distinct
// results to three. A teacher reviewing a draft is worst served by a grade that
// contradicts its own summary, so the drafters buy the steadier judgement at
// roughly 13s against 2s.
// Spelled camelCase on purpose. @ai-sdk/openai-compatible forwards unknown
// provider options verbatim, but then writes `reasoning_effort` itself from its
// own `reasoningEffort` field — so a snake_case gear is passed through and then
// overwritten with undefined, reaching the API as nothing at all. The contract
// test asserts the wire, which is how that was caught.
export const deepSeekDrafterProviderOptions = {
  deepseek: { reasoningEffort: "high" },
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
