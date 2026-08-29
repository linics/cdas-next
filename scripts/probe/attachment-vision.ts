/**
 * PLAN-ATTACHMENTS.md phase 3 hangs on one assumption: that a model can read a
 * student's uploaded evidence well enough for a teacher to draft against it.
 * This measures that instead of assuming it.
 *
 * The fixture is a school water-survey sheet of the kind students actually hand
 * in — a four-column table, a bar chart, and one small red note in a corner. It
 * is graded on facts that can only come from looking: the three difference
 * values, which bar is tallest, and the exact wording of the note. A model that
 * hedges or invents fails visibly.
 *
 * Both candidates are probed because the choice matters for cost, not accuracy.
 * DeepSeek caps an image at 384 tokens, which sounded like it would flatten a
 * dense worksheet; whether it actually does is the thing worth knowing.
 *
 * The vision call in phase 3 is deliberately isolated — one image in, one
 * description out, no tools — so it is unaffected by GLM's tool_choice defect
 * (see scripts/probe/glm-tool-choice.ts) and either provider may serve it
 * regardless of which model runs the main conversation.
 *
 * Needs DEEPSEEK_API_KEY, and GLM_API_KEY only to include GLM in the comparison.
 *
 *   pnpm probe:vision
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import nextEnvironment from "@next/env";

const fixture = join(
  process.cwd(),
  "scripts/probe/fixtures/student-work.png",
);

/** Every answer is checkable against the fixture, so a wrong read is obvious. */
const question =
  "这是学生提交的作业附件。请只根据图中可见内容回答：" +
  "(1) 表格里三个地点的差值分别是多少？" +
  "(2) 柱状图中用水量最多的是哪个地点？" +
  "(3) 图中有没有关于漏水的说明？如果有，原话是什么？" +
  "不要推测图中没有的内容。";

const groundTruth = ["6.7", "25.6", "11.3", "食堂", "滴水"] as const;

type Reading = Readonly<{
  label: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  answer: string;
  missed: readonly string[];
  errorMessage: string | null;
}>;

async function read(
  label: string,
  baseUrl: string,
  apiKey: string,
  model: string,
  extra: Record<string, unknown> = {},
): Promise<Reading> {
  const dataUrl = `data:image/png;base64,${readFileSync(fixture).toString("base64")}`;
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: question },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      ...extra,
    }),
  });
  const latencyMs = Date.now() - startedAt;
  const text = await response.text();

  let record: {
    error?: { message?: string };
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  try {
    record = JSON.parse(text) as typeof record;
  } catch {
    return {
      label,
      latencyMs,
      promptTokens: 0,
      completionTokens: 0,
      answer: "",
      missed: groundTruth,
      errorMessage: `NON_JSON_RESPONSE: ${text.slice(0, 200)}`,
    };
  }

  const answer = record.choices?.[0]?.message?.content ?? "";
  return {
    label,
    latencyMs,
    promptTokens: record.usage?.prompt_tokens ?? 0,
    completionTokens: record.usage?.completion_tokens ?? 0,
    answer,
    missed: groundTruth.filter((fact) => !answer.includes(fact)),
    errorMessage:
      record.error?.message ??
      (response.ok ? null : `HTTP_${response.status}: ${text.slice(0, 200)}`),
  };
}

async function main(): Promise<void> {
  nextEnvironment.loadEnvConfig(process.cwd());
  const readings: Reading[] = [];

  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (deepseekKey) {
    readings.push(
      await read(
        "DeepSeek deepseek-v4-flash-vision-exp",
        "https://api.deepseek.com",
        deepseekKey,
        "deepseek-v4-flash-vision-exp",
      ),
    );
  }

  const glmKey = process.env.GLM_API_KEY?.trim();
  if (glmKey) {
    readings.push(
      await read(
        `GLM ${process.env.GLM_MODEL?.trim() || "glm-5.3-flash"}`,
        process.env.GLM_BASE_URL?.trim() ||
          "https://open.bigmodel.cn/api/paas/v4",
        glmKey,
        process.env.GLM_MODEL?.trim() || "glm-5.3-flash",
        { reasoning_effort: "high" },
      ),
    );
  }

  if (readings.length === 0) {
    throw new Error("需要 DEEPSEEK_API_KEY 或 GLM_API_KEY 才能跑这个探针。");
  }

  for (const reading of readings) {
    console.log(`\n── ${reading.label}`);
    if (reading.errorMessage) {
      console.log(`   错误：${reading.errorMessage}`);
      continue;
    }
    console.log(
      `   ${(reading.latencyMs / 1000).toFixed(1)}s` +
        `   图+文 ${reading.promptTokens} prompt token` +
        `   输出 ${reading.completionTokens}`,
    );
    console.log(
      reading.missed.length === 0
        ? "   全部事实读对"
        : `   漏读或读错：${reading.missed.join("、")}`,
    );
    console.log(
      reading.answer
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => `     ${line}`)
        .join("\n"),
    );
  }

  console.log("\n════════════════════════════════════════");
  const cheapest = readings
    .filter((reading) => !reading.errorMessage && reading.missed.length === 0)
    .sort((a, b) => a.promptTokens - b.promptTokens)[0];
  if (cheapest) {
    console.log(
      `读全部事实且单图最省的是 ${cheapest.label}（${cheapest.promptTokens} prompt token）。`,
    );
  } else {
    console.log("没有一个候选读全了全部事实 —— 附件第三期的前提不成立，需要重新设计。");
  }
  console.log("════════════════════════════════════════\n");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
