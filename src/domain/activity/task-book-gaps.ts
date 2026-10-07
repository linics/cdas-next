import { teacherEvaluationLevelLabels } from "../evaluation/teacher-evaluation-policy";
import {
  activityContentV3Schema,
  disciplineLabel,
  type ActivityContentV3,
} from "./activity-content";

/** The four parts of the task-book form, in the order the teacher fills them. */
export const taskBookSections = [
  { key: "basics", title: "基本信息" },
  { key: "design", title: "学习目标与跨学科设计" },
  { key: "phases", title: "阶段任务与学习证据" },
  { key: "rubric", title: "评价量规" },
] as const;

export type TaskBookSection = (typeof taskBookSections)[number]["key"];

export type TaskBookGap = Readonly<{ section: TaskBookSection; label: string }>;

const basicsFields: Record<string, string> = {
  title: "任务标题",
  topic: "任务主题",
  summary: "任务描述",
  schoolStage: "学段",
  grade: "年级",
  mainDisciplineCode: "主学科",
  assignmentType: "任务类型",
  submissionMode: "提交模式",
  integratedDisciplineCodes: "融合学科",
  assignmentSubtype: "任务子类型",
  inquiryDepth: "探究深度",
  durationWeeks: "周期（周）",
};

const phaseFields: Record<string, string> = {
  name: "阶段名称",
  action: "核心动作",
  context: "情境承接",
  support: "学习支架",
  evaluationFocus: "评价要点",
  learningGoalIds: "服务的学习目标",
  suggestedLessons: "课时建议",
};

const rubricFields: Record<string, string> = {
  name: "维度名称",
  excellent: `${teacherEvaluationLevelLabels.excellent}描述`,
  good: `${teacherEvaluationLevelLabels.good}描述`,
  pass: `${teacherEvaluationLevelLabels.pass}描述`,
  improve: `${teacherEvaluationLevelLabels.improve}描述`,
  learningGoalIds: "评价的学习目标",
};

function named(prefix: string, index: number, name: string | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? `${prefix} ${index + 1}「${trimmed}」` : `${prefix} ${index + 1}`;
}

function gapFor(
  values: ActivityContentV3,
  path: readonly PropertyKey[],
): TaskBookGap | null {
  const [head, index, field, nested, nestedField] = path;
  if (typeof head !== "string") return null;
  if (head in basicsFields) return { section: "basics", label: basicsFields[head]! };
  if (head === "backgroundSetting") return { section: "design", label: "背景设定" };
  if (head === "taskInstructions") return { section: "phases", label: "总体任务说明" };
  if (typeof index !== "number") return null;

  if (head === "disciplineContributions") {
    const code = values.disciplineContributions[index]?.disciplineCode;
    const subject = code ? disciplineLabel(code) : `学科 ${index + 1}`;
    if (field === "contribution") return { section: "design", label: `${subject} · 学科贡献` };
    if (field === "necessity") return { section: "design", label: `${subject} · 不可替代性` };
    return null;
  }
  if (head === "learningGoals") {
    if (field === "description") return { section: "design", label: `目标 ${index + 1} · 可观察目标` };
    if (field === "competencyReferences") {
      return { section: "design", label: `目标 ${index + 1} · 至少选一条课程依据` };
    }
    return null;
  }
  if (head === "phases") {
    const phase = named("阶段", index, values.phases[index]?.name);
    if (field === "evidence" && typeof nested === "number" && nestedField === "description") {
      return { section: "phases", label: `${phase} · 证据 ${nested + 1} 的任务要求` };
    }
    if (field === "evidence") return { section: "phases", label: `${phase} · 需提交的学习证据` };
    if (typeof field === "string" && field in phaseFields) {
      return { section: "phases", label: `${phase} · ${phaseFields[field]}` };
    }
    return null;
  }
  if (head === "rubricDimensions") {
    const dimension = named("评价维度", index, values.rubricDimensions[index]?.name);
    if (typeof field === "string" && field in rubricFields) {
      return { section: "rubric", label: `${dimension} · ${rubricFields[field]}` };
    }
    return null;
  }
  return null;
}

const sectionOrder = new Map(taskBookSections.map((section, index) => [section.key, index]));

/**
 * What still stands between this task book and a version that can be saved,
 * in the teacher's words and in form order (D-093). The full schema decides
 * what is wrong; this only says where. Goal coverage is worked out here rather
 * than read from the schema's cross-field check, which does not run while
 * simpler fields are still blank — and a teacher needs both lists at once.
 */
export function describeTaskBookGaps(values: ActivityContentV3): TaskBookGap[] {
  const gaps: TaskBookGap[] = [];
  const parsed = activityContentV3Schema.safeParse(values);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const gap = gapFor(values, issue.path);
      if (gap) gaps.push(gap);
    }
  }

  const phaseGoals = new Set(values.phases.flatMap((phase) => phase.learningGoalIds));
  const rubricGoals = new Set(
    values.rubricDimensions.flatMap((dimension) => dimension.learningGoalIds),
  );
  values.learningGoals.forEach((goal, index) => {
    if (!phaseGoals.has(goal.id)) {
      gaps.push({ section: "phases", label: `目标 ${index + 1} 还没有阶段承担` });
    }
    if (!rubricGoals.has(goal.id)) {
      gaps.push({ section: "rubric", label: `目标 ${index + 1} 还没有评价维度评价` });
    }
  });

  // A schema issue the map above cannot place still blocks saving, so it is
  // reported against the part of the form it belongs to rather than dropped.
  if (!parsed.success && gaps.length === 0) {
    gaps.push({ section: "basics", label: "还有一项内容不符合要求，请检查各部分" });
  }

  const seen = new Set<string>();
  return gaps
    .filter((gap) => {
      const key = `${gap.section}|${gap.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => sectionOrder.get(left.section)! - sectionOrder.get(right.section)!);
}
