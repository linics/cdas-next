/**
 * Two questions decide whether CDAS Next can move to GLM-5.3-Flash.
 *
 * 1. Does GLM honour tool_choice at all?
 *
 *    We pin DeepSeek to non-thinking mode because its thinking mode rejects
 *    named tool_choice (src/server/assistant/deepseek-provider.ts). Two
 *    behaviours depend on naming a tool: forcing publish_activity_release when
 *    the teacher explicitly asks to publish, and D-050's single repair retry.
 *    GLM-5.3 cannot turn thinking off, so if naming a tool does not work under
 *    thinking, those two behaviours have no mechanism left.
 *
 *    The decisive case is not the named one — it is `tool_choice: "none"`. If
 *    the model still calls a tool after being told to call none, the parameter
 *    is not being honoured at all, and every other tool_choice result is
 *    meaningless. A garbage function name is probed for the same reason: an API
 *    that validates the parameter would reject a tool that does not exist.
 *
 * 2. What does forced thinking cost on a trivial turn?
 *
 *    GLM bills reasoning tokens as output. The teacher workflow spends most of
 *    its turns routing to one tool, where thinking earns nothing. This measures
 *    the reasoning share of output on exactly such a turn, because that share —
 *    not the headline per-token price — decides whether the move saves money.
 *
 * Talks to the HTTP API directly rather than through @ai-sdk, so the answer is
 * about GLM itself and not about how a provider adapter translates our call.
 *
 * Reads GLM_API_KEY / GLM_BASE_URL / GLM_MODEL from .env.local. Costs a few
 * hundred tokens across six small calls.
 *
 *   pnpm probe:glm
 */
import nextEnvironment from "@next/env";

type ProbeOutcome = Readonly<{
  name: string;
  expectation: string;
  httpStatus: number;
  errored: boolean;
  calledTools: readonly string[];
  reasoningTokens: number;
  completionTokens: number;
  errorMessage: string | null;
}>;

const publishTool = {
  type: "function",
  function: {
    name: "publish_activity_release",
    description:
      "把一份已存在的活动草稿发布给一个班级。只有教师明确要求发布时才调用。",
    parameters: {
      type: "object",
      properties: {
        draftId: { type: "string", description: "要发布的活动草稿 id" },
        classroomId: { type: "string", description: "接收发布的班级 id" },
      },
      required: ["draftId", "classroomId"],
    },
  },
} as const;

const listDraftsTool = {
  type: "function",
  function: {
    name: "list_my_activity_drafts",
    description: "列出当前教师的全部活动草稿。",
    parameters: { type: "object", properties: {} },
  },
} as const;

/** A turn where the obvious move is to list drafts. A tool_choice that is
 *  actually honoured is therefore visible: naming publish should override this,
 *  and "none" should suppress the call entirely. */
const messages = [
  {
    role: "system",
    content: "你是教师工作台助手。只在教师明确要求时才发布活动。",
  },
  { role: "user", content: "看一下我手上有哪些活动草稿。" },
] as const;

function readEnvironment() {
  nextEnvironment.loadEnvConfig(process.cwd());
  const apiKey = process.env.GLM_API_KEY?.trim();
  const baseUrl =
    process.env.GLM_BASE_URL?.trim() || "https://open.bigmodel.cn/api/paas/v4";
  const model = process.env.GLM_MODEL?.trim() || "glm-5.3-flash";
  if (!apiKey) {
    throw new Error(
      "GLM_API_KEY_REQUIRED — 把 key 填进 .env.local 的 GLM_API_KEY= 后面再跑。",
    );
  }
  return { apiKey, baseUrl, model };
}

async function probe(
  name: string,
  expectation: string,
  body: Record<string, unknown>,
): Promise<ProbeOutcome> {
  const { apiKey, baseUrl, model } = readEnvironment();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, tools: [publishTool, listDraftsTool], ...body }),
  });

  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return {
      name,
      expectation,
      httpStatus: response.status,
      errored: true,
      calledTools: [],
      reasoningTokens: 0,
      completionTokens: 0,
      errorMessage: `NON_JSON_RESPONSE: ${text.slice(0, 200)}`,
    };
  }

  const record = payload as {
    error?: { message?: string };
    choices?: { message?: { tool_calls?: { function?: { name?: string } }[] } }[];
    usage?: {
      completion_tokens?: number;
      completion_tokens_details?: { reasoning_tokens?: number };
    };
  };

  return {
    name,
    expectation,
    httpStatus: response.status,
    errored: !response.ok || Boolean(record.error),
    calledTools:
      record.choices?.[0]?.message?.tool_calls?.flatMap((call) =>
        call.function?.name ? [call.function.name] : [],
      ) ?? [],
    reasoningTokens:
      record.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    completionTokens: record.usage?.completion_tokens ?? 0,
    errorMessage:
      record.error?.message ??
      (response.ok ? null : `HTTP_${response.status}: ${text.slice(0, 200)}`),
  };
}

/** A question that cannot be answered without working through it, so the gear's
 *  effect on real reasoning is visible rather than only its effect on routing. */
async function probeWithoutTools(gear: string): Promise<ProbeOutcome> {
  const { apiKey, baseUrl, model } = readEnvironment();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      reasoning_effort: gear,
      messages: [
        {
          role: "user",
          content:
            "水池有甲乙两个进水管和丙一个出水管。甲单独注满需 6 小时，乙需 8 小时，" +
            "丙单独放空满池需 4 小时。池空时先开甲乙 2 小时，再三管齐开，" +
            "问从头算起多久池水首次达到满池的一半？给出精确分数。",
        },
      ],
    }),
  });
  const record = (await response.json()) as {
    usage?: {
      completion_tokens?: number;
      completion_tokens_details?: { reasoning_tokens?: number };
    };
  };
  return {
    name: `hard ${gear}`,
    expectation: "",
    httpStatus: response.status,
    errored: !response.ok,
    calledTools: [],
    reasoningTokens:
      record.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    completionTokens: record.usage?.completion_tokens ?? 0,
    errorMessage: null,
  };
}

async function main(): Promise<void> {
  const named = (name: string) => ({ type: "function", function: { name } });

  const outcomes = [
    await probe(
      "tool_choice=none",
      "若 tool_choice 被遵守：不应有任何工具调用",
      { tool_choice: "none" },
    ),
    await probe(
      "tool_choice 指向不存在的工具",
      "若 tool_choice 被校验：应当报错",
      { tool_choice: named("no_such_tool_exists") },
    ),
    await probe(
      "tool_choice 具名 publish",
      "若 tool_choice 被遵守：应当调用 publish_activity_release",
      { tool_choice: named("publish_activity_release") },
    ),
    await probe(
      "tool_choice 具名 publish + reasoning_effort=low",
      "同上，在最低思考档位",
      {
        tool_choice: named("publish_activity_release"),
        reasoning_effort: "low",
      },
    ),
    await probe(
      "thinking disabled",
      "文档说会报错：应当报错，且不产生 reasoning token",
      { thinking: { type: "disabled" } },
    ),
    await probe("无 tool_choice 基线", "模型自选，预期 list_my_activity_drafts", {}),
  ];

  for (const outcome of outcomes) {
    console.log(`\n── ${outcome.name}`);
    console.log(`   预期：${outcome.expectation}`);
    console.log(
      `   实际：HTTP ${outcome.httpStatus}${outcome.errored ? " 报错" : " 正常"}` +
        `，调用 [${outcome.calledTools.join(", ") || "无"}]` +
        `，思考 ${outcome.reasoningTokens}/${outcome.completionTokens} 输出 token`,
    );
    if (outcome.errorMessage) {
      console.log(`   错误：${outcome.errorMessage}`);
    }
  }

  // The gears are the whole cost story, so measure them rather than trusting
  // the headline price. Default is max, which thinks even when routing to one
  // obvious tool; the lower gears decide for themselves whether to think.
  const gears = ["low", "high", "max"] as const;
  console.log("\n── reasoning_effort 三档在两种轮次上的思考开销");
  for (const gear of gears) {
    const routing = await probe(`gear ${gear} routing`, "", {
      reasoning_effort: gear,
    });
    const hard = await probeWithoutTools(gear);
    console.log(
      `   ${gear.padEnd(4)} 工具路由 ${routing.reasoningTokens}/${routing.completionTokens}` +
        `   难题 ${hard.reasoningTokens}/${hard.completionTokens}`,
    );
  }

  const [none, bogus] = outcomes;
  const toolChoiceIgnored =
    none.calledTools.length > 0 && !bogus.errored;
  const reasoning = outcomes.reduce((sum, o) => sum + o.reasoningTokens, 0);
  const completion = outcomes.reduce((sum, o) => sum + o.completionTokens, 0);
  const share = completion > 0 ? Math.round((reasoning / completion) * 100) : 0;

  console.log("\n════════════════════════════════════════");
  if (toolChoiceIgnored) {
    console.log(
      "结论 1：GLM 完全不遵守 tool_choice —— 传 none 仍然调工具，传不存在的工具名也不报错。\n" +
        "        参数被静默丢弃，不是「具名不支持」而是「整个参数不支持」。\n" +
        "        发布强制与 D-050 修复重试会失去强制机制，且不会有任何报错提示。",
    );
  } else if (none.calledTools.length === 0) {
    console.log("结论 1：GLM 遵守 tool_choice。换模型这条路在工具强制上是通的。");
  } else {
    console.log("结论 1：结果不一致，需人工看上面逐条输出。");
  }
  console.log(
    `\n结论 2：这些琐碎的工具路由轮次里，思考占了输出 token 的 ${share}%。\n` +
      "        GLM 按输出价计费推理 token，且思考关不掉；换算成本时必须按这个比例放大输出侧。",
  );
  console.log("════════════════════════════════════════\n");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
