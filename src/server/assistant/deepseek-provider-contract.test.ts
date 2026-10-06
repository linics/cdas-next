import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, NoObjectGeneratedError, Output, tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

import {
  createDeepSeekModel,
  deepSeekFetch,
  ignoringEchoedResponseFormat,
  retryingUnparseableJson,
  deepSeekNamedToolProviderOptions,
  deepSeekProviderOptionsForToolChoice,
  deepSeekThinkingProviderOptions,
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
      providerOptions: deepSeekNamedToolProviderOptions,
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
      providerOptions: deepSeekThinkingProviderOptions,
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

  it("still sends the gear on an auto turn that carries tools", async () => {
    let requestBody: Record<string, unknown> = {};
    const interceptedFetch: typeof fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          id: "chatcmpl-auto",
          object: "chat.completion",
          created: 1,
          model: "deepseek-v4-flash",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "已了解你的活动构想。" },
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
      prompt: "帮我设计一个七年级校园节水的跨学科活动。",
      tools: {
        create_activity_draft: tool({
          description: "Create a previewable activity draft.",
          inputSchema: z.object({ title: z.string() }),
        }),
      },
      toolChoice: "auto",
      providerOptions: deepSeekProviderOptionsForToolChoice("auto"),
    });

    // Designing an activity is an `auto` turn, and DeepSeek only refuses
    // thinking when a tool is named — so the turn that writes the most content
    // is precisely the one that must keep its gear.
    expect(requestBody).toMatchObject({
      reasoning_effort: "low",
      tool_choice: "auto",
    });
    expect(requestBody).not.toHaveProperty("thinking");
  });
});

describe("DeepSeek dropped responses", () => {
  const completion = () =>
    new Response(
      JSON.stringify({
        id: "chatcmpl-retry",
        object: "chat.completion",
        created: 1,
        model: "deepseek-v4-flash",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "起草完成" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  // What DeepSeek does while thinking: a 200 and a few keep-alive newlines,
  // then the socket goes away before the JSON arrives.
  const droppedMidBody = () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("\n\n"));
          controller.error(new TypeError("terminated"));
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  it("retries a non-streaming call whose connection closed mid-body", async () => {
    let calls = 0;
    const network: typeof fetch = async () => {
      calls += 1;
      return calls === 1 ? droppedMidBody() : completion();
    };

    const result = await generateText({
      model: createDeepSeekModel(
        { apiKey: "contract-test-key", model: "deepseek-v4-flash" },
        network,
      ),
      prompt: "起草一条反馈。",
    });

    expect(result.text).toBe("起草完成");
    expect(calls).toBe(2);
  }, 15_000);

  it("leaves a streaming response for the caller to read", async () => {
    const streamed = droppedMidBody();
    const response = await deepSeekFetch(async () => streamed)(
      "https://api.deepseek.com/chat/completions",
      { method: "POST", body: JSON.stringify({ stream: true }) },
    );

    expect(response).toBe(streamed);
  });

  it("does not retry a call the caller aborted", async () => {
    const controller = new AbortController();
    const wrapped = deepSeekFetch(async () => {
      controller.abort();
      return droppedMidBody();
    });

    await expect(
      wrapped("https://api.deepseek.com/chat/completions", {
        method: "POST",
        body: JSON.stringify({ stream: false }),
        signal: controller.signal,
      }),
    ).rejects.toThrow("terminated");
  });
});

describe("DeepSeek json_object answers", () => {
  const answering = (content: string): typeof fetch => async () =>
    new Response(
      JSON.stringify({
        id: "chatcmpl-json",
        object: "chat.completion",
        created: 1,
        model: "deepseek-v4-flash",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  const draftSchema = z.object({ summary: z.string() }).strict();
  const draft = (content: string) =>
    generateText({
      model: createDeepSeekModel(
        { apiKey: "contract-test-key", model: "deepseek-v4-flash" },
        answering(content),
      ),
      output: Output.object({
        schema: ignoringEchoedResponseFormat(draftSchema),
      }),
      prompt: "起草。",
    });

  it("accepts a valid draft that echoed the response format", async () => {
    // Verbatim shape from a real evaluation draft that was thrown away.
    const result = await draft(
      JSON.stringify({ type: "json_object", summary: "证据清楚。" }),
    );

    expect(result.output).toEqual({ summary: "证据清楚。" });
  });

  it("still refuses any other unknown key", async () => {
    await expect(
      draft(JSON.stringify({ summary: "证据清楚。", note: "给教师看" })),
    ).rejects.toSatisfy((error) => NoObjectGeneratedError.isInstance(error));
  });
});

describe("DeepSeek answers that are not JSON (D-092)", () => {
  const answeringInTurn = (contents: readonly string[]) => {
    const calls = { count: 0 };
    const fetchImpl: typeof fetch = async () => {
      const content = contents[Math.min(calls.count, contents.length - 1)]!;
      calls.count += 1;
      return new Response(
        JSON.stringify({
          id: "chatcmpl-json",
          object: "chat.completion",
          created: 1,
          model: "deepseek-v4-flash",
          choices: [
            { index: 0, message: { role: "assistant", content }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    return { calls, fetchImpl };
  };
  const draftWith = (fetchImpl: typeof fetch) =>
    retryingUnparseableJson(() =>
      generateText({
        model: createDeepSeekModel(
          { apiKey: "contract-test-key", model: "deepseek-v4-flash" },
          fetchImpl,
        ),
        output: Output.object({
          schema: ignoringEchoedResponseFormat(z.object({ summary: z.string() }).strict()),
        }),
        prompt: "起草。",
      }),
    );
  // Verbatim tail of a real evaluation draft that failed to parse.
  const strayTail = '{"summary":"还缺读数。","} ';

  it("calls again once when the answer is not JSON", async () => {
    const { calls, fetchImpl } = answeringInTurn([
      strayTail,
      JSON.stringify({ summary: "还缺读数。" }),
    ]);

    const result = await draftWith(fetchImpl);

    expect(result.output).toEqual({ summary: "还缺读数。" });
    expect(calls.count).toBe(2);
  });

  it("gives up after the second unparseable answer", async () => {
    const { calls, fetchImpl } = answeringInTurn([strayTail]);

    await expect(draftWith(fetchImpl)).rejects.toSatisfy((error) =>
      NoObjectGeneratedError.isInstance(error),
    );
    expect(calls.count).toBe(2);
  });

  it("does not call again when the answer parses but breaks the schema", async () => {
    const { calls, fetchImpl } = answeringInTurn([
      JSON.stringify({ summary: "还缺读数。", note: "给教师看" }),
    ]);

    await expect(draftWith(fetchImpl)).rejects.toSatisfy((error) =>
      NoObjectGeneratedError.isInstance(error),
    );
    expect(calls.count).toBe(1);
  });
});

