import { writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
vi.mock("server-only", () => ({}));
import {
  adaptationModelOutputSchema,
  adaptationModelSource,
  describeAdaptationChanges,
  mergeAdaptation,
  type ActivityAdaptationRequest,
  type AdaptationModelOutput,
} from "../../domain/activity/activity-adaptation";
import { waterConservationTaskBookV3 as current } from "../../fixtures/water-conservation-v3";
import { generateActivityAdaptation } from "./activity-adaptation-suggestion";

/**
 * Unit tests replace the model, so only a real call proves DeepSeek returns
 * the area-keyed, structure-preserving shape the prompt asks for.
 */
const model = () =>
  createOpenAICompatible({
    name: "deepseek",
    baseURL: "https://api.deepseek.com",
    apiKey: process.env.DEEPSEEK_API_KEY!.trim(),
  }).chatModel(process.env.AI_MODEL!.trim());

const cases: ReadonlyArray<{ name: string; request: ActivityAdaptationRequest }> = [
  {
    name: "新年级与新情境",
    request: { targetGrade: 8, totalLessons: null, contextNote: "城郊学校，改为调查社区公共用水点位", areas: ["BASIC_SETTINGS", "BACKGROUND", "TASK_INSTRUCTIONS", "PHASES"] },
  },
  {
    name: "重新分配课时",
    request: { targetGrade: null, totalLessons: 7, contextNote: "", areas: ["PHASES"] },
  },
  {
    name: "目标与评价随年级调整",
    request: { targetGrade: 9, totalLessons: null, contextNote: "九年级毕业班，时间紧", areas: ["OBJECTIVES", "RUBRIC"] },
  },
];

describe.each(cases)("real-model adaptation: $name", ({ request }) => {
  it("returns a mergeable, in-scope rewrite", async () => {
    const raw = await generateActivityAdaptation(model(), {
      current: { grade: current.grade, mainDiscipline: "物理", integratedDisciplines: ["数学", "语文"], totalLessons: 4 },
      target: { grade: request.targetGrade, totalLessons: request.totalLessons, contextNote: request.contextNote },
      areas: request.areas,
      source: adaptationModelSource(current, request.areas),
    });
    const output = adaptationModelOutputSchema(request.areas).parse(raw) as AdaptationModelOutput;
    const merged = mergeAdaptation(current, request, output);
    const changes = describeAdaptationChanges(current, merged);
    // Set ADAPTATION_DUMP to a directory to read the rewrites by eye.
    if (process.env.ADAPTATION_DUMP) {
      writeFileSync(
        `${process.env.ADAPTATION_DUMP}/${request.areas.join("-")}.json`,
        JSON.stringify(changes, null, 2),
      );
    }
    expect(changes.length).toBeGreaterThan(0);
  });
});
