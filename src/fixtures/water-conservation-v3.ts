import type { ActivityContentV3 } from "../domain/activity/activity-content";

/** A valid middle-school fixture shared by v3 schema, assistant and release tests. */
export const waterConservationTaskBookV3: ActivityContentV3 = {
  schemaVersion: 3,
  title: "校园节水行动",
  topic: "校园用水调查与改善",
  summary: "学生以真实校园用水场景为对象，形成可核验的节水建议。",
  schoolStage: "MIDDLE",
  grade: 7,
  mainDisciplineCode: "physics",
  integratedDisciplineCodes: ["math", "chinese"],
  disciplineContributions: [
    { disciplineCode: "physics", contribution: "观察用水现象并解释流量、装置与节水措施。", necessity: "没有物理解释，建议不能说明其节水机理。" },
    { disciplineCode: "math", contribution: "整理、比较用水数据并呈现变化。", necessity: "没有数据分析，问题判断与建议效果无法核验。" },
    { disciplineCode: "chinese", contribution: "面向真实对象清晰表达调查结论和建议。", necessity: "没有公共表达，方案无法被理解、讨论和采纳。" },
  ],
  assignmentType: "inquiry",
  assignmentSubtype: "survey",
  inquiryDepth: "intermediate",
  submissionMode: "once",
  durationWeeks: 2,
  backgroundSetting: "学校希望根据学生调查改进用水管理。",
  taskInstructions: "完成用水观察和数据整理，形成一份有证据的节水建议。",
  learningGoals: [
    { id: "goal-physics", description: "能基于观察说明一个校园用水问题及其可能机理。", competencyReferences: [{ disciplineCode: "physics", competencyCode: "scientific_inquiry" }] },
    { id: "goal-math", description: "能整理并解释调查数据，以数据支持判断。", competencyReferences: [{ disciplineCode: "math", competencyCode: "abstraction_ability" }] },
    { id: "goal-chinese", description: "能面向校园管理者清楚表达有依据的节水建议。", competencyReferences: [{ disciplineCode: "chinese", competencyCode: "language_application" }] },
  ],
  phases: [
    { name: "观察与问题界定", action: "记录校园用水现象并提出可调查的问题。", context: "从日常用水点位出发。", support: "提供观察记录表。", learningGoalIds: ["goal-physics"], evidence: [{ type: "text", description: "观察记录与问题说明" }], evaluationFocus: "问题具体且基于观察。", suggestedLessons: 1 },
    { name: "调查与分析", action: "收集、整理并解释用水数据。", context: "比较不同时间或点位的数据。", support: "提供数据整理模板。", learningGoalIds: ["goal-physics", "goal-math"], evidence: [{ type: "document", description: "数据表与分析说明" }], evaluationFocus: "数据完整，解释有依据。", suggestedLessons: 2 },
    { name: "建议与公开表达", action: "形成并说明一项可行的节水建议。", context: "面向校园管理者或班级。", support: "提供建议稿结构。", learningGoalIds: ["goal-math", "goal-chinese"], evidence: [{ type: "text", description: "节水建议稿" }], evaluationFocus: "建议可行，表达清晰。", suggestedLessons: 1 },
  ],
  rubricDimensions: [
    { name: "问题与机理", excellent: "问题具体，能用观察和机理充分解释。", good: "问题明确，解释基本合理。", pass: "能说明问题。", improve: "问题或解释需要补充。", learningGoalIds: ["goal-physics"] },
    { name: "数据与证据", excellent: "数据完整，分析准确且能支持判断。", good: "数据较完整，分析基本支持判断。", pass: "有基本数据和判断。", improve: "数据或分析需要补充。", learningGoalIds: ["goal-math"] },
    { name: "跨学科连接", excellent: "能清晰连接物理解释、数据分析与表达。", good: "能连接主要学科方法。", pass: "能识别部分连接。", improve: "连接需要补充。", learningGoalIds: ["goal-physics", "goal-math", "goal-chinese"] },
    { name: "建议表达", excellent: "建议具体可行，表达有说服力。", good: "建议较可行，表达清楚。", pass: "能提出基本建议。", improve: "建议或表达需要改进。", learningGoalIds: ["goal-chinese"] },
  ],
};
