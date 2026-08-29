import { readFileSync } from "node:fs";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import {
  attachmentTranscriptionInstructions,
  attachmentTranscriptionMaxOutputTokens,
  attachmentTranscriptionPrompt,
  defaultAttachmentVisionModel,
} from "../../src/domain/assistant/attachment-vision-model";
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
    defaultAttachmentVisionModel;
  const model = createOpenAICompatible({
    name: "deepseek",
    baseURL: "https://api.deepseek.com",
    apiKey,
  }).chatModel(modelId);
  const bytes = new Uint8Array(readFileSync(fixture));
  const result = await generateText({
    model,
    instructions: attachmentTranscriptionInstructions,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: attachmentTranscriptionPrompt },
          { type: "file", data: bytes, mediaType: "image/png" },
        ],
      },
    ],
    maxOutputTokens: attachmentTranscriptionMaxOutputTokens,
    timeout: 60_000,
  });
  const matchedFacts = knownFacts.filter((fact) =>
    result.text.includes(fact),
  );
  // Every fact, not merely one. A transcription that reaches a single number is
  // exactly the state that shipped: the drafter then reports, correctly, that
  // it cannot verify what the student wrote, and the evidence is lost anyway.
  if (matchedFacts.length !== knownFacts.length) {
    const missing = knownFacts.filter((fact) => !matchedFacts.includes(fact));
    throw new Error(
      `E2E_ATTACHMENT_VISION_FACTS_MISSING:${missing.join(",")}:${result.finishReason}:${result.text.slice(0, 500)}`,
    );
  }
  // A transcription cut off by the budget loses whatever came last, which on a
  // worksheet is the data. Fail on truncation even if the facts happened to fit.
  if (result.finishReason !== "stop") {
    throw new Error(
      `E2E_ATTACHMENT_VISION_TRUNCATED:${result.finishReason}`,
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
