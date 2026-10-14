import { describe, expect, it } from "vitest";
import { waterConservationTaskBookV3 } from "../../fixtures/water-conservation-v3";
import {
  applyTaskBookEdits,
  describeTaskBookEditErrors,
  parseTaskBookPath,
  taskBookEditSchema,
  textChangeParts,
  type TaskBookEdit,
} from "./task-book-edits";

const book = { ...waterConservationTaskBookV3, submissionMode: "phased" as const };

function apply(...edits: TaskBookEdit[]) {
  return applyTaskBookEdits(book, edits);
}

function changedOnly(result: ReturnType<typeof apply>) {
  if (!result.ok) throw new Error(describeTaskBookEditErrors(result.errors));
  return result;
}

describe("applyTaskBookEdits (D-097)", () => {
  it("changes one field and nothing else", () => {
    const result = changedOnly(apply({ op: "set", path: "phases[1].name", value: "读水表，算浪费" }));

    expect(result.content).toEqual({
      ...book,
      phases: book.phases.map((phase, index) =>
        index === 1 ? { ...phase, name: "读水表，算浪费" } : phase,
      ),
    });
    expect(result.changes).toEqual([
      {
        path: "phases[1].name",
        label: "阶段 2「读水表，算浪费」 · 阶段名称",
        kind: "changed",
        before: book.phases[1]!.name,
        after: "读水表，算浪费",
      },
    ]);
  });

  it("shows options in the form's words", () => {
    const result = changedOnly(
      apply(
        { op: "set", path: "submissionMode", value: "once" },
        { op: "set", path: "durationWeeks", value: 4 },
      ),
    );

    expect(result.changes.map((change) => [change.label, change.before, change.after])).toEqual([
      ["提交模式", "过程性提交", "一次性提交"],
      ["周期（周）", `${book.durationWeeks} 周`, "4 周"],
    ]);
  });

  it("replaces a phrase inside a paragraph without retyping it", () => {
    const original = book.taskInstructions;
    const word = Array.from(original).slice(2, 5).join("");
    const result = changedOnly(apply({ op: "replaceText", path: "taskInstructions", find: word, replaceWith: "【新词】" }));

    expect(result.content.taskInstructions).toBe(original.split(word).join("【新词】"));
    expect(result.changes).toHaveLength(1);
    expect(textChangeParts(result.changes[0]!.before!, result.changes[0]!.after!)).toMatchObject({
      removed: word,
      added: "【新词】",
    });
  });

  it("replaces a word across the whole task book but never inside codes", () => {
    const result = changedOnly(apply({ op: "replaceText", path: null, find: "水", replaceWith: "水资源" }));
    const text = JSON.stringify(result.content);

    expect(result.changes.length).toBeGreaterThan(1);
    expect(result.content.learningGoals.map((goal) => goal.id)).toEqual(book.learningGoals.map((goal) => goal.id));
    expect(result.content.phases.map((phase) => phase.learningGoalIds)).toEqual(book.phases.map((phase) => phase.learningGoalIds));
    expect(text).toContain("水资源");
  });

  it("adds and removes list items", () => {
    const added = changedOnly(
      apply({ op: "insert", path: "phases[2].evidence", index: null, item: { type: "image", description: "改造前后的对比示意图" } }),
    );
    expect(added.content.phases[2]!.evidence.at(-1)).toEqual({ type: "image", description: "改造前后的对比示意图" });
    expect(added.changes).toEqual([
      expect.objectContaining({ kind: "added", after: "图片：改造前后的对比示意图" }),
    ]);

    const removed = applyTaskBookEdits(added.content, [{ op: "remove", path: `phases[2].evidence[${book.phases[2]!.evidence.length}]` }]);
    expect(removed.ok && removed.content).toEqual(book);
  });

  it("names learning goals by number when their links change", () => {
    const result = changedOnly(apply({ op: "setList", path: "rubricDimensions[0].learningGoalIds", values: [book.learningGoals[1]!.id] }));

    expect(result.changes[0]).toMatchObject({ after: "目标 2" });
  });

  it("derives the integrated disciplines from the contributions", () => {
    const result = changedOnly(
      apply({
        op: "insert",
        path: "disciplineContributions",
        index: null,
        item: { disciplineCode: "geography", contribution: "用地图标出校园用水点的分布。", necessity: "没有空间分布，就说不清浪费集中在哪里。" },
      }),
    );

    expect(result.content.integratedDisciplineCodes).toEqual([...book.integratedDisciplineCodes, "geography"]);
    expect(result.changes.map((change) => change.label)).toEqual(["学科贡献 · 地理", "融合学科"]);
  });

  it("refuses edits that do not fit the stored task book, saying why", () => {
    const result = apply(
      { op: "set", path: "phases[7].name", value: "不存在" },
      { op: "replaceText", path: "summary", find: "原文里没有的字", replaceWith: "x" },
      { op: "set", path: "phases[0]", value: "整段替换" },
      { op: "set", path: "schemaVersion", value: 2 },
      { op: "setList", path: "integratedDisciplineCodes", values: ["math"] },
      { op: "set", path: "title.constructor", value: "x" },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => [error.edit, error.code])).toEqual([
      [1, "PATH_NOT_FOUND"],
      [2, "TEXT_NOT_FOUND"],
      [3, "NOT_A_VALUE"],
      [4, "PATH_LOCKED"],
      [5, "PATH_LOCKED"],
      [6, "PATH_NOT_FOUND"],
    ]);
    expect(describeTaskBookEditErrors(result.errors)).toContain("第 2 条修改：原文里没有「原文里没有的字」");
  });

  it("refuses a result the saved-draft schema would reject", () => {
    const result = apply({ op: "set", path: "submissionMode", value: "weekly" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ code: "INVALID_RESULT" });
    expect(result.errors[0]!.message).toContain("提交模式");
  });

  it("refuses edits that leave the task book as it was", () => {
    const result = apply({ op: "set", path: "title", value: book.title });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]!.code).toBe("NO_CHANGE");
  });

  it("parses zero-based paths and rejects anything else", () => {
    expect(parseTaskBookPath("phases[1].evidence[0].description")).toEqual(["phases", 1, "evidence", 0, "description"]);
    for (const path of ["phases.1.name", "__proto__.x", "phases[a]", "a..b", "title; drop"]) {
      expect(taskBookEditSchema.safeParse({ op: "set", path, value: "x" }).success).toBe(false);
    }
  });
});

describe("textChangeParts", () => {
  it("keeps a little context around the changed span", () => {
    expect(textChangeParts("一二三四五六七八九十", "一二三四X六七八九十", 2)).toEqual({
      prefix: "三四",
      removed: "五",
      added: "X",
      suffix: "六七",
      truncatedStart: true,
      truncatedEnd: true,
    });
  });
});
