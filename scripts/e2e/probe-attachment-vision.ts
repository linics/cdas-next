import { readFileSync } from "node:fs";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import { loadE2eEnvironment } from "./environment";

const acknowledgement = "synthetic-data-cost-approved";
const fixture = "scripts/probe/fixtures/student-work.png";
const knownFacts = ["6.7", "25.6", "11.3", "食堂", "滴水"] as const;

async function main(): Promise<void> {
  loadE2eEnvironment();
  if (process.env.E2E_REAL_MODEL_ACK !== acknowledgement) {
    throw new Error("E2E_REAL_MODEL_COST_ACK_REQUIRED");
  }
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY_REQUIRED");

  const modelId =
    process.env.AI_ATTACHMENT_VISION_MODEL?.trim() ||
    "deepseek-v4-flash-vision-exp";
  const model = createOpenAICompatible({
    name: "deepseek",
    baseURL: "https://api.deepseek.com",
    apiKey,
  }).chatModel(modelId);
  const bytes = new Uint8Array(readFileSync(fixture));
  const result = await generateText({
    model,
    instructions: "只转写图片中实际可见的文字和数字，不猜测。",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "请列出这份合成学生作业图片中的地点、数字和备注。",
          },
          { type: "file", data: bytes, mediaType: "image/png" },
        ],
      },
    ],
    maxOutputTokens: 256,
    timeout: 60_000,
  });
  const matchedFacts = knownFacts.filter((fact) =>
    result.text.includes(fact),
  );
  if (matchedFacts.length === 0) {
    throw new Error(
      `E2E_ATTACHMENT_VISION_FACTS_MISSING:${result.text.slice(0, 500)}`,
    );
  }
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      model: modelId,
      fixture,
      matchedFacts,
      outputCodePoints: [...result.text].length,
    })}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      ok: false,
      error: {
        code: error instanceof Error ? error.message : "VISION_PROBE_FAILED",
      },
    })}\n`,
  );
  process.exitCode = 1;
});
