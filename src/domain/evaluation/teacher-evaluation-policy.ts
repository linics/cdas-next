export const TEACHER_EVALUATION_SUMMARY_MAX_LENGTH = 10_000;
export const TEACHER_EVALUATION_INTENT_TTL_MS = 10 * 60 * 1_000;
export const TEACHER_EVALUATION_MAX_CITATIONS = 5;

export const teacherEvaluationLevels = [
  "excellent",
  "good",
  "pass",
  "improve",
] as const;
export type TeacherEvaluationLevel = (typeof teacherEvaluationLevels)[number];

export const teacherEvaluationLevelLabels: Readonly<
  Record<TeacherEvaluationLevel, string>
> = {
  excellent: "优秀",
  good: "良好",
  pass: "合格",
  improve: "需改进",
};

export const teacherEvaluationOutcomeStatuses = [
  "LEVEL",
  "INSUFFICIENT_EVIDENCE",
] as const;
export type TeacherEvaluationOutcomeStatus =
  (typeof teacherEvaluationOutcomeStatuses)[number];

export const teacherEvaluationOutcomeStatusLabels: Readonly<
  Record<TeacherEvaluationOutcomeStatus, string>
> = {
  LEVEL: "给出等级",
  INSUFFICIENT_EVIDENCE: "证据不足",
};

export const teacherEvaluationCitationKindLabels = {
  text: "本版文字证据",
  attachment: "本版附件",
  checkpoint: "已确认检查点",
} as const;
