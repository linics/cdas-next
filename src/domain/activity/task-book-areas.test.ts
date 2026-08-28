import { describe, expect, it } from "vitest";
import type { ActivityContentV2 } from "./activity-content";
import { changedTaskBookAreas, taskBookAreas } from "./task-book-areas";

const base: ActivityContentV2 = {
  schemaVersion: 2,
  title: "校园节水行动",
  topic: "校园节水",
  summary: "记录水表并提出改善建议",
  schoolStage: "MIDDLE",
  grade: 7,
  mainDisciplineCode: "physics",
  integratedDisciplineCodes: ["math"],
  crossDisciplinaryConceptCodes: [],
  assignmentType: "inquiry",
  assignmentSubtype: "survey",
  inquiryDepth: "intermediate",
  submissionMode: "once",
  durationWeeks: 2,
  backgroundSetting: "你们是校园节水顾问，要向总务处提出可执行的节水方案。",
  objectiveKnowledge: "理解用水数据。",
  objectiveProcess: "使用数据支持结论。",
  objectiveEmotion: "愿意参与校园节水。",
  learningObjectives: ["理解用水数据。", "使用数据支持结论。"],
  taskInstructions: "记录两次水表读数并解释差异。",
  evidenceRequirements: ["时间与读数", "分析结论"],
  feedbackCriteria: ["问题意识", "证据品质", "跨学科连结", "方案表达"],
  phases: [
    { name: "观察", action: "记录用水。", context: "在校园观察。", support: "使用记录表。", evidence: [{ type: "text", description: "时间与读数" }], evaluationFocus: "资料完整。", suggestedLessons: 1 },
    { name: "分析", action: "整理资料。", context: "比较读数。", support: "使用表格。", evidence: [{ type: "document", description: "分析表" }], evaluationFocus: "结论有据。", suggestedLessons: 1 },
    { name: "建议", action: "提出建议。", context: "面向总务处。", support: "使用建议模板。", evidence: [{ type: "text", description: "建议稿" }], evaluationFocus: "方案可行。", suggestedLessons: 1 },
  ],
  rubricDimensions: [
    { name: "问题意识", excellent: "清楚", good: "较清楚", pass: "基本", improve: "需补充" },
    { name: "证据品质", excellent: "完整", good: "较完整", pass: "基本", improve: "需补充" },
    { name: "跨学科连结", excellent: "清楚", good: "较清楚", pass: "基本", improve: "需补充" },
    { name: "方案表达", excellent: "可行", good: "较可行", pass: "基本", improve: "需补充" },
  ],
};

describe("task book areas", () => {
  it("reports nothing changed for an identical task book", () => {
    expect(changedTaskBookAreas(base, { ...base })).toEqual([]);
  });

  it("maps every editable field to exactly one reported area", () => {
    const perField: Array<[Partial<ActivityContentV2>, string]> = [
      [{ title: "改过的标题" }, "BASIC_SETTINGS"],
      [{ durationWeeks: 3 }, "BASIC_SETTINGS"],
      [{ backgroundSetting: "换一个真实受众的背景设定。" }, "BACKGROUND"],
      [{ objectiveEmotion: "愿意为公共资源负责。" }, "OBJECTIVES"],
      [{ learningObjectives: ["只留一条目标。"] }, "OBJECTIVES"],
      [{ taskInstructions: "换一段总体任务说明。" }, "TASK_INSTRUCTIONS"],
      [{ evidenceRequirements: ["只留一项证据"] }, "EVIDENCE"],
      [{ feedbackCriteria: ["问题意识"] }, "RUBRIC"],
    ];

    for (const [patch, area] of perField) {
      expect(changedTaskBookAreas(base, { ...base, ...patch })).toEqual([area]);
    }
  });

  it("treats a rewritten phase and a reordered phase list as the same kind of change", () => {
    const rewritten = {
      ...base,
      phases: base.phases.map((phase, index) =>
        index === 1
          ? { ...phase, context: "你们在上一阶段发现了读数差异，现在总务处希望你们解释它。" }
          : phase,
      ),
    };
    const reordered = { ...base, phases: [...base.phases].reverse() };

    expect(changedTaskBookAreas(base, rewritten)).toEqual(["PHASES"]);
    expect(changedTaskBookAreas(base, reordered)).toEqual(["PHASES"]);
  });

  it("reports every touched area when a revision reaches beyond one region", () => {
    const wide = {
      ...base,
      backgroundSetting: "换一个背景。",
      rubricDimensions: base.rubricDimensions.map((dimension) => ({
        ...dimension,
        improve: "需要更多证据支持。",
      })),
    };

    expect(changedTaskBookAreas(base, wide)).toEqual(["BACKGROUND", "RUBRIC"]);
  });

  it("returns areas in a stable declared order", () => {
    const everything: ActivityContentV2 = {
      ...base,
      title: "全改",
      backgroundSetting: "全改的背景。",
      objectiveKnowledge: "全改的知识目标。",
      taskInstructions: "全改的总体任务。",
      evidenceRequirements: ["全改的证据"],
      feedbackCriteria: ["全改的标准"],
      phases: [...base.phases].reverse(),
    };

    expect(changedTaskBookAreas(base, everything)).toEqual([...taskBookAreas]);
  });
});
