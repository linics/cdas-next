import type {
  ActivityContentV3,
  DisciplineCode,
} from "../../../domain/activity/activity-content";
import { findCoreCompetency } from "../../../domain/curriculum/core-competencies";

export type ActivityDraftV3FormValues = ActivityContentV3;

export type ActivityDraftV3ActionState = {
  status:
    | "idle"
    | "success"
    | "validation_error"
    | "unauthorized"
    | "conflict"
    | "error";
  message: string;
  values: ActivityDraftV3FormValues;
  draftId: string | null;
  expectedVersion: number | null;
  persistedStatus: "EDITING" | "READY_FOR_PREVIEW" | "SEALED" | null;
  nextIdempotencyKey: string;
};

export function createBlankLearningGoal(id: string): ActivityContentV3["learningGoals"][number] {
  return { id, description: "", competencyReferences: [] };
}

export function nextLearningGoalId(
  goals: readonly ActivityContentV3["learningGoals"][number][],
): string {
  const used = new Set(goals.map((goal) => goal.id));
  let suffix = 1;
  while (used.has(`goal-${suffix}`)) suffix += 1;
  return `goal-${suffix}`;
}

export function createBlankPhase(name: string): ActivityContentV3["phases"][number] {
  return {
    name,
    action: "",
    context: "",
    support: "",
    learningGoalIds: [],
    evidence: [{ type: "text", description: "" }],
    evaluationFocus: "",
    suggestedLessons: 1,
  };
}

export function createBlankRubricDimension(
  name: string,
): ActivityContentV3["rubricDimensions"][number] {
  return {
    name,
    excellent: "",
    good: "",
    pass: "",
    improve: "",
    learningGoalIds: [],
  };
}

export function createBlankContribution(
  disciplineCode: DisciplineCode,
): ActivityContentV3["disciplineContributions"][number] {
  return { disciplineCode, contribution: "", necessity: "" };
}

/**
 * The starting shape a teacher edits. It already carries the structural
 * minimums the schema demands — two goals, three phases, four rubric
 * dimensions — so the form never asks someone to discover those limits by
 * being rejected.
 */
export const emptyActivityDraftV3Values: ActivityDraftV3FormValues = {
  schemaVersion: 3,
  title: "",
  topic: "",
  summary: "",
  schoolStage: "MIDDLE",
  grade: 7,
  mainDisciplineCode: "physics",
  integratedDisciplineCodes: ["chinese"],
  disciplineContributions: [
    createBlankContribution("physics"),
    createBlankContribution("chinese"),
  ],
  assignmentType: "inquiry",
  assignmentSubtype: "survey",
  inquiryDepth: "basic",
  submissionMode: "phased",
  durationWeeks: 2,
  backgroundSetting: "",
  taskInstructions: "",
  learningGoals: [createBlankLearningGoal("goal-1"), createBlankLearningGoal("goal-2")],
  phases: [
    createBlankPhase("观察与问题界定"),
    createBlankPhase("调查与分析"),
    createBlankPhase("建议与公开表达"),
  ],
  rubricDimensions: [
    createBlankRubricDimension("问题与机理"),
    createBlankRubricDimension("数据与证据"),
    createBlankRubricDimension("跨学科连接"),
    createBlankRubricDimension("表达与建议"),
  ],
};

/**
 * Keeps the discipline roster and its contribution list in step, and drops
 * goal links and competency citations that the current selection no longer
 * allows. Doing this as the teacher edits means the schema's cross-field rules
 * surface as the form changing shape, not as a wall of errors on save.
 */
export function normalizeV3Values(
  values: ActivityDraftV3FormValues,
): ActivityDraftV3FormValues {
  const selected: DisciplineCode[] = [
    values.mainDisciplineCode,
    ...values.integratedDisciplineCodes.filter(
      (code) => code !== values.mainDisciplineCode,
    ),
  ];
  const existing = new Map(
    values.disciplineContributions.map((item) => [item.disciplineCode, item]),
  );
  const disciplineContributions = selected.map(
    (code) => existing.get(code) ?? createBlankContribution(code),
  );

  const goalIds = new Set(values.learningGoals.map((goal) => goal.id));
  const learningGoals = values.learningGoals.map((goal) => ({
    ...goal,
    competencyReferences: goal.competencyReferences.filter((reference) => {
      const competency = findCoreCompetency(
        reference.disciplineCode,
        reference.competencyCode,
      );
      return (
        selected.includes(reference.disciplineCode) &&
        competency !== undefined &&
        competency.schoolStages.includes(values.schoolStage) &&
        values.grade >= competency.gradeRange[0] &&
        values.grade <= competency.gradeRange[1]
      );
    }),
  }));

  return {
    ...values,
    integratedDisciplineCodes: selected.slice(1),
    disciplineContributions,
    learningGoals,
    inquiryDepth:
      values.assignmentType === "inquiry" ? (values.inquiryDepth ?? "basic") : null,
    assignmentSubtype:
      values.assignmentType === "project" ? null : values.assignmentSubtype,
    phases: values.phases.map((phase) => ({
      ...phase,
      learningGoalIds: phase.learningGoalIds.filter((id) => goalIds.has(id)),
    })),
    rubricDimensions: values.rubricDimensions.map((dimension) => ({
      ...dimension,
      learningGoalIds: dimension.learningGoalIds.filter((id) => goalIds.has(id)),
    })),
  };
}
