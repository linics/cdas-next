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

export const waterConservationTaskBook = {
  schemaVersion: 2,
  title: "校园节水行动",
  topic: "生态与可持续发展",
  summary: "观察校园真实用水场景，用简单统计识别问题，并形成一份有证据、可执行的节水改进建议。",
  schoolStage: "MIDDLE",
  grade: 7,
  mainDisciplineCode: "physics",
  integratedDisciplineCodes: ["math", "chinese"],
  crossDisciplinaryConceptCodes: ["system_model"],
  assignmentType: "inquiry",
  assignmentSubtype: "survey",
  inquiryDepth: "deep",
  submissionMode: "phased",
  durationWeeks: 2,
  backgroundSetting:
    "你们是七年级节水观察员。总务处下周要在公示栏向全校宣布一批节水措施，但手上没有证据，不知道该先改哪一处。请你们用现场证据回答：校园里哪一处用水最浪费，怎样说服相关负责人立刻改？两周后你们要交出一份《校园节水建议书》，被采纳的建议会直接贴上公示栏。",
  objectiveKnowledge: "理解校园用水行为与资源节约之间的关系。",
  objectiveProcess: "能够通过观察、调查和简单统计形成有证据的判断。",
  objectiveEmotion: "愿意对公共资源负责，并与同伴沟通可行的改进方案。",
  learningObjectives: ["理解校园用水行为与资源节约之间的关系。", "能够通过观察、调查和简单统计形成有证据的判断。", "愿意对公共资源负责，并与同伴沟通可行的改进方案。"],
  taskInstructions: "作为节水观察员，完成现场观察、数据分析和面向总务处的建议表达，形成有证据的节水行动方案。",
  evidenceRequirements: ["带有时间和地点的观察记录", "整理后的统计表或图表", "节水行动建议稿"],
  feedbackCriteria: ["问题意识", "证据质量", "跨学科连接", "方案表达"],
  phases: [
    { name: "观察与问题界定", action: "到一个真实用水点做观察，写下可调查的浪费问题。", context: "总务处请你们先去现场看。洗手间、饮水区或绿化浇灌，哪一处最像每天都在漏水？把时间、地点和现象记下来，好让下一阶段对得上。", support: "用观察记录表标注时间、地点、行为与影响，先把现象写清楚再下判断。", evidence: [{ type: "text", description: "带时间、地点和现象的观察记录" }], evaluationFocus: "问题是否来自真实场景且表述清楚。", suggestedLessons: 1 },
    { name: "调查与分析", action: "整理观察或问卷数据，解释这个用水问题为何成立。", context: "你们在上一阶段已经锁定了一个用水点。现在总务处希望你们用数据说清楚：浪费发生在什么时间、什么行为上，而不是只凭感觉。", support: "用统计表、频数或简单图表整理数据，比较不同时间或地点。", evidence: [{ type: "document", description: "统计表或图表及简要分析" }], evaluationFocus: "判断是否有可靠证据支持。", suggestedLessons: 1 },
    { name: "建议与公开表达", action: "面向明确负责人提出至少两条可执行的节水建议。", context: "数据已经指向明确问题。现在总务处要把建议贴到公示栏，请你们告诉具体负责人该怎么改，并讲清证据从哪来。", support: "按现象、证据、建议的结构组织表达，建议要写清谁来做、在哪里做。", evidence: [{ type: "text", description: "包含证据依据的节水建议稿" }], evaluationFocus: "建议是否具体、可执行并与证据对应。", suggestedLessons: 1 },
  ],
  rubricDimensions: [
    { name: "问题意识", excellent: "从真实情境提出清晰、可调查的问题。", good: "能从情境提出较清楚的问题。", pass: "能指出一个相关问题。", improve: "问题与情境关联不清。" },
    { name: "证据质量", excellent: "证据完整、可靠，并能支持结论。", good: "有较充分证据支持结论。", pass: "提供基本证据。", improve: "证据不足或与结论脱节。" },
    { name: "跨学科连接", excellent: "能清楚说明学科方法如何共同支持方案。", good: "能使用两个学科的方法。", pass: "能使用一种相关方法。", improve: "未说明学科方法。" },
    { name: "方案表达", excellent: "方案具体、可执行且表达有说服力。", good: "方案较具体并能表达依据。", pass: "提出基本建议。", improve: "建议笼统或不可执行。" },
  ],
} satisfies ActivityContent;
