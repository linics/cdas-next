import { z } from "zod";
import type { ActivityContentStructured } from "./activity-content";

/**
 * Teacher-recognisable task-book regions. They are used by the assistant's
 * revision approval gate: a proposed change must describe exactly the
 * regions it actually alters.
 */
export const taskBookAreas = [
  "BASIC_SETTINGS",
  "BACKGROUND",
  "OBJECTIVES",
  "TASK_INSTRUCTIONS",
  "PHASES",
  "EVIDENCE",
  "RUBRIC",
] as const;

export type TaskBookArea = (typeof taskBookAreas)[number];
export const taskBookAreaSchema = z.enum(taskBookAreas);

export const taskBookAreaLabels: Readonly<Record<TaskBookArea, string>> = {
  BASIC_SETTINGS: "基本信息",
  BACKGROUND: "背景设定",
  OBJECTIVES: "学习目标与跨学科设计",
  TASK_INSTRUCTIONS: "总体任务",
  PHASES: "阶段任务",
  EVIDENCE: "学习证据",
  RUBRIC: "评价量规",
};

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function v3PhaseWithoutEvidence(phase: ActivityContentStructured["phases"][number]) {
  return Object.fromEntries(
    Object.entries(phase).filter(([field]) => field !== "evidence"),
  );
}

/**
 * v2 keeps scalar objective/evidence projections, whereas v3 owns goals,
 * phase evidence and rubric links canonically. This comparison intentionally
 * splits V3 phase task design from phase evidence, so a teacher cannot claim
 * to only adjust evidence while silently changing the task sequence.
 */
export function changedTaskBookAreas(
  before: ActivityContentStructured,
  after: ActivityContentStructured,
): TaskBookArea[] {
  if (before.schemaVersion !== after.schemaVersion) return [...taskBookAreas];
  const changed = new Set<TaskBookArea>();

  if (before.schemaVersion === 2 && after.schemaVersion === 2) {
    const v2Fields: Readonly<Record<TaskBookArea, readonly (keyof typeof before)[]>> = {
      BASIC_SETTINGS: ["title", "topic", "summary", "schoolStage", "grade", "mainDisciplineCode", "integratedDisciplineCodes", "crossDisciplinaryConceptCodes", "assignmentType", "assignmentSubtype", "inquiryDepth", "submissionMode", "durationWeeks"],
      BACKGROUND: ["backgroundSetting"],
      OBJECTIVES: ["objectiveKnowledge", "objectiveProcess", "objectiveEmotion", "learningObjectives"],
      TASK_INSTRUCTIONS: ["taskInstructions"],
      PHASES: ["phases"],
      EVIDENCE: ["evidenceRequirements"],
      RUBRIC: ["rubricDimensions", "feedbackCriteria"],
    };
    taskBookAreas.forEach((area) => {
      if (v2Fields[area].some((field) => !jsonEqual(before[field], after[field]))) changed.add(area);
    });
  } else if (before.schemaVersion === 3 && after.schemaVersion === 3) {
    const basicFields: ReadonlyArray<keyof typeof before> = [
      "title", "topic", "summary", "schoolStage", "grade", "mainDisciplineCode",
      "integratedDisciplineCodes", "assignmentType", "assignmentSubtype", "inquiryDepth",
      "submissionMode", "durationWeeks",
    ];
    if (basicFields.some((field) => !jsonEqual(before[field], after[field]))) changed.add("BASIC_SETTINGS");
    if (!jsonEqual(before.backgroundSetting, after.backgroundSetting)) changed.add("BACKGROUND");
    if (!jsonEqual(before.learningGoals, after.learningGoals) || !jsonEqual(before.disciplineContributions, after.disciplineContributions)) changed.add("OBJECTIVES");
    if (!jsonEqual(before.taskInstructions, after.taskInstructions)) changed.add("TASK_INSTRUCTIONS");
    if (!jsonEqual(before.phases.map(v3PhaseWithoutEvidence), after.phases.map(v3PhaseWithoutEvidence))) changed.add("PHASES");
    if (!jsonEqual(before.phases.map((phase) => phase.evidence), after.phases.map((phase) => phase.evidence))) changed.add("EVIDENCE");
    if (!jsonEqual(before.rubricDimensions, after.rubricDimensions)) changed.add("RUBRIC");
  }
  return taskBookAreas.filter((area) => changed.has(area));
}
