import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { buildReleaseAnswerSummaryPrompt } from "./release-answer-summary";

describe("answer summary prompt", () => {
  // D-053: DeepSeek json_object mode learns the keys only from the prompt.
  it("names the output keys and kinds, and carries numbered answers without names", () => {
    const prompt = buildReleaseAnswerSummaryPrompt({
      task: "校园节水行动",
      phase: "现场认定",
      asked: { action: "找到一处浪费水的现象并记录", evidence: ["观察记录"] },
      answers: [
        { answer: 1, text: "二楼饮水机旁边在漏水" },
        { answer: 2, text: "操场水龙头一直滴水" },
      ],
    });
    expect(prompt).toContain("JSON");
    expect(prompt).toContain("summary 和 themes");
    expect(prompt).toContain("kind、statement、evidence");
    expect(prompt).toContain("answer 和 quote");
    expect(prompt).toContain("STRENGTH");
    expect(prompt).toContain("GAP");
    expect(prompt).toContain("一字不改");
    expect(prompt).toContain("不要提出教学建议");
    expect(prompt).toContain("教师看不到");
    expect(prompt).toContain('"answer": 2');
    expect(prompt).not.toContain("submissionId");
  });
});
