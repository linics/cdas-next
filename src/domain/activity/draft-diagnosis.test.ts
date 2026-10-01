import { describe, expect, it } from "vitest";
import { waterConservationTaskBookV3 as content } from "../../fixtures/water-conservation-v3";
import {
  DiagnosisOutputError,
  diagnosisModelOutputSchema,
  diagnosisTargets,
  resolveDiagnosisFindings,
} from "./draft-diagnosis";

const finding = (target: string, category = "EVIDENCE" as const) => ({
  target,
  category,
  problem: "证据只写了名称。",
  suggestion: "写明必须包含的要素。",
});

function errorCode(run: () => unknown) {
  try {
    run();
  } catch (error) {
    if (error instanceof DiagnosisOutputError) return error.code;
    throw error;
  }
  return null;
}

describe("draft diagnosis targets", () => {
  it("names every goal, contribution, phase, evidence item and rubric dimension", () => {
    const targets = diagnosisTargets(content).map((item) => item.target);
    expect(targets).toContain("learningGoals.3");
    expect(targets).toContain("disciplineContributions.3");
    expect(targets).toContain("phases.2.evidence.1");
    expect(targets).toContain("rubricDimensions.4");
    expect(targets).not.toContain("phases.4");
  });

  it("labels findings with this version's names and rejects unknown or repeated targets", () => {
    const [resolved] = resolveDiagnosisFindings(content, {
      summary: "整体清楚。",
      findings: [finding("phases.2")],
    });
    expect(resolved?.label).toBe("阶段 2「调查与分析」");
    expect(
      errorCode(() =>
        resolveDiagnosisFindings(content, { summary: "整体清楚。", findings: [finding("phases.9")] }),
      ),
    ).toBe("UNKNOWN_TARGET");
    expect(
      errorCode(() =>
        resolveDiagnosisFindings(content, {
          summary: "整体清楚。",
          findings: [finding("summary"), finding("summary")],
        }),
      ),
    ).toBe("REPEATED_FINDING");
  });

  it("drops an extra key on a finding instead of rejecting the diagnosis", () => {
    const parsed = diagnosisModelOutputSchema.parse({
      summary: "证据要求偏笼统，其余结构完整。",
      findings: [
        {
          target: "phases.2.evidence.1",
          target_label: "阶段 2 · 证据 1",
          category: "EVIDENCE",
          problem: "看不出比较了什么。",
          suggestion: "要求两个点位的对比表。",
        },
      ],
    });
    expect(parsed.findings[0]).toEqual({
      target: "phases.2.evidence.1",
      category: "EVIDENCE",
      problem: "看不出比较了什么。",
      suggestion: "要求两个点位的对比表。",
    });
    // The envelope itself stays strict.
    expect(
      diagnosisModelOutputSchema.safeParse({ summary: "结构完整，没有明显问题。", findings: [], score: 90 }).success,
    ).toBe(false);
  });
});

