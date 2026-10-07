import { describe, expect, it } from "vitest";
import { emptyActivityDraftV3Values } from "../../app/teacher/activities/activity-draft-v3-state";
import { waterConservationDemoV3 } from "../../fixtures/demo-activities";
import { describeTaskBookGaps } from "./task-book-gaps";

describe("task-book gaps (D-093)", () => {
  it("lists nothing for a complete task book", () => {
    expect(describeTaskBookGaps(waterConservationDemoV3)).toEqual([]);
  });

  it("names every blank field and every unlinked goal of a new task book, in form order", () => {
    const labels = describeTaskBookGaps(emptyActivityDraftV3Values).map((gap) => gap.label);

    expect(labels).toEqual(
      expect.arrayContaining([
        "任务标题",
        "背景设定",
        "物理 · 学科贡献",
        "目标 1 · 可观察目标",
        "目标 1 · 至少选一条课程依据",
        "总体任务说明",
        "阶段 1「观察与问题界定」 · 核心动作",
        "阶段 2「调查与分析」 · 证据 1 的任务要求",
        "目标 2 还没有阶段承担",
        "评价维度 1「问题与机理」 · 达标描述",
        "目标 1 还没有评价维度评价",
      ]),
    );
    const sections = describeTaskBookGaps(emptyActivityDraftV3Values).map((gap) => gap.section);
    expect(sections).toEqual([...sections].sort((left, right) =>
      ["basics", "design", "phases", "rubric"].indexOf(left) -
      ["basics", "design", "phases", "rubric"].indexOf(right),
    ));
  });

  it("reports a goal no rubric dimension judges even when every field is filled", () => {
    const content = structuredClone(waterConservationDemoV3);
    // 建议与表达 judges only goal-proposal; point it at goal-evidence instead.
    content.rubricDimensions[3]!.learningGoalIds = ["goal-evidence"];
    content.rubricDimensions[2]!.learningGoalIds = ["goal-mechanism", "goal-evidence"];

    expect(describeTaskBookGaps(content)).toEqual([
      { section: "rubric", label: "目标 3 还没有评价维度评价" },
    ]);
  });
});
