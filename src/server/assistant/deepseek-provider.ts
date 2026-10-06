import "server-only";

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, type LanguageModel } from "ai";
import { z } from "zod";
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

// N1 adaptation rewrites a whole task book's selected areas in one call. The
// output is long and the judgement is lighter than grading: at the drafters'
// high gear one of nine real calls (goals + rubric) overran 120s, so it gets
// the low gear that still keeps the rewrite reasoned.
export const deepSeekRewriteProviderOptions = {
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
 * The drafters ask for `response_format: {type: "json_object"}`, and DeepSeek
 * sometimes copies that into its answer as a top-level `"type": "json_object"`
 * key beside an otherwise valid object. The drafters' outer schemas are strict,
 * so that one echoed key threw away a correct evaluation draft (1 of 8 real
 * calls on 2026-10-06). Drop exactly that key and nothing else: any other
 * unknown field still fails the strict schema it wraps.
 */
export function ignoringEchoedResponseFormat<Schema extends z.ZodType>(
  schema: Schema,
) {
  return z.preprocess((value) => {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).type === "json_object"
    ) {
      const rest: Record<string, unknown> = { ...value };
      delete rest.type;
      return rest;
    }
    return value;
  }, schema);
}

function isStreamingRequest(body: unknown): boolean {
  if (typeof body !== "string") return false;
  try {
    return (JSON.parse(body) as { stream?: unknown }).stream === true;
  } catch {
    return false;
  }
}

/**
 * DeepSeek answers a non-streaming request with its status line first and keeps
 * the body open while it thinks — tens of seconds at the drafters' gear. A
 * connection dropped in that window surfaces after a 200, which the SDK reads
 * as "not retryable", so one network blip failed the teacher's draft outright.
 * The 2026-10-06 real-model smoke hit exactly that: the socket closed at 35s
 * and the evaluation drafter ended EVALUATION_SUGGESTION_PROVIDER_FAILED.
 *
 * Reading the body here moves that failure inside fetch, where it is reported
 * as a retryable call error and the SDK's own retry runs. Streaming requests
 * pass through untouched: their body is the stream the caller consumes.
 */
export function deepSeekFetch(baseFetch: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    if (!response.ok || isStreamingRequest(init?.body)) {
      return response;
    }
    try {
      const body = await response.arrayBuffer();
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      if (init?.signal?.aborted) throw error;
      throw new APICallError({
        message: "DeepSeek closed the connection before the response finished",
        cause: error,
        url: input instanceof Request ? input.url : String(input),
        requestBodyValues: undefined,
        statusCode: response.status,
        isRetryable: true,
      });
    }
  };
}

/**
 * Construct the model at the external-provider boundary. The API key stays
 * server-only and is sent directly to DeepSeek; Vercel AI Gateway is not used.
 */
export function createDeepSeekModel(
  config: Pick<ActivityAssistantConfig, "apiKey" | "model">,
  baseFetch: typeof fetch = fetch,
): LanguageModel {
  return createOpenAICompatible({
    name: "deepseek",
    baseURL: deepSeekBaseUrl,
    apiKey: config.apiKey,
    fetch: deepSeekFetch(baseFetch),
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
  baseFetch: typeof fetch = fetch,
): LanguageModel {
  return createOpenAICompatible({
    name: "deepseek",
    baseURL: deepSeekBaseUrl,
    apiKey: config.apiKey,
    fetch: deepSeekFetch(baseFetch),
  }).chatModel(config.attachmentVisionModel);
}
