import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { diagnosisTargets } from "../../domain/activity/draft-diagnosis";
import { waterConservationTaskBookV3 as content } from "../../fixtures/water-conservation-v3";
import { buildActivityDraftDiagnosisPrompt } from "./activity-draft-diagnosis";

describe("diagnosis prompt", () => {
  // D-053: DeepSeek json_object mode learns the keys only from the prompt.
  it("names the output keys, the category codes and the target list", () => {
    const prompt = buildActivityDraftDiagnosisPrompt({
      targets: diagnosisTargets(content),
      taskBook: content,
      adoptedSources: [],
    });
    expect(prompt).toContain("JSON");
    expect(prompt).toContain("summary 和 findings");
    expect(prompt).toContain("target、category、problem、suggestion");
    for (const code of ["ALIGNMENT", "DISCIPLINE", "EVIDENCE", "RUBRIC", "CONTEXT", "FEASIBILITY"]) {
      expect(prompt).toContain(code);
    }
    expect(prompt).toContain("\"phases.2.evidence.1\"");
    expect(prompt).toContain("不要报告这些结构性覆盖问题");
  });
});
