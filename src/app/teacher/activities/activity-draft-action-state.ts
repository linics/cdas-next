import type {
  ActivityContent,
  ActivityContentStructured,
  ActivityContentV2,
  ActivityContentV3,
} from "../../../domain/activity/activity-content";

export type ActivityDraftFormValues = ActivityContentStructured;

export type ActivityDraftActionState = Readonly<{
  status: "idle" | "success" | "validation_error" | "conflict" | "unauthorized" | "error";
  message: string;
  values: ActivityDraftFormValues;
  draftId: string | null;
  expectedVersion: number | null;
  persistedStatus: "EDITING" | "READY_FOR_PREVIEW" | "SEALED" | null;
  nextIdempotencyKey: string;
}>;

export const createBlankPhase = (name: string, learningGoalIds: string[] = []) => ({
  name,
  action: "",
  context: "",
  support: "",
  learningGoalIds,
  evidence: [{ type: "text" as const, description: "" }],
  evaluationFocus: "",
  suggestedLessons: 1,
});

function supportedV3EvidenceType(
  type: ActivityContentV2["phases"][number]["evidence"][number]["type"],
): ActivityContentV3["phases"][number]["evidence"][number]["type"] {
  return type === "text" || type === "document" || type === "image" || type === "confirm"
    ? type
    : "confirm";
}

export const emptyActivityDraftValues: ActivityContentV3 = {
  schemaVersion: 3,
  title: "",
  topic: "",
  summary: "",
  schoolStage: "PRIMARY",
  grade: 1,
  mainDisciplineCode: "chinese",
  integratedDisciplineCodes: ["science"],
  disciplineContributions: [
    { disciplineCode: "chinese", contribution: "通过访谈和任务表达形成清晰的公共沟通。", necessity: "没有语文的表达与交流，成果无法被真实对象理解和采纳。" },
    { disciplineCode: "science", contribution: "通过观察、记录和证据解释支持真实问题判断。", necessity: "没有科学的探究证据，方案不能建立在可核验的发现上。" },
  ],
  assignmentType: "practical",
  assignmentSubtype: "observation",
  inquiryDepth: null,
  submissionMode: "once",
  durationWeeks: 2,
  backgroundSetting: "",
  taskInstructions: "",
  learningGoals: [
    { id: "goal-1", description: "", competencyReferences: [{ disciplineCode: "chinese", competencyCode: "language_application" }] },
    { id: "goal-2", description: "", competencyReferences: [{ disciplineCode: "science", competencyCode: "inquiry_practice" }] },
  ],
  phases: [
    createBlankPhase("观察与问题界定", ["goal-1"]),
    createBlankPhase("调查与分析", ["goal-1", "goal-2"]),
    createBlankPhase("建议与公开表达", ["goal-2"]),
  ],
  rubricDimensions: [
    { name: "问题意识", excellent: "", good: "", pass: "", improve: "", learningGoalIds: ["goal-1"] },
    { name: "证据质量", excellent: "", good: "", pass: "", improve: "", learningGoalIds: ["goal-1", "goal-2"] },
    { name: "跨学科连接", excellent: "", good: "", pass: "", improve: "", learningGoalIds: ["goal-2"] },
    { name: "方案表达", excellent: "", good: "", pass: "", improve: "", learningGoalIds: ["goal-2"] },
  ],
};

export function structuredTaskBookValues(content: ActivityContent): ActivityDraftFormValues {
  if (content.schemaVersion === 2 || content.schemaVersion === 3) return content;
  return {
    ...emptyActivityDraftValues,
    title: content.title,
    summary: content.summary,
    taskInstructions: content.taskInstructions,
  };
}

/** Explicit, in-place v2 draft upgrade. It deliberately creates a new v3
 * revision only after the teacher fills the displayed placeholders and saves. */
export function upgradeTaskBookV2ToV3(content: ActivityContentV2): ActivityContentV3 {
  const selectedDisciplines = [content.mainDisciplineCode, ...content.integratedDisciplineCodes];
  const goalDiscipline = content.mainDisciplineCode === "integrated"
    ? content.integratedDisciplineCodes.find((code) => code !== "integrated") ?? "chinese"
    : content.mainDisciplineCode;
  const goalIds = ["goal-1", "goal-2", "goal-3"];
  const mainCompetencies: Record<string, string> = {
    chinese: "language_application", math: content.schoolStage === "PRIMARY" ? "number_sense" : "abstraction_ability", english: "language_ability",
    science: "scientific_concept", history: "historical_evidence", geography: "regional_cognition",
    physics: "scientific_inquiry", chemistry: "chemical_concept", biology: "inquiry_practice",
    infoTech: "information_awareness", labor: "labor_ability", arts: "creative_practice",
    sports: "health_behavior", politics: "moral_cultivation", integrated: "language_application",
  };
  return {
    schemaVersion: 3,
    title: content.title, topic: content.topic, summary: content.summary,
    schoolStage: content.schoolStage, grade: content.grade,
    mainDisciplineCode: content.mainDisciplineCode,
    integratedDisciplineCodes: content.integratedDisciplineCodes,
    disciplineContributions: selectedDisciplines.map((disciplineCode) => ({ disciplineCode, contribution: "请补充该学科在任务中的具体贡献。", necessity: "请说明缺少该学科时任务为何不能成立。" })),
    assignmentType: content.assignmentType, assignmentSubtype: content.assignmentSubtype,
    inquiryDepth: content.assignmentType === "inquiry" ? content.inquiryDepth : null,
    submissionMode: content.submissionMode, durationWeeks: content.durationWeeks,
    backgroundSetting: content.backgroundSetting, taskInstructions: content.taskInstructions,
    learningGoals: [
      { id: goalIds[0]!, description: content.objectiveKnowledge, competencyReferences: [{ disciplineCode: goalDiscipline, competencyCode: mainCompetencies[goalDiscipline]! }] },
      { id: goalIds[1]!, description: content.objectiveProcess, competencyReferences: [{ disciplineCode: goalDiscipline, competencyCode: mainCompetencies[goalDiscipline]! }] },
      { id: goalIds[2]!, description: content.objectiveEmotion, competencyReferences: [{ disciplineCode: goalDiscipline, competencyCode: mainCompetencies[goalDiscipline]! }] },
    ],
    phases: content.phases.map((phase, index) => ({
      ...phase,
      // v2 could mention video/link. They are deliberately changed to a
      // teacher-confirmed checkpoint instead of claiming v3 can upload/read
      // an unsupported evidence type.
      evidence: phase.evidence.map((evidence) => ({
        type: supportedV3EvidenceType(evidence.type),
        description:
          evidence.type === "video" || evidence.type === "link"
            ? `请以现场确认替代原“${evidence.description}”证据，或改为文字、图片、PDF/DOC/DOCX。`
            : evidence.description,
      })),
      learningGoalIds: [goalIds[Math.min(index, goalIds.length - 1)]!],
    })),
    rubricDimensions: content.rubricDimensions.map((dimension, index) => ({ ...dimension, learningGoalIds: [goalIds[index % goalIds.length]!] })),
  };
}

/** Keeps v2's legacy scalar projection aligned; v3 deliberately has none. */
export function normalizeTaskBookValues(values: ActivityDraftFormValues): ActivityDraftFormValues {
  if (values.schemaVersion === 3) return values;
  return {
    ...values,
    learningObjectives: [values.objectiveKnowledge, values.objectiveProcess, values.objectiveEmotion]
      .map((item) => item.trim()).filter(Boolean),
    evidenceRequirements: values.phases.flatMap((phase) => phase.evidence.map((item) => item.description.trim()).filter(Boolean)),
    feedbackCriteria: values.rubricDimensions.map((dimension) => dimension.name.trim()).filter(Boolean),
  };
}
