import { z } from "zod";
import {
  activityContentV2Schema,
  activityContentV3Schema,
  assignmentSubtypes,
  assignmentTypes,
  disciplineCatalog,
  evidenceTypes,
  inquiryDepths,
  submissionModes,
  type ActivityContentStructured,
} from "./activity-content";
import { basicsFields, phaseFields, rubricFields } from "./task-book-gaps";

/**
 * D-097: an assistant revision is a list of exact edits applied to the stored
 * task book, not a whole task book retyped by the model. What no edit names
 * cannot change, and every change can be shown as before and after.
 *
 * Paths are JSON-style and zero-based: `phases[1].name` is the second phase's
 * name, `rubricDimensions[2].pass` the third dimension's 达标 descriptor.
 */
const pathPattern = /^[A-Za-z][A-Za-z0-9]*(?:\[\d{1,2}\]|\.[A-Za-z][A-Za-z0-9]*)*$/u;

export const taskBookEditPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(pathPattern);

export const taskBookEditSchema = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("set"),
      path: taskBookEditPathSchema,
      value: z.union([z.string().max(5_000), z.int(), z.null()]),
    })
    .strict(),
  z
    .object({
      op: z.literal("replaceText"),
      path: taskBookEditPathSchema.nullable(),
      find: z.string().min(1).max(500),
      replaceWith: z.string().max(1_000),
    })
    .strict(),
  z
    .object({
      op: z.literal("setList"),
      path: taskBookEditPathSchema,
      values: z.array(z.string().trim().min(1).max(80)).max(15),
    })
    .strict(),
  z
    .object({
      op: z.literal("insert"),
      path: taskBookEditPathSchema,
      index: z.int().min(0).max(20).nullable(),
      item: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      op: z.literal("remove"),
      path: taskBookEditPathSchema,
    })
    .strict(),
]);

export type TaskBookEdit = z.infer<typeof taskBookEditSchema>;

export type TaskBookEditErrorCode =
  | "PATH_NOT_FOUND"
  | "PATH_LOCKED"
  | "NOT_A_VALUE"
  | "NOT_A_LIST"
  | "TEXT_NOT_FOUND"
  | "NO_CHANGE"
  | "INVALID_RESULT";

export type TaskBookEditError = Readonly<{
  /** 1-based position of the edit in the list; null for the result as a whole. */
  edit: number | null;
  code: TaskBookEditErrorCode;
  message: string;
}>;

export type TaskBookChange = Readonly<{
  path: string;
  label: string;
  kind: "changed" | "added" | "removed";
  before: string | null;
  after: string | null;
}>;

export type TaskBookEditResult<T extends ActivityContentStructured = ActivityContentStructured> =
  | Readonly<{ ok: true; content: T; changes: TaskBookChange[] }>
  | Readonly<{ ok: false; errors: TaskBookEditError[] }>;

type Segment = string | number;
type Json = unknown;

/** Task books are plain JSON with stable key order, so text equality is equality. Also runs in the browser. */
function sameJson(a: Json, b: Json): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function parseTaskBookPath(path: string): Segment[] {
  return [...path.matchAll(/([A-Za-z][A-Za-z0-9]*)|\[(\d+)\]/gu)].map((match) =>
    match[1] ?? Number(match[2]),
  );
}

function formatPath(segments: readonly Segment[]): string {
  return segments
    .map((segment, index) =>
      typeof segment === "number" ? `[${segment}]` : index === 0 ? segment : `.${segment}`,
    )
    .join("");
}

/** Fields whose values are codes or identifiers, never prose a teacher reads. */
const codeFields = new Set([
  "schemaVersion",
  "id",
  "competencyCode",
  "disciplineCode",
  "mainDisciplineCode",
  "integratedDisciplineCodes",
  "learningGoalIds",
  "type",
  "schoolStage",
  "assignmentType",
  "assignmentSubtype",
  "inquiryDepth",
  "submissionMode",
]);

function lockedReason(content: ActivityContentStructured, head: Segment | undefined): string | null {
  if (head === "schemaVersion") return "任务书版本不能改";
  if (head === "integratedDisciplineCodes" && content.schemaVersion === 3) {
    return "融合学科由学科贡献 disciplineContributions 推算，改学科请改那里";
  }
  return null;
}

function isObject(value: Json): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The container holding the last segment, or null when any step is missing. */
function locate(root: Json, segments: readonly Segment[]): { parent: Json; key: Segment } | null {
  if (segments.length === 0) return null;
  let node: Json = root;
  for (const segment of segments.slice(0, -1)) {
    if (typeof segment === "number") {
      if (!Array.isArray(node) || segment >= node.length) return null;
      node = node[segment];
    } else {
      if (!isObject(node) || !Object.hasOwn(node, segment)) return null;
      node = node[segment];
    }
  }
  const key = segments.at(-1)!;
  if (typeof key === "number") {
    return Array.isArray(node) && key < node.length ? { parent: node, key } : null;
  }
  return isObject(node) && Object.hasOwn(node, key) ? { parent: node, key } : null;
}

function read(parent: Json, key: Segment): Json {
  return (parent as Record<string | number, Json>)[key];
}

function write(parent: Json, key: Segment, value: Json): void {
  (parent as Record<string | number, Json>)[key] = value;
}

const stageLabels: Record<string, string> = { PRIMARY: "小学", MIDDLE: "初中" };
const subtypeLabels = new Map<string, string>(
  Object.values(assignmentSubtypes).flatMap((list) =>
    list.map((item) => [item.code, item.label] as const),
  ),
);
const optionLabels: Record<string, (value: Json) => string | undefined> = {
  submissionMode: (value) => submissionModes.find((item) => item.code === value)?.label,
  assignmentType: (value) => assignmentTypes.find((item) => item.code === value)?.label,
  assignmentSubtype: (value) => (typeof value === "string" ? subtypeLabels.get(value) : undefined),
  inquiryDepth: (value) => inquiryDepths.find((item) => item.code === value)?.label,
  schoolStage: (value) => (typeof value === "string" ? stageLabels[value] : undefined),
  mainDisciplineCode: (value) => disciplineCatalog.find((item) => item.code === value)?.label,
  disciplineCode: (value) => disciplineCatalog.find((item) => item.code === value)?.label,
  type: (value) => evidenceTypes.find((item) => item.code === value)?.label,
  grade: (value) => (typeof value === "number" ? `${value} 年级` : undefined),
  durationWeeks: (value) => (typeof value === "number" ? `${value} 周` : undefined),
  suggestedLessons: (value) => (typeof value === "number" ? `${value} 课时` : undefined),
};

function goalLabel(content: Json, id: Json): string {
  const goals = isObject(content) && Array.isArray(content.learningGoals) ? content.learningGoals : [];
  const index = goals.findIndex((goal) => isObject(goal) && goal.id === id);
  return index >= 0 ? `目标 ${index + 1}` : String(id);
}

function itemSummary(item: Json): string {
  if (!isObject(item)) return String(item);
  if (typeof item.description === "string" && typeof item.type === "string") {
    return `${optionLabels.type!(item.type) ?? item.type}：${item.description}`;
  }
  if (typeof item.disciplineCode === "string" && typeof item.contribution === "string") {
    return `${optionLabels.disciplineCode!(item.disciplineCode) ?? item.disciplineCode}：${item.contribution}`;
  }
  for (const key of ["name", "description"]) {
    if (typeof item[key] === "string") return item[key] as string;
  }
  return JSON.stringify(item);
}

/** How a value reads to a teacher: option labels, goal numbers, item names. */
function displayValue(content: Json, field: Segment | undefined, value: Json): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value
      .map((entry) => (field === "learningGoalIds" ? goalLabel(content, entry) : displayValue(content, undefined, entry)))
      .join("、");
  }
  if (isObject(value)) return itemSummary(value);
  const label = typeof field === "string" ? optionLabels[field]?.(value) : undefined;
  return label ?? String(value);
}

function named(prefix: string, index: number, name: Json): string {
  return typeof name === "string" && name.trim()
    ? `${prefix} ${index + 1}「${name.trim()}」`
    : `${prefix} ${index + 1}`;
}

/** The place a path points to, in the words of the task-book form. */
export function taskBookPathLabel(content: Json, segments: readonly Segment[]): string {
  const [head, index, field, nested, nestedField] = segments;
  const root = isObject(content) ? content : {};
  const list = (key: string) => (Array.isArray(root[key]) ? (root[key] as Json[]) : []);
  if (typeof head !== "string") return formatPath(segments);
  if (head in basicsFields) return basicsFields[head]!;
  if (head === "backgroundSetting") return "背景设定";
  if (head === "taskInstructions") return "总体任务说明";
  if (head === "disciplineContributions") {
    if (typeof index !== "number") return "学科贡献";
    const item = list(head)[index];
    const code = isObject(item) ? item.disciplineCode : undefined;
    const subject = (typeof code === "string" && optionLabels.disciplineCode!(code)) || `学科 ${index + 1}`;
    if (field === "contribution") return `${subject} · 学科贡献`;
    if (field === "necessity") return `${subject} · 不可替代性`;
    return `学科贡献 · ${subject}`;
  }
  if (head === "learningGoals") {
    if (typeof index !== "number") return "学习目标";
    if (field === "description") return `目标 ${index + 1} · 可观察目标`;
    if (field === "competencyReferences") return `目标 ${index + 1} · 课程依据`;
    return `目标 ${index + 1}`;
  }
  if (head === "phases") {
    if (typeof index !== "number") return "阶段";
    const phaseItem = list(head)[index];
    const phase = named("阶段", index, isObject(phaseItem) ? phaseItem.name : undefined);
    if (field === "evidence") {
      if (typeof nested !== "number") return `${phase} · 需提交的学习证据`;
      if (nestedField === "description") return `${phase} · 证据 ${nested + 1} 的任务要求`;
      if (nestedField === "type") return `${phase} · 证据 ${nested + 1} 的类型`;
      return `${phase} · 证据 ${nested + 1}`;
    }
    if (typeof field === "string" && field in phaseFields) return `${phase} · ${phaseFields[field]}`;
    return phase;
  }
  if (head === "rubricDimensions") {
    if (typeof index !== "number") return "评价维度";
    const dimensionItem = list(head)[index];
    const dimension = named("评价维度", index, isObject(dimensionItem) ? dimensionItem.name : undefined);
    if (typeof field === "string" && field in rubricFields) return `${dimension} · ${rubricFields[field]}`;
    return dimension;
  }
  return formatPath(segments);
}

function replaceInText(
  node: Json,
  field: Segment | undefined,
  path: Segment[],
  find: string,
  replaceWith: string,
  visit: (path: Segment[], before: string, after: string) => void,
): Json {
  if (typeof node === "string") {
    if (typeof field === "string" && codeFields.has(field)) return node;
    if (!node.includes(find)) return node;
    const after = node.split(find).join(replaceWith);
    visit(path, node, after);
    return after;
  }
  if (Array.isArray(node)) {
    if (typeof field === "string" && codeFields.has(field)) return node;
    return node.map((entry, index) =>
      replaceInText(entry, field, [...path, index], find, replaceWith, visit),
    );
  }
  if (isObject(node)) {
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [
        key,
        replaceInText(value, key, [...path, key], find, replaceWith, visit),
      ]),
    );
  }
  return node;
}

function issueLabel(content: Json, path: readonly PropertyKey[]): string {
  const segments = path.filter(
    (segment): segment is Segment => typeof segment === "string" || typeof segment === "number",
  );
  return segments.length > 0 ? taskBookPathLabel(content, segments) : "任务书";
}

/**
 * Applies the edits in order to a copy of `current` and checks the result
 * against the same schema a saved draft must pass. Either every edit applies
 * and the result is a valid task book, or nothing is returned but the reasons.
 */
export function applyTaskBookEdits<T extends ActivityContentStructured>(
  current: T,
  edits: readonly TaskBookEdit[],
): TaskBookEditResult<T> {
  const draft = structuredClone(current) as Record<string, Json>;
  const changes: TaskBookChange[] = [];
  const errors: TaskBookEditError[] = [];
  const fail = (edit: number, code: TaskBookEditErrorCode, message: string) => {
    errors.push({ edit, code, message });
  };

  edits.forEach((edit, position) => {
    const number = position + 1;
    const segments = edit.path === null ? [] : parseTaskBookPath(edit.path);
    const locked = lockedReason(current, segments[0]);
    if (locked) {
      fail(number, "PATH_LOCKED", `${edit.path}：${locked}`);
      return;
    }

    if (edit.op === "replaceText") {
      const scope = segments.length === 0 ? { parent: { root: draft }, key: "root" as Segment } : locate(draft, segments);
      if (!scope) {
        fail(number, "PATH_NOT_FOUND", `${edit.path} 在这份草稿里不存在`);
        return;
      }
      let replaced = 0;
      const field = segments.at(-1);
      const next = replaceInText(read(scope.parent, scope.key), typeof field === "number" ? segments.at(-2) : field, [...segments], edit.find, edit.replaceWith, (path, before, after) => {
        replaced += 1;
        changes.push({ path: formatPath(path), label: taskBookPathLabel(draft, path), kind: "changed", before, after });
      });
      if (replaced === 0) {
        fail(number, "TEXT_NOT_FOUND", `原文里没有「${edit.find}」${edit.path ? `（在 ${edit.path} 中）` : ""}，find 必须逐字照抄原文`);
        return;
      }
      if (segments.length === 0) {
        Object.assign(draft, next as Record<string, Json>);
      } else {
        write(scope.parent, scope.key, next);
      }
      return;
    }

    if (edit.op === "insert") {
      const target = locate(draft, segments);
      const list = target ? read(target.parent, target.key) : undefined;
      if (!target || !Array.isArray(list)) {
        fail(number, target ? "NOT_A_LIST" : "PATH_NOT_FOUND", `${edit.path} 不是这份草稿里的一个列表`);
        return;
      }
      const at = edit.index === null ? list.length : Math.min(edit.index, list.length);
      list.splice(at, 0, structuredClone(edit.item));
      const path = [...segments, at];
      changes.push({ path: formatPath(path), label: taskBookPathLabel(draft, path), kind: "added", before: null, after: itemSummary(edit.item) });
      return;
    }

    const target = locate(draft, segments);
    if (!target) {
      fail(number, "PATH_NOT_FOUND", `${edit.path} 在这份草稿里不存在`);
      return;
    }
    const field = typeof target.key === "number" ? segments.at(-2) : target.key;
    const before = read(target.parent, target.key);

    if (edit.op === "remove") {
      if (!Array.isArray(target.parent) || typeof target.key !== "number") {
        fail(number, "NOT_A_LIST", `${edit.path} 不是列表里的一项，remove 只能删列表项`);
        return;
      }
      const label = taskBookPathLabel(draft, segments);
      target.parent.splice(target.key, 1);
      changes.push({ path: formatPath(segments), label, kind: "removed", before: itemSummary(before), after: null });
      return;
    }

    if (edit.op === "setList") {
      if (!Array.isArray(before) || before.some((entry) => typeof entry !== "string")) {
        fail(number, "NOT_A_LIST", `${edit.path} 不是一个编号列表，setList 只用于编号列表`);
        return;
      }
      write(target.parent, target.key, [...edit.values]);
      changes.push({
        path: formatPath(segments),
        label: taskBookPathLabel(draft, segments),
        kind: "changed",
        before: displayValue(draft, field, before),
        after: displayValue(draft, field, edit.values),
      });
      return;
    }

    if (typeof before === "object" && before !== null) {
      fail(number, "NOT_A_VALUE", `${edit.path} 是一组内容，set 只能改单个文字或选项；改列表用 insert、remove 或 setList`);
      return;
    }
    write(target.parent, target.key, edit.value);
    changes.push({
      path: formatPath(segments),
      label: taskBookPathLabel(draft, segments),
      kind: "changed",
      before: displayValue(draft, field, before),
      after: displayValue(draft, field, edit.value),
    });
  });

  if (errors.length > 0) return { ok: false, errors };

  if (draft.schemaVersion === 3 && Array.isArray(draft.disciplineContributions)) {
    const main = draft.mainDisciplineCode;
    const derived = draft.disciplineContributions
      .map((item) => (isObject(item) ? item.disciplineCode : undefined))
      .filter((code): code is string => typeof code === "string" && code !== main);
    if (!sameJson(derived, draft.integratedDisciplineCodes)) {
      changes.push({
        path: "integratedDisciplineCodes",
        label: basicsFields.integratedDisciplineCodes!,
        kind: "changed",
        before: displayValue(draft, "disciplineCode", draft.integratedDisciplineCodes),
        after: displayValue(draft, "disciplineCode", derived),
      });
      draft.integratedDisciplineCodes = derived;
    }
  }

  if (sameJson(draft, current)) {
    return { ok: false, errors: [{ edit: null, code: "NO_CHANGE", message: "这些修改套用后与原文完全相同" }] };
  }

  // The schema of the draft's own version, so an issue names its field rather
  // than collapsing into the union's "no variant matched".
  const parsed = (current.schemaVersion === 3 ? activityContentV3Schema : activityContentV2Schema).safeParse(draft);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, 6).map((issue) => ({
        edit: null,
        code: "INVALID_RESULT" as const,
        message: `改完后「${issueLabel(draft, issue.path)}」不符合要求：${issue.message}`,
      })),
    };
  }
  return { ok: true, content: parsed.data as T, changes };
}

/** One line per error, for the model to correct its edits. */
export function describeTaskBookEditErrors(errors: readonly TaskBookEditError[]): string {
  return errors
    .map((error) => (error.edit === null ? error.message : `第 ${error.edit} 条修改：${error.message}`))
    .join("\n");
}

/**
 * The part of a text that changed, with a little context, so a confirmation
 * card can show 「…原来[旧]→[新]后面…」 instead of two whole paragraphs.
 */
export function textChangeParts(
  before: string,
  after: string,
  context = 16,
): Readonly<{ prefix: string; removed: string; added: string; suffix: string; truncatedStart: boolean; truncatedEnd: boolean }> {
  const beforeChars = Array.from(before);
  const afterChars = Array.from(after);
  let start = 0;
  while (start < beforeChars.length && start < afterChars.length && beforeChars[start] === afterChars[start]) start += 1;
  let end = 0;
  while (
    end < beforeChars.length - start &&
    end < afterChars.length - start &&
    beforeChars[beforeChars.length - 1 - end] === afterChars[afterChars.length - 1 - end]
  ) end += 1;
  const prefixStart = Math.max(0, start - context);
  const suffixEnd = Math.min(beforeChars.length, beforeChars.length - end + context);
  return {
    prefix: beforeChars.slice(prefixStart, start).join(""),
    removed: beforeChars.slice(start, beforeChars.length - end).join(""),
    added: afterChars.slice(start, afterChars.length - end).join(""),
    suffix: beforeChars.slice(beforeChars.length - end, suffixEnd).join(""),
    truncatedStart: prefixStart > 0,
    truncatedEnd: suffixEnd < beforeChars.length,
  };
}
