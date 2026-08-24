export const TEACHER_FEEDBACK_BODY_MAX_LENGTH = 10_000;

export const teacherFeedbackNextSteps = ["CONTINUE", "REVISE"] as const;
export type TeacherFeedbackNextStep =
  (typeof teacherFeedbackNextSteps)[number];

export const teacherFeedbackSupportLevels = [
  "FOUNDATION",
  "STANDARD",
  "CHALLENGE",
] as const;
export type TeacherFeedbackSupportLevel =
  (typeof teacherFeedbackSupportLevels)[number];

export const teacherFeedbackNextStepLabels: Readonly<
  Record<TeacherFeedbackNextStep, string>
> = {
  CONTINUE: "继续后续阶段",
  REVISE: "按反馈修改并重交",
};

export const teacherFeedbackSupportLevelLabels: Readonly<
  Record<TeacherFeedbackSupportLevel, string>
> = {
  FOUNDATION: "基础支持",
  STANDARD: "标准任务",
  CHALLENGE: "挑战拓展",
};
