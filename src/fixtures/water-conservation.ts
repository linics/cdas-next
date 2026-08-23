import type { ActivityContent } from "../domain/activity/activity-content";

// Migrated as content only from the old CDAS demo asset. The old phased task,
// persistence model, and API contract are intentionally not carried forward.
export const waterConservationActivity = {
  schemaVersion: 1,
  title: "校园节水行动",
  summary:
    "观察校园真实用水场景，用简单统计识别问题，并形成一份有证据、可执行的节水改进建议。",
  learningObjectives: [
    "从校园生活中界定一个可观察、可调查的用水问题。",
    "使用观察记录、问卷或简单统计支持判断。",
    "按照“现象—证据—建议”的结构清楚表达改进方案。",
  ],
  taskInstructions:
    "选择一个校园用水场景进行观察，记录时间、地点、行为与影响；整理观察或问卷数据；据此提出至少两条针对明确对象、具有证据依据且可以执行的节水建议，并补充一段行动反思。",
  evidenceRequirements: [
    "一份包含时间、地点和观察结果的记录或统计表。",
    "一段说明问题、证据与建议之间关系的文字。",
    "一份至少包含两条具体行动的节水建议稿。",
  ],
  feedbackCriteria: [
    "问题来自真实场景且表述清楚。",
    "判断有观察、调查或统计证据支持。",
    "建议具体、可执行，并与证据对应。",
    "文字结构清楚，能说明跨学科方法如何发挥作用。",
  ],
} satisfies ActivityContent;
