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

// The two drafters. One call each, no tools, and the thing being bought is
// judgement: on an ambiguous evaluation every gear named the problem in prose
// but only the thinking ones carried it into the level — dimension one landed on
// the correct "improve" 2/5 times without thinking, 4/5 at low, 5/5 at high, and
// the spread of whole outcomes narrowed from five distinct results to three. A
// grade that contradicts its own summary is the worst thing to hand a reviewing
// teacher, so this pays roughly 13s against 2s for the steadier judgement.
//
// Spelled camelCase on purpose. @ai-sdk/openai-compatible forwards unknown
// provider options verbatim, then writes `reasoning_effort` itself from its own
// `reasoningEffort` field — so a snake_case gear is passed through and then
// overwritten with undefined, reaching the API as nothing at all. The contract
// test asserts the serialized request, which is how that was caught.
export const deepSeekThinkingProviderOptions = {
  deepseek: { reasoningEffort: "high" },
} as const;

// The agent loop's ordinary `auto` turns. A lower gear than the drafters get,
// because this is not one call: retrieval runs up to six steps before the draft
// call, every step pays the gear, and the whole stream shares one 90s budget.
// Measured on a full activity design that searches and reads before proposing —
// 50s with no thinking, 61s here, 100s at the drafters' gear, which overran the
// budget and cancelled the run outright. The design still reasons; it just
// cannot afford to reason six times over on its way there.
export const deepSeekAgentLoopProviderOptions = {
  deepseek: { reasoningEffort: "low" },
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
    ? deepSeekAgentLoopProviderOptions
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

/**
 * Attachment images use a bounded, tool-free subcall rather than moving the
 * whole teacher workflow onto an experimental vision model. The description
 * returned by that subcall is the only image-derived value the drafting model
 * receives.
 */
export function createDeepSeekAttachmentVisionModel(
  config: Pick<
    ActivityAssistantConfig,
    "apiKey" | "attachmentVisionModel"
  >,
): LanguageModel {
  return createOpenAICompatible({
    name: "deepseek",
    baseURL: deepSeekBaseUrl,
    apiKey: config.apiKey,
  }).chatModel(config.attachmentVisionModel);
}
