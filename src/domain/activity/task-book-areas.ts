import { z } from "zod";
import type {
  ActivityContentStructured,
  ActivityContentV2,
  ActivityContentV3,
} from "./activity-content";

/**
 * The teacher-facing regions of a v2 task book. They exist so a proposed
 * revision can state what it touches in words the teacher recognises from the
 * draft form, and so the server can check that statement against the actual
 * difference instead of trusting it.
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

type ContentField = Exclude<keyof ActivityContentV2, "schemaVersion">;

/**
 * Every v2 field except `schemaVersion` belongs to exactly one area. A field
 * added to the content schema without being placed here would silently become
 * invisible to the scope check, so the type of this table is exhaustive.
 */
const areaFields: Readonly<Record<TaskBookArea, readonly ContentField[]>> = {
  BASIC_SETTINGS: [
    "title",
    "topic",
    "summary",
    "schoolStage",
    "grade",
    "mainDisciplineCode",
    "integratedDisciplineCodes",
    "crossDisciplinaryConceptCodes",
    "assignmentType",
    "assignmentSubtype",
    "inquiryDepth",
    "submissionMode",
    "durationWeeks",
  ],
  BACKGROUND: ["backgroundSetting"],
  OBJECTIVES: [
    "objectiveKnowledge",
    "objectiveProcess",
    "objectiveEmotion",
    "learningObjectives",
  ],
  TASK_INSTRUCTIONS: ["taskInstructions"],
  PHASES: ["phases"],
  EVIDENCE: ["evidenceRequirements"],
  RUBRIC: ["rubricDimensions", "feedbackCriteria"],
};

const fieldArea = new Map<ContentField, TaskBookArea>(
  taskBookAreas.flatMap((area) =>
    areaFields[area].map((field) => [field, area] as const),
  ),
);

export const taskBookAreaLabels: Readonly<Record<TaskBookArea, string>> = {
  BASIC_SETTINGS: "基本设置",
  BACKGROUND: "背景设定",
  OBJECTIVES: "学习目标",
  TASK_INSTRUCTIONS: "总体任务",
  PHASES: "任务链阶段",
  EVIDENCE: "证据要求",
  RUBRIC: "评价标准",
};

/**
 * Which areas actually differ between two task books. Comparison is by
 * canonical JSON of each field, so reordering an array counts as a change:
 * phase order and rubric order are meaning, not presentation.
 */
type V3ContentField = Exclude<keyof ActivityContentV3, "schemaVersion">;

/**
 * The same teacher-facing regions for a v3 task book. v3 has no standalone
 * evidence field — evidence lives inside the phase that collects it — so a
 * changed requirement reports as PHASES. EVIDENCE therefore never appears for
 * a v3 revision, and a proposal that declares it is correctly rejected for
 * describing a change it did not make.
 */
const v3AreaFields: Readonly<Record<TaskBookArea, readonly V3ContentField[]>> = {
  BASIC_SETTINGS: [
    "title",
    "topic",
    "summary",
    "schoolStage",
    "grade",
    "mainDisciplineCode",
    "integratedDisciplineCodes",
    "assignmentType",
    "assignmentSubtype",
    "inquiryDepth",
    "submissionMode",
    "durationWeeks",
  ],
  BACKGROUND: ["backgroundSetting"],
  OBJECTIVES: ["learningGoals", "disciplineContributions"],
  TASK_INSTRUCTIONS: ["taskInstructions"],
  PHASES: ["phases"],
  EVIDENCE: [],
  RUBRIC: ["rubricDimensions"],
};

const v3FieldArea = new Map<V3ContentField, TaskBookArea>(
  taskBookAreas.flatMap((area) =>
    v3AreaFields[area].map((field) => [field, area] as const),
  ),
);

export function changedTaskBookAreas(
  before: ActivityContentStructured,
  after: ActivityContentStructured,
): TaskBookArea[] {
  const changed = new Set<TaskBookArea>();
  if (before.schemaVersion === 3 && after.schemaVersion === 3) {
    for (const [field, area] of v3FieldArea) {
      if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
        changed.add(area);
      }
    }
    return taskBookAreas.filter((area) => changed.has(area));
  }
  if (before.schemaVersion === 2 && after.schemaVersion === 2) {
    for (const [field, area] of fieldArea) {
      if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
        changed.add(area);
      }
    }
    return taskBookAreas.filter((area) => changed.has(area));
  }
  // A revision may not change the task book's version. Reporting every area
  // makes the scope check reject it rather than letting it through unnoticed.
  return [...taskBookAreas];
}
