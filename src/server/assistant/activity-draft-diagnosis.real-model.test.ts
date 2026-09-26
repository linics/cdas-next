import { writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
vi.mock("server-only", () => ({}));
import {
  diagnosisModelOutputSchema,
  diagnosisTargets,
  resolveDiagnosisFindings,
} from "../../domain/activity/draft-diagnosis";
import { waterConservationTaskBookV3 as content } from "../../fixtures/water-conservation-v3";
import { generateActivityDraftDiagnosis, taskBookForModel } from "./activity-draft-diagnosis";

/**
 * Only a real call proves DeepSeek answers with locatable findings in the
 * named shape. Run it several times: one pass is not stability.
 */
const model = () =>
  createOpenAICompatible({
    name: "deepseek",
    baseURL: "https://api.deepseek.com",
    apiKey: process.env.DEEPSEEK_API_KEY!.trim(),
  }).chatModel(process.env.AI_MODEL!.trim());

// A deliberately weaker version: vague evidence and a flat rubric dimension.
const weakened = {
  ...content,
  phases: content.phases.map((phase, index) =>
    index === 1
      ? { ...phase, evidence: [{ type: "text" as const, description: "学习记录" }] }
      : phase,
  ),
  rubricDimensions: content.rubricDimensions.map((dimension, index) =>
    index === 1
      ? { ...dimension, excellent: "很好", good: "较好", pass: "一般", improve: "较差" }
      : dimension,
  ),
};

describe.each([
  { name: "fixture", taskBook: content },
  { name: "weakened", taskBook: weakened },
])("real-model diagnosis: $name", ({ name, taskBook }) => {
  it("returns findings that each locate a real field", async () => {
    const raw = await generateActivityDraftDiagnosis(model(), {
      targets: diagnosisTargets(taskBook),
      taskBook: taskBookForModel(taskBook),
      adoptedSources: [],
    });
    const output = diagnosisModelOutputSchema.parse(raw);
    const findings = resolveDiagnosisFindings(taskBook, output);
    if (process.env.DIAGNOSIS_DUMP) {
      writeFileSync(`${process.env.DIAGNOSIS_DUMP}/${name}-${Date.now()}.json`, JSON.stringify({ summary: output.summary, findings }, null, 2));
    }
    expect(output.summary.length).toBeGreaterThan(0);
    // Internal goal ids must not reach the teacher-facing text.
    expect(JSON.stringify(output)).not.toMatch(/goal-[a-z]/);
    if (name === "weakened") {
      // The planted defects are what a useful check must notice.
      expect(findings.some((finding) => finding.target === "phases.2.evidence.1" || finding.target === "rubricDimensions.2")).toBe(true);
    }
  });
});
