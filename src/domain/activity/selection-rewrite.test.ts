import { describe, expect, it } from "vitest";
import { waterConservationTaskBookV3 } from "../../fixtures/water-conservation-v3";
import {
  replacementBudget,
  rewritableFieldLimit,
  selectionRewriteRequestSchema,
  spliceSelection,
  taskBookTextAt,
  withTaskBookText,
} from "./selection-rewrite";

const book = waterConservationTaskBookV3;
const context = book.phases[1]!.context;

function request(overrides: Record<string, unknown> = {}) {
  return {
    fieldPath: "phases[1].context",
    fieldText: context,
    selectionStart: 2,
    selectionEnd: 8,
    action: "specific",
    instruction: "",
    taskBook: book,
    ...overrides,
  };
}

describe("selection rewrite (D-098)", () => {
  it("knows which fields can be rewritten and their form limits", () => {
    expect(rewritableFieldLimit("phases[1].context")).toBe(500);
    expect(rewritableFieldLimit("rubricDimensions[2].pass")).toBe(300);
    expect(rewritableFieldLimit("taskInstructions")).toBe(5_000);
    for (const path of ["title", "phases[1].name", "submissionMode", "learningGoals[0].id", "phases[1].context.x"]) {
      expect(rewritableFieldLimit(path)).toBeNull();
    }
  });

  it("reads and replaces one text field without touching the rest", () => {
    expect(taskBookTextAt(book, "phases[1].context")).toBe(context);
    expect(taskBookTextAt(book, "phases[9].context")).toBeUndefined();
    expect(taskBookTextAt(book, "phases[1].constructor")).toBeUndefined();

    const next = withTaskBookText(book, "phases[1].context", "新的情境。");
    expect(next.phases[1]!.context).toBe("新的情境。");
    expect({ ...next, phases: book.phases }).toEqual(book);
    expect(book.phases[1]!.context).toBe(context);
  });

  it("splices the replacement into the selection only", () => {
    expect(spliceSelection("甲乙丙丁戊", 1, 3, "XY")).toBe("甲XY丁戊");
  });

  it("accepts a selection that matches the task book", () => {
    const parsed = selectionRewriteRequestSchema.parse(request());
    expect(replacementBudget(parsed)).toBe(500 - (context.length - 6));
  });

  it("refuses selections the splice could not trust", () => {
    for (const overrides of [
      { fieldPath: "title" },
      { selectionStart: 5, selectionEnd: 5 },
      { selectionEnd: context.length + 1 },
      { fieldText: `${context}（教师又补了一句）` },
      { action: "custom", instruction: "  " },
      { fieldText: "   ", selectionStart: 0, selectionEnd: 3, taskBook: withTaskBookText(book, "phases[1].context", "   ") },
    ]) {
      expect(selectionRewriteRequestSchema.safeParse(request(overrides)).success).toBe(false);
    }
  });
});
