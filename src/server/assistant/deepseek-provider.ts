import "server-only";

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { ActivityAssistantConfig } from "./assistant-config";

const deepSeekBaseUrl = "https://api.deepseek.com";

// DeepSeek refuses the combination outright: naming a tool while thinking is on
// comes back as "Thinking mode does not support this tool_choice". That refusal
// is the only reason any call here runs without thinking, so it is scoped to the
// calls that actually name a tool — forcing publish_activity_release on an
// explicit request, and D-050's single repair retry. Every other turn is free to
// think, including the ones that design an activity.
export const deepSeekNamedToolProviderOptions = {
  deepseek: { thinking: { type: "disabled" } },
} as const;

// Everything else: the agent loop's ordinary `auto` turns, and the two drafters,
// which call no tools at all.
//
// Measured rather than assumed, on the two shapes that matter. Drafting an
// evaluation for a student who admitted estimating one of their readings, every
// gear named the estimate in its prose but only the thinking ones carried it
// into the level — dimension one landed on the correct "improve" 2/5 times
// without thinking, 4/5 at low, 5/5 at high, and the spread of whole outcomes
// narrowed from five distinct results to three. Designing an activity, the high
// gear returned consistently fuller tool arguments (1081-1266 characters against
// 992-1068) with no loss of reliability; malformed payloads happen at every gear,
// which is what D-050 is for. On trivial routing turns thinking costs 13-20
// reasoning tokens, so the gear is cheap where it earns nothing.
//
// Spelled camelCase on purpose. @ai-sdk/openai-compatible forwards unknown
// provider options verbatim, then writes `reasoning_effort` itself from its own
// `reasoningEffort` field — so a snake_case gear is passed through and then
// overwritten with undefined, reaching the API as nothing at all. The contract
// test asserts the serialized request, which is how that was caught.
export const deepSeekThinkingProviderOptions = {
  deepseek: { reasoningEffort: "high" },
} as const;

/**
 * Pick the gear from the turn's own tool choice, because that is exactly what
 * the provider's refusal keys on. A turn that names a tool must not think; a
 * turn that leaves the choice open may.
 */
export function deepSeekProviderOptionsForToolChoice(
  toolChoice: "auto" | Readonly<{ type: "tool"; toolName: string }>,
) {
  return toolChoice === "auto"
    ? deepSeekThinkingProviderOptions
    : deepSeekNamedToolProviderOptions;
}

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
