import type { ActivityRubricDimension } from "../activity/activity-content";
import {
  teacherEvaluationLevels,
  type TeacherEvaluationLevel,
} from "./teacher-evaluation-policy";

export type RubricLevelGuidance = Readonly<{
  /** What the awarded level says, in the frozen rubric; null when no level was given. */
  awarded: Readonly<{ level: TeacherEvaluationLevel; descriptor: string }> | null;
  /** The level to aim for next: one step up, or 达标 when the evidence was insufficient. */
  next: Readonly<{ level: TeacherEvaluationLevel; descriptor: string }> | null;
}>;

/**
 * D-096: a level word alone does not tell a student what it means or what
 * would be better. Reads both from the release's frozen rubric. Returns null
 * when the outcome does not line up with the rubric by position and name.
 */
export function rubricLevelGuidance(
  dimensions: readonly ActivityRubricDimension[],
  outcome: Readonly<{
    dimensionIndex: number;
    dimensionName: string;
    status: "LEVEL" | "INSUFFICIENT_EVIDENCE";
    level?: TeacherEvaluationLevel;
  }>,
): RubricLevelGuidance | null {
  const dimension = dimensions[outcome.dimensionIndex - 1];
  if (!dimension || dimension.name !== outcome.dimensionName) return null;
  if (outcome.status !== "LEVEL" || !outcome.level) {
    return { awarded: null, next: { level: "pass", descriptor: dimension.pass } };
  }
  const rank = teacherEvaluationLevels.indexOf(outcome.level);
  const nextLevel = rank > 0 ? teacherEvaluationLevels[rank - 1] : undefined;
  return {
    awarded: { level: outcome.level, descriptor: dimension[outcome.level] },
    next: nextLevel ? { level: nextLevel, descriptor: dimension[nextLevel] } : null,
  };
}
