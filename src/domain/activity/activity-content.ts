import { z } from "zod";

const nonBlankText = z.string().trim().min(1);

/**
 * The first version remains readable forever. New product entry points write
 * v2, but keeping this branch makes the historical boundary explicit.
 */
export const activityContentV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    title: nonBlankText.max(120),
    summary: nonBlankText.max(600),
    learningObjectives: z.array(nonBlankText.max(240)).min(1).max(8),
    taskInstructions: nonBlankText.max(5_000),
    evidenceRequirements: z.array(nonBlankText.max(300)).min(1).max(8),
    feedbackCriteria: z.array(nonBlankText.max(240)).min(1).max(8),
  })
  .strict();

export const schoolStages = ["PRIMARY", "MIDDLE"] as const;
export type SchoolStage = (typeof schoolStages)[number];

export const disciplineCatalog = [
  { code: "politics", label: "道德与法治", stages: ["PRIMARY", "MIDDLE"] },
  { code: "chinese", label: "语文", stages: ["PRIMARY", "MIDDLE"] },
  { code: "math", label: "数学", stages: ["PRIMARY", "MIDDLE"] },
  { code: "english", label: "英语", stages: ["PRIMARY", "MIDDLE"] },
  { code: "science", label: "科学", stages: ["PRIMARY"] },
  { code: "history", label: "历史", stages: ["MIDDLE"] },
  { code: "geography", label: "地理", stages: ["MIDDLE"] },
  { code: "physics", label: "物理", stages: ["MIDDLE"] },
  { code: "chemistry", label: "化学", stages: ["MIDDLE"] },
  { code: "biology", label: "生物学", stages: ["MIDDLE"] },
  { code: "infoTech", label: "信息科技", stages: ["PRIMARY", "MIDDLE"] },
  { code: "labor", label: "劳动", stages: ["PRIMARY", "MIDDLE"] },
  { code: "arts", label: "艺术", stages: ["PRIMARY", "MIDDLE"] },
  { code: "sports", label: "体育与健康", stages: ["PRIMARY", "MIDDLE"] },
  { code: "integrated", label: "综合实践活动", stages: ["PRIMARY", "MIDDLE"] },
] as const satisfies ReadonlyArray<{
  code: string;
  label: string;
  stages: readonly SchoolStage[];
}>;

export type DisciplineCode = (typeof disciplineCatalog)[number]["code"];
export const disciplineCodeSchema = z.enum(
  disciplineCatalog.map((discipline) => discipline.code) as [
    DisciplineCode,
    ...DisciplineCode[],
  ],
);

export const assignmentTypes = [
  { code: "practical", label: "实践性作业", description: "体验、观察、参与真实情境" },
  { code: "inquiry", label: "探究性作业", description: "调查、实验、论证科学问题" },
  { code: "project", label: "项目式作业", description: "设计、制作、迭代解决现实问题" },
] as const;

export const assignmentSubtypes = {
  practical: [
    { code: "visit", label: "参观考察" },
    { code: "simulation", label: "模拟表演" },
    { code: "observation", label: "观察体验" },
  ],
  inquiry: [
    { code: "literature", label: "文献探究" },
    { code: "survey", label: "调查探究" },
    { code: "experiment", label: "实验探究" },
  ],
} as const;

export const inquiryDepths = [
  { code: "basic", label: "基础探究", description: "理解与掌握核心概念" },
  { code: "intermediate", label: "中等探究", description: "情境化运用知识解决问题" },
  { code: "deep", label: "深度探究", description: "跨学科综合探究与方案设计" },
] as const;

export const submissionModes = [
  { code: "phased", label: "过程性提交" },
  { code: "once", label: "一次性提交" },
  { code: "mixed", label: "混合提交" },
] as const;

export const crossDisciplinaryConcepts = [
  { code: "matter_energy", label: "物质与能量", description: "形态转化与守恒" },
  { code: "structure_function", label: "结构与功能", description: "设计与适应性" },
  { code: "system_model", label: "系统与模型", description: "简化研究工具" },
  { code: "stability_change", label: "稳定与变化", description: "相对平衡与绝对发展" },
] as const;

export const evidenceTypes = [
  { code: "text", label: "文字记录" },
  { code: "document", label: "文档" },
  { code: "image", label: "图片" },
  { code: "video", label: "视频" },
  { code: "confirm", label: "现场确认" },
  { code: "link", label: "链接" },
] as const;

const phaseEvidenceSchema = z.object({
  type: z.enum(["text", "document", "image", "video", "confirm", "link"]),
  description: nonBlankText.max(300),
}).strict();

const taskPhaseSchema = z.object({
  name: nonBlankText.max(80),
  action: nonBlankText.max(300),
  context: nonBlankText.max(500),
  support: nonBlankText.max(500),
  evidence: z.array(phaseEvidenceSchema).min(1).max(4),
  evaluationFocus: nonBlankText.max(300),
  suggestedLessons: z.int().min(1).max(16),
}).strict();

export const rubricDimensionSchema = z.object({
  name: nonBlankText.max(100),
  excellent: nonBlankText.max(300),
  good: nonBlankText.max(300),
  pass: nonBlankText.max(300),
  improve: nonBlankText.max(300),
}).strict();

const assignmentTypeSchema = z.enum(["practical", "inquiry", "project"]);
const assignmentSubtypeSchema = z.enum([
  "visit", "simulation", "observation", "literature", "survey", "experiment",
]);

export const activityContentV2Schema = z.object({
  schemaVersion: z.literal(2),
  title: nonBlankText.max(120),
  topic: nonBlankText.max(160),
  summary: nonBlankText.max(600),
  schoolStage: z.enum(schoolStages),
  grade: z.int().min(1).max(9),
  mainDisciplineCode: disciplineCodeSchema,
  integratedDisciplineCodes: z.array(disciplineCodeSchema).min(1).max(14),
  crossDisciplinaryConceptCodes: z.array(z.enum([
    "matter_energy", "structure_function", "system_model", "stability_change",
  ])).max(2),
  assignmentType: assignmentTypeSchema,
  assignmentSubtype: assignmentSubtypeSchema.nullable(),
  inquiryDepth: z.enum(["basic", "intermediate", "deep"]),
  submissionMode: z.enum(["phased", "once", "mixed"]),
  durationWeeks: z.int().min(1).max(16),
  backgroundSetting: nonBlankText.max(1_200),
  objectiveKnowledge: nonBlankText.max(500),
  objectiveProcess: nonBlankText.max(500),
  objectiveEmotion: nonBlankText.max(500),
  learningObjectives: z.array(nonBlankText.max(240)).min(1).max(8),
  taskInstructions: nonBlankText.max(5_000),
  evidenceRequirements: z.array(nonBlankText.max(300)).min(1).max(16),
  feedbackCriteria: z.array(nonBlankText.max(240)).min(1).max(8),
  phases: z.array(taskPhaseSchema).min(3).max(4),
  rubricDimensions: z.array(rubricDimensionSchema).min(4).max(8),
}).strict().superRefine((content, context) => {
  const expectedStage = content.grade <= 6 ? "PRIMARY" : "MIDDLE";
  if (content.schoolStage !== expectedStage) {
    context.addIssue({ code: "custom", path: ["grade"], message: "Grade must belong to the selected school stage" });
  }
  const supportsStage = (code: DisciplineCode) =>
    disciplineCatalog.find((discipline) => discipline.code === code)?.stages.some((stage) => stage === content.schoolStage) ?? false;
  if (!supportsStage(content.mainDisciplineCode)) {
    context.addIssue({ code: "custom", path: ["mainDisciplineCode"], message: "Main discipline is unavailable for this school stage" });
  }
  if (new Set(content.integratedDisciplineCodes).size !== content.integratedDisciplineCodes.length) {
    context.addIssue({ code: "custom", path: ["integratedDisciplineCodes"], message: "Integrated disciplines must not repeat" });
  }
  if (content.integratedDisciplineCodes.includes(content.mainDisciplineCode)) {
    context.addIssue({ code: "custom", path: ["integratedDisciplineCodes"], message: "Integrated disciplines cannot include the main discipline" });
  }
  if (content.integratedDisciplineCodes.some((code) => !supportsStage(code))) {
    context.addIssue({ code: "custom", path: ["integratedDisciplineCodes"], message: "Integrated discipline is unavailable for this school stage" });
  }
  if (new Set(content.crossDisciplinaryConceptCodes).size !== content.crossDisciplinaryConceptCodes.length) {
    context.addIssue({ code: "custom", path: ["crossDisciplinaryConceptCodes"], message: "Cross-disciplinary concepts must not repeat" });
  }
  const practical = new Set(assignmentSubtypes.practical.map((item) => item.code));
  const inquiry = new Set(assignmentSubtypes.inquiry.map((item) => item.code));
  if (content.assignmentType === "project" && content.assignmentSubtype !== null) {
    context.addIssue({ code: "custom", path: ["assignmentSubtype"], message: "Project tasks do not have a subtype" });
  }
  if (content.assignmentType === "practical" && !practical.has(content.assignmentSubtype as never)) {
    context.addIssue({ code: "custom", path: ["assignmentSubtype"], message: "Practical tasks require a practical subtype" });
  }
  if (content.assignmentType === "inquiry" && !inquiry.has(content.assignmentSubtype as never)) {
    context.addIssue({ code: "custom", path: ["assignmentSubtype"], message: "Inquiry tasks require an inquiry subtype" });
  }
});

export const activityContentSchema = z.union([activityContentV1Schema, activityContentV2Schema]);

export type ActivityContentV1 = z.infer<typeof activityContentV1Schema>;
export type ActivityContentV2 = z.infer<typeof activityContentV2Schema>;
export type ActivityContent = z.infer<typeof activityContentSchema>;

export function disciplineLabel(code: DisciplineCode): string {
  return disciplineCatalog.find((discipline) => discipline.code === code)?.label ?? code;
}

export function assignmentTypeDetails(code: ActivityContentV2["assignmentType"]) {
  return assignmentTypes.find((type) => type.code === code)!;
}

export function assignmentSubtypeLabel(
  assignmentType: ActivityContentV2["assignmentType"],
  code: ActivityContentV2["assignmentSubtype"],
): string | null {
  if (assignmentType === "project" || code === null) return null;
  return assignmentSubtypes[assignmentType].find((subtype) => subtype.code === code)?.label ?? code;
}

export function evidenceTypeLabel(code: ActivityContentV2["phases"][number]["evidence"][number]["type"]): string {
  return evidenceTypes.find((type) => type.code === code)?.label ?? code;
}
