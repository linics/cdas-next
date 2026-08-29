import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

import {
  deepSeekAgentLoopProviderOptions,
  deepSeekDrafterProviderOptions,
} from "./deepseek-provider";

describe("DeepSeek provider request contract", () => {
  it("serializes non-thinking mode with the named publish tool choice", async () => {
    let requestUrl = "";
    let requestBody: unknown;
    const interceptedFetch: typeof fetch = async (input, init) => {
      requestUrl = input instanceof Request ? input.url : String(input);
      requestBody = JSON.parse(String(init?.body));

      return new Response(
        JSON.stringify({
          id: "chatcmpl-contract",
          object: "chat.completion",
          created: 1,
          model: "deepseek-v4-flash",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call-contract",
                    type: "function",
                    function: {
                      name: "publish_activity_release",
                      arguments: "{}",
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };
    const provider = createOpenAICompatible({
      name: "deepseek",
      baseURL: "https://api.deepseek.com",
      apiKey: "contract-test-key",
      fetch: interceptedFetch,
    });

    await generateText({
      model: provider.chatModel("deepseek-v4-flash"),
      prompt: "請發佈既有草稿。",
      tools: {
        publish_activity_release: tool({
          description: "Publish an existing activity draft.",
          inputSchema: z.object({}),
        }),
      },
      toolChoice: {
        type: "tool",
        toolName: "publish_activity_release",
      },
      providerOptions: deepSeekAgentLoopProviderOptions,
    });

    expect(requestUrl).toBe("https://api.deepseek.com/chat/completions");
    expect(requestBody).toMatchObject({
      model: "deepseek-v4-flash",
      thinking: { type: "disabled" },
      tool_choice: {
        type: "function",
        function: { name: "publish_activity_release" },
      },
      tools: [
        {
          type: "function",
          function: { name: "publish_activity_release" },
        },
      ],
    });
  });

  it("serializes the drafter's reasoning gear, with no tool choice to conflict with", async () => {
    let requestBody: Record<string, unknown> = {};
    const interceptedFetch: typeof fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          id: "chatcmpl-drafter",
          object: "chat.completion",
          created: 1,
          model: "deepseek-v4-flash",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "起草文本" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const provider = createOpenAICompatible({
      name: "deepseek",
      baseURL: "https://api.deepseek.com",
      apiKey: "contract-test-key",
      fetch: interceptedFetch,
    });

    await generateText({
      model: provider.chatModel("deepseek-v4-flash"),
      prompt: "起草一份评价建议。",
      providerOptions: deepSeekDrafterProviderOptions,
    });

    // A gear the provider drops on the floor buys nothing and says nothing, so
    // assert it on the wire rather than trusting the option object.
    expect(requestBody).toMatchObject({
      model: "deepseek-v4-flash",
      reasoning_effort: "high",
    });
    // The agent loop's non-thinking pin exists for named tool_choice; the
    // drafters name no tool, so that pin must not follow them here.
    expect(requestBody).not.toHaveProperty("thinking");
    expect(requestBody).not.toHaveProperty("tool_choice");
  });
});
