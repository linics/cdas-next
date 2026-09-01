import {
  projectionColumns,
  type ActivityContent,
  type ActivityContentV2,
} from "../../../domain/activity/activity-content";

export type ActivityDraftFormValues = ActivityContentV2;

export type ActivityDraftActionState = Readonly<{
  status: "idle" | "success" | "validation_error" | "conflict" | "unauthorized" | "error";
  message: string;
  values: ActivityDraftFormValues;
  draftId: string | null;
  expectedVersion: number | null;
  persistedStatus: "EDITING" | "READY_FOR_PREVIEW" | "SEALED" | null;
  nextIdempotencyKey: string;
}>;

export const createBlankPhase = (name: string) => ({
  name,
  action: "",
  context: "",
  support: "",
  evidence: [{ type: "text" as const, description: "" }],
  evaluationFocus: "",
  suggestedLessons: 1,
});

export const emptyActivityDraftValues: ActivityDraftFormValues = {
  schemaVersion: 2,
  title: "",
  topic: "",
  summary: "",
  schoolStage: "PRIMARY",
  grade: 1,
  mainDisciplineCode: "chinese",
  integratedDisciplineCodes: ["science"],
  crossDisciplinaryConceptCodes: [],
  assignmentType: "practical",
  assignmentSubtype: "observation",
  inquiryDepth: "basic",
  submissionMode: "once",
  durationWeeks: 2,
  backgroundSetting: "",
  objectiveKnowledge: "",
  objectiveProcess: "",
  objectiveEmotion: "",
  learningObjectives: [],
  taskInstructions: "",
  evidenceRequirements: [],
  feedbackCriteria: [],
  phases: [createBlankPhase("观察与问题界定"), createBlankPhase("调查与分析"), createBlankPhase("建议与公开表达")],
  rubricDimensions: [
    { name: "问题意识", excellent: "", good: "", pass: "", improve: "" },
    { name: "证据质量", excellent: "", good: "", pass: "", improve: "" },
    { name: "跨学科连接", excellent: "", good: "", pass: "", improve: "" },
    { name: "方案表达", excellent: "", good: "", pass: "", improve: "" },
  ],
};

export function structuredTaskBookValues(content: ActivityContent): ActivityDraftFormValues {
  if (content.schemaVersion === 2) return content;
  // v1 and v3 both fall back to the v2 form shape here. v3 has its own editor;
  // this path only supplies the scalar summary a legacy form can still show.
  const projection = projectionColumns(content);
  return {
    ...emptyActivityDraftValues,
    title: content.title,
    summary: content.summary,
    learningObjectives: projection.learningObjectives,
    taskInstructions: projection.taskInstructions,
    evidenceRequirements: projection.evidenceRequirements,
    feedbackCriteria: projection.feedbackCriteria,
  };
}

/** Keeps the legacy summary fields in the v2 snapshot aligned with the task book. */
export function normalizeTaskBookValues(values: ActivityDraftFormValues): ActivityDraftFormValues {
  return {
    ...values,
    learningObjectives: [values.objectiveKnowledge, values.objectiveProcess, values.objectiveEmotion]
      .map((item) => item.trim())
      .filter(Boolean),
    evidenceRequirements: values.phases.flatMap((phase) => phase.evidence.map((item) => item.description.trim()).filter(Boolean)),
    feedbackCriteria: values.rubricDimensions.map((dimension) => dimension.name.trim()).filter(Boolean),
  };
}
