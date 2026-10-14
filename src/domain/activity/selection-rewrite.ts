import { z } from "zod";
import { activityContentV3WorkingSchema, type ActivityContentV3 } from "./activity-content";
import { parseTaskBookPath } from "./task-book-edits";

/**
 * D-098: the teacher selects words in a task-book field and asks for a
 * rewrite of just those words. The model returns only the replacement; the
 * text around the selection is spliced back unchanged, so nothing outside the
 * selection can move.
 */
/** What each quick action asks of the model; the buttons name them in the bar. */
export const selectionRewritePresets = {
  specific: {
    instruction:
      "把这段写具体：写清学生要做的动作、对象、地点或标准，让学生照着就能做；不添加新的任务环节。",
  },
  student: {
    instruction: "改成这个年级的学生一读就懂的说法：短句、常用词、少用术语，意思不变。",
  },
  shorter: {
    instruction: "删去重复和空泛的话，只留关键信息，明显缩短，意思不变。",
  },
  realistic: {
    instruction:
      "让这段更像真实发生的事：写出具体的人、地点或需求，与任务书已有的情境一致。",
  },
} as const;

export type SelectionRewritePreset = keyof typeof selectionRewritePresets;
export const selectionRewriteActions = [
  ...(Object.keys(selectionRewritePresets) as SelectionRewritePreset[]),
  "custom",
] as const;

/** Fields a selection may be rewritten in, with the form's length limit. */
const rewritableFields: ReadonlyArray<readonly [RegExp, number]> = [
  [/^summary$/u, 600],
  [/^backgroundSetting$/u, 1_200],
  [/^taskInstructions$/u, 5_000],
  [/^learningGoals\[\d{1,2}\]\.description$/u, 500],
  [/^disciplineContributions\[\d{1,2}\]\.(?:contribution|necessity)$/u, 500],
  [/^phases\[\d\]\.(?:action|evaluationFocus)$/u, 300],
  [/^phases\[\d\]\.(?:context|support)$/u, 500],
  [/^phases\[\d\]\.evidence\[\d\]\.description$/u, 300],
  [/^rubricDimensions\[\d\]\.(?:excellent|good|pass|improve)$/u, 300],
];

export function rewritableFieldLimit(path: string): number | null {
  return rewritableFields.find(([pattern]) => pattern.test(path))?.[1] ?? null;
}

/** The string at a task-book path, or undefined when the path leads elsewhere. */
export function taskBookTextAt(values: unknown, path: string): string | undefined {
  let node: unknown = values;
  for (const segment of parseTaskBookPath(path)) {
    if (typeof segment === "number") {
      if (!Array.isArray(node)) return undefined;
      node = node[segment];
    } else {
      if (typeof node !== "object" || node === null || !Object.hasOwn(node, segment)) {
        return undefined;
      }
      node = (node as Record<string, unknown>)[segment];
    }
  }
  return typeof node === "string" ? node : undefined;
}

/** A copy of the task book with one text field replaced. */
export function withTaskBookText<T extends ActivityContentV3>(values: T, path: string, text: string): T {
  const segments = parseTaskBookPath(path);
  const copy = structuredClone(values);
  let node: unknown = copy;
  for (const segment of segments.slice(0, -1)) {
    node = (node as Record<string | number, unknown>)[segment];
  }
  const last = segments.at(-1)!;
  if (typeof node !== "object" || node === null || typeof (node as Record<string | number, unknown>)[last] !== "string") {
    throw new Error("SELECTION_REWRITE_PATH_NOT_TEXT");
  }
  (node as Record<string | number, unknown>)[last] = text;
  return copy;
}

export function spliceSelection(text: string, start: number, end: number, replacement: string): string {
  return `${text.slice(0, start)}${replacement}${text.slice(end)}`;
}

export const selectionRewriteRequestSchema = z
  .object({
    fieldPath: z.string().max(80),
    fieldText: z.string().max(5_000),
    selectionStart: z.int().min(0),
    selectionEnd: z.int().min(1),
    action: z.enum(selectionRewriteActions),
    instruction: z.string().trim().max(200),
    taskBook: activityContentV3WorkingSchema,
  })
  .strict()
  .superRefine((request, context) => {
    const limit = rewritableFieldLimit(request.fieldPath);
    if (limit === null) {
      context.addIssue({ code: "custom", path: ["fieldPath"], message: "Field cannot be rewritten" });
      return;
    }
    if (
      request.selectionStart >= request.selectionEnd ||
      request.selectionEnd > request.fieldText.length ||
      !request.fieldText.slice(request.selectionStart, request.selectionEnd).trim()
    ) {
      context.addIssue({ code: "custom", path: ["selectionEnd"], message: "Selection must cover visible text" });
    }
    // The text the teacher selected in must be the text the task book holds,
    // or the splice would land on words the model never saw.
    if (taskBookTextAt(request.taskBook, request.fieldPath) !== request.fieldText) {
      context.addIssue({ code: "custom", path: ["fieldText"], message: "Field text does not match the task book" });
    }
    if (request.action === "custom" && !request.instruction) {
      context.addIssue({ code: "custom", path: ["instruction"], message: "A custom rewrite needs an instruction" });
    }
  });

export type SelectionRewriteRequest = z.infer<typeof selectionRewriteRequestSchema>;

export const selectionRewriteModelOutputSchema = z
  .object({
    replacement: z.string().trim().min(1).max(5_000),
    note: z.string().trim().max(120),
  })
  .strict();

/** The longest replacement that keeps the field within its form limit. */
export function replacementBudget(request: SelectionRewriteRequest): number {
  const limit = rewritableFieldLimit(request.fieldPath) ?? 0;
  return limit - (request.fieldText.length - (request.selectionEnd - request.selectionStart));
}
