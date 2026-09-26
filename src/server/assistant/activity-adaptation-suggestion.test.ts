import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { adaptationModelSource } from "../../domain/activity/activity-adaptation";
import { waterConservationTaskBookV3 as current } from "../../fixtures/water-conservation-v3";
import { buildActivityAdaptationPrompt } from "./activity-adaptation-suggestion";

const base = {
  current: { grade: 7, mainDiscipline: "物理", integratedDisciplines: ["数学", "语文"], totalLessons: 4 },
  target: { grade: 8, totalLessons: 6, contextNote: "社区公共用水" },
  areas: ["BACKGROUND", "PHASES"] as const,
};

describe("adaptation prompt", () => {
  // DeepSeek's json_object mode learns keys only from the prompt (D-053).
  it("names every output key, the structure rules and the lesson total", () => {
    const prompt = buildActivityAdaptationPrompt({
      ...base,
      areas: [...base.areas],
      source: adaptationModelSource(current, [...base.areas]),
    });
    expect(prompt).toContain("JSON");
    expect(prompt).toContain("- BACKGROUND：");
    expect(prompt).toContain("- PHASES：");
    expect(prompt).not.toContain("- RUBRIC：");
    expect(prompt).toContain("suggestedLessons 之和必须恰好等于 6");
    expect(prompt).toContain("目标年级是 8 年级");
    expect(prompt).toContain("learningGoals 的 id");
  });
});
