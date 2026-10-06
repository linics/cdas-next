import { z } from "zod";
import {
  activityContentV3Schema,
  type ActivityContentV3,
} from "./activity-content";
import {
  changedTaskBookAreas,
  taskBookAreaLabels,
  type TaskBookArea,
} from "./task-book-areas";

/**
 * The regions a teacher may hand to AI when adapting a v3 task book to another
 * class. Adaptation rewrites words inside the existing design; it never adds or
 * removes a goal, phase, evidence item or rubric dimension, never re-links them
 * and never changes disciplines, task type or submission mode. Those are design
 * decisions the teacher makes in the form.
 */
export const adaptableTaskBookAreas = [
  "BASIC_SETTINGS",
  "BACKGROUND",
  "OBJECTIVES",
  "TASK_INSTRUCTIONS",
  "PHASES",
  "RUBRIC",
] as const satisfies readonly TaskBookArea[];

export type AdaptableTaskBookArea = (typeof adaptableTaskBookAreas)[number];

export const adaptableAreaHints: Readonly<Record<AdaptableTaskBookArea, string>> = {
  BASIC_SETTINGS: "主题与简介（标题和学科设置不变）",
  BACKGROUND: "学生进入任务的情境与角色",
  OBJECTIVES: "学习目标文字与学科贡献说明",
  TASK_INSTRUCTIONS: "给学生的总体任务说明",
  PHASES: "各阶段内容、证据说明与建议课时",
  RUBRIC: "评价标准各档描述",
};

export const adaptationContextNoteMaxLength = 500;

export const activityAdaptationRequestSchema = z
  .object({
    targetGrade: z.int().min(1).max(9).nullable(),
    totalLessons: z.int().min(3).max(64).nullable(),
    contextNote: z.string().trim().max(adaptationContextNoteMaxLength),
    areas: z
      .array(z.enum(adaptableTaskBookAreas))
      .min(1)
      .max(adaptableTaskBookAreas.length)
      .refine((areas) => new Set(areas).size === areas.length, {
        message: "Areas must not repeat",
      }),
  })
  .strict();

export type ActivityAdaptationRequest = z.infer<
  typeof activityAdaptationRequestSchema
>;

export type AdaptationRequestProblem =
  | "NOTHING_TO_ADAPT"
  | "GRADE_INCOMPATIBLE"
  | "LESSONS_NEED_PHASES"
  | "LESSONS_TOO_FEW";

function schoolStageFor(grade: number): ActivityContentV3["schoolStage"] {
  return grade <= 6 ? "PRIMARY" : "MIDDLE";
}

/**
 * The teacher's settings are checked against the current task book before any
 * model is called. A grade the chosen disciplines or cited competencies do not
 * cover is a design change for the form, not something a rewrite can repair.
 */
export function adaptationRequestProblem(
  current: ActivityContentV3,
  request: ActivityAdaptationRequest,
): AdaptationRequestProblem | null {
  const gradeChanges =
    request.targetGrade !== null && request.targetGrade !== current.grade;
  if (
    !gradeChanges &&
    request.totalLessons === null &&
    request.contextNote.length === 0
  ) {
    return "NOTHING_TO_ADAPT";
  }
  if (request.totalLessons !== null) {
    if (!request.areas.includes("PHASES")) {
      return "LESSONS_NEED_PHASES";
    }
    if (request.totalLessons < current.phases.length) {
      return "LESSONS_TOO_FEW";
    }
  }
  if (
    gradeChanges &&
    !activityContentV3Schema.safeParse(withGrade(current, request.targetGrade!))
      .success
  ) {
    return "GRADE_INCOMPATIBLE";
  }
  return null;
}

function withGrade(content: ActivityContentV3, grade: number): ActivityContentV3 {
  return { ...content, grade, schoolStage: schoolStageFor(grade) };
}

const text = (max: number) => z.string().trim().min(1).max(max);

const outputAreaSchemas = {
  BASIC_SETTINGS: z
    .object({ topic: text(160), summary: text(600) })
    .strict(),
  BACKGROUND: z.object({ backgroundSetting: text(1_200) }).strict(),
  OBJECTIVES: z
    .object({
      learningGoals: z
        .array(z.object({ id: z.string(), description: text(500) }).strict())
        .min(1)
        .max(8),
      disciplineContributions: z
        .array(
          z
            .object({
              disciplineCode: z.string(),
              contribution: text(500),
              necessity: text(500),
            })
            .strict(),
        )
        .min(1)
        .max(15),
    })
    .strict(),
  TASK_INSTRUCTIONS: z.object({ taskInstructions: text(5_000) }).strict(),
  PHASES: z
    .object({
      phases: z
        .array(
          z
            .object({
              name: text(80),
              action: text(300),
              context: text(500),
              support: text(500),
              evidence: z
                .array(z.object({ description: text(300) }).strict())
                .min(1)
                .max(4),
              evaluationFocus: text(300),
              suggestedLessons: z.int().min(1).max(16),
            })
            .strict(),
        )
        .min(1)
        .max(4),
    })
    .strict(),
  RUBRIC: z
    .object({
      rubricDimensions: z
        .array(
          z
            .object({
              name: text(100),
              excellent: text(300),
              good: text(300),
              pass: text(300),
              improve: text(300),
            })
            .strict(),
        )
        .min(1)
        .max(8),
    })
    .strict(),
} as const satisfies Record<AdaptableTaskBookArea, z.ZodType>;

type OutputAreaSchemas = typeof outputAreaSchemas;
export type AdaptationModelOutput = {
  [Area in AdaptableTaskBookArea]?: z.infer<OutputAreaSchemas[Area]>;
};

/**
 * The model answers with exactly the areas the teacher selected, each under
 * its area code. An area it was not given is rejected rather than ignored: a
 * model that rewrites what it was told to leave alone has misread the task.
 */
export function adaptationModelOutputSchema(
  areas: readonly AdaptableTaskBookArea[],
) {
  const shape = Object.fromEntries(
    areas.map((area) => [area, outputAreaSchemas[area]]),
  ) as Record<string, z.ZodType>;
  return z.object(shape).strict();
}

/** What the model sees for each selected area: the current words only. */
export function adaptationModelSource(
  current: ActivityContentV3,
  areas: readonly AdaptableTaskBookArea[],
): AdaptationModelOutput {
  const source: AdaptationModelOutput = {};
  for (const area of areas) {
    switch (area) {
      case "BASIC_SETTINGS":
        source.BASIC_SETTINGS = { topic: current.topic, summary: current.summary };
        break;
      case "BACKGROUND":
        source.BACKGROUND = { backgroundSetting: current.backgroundSetting };
        break;
      case "OBJECTIVES":
        source.OBJECTIVES = {
          learningGoals: current.learningGoals.map(({ id, description }) => ({
            id,
            description,
          })),
          disciplineContributions: current.disciplineContributions.map(
            (item) => ({ ...item }),
          ),
        };
        break;
      case "TASK_INSTRUCTIONS":
        source.TASK_INSTRUCTIONS = { taskInstructions: current.taskInstructions };
        break;
      case "PHASES":
        source.PHASES = {
          phases: current.phases.map((phase) => ({
            name: phase.name,
            action: phase.action,
            context: phase.context,
            support: phase.support,
            evidence: phase.evidence.map(({ description }) => ({ description })),
            evaluationFocus: phase.evaluationFocus,
            suggestedLessons: phase.suggestedLessons,
          })),
        };
        break;
      case "RUBRIC":
        source.RUBRIC = {
          rubricDimensions: current.rubricDimensions.map(
            ({ name, excellent, good, pass, improve }) => ({
              name,
              excellent,
              good,
              pass,
              improve,
            }),
          ),
        };
        break;
    }
  }
  return source;
}

export type AdaptationMergeProblem =
  | "STRUCTURE_CHANGED"
  | "LESSONS_MISMATCH"
  | "NO_CHANGE"
  | "OUT_OF_SCOPE"
  | "INVALID_TASK_BOOK";

export class AdaptationMergeError extends Error {
  constructor(public readonly code: AdaptationMergeProblem) {
    super(code);
    this.name = "AdaptationMergeError";
  }
}

/**
 * Build the adapted task book from the current one. Everything the teacher did
 * not select is copied from `current`, so "untouched areas stay untouched"
 * holds by construction; the area diff below then proves it independently.
 * Grade and stage come from the teacher's request, never from the model.
 */
export function mergeAdaptation(
  current: ActivityContentV3,
  request: ActivityAdaptationRequest,
  output: AdaptationModelOutput,
): ActivityContentV3 {
  const next: ActivityContentV3 = withGrade(
    current,
    request.targetGrade ?? current.grade,
  );

  if (output.BASIC_SETTINGS) {
    next.topic = output.BASIC_SETTINGS.topic;
    next.summary = output.BASIC_SETTINGS.summary;
  }
  if (output.BACKGROUND) {
    next.backgroundSetting = output.BACKGROUND.backgroundSetting;
  }
  if (output.OBJECTIVES) {
    const { learningGoals, disciplineContributions } = output.OBJECTIVES;
    if (
      learningGoals.length !== current.learningGoals.length ||
      learningGoals.some((goal, index) => goal.id !== current.learningGoals[index]!.id) ||
      disciplineContributions.length !== current.disciplineContributions.length ||
      disciplineContributions.some(
        (item, index) =>
          item.disciplineCode !== current.disciplineContributions[index]!.disciplineCode,
      )
    ) {
      throw new AdaptationMergeError("STRUCTURE_CHANGED");
    }
    next.learningGoals = current.learningGoals.map((goal, index) => ({
      ...goal,
      description: learningGoals[index]!.description,
    }));
    next.disciplineContributions = current.disciplineContributions.map(
      (item, index) => ({
        ...item,
        contribution: disciplineContributions[index]!.contribution,
        necessity: disciplineContributions[index]!.necessity,
      }),
    );
  }
  if (output.TASK_INSTRUCTIONS) {
    next.taskInstructions = output.TASK_INSTRUCTIONS.taskInstructions;
  }
  if (output.PHASES) {
    const phases = output.PHASES.phases;
    if (
      phases.length !== current.phases.length ||
      phases.some(
        (phase, index) =>
          phase.evidence.length !== current.phases[index]!.evidence.length,
      )
    ) {
      throw new AdaptationMergeError("STRUCTURE_CHANGED");
    }
    next.phases = current.phases.map((phase, index) => {
      const adapted = phases[index]!;
      return {
        ...phase,
        name: adapted.name,
        action: adapted.action,
        context: adapted.context,
        support: adapted.support,
        evidence: phase.evidence.map((item, evidenceIndex) => ({
          type: item.type,
          description: adapted.evidence[evidenceIndex]!.description,
        })),
        evaluationFocus: adapted.evaluationFocus,
        suggestedLessons: adapted.suggestedLessons,
      };
    });
    if (
      request.totalLessons !== null &&
      next.phases.reduce((sum, phase) => sum + phase.suggestedLessons, 0) !==
        request.totalLessons
    ) {
      throw new AdaptationMergeError("LESSONS_MISMATCH");
    }
  }
  if (output.RUBRIC) {
    const dimensions = output.RUBRIC.rubricDimensions;
    if (dimensions.length !== current.rubricDimensions.length) {
      throw new AdaptationMergeError("STRUCTURE_CHANGED");
    }
    next.rubricDimensions = current.rubricDimensions.map((dimension, index) => ({
      ...dimensions[index]!,
      learningGoalIds: dimension.learningGoalIds,
    }));
  }

  const parsed = activityContentV3Schema.safeParse(next);
  if (!parsed.success) {
    throw new AdaptationMergeError("INVALID_TASK_BOOK");
  }
  const changed = changedTaskBookAreas(current, parsed.data);
  if (changed.length === 0) {
    throw new AdaptationMergeError("NO_CHANGE");
  }
  // Grade and stage are basic settings the teacher chose, so a grade change
  // may report BASIC_SETTINGS even when the model was not given that area.
  const allowed = new Set<TaskBookArea>(request.areas);
  if (request.targetGrade !== null && request.targetGrade !== current.grade) {
    allowed.add("BASIC_SETTINGS");
  }
  if (changed.some((area) => !allowed.has(area))) {
    throw new AdaptationMergeError("OUT_OF_SCOPE");
  }
  return parsed.data;
}

export type AdaptationChange = Readonly<{
  area: TaskBookArea;
  areaLabel: string;
  label: string;
  before: string;
  after: string;
}>;

/**
 * The teacher confirms a list of concrete replacements, not a whole second
 * task book to reread. Each entry is one field that differs, labelled the way
 * the draft form labels it.
 */
export function describeAdaptationChanges(
  before: ActivityContentV3,
  after: ActivityContentV3,
): AdaptationChange[] {
  const changes: AdaptationChange[] = [];
  const push = (
    area: TaskBookArea,
    label: string,
    beforeValue: string | number,
    afterValue: string | number,
  ) => {
    if (beforeValue !== afterValue) {
      changes.push({
        area,
        areaLabel: taskBookAreaLabels[area],
        label,
        before: String(beforeValue),
        after: String(afterValue),
      });
    }
  };

  push("BASIC_SETTINGS", "年级", `${before.grade} 年级`, `${after.grade} 年级`);
  push("BASIC_SETTINGS", "主题", before.topic, after.topic);
  push("BASIC_SETTINGS", "简介", before.summary, after.summary);
  push("BACKGROUND", "背景设定", before.backgroundSetting, after.backgroundSetting);
  before.learningGoals.forEach((goal, index) =>
    push(
      "OBJECTIVES",
      `学习目标 ${index + 1}`,
      goal.description,
      after.learningGoals[index]?.description ?? "",
    ),
  );
  before.disciplineContributions.forEach((item, index) => {
    const next = after.disciplineContributions[index];
    push("OBJECTIVES", `学科贡献 ${index + 1}`, item.contribution, next?.contribution ?? "");
    push("OBJECTIVES", `学科必要性 ${index + 1}`, item.necessity, next?.necessity ?? "");
  });
  push("TASK_INSTRUCTIONS", "总体任务", before.taskInstructions, after.taskInstructions);
  before.phases.forEach((phase, index) => {
    const next = after.phases[index];
    const prefix = `阶段 ${index + 1}`;
    push("PHASES", `${prefix} · 名称`, phase.name, next?.name ?? "");
    push("PHASES", `${prefix} · 核心动作`, phase.action, next?.action ?? "");
    push("PHASES", `${prefix} · 情境`, phase.context, next?.context ?? "");
    push("PHASES", `${prefix} · 支架`, phase.support, next?.support ?? "");
    phase.evidence.forEach((item, evidenceIndex) =>
      push(
        "PHASES",
        `${prefix} · 证据 ${evidenceIndex + 1}`,
        item.description,
        next?.evidence[evidenceIndex]?.description ?? "",
      ),
    );
    push("PHASES", `${prefix} · 评价要点`, phase.evaluationFocus, next?.evaluationFocus ?? "");
    push(
      "PHASES",
      `${prefix} · 建议课时`,
      `${phase.suggestedLessons} 课时`,
      `${next?.suggestedLessons ?? 0} 课时`,
    );
  });
  before.rubricDimensions.forEach((dimension, index) => {
    const next = after.rubricDimensions[index];
    const prefix = `评价维度 ${index + 1}`;
    push("RUBRIC", `${prefix} · 名称`, dimension.name, next?.name ?? "");
    push("RUBRIC", `${prefix} · 优秀`, dimension.excellent, next?.excellent ?? "");
    push("RUBRIC", `${prefix} · 良好`, dimension.good, next?.good ?? "");
    push("RUBRIC", `${prefix} · 达标`, dimension.pass, next?.pass ?? "");
    push("RUBRIC", `${prefix} · 待改进`, dimension.improve, next?.improve ?? "");
  });
  return changes;
}
