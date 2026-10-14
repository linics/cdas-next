import { beforeEach, describe, expect, it, vi } from "vitest";
import { waterConservationTaskBookV3 } from "../../fixtures/water-conservation-v3";
import type { PrismaClient } from "../../generated/prisma/client";
import {
  buildSelectionRewritePrompt,
  SelectionRewriteSuggestionError,
  suggestSelectionRewrite,
  type SelectionRewriteDependencies,
} from "./selection-rewrite-suggestion";

vi.mock("server-only", () => ({}));

const book = waterConservationTaskBookV3;
const field = book.phases[1]!.context;
const runId = "50000000-0000-4000-8000-000000000005";
const context = {
  actorId: "10000000-0000-4000-8000-000000000001",
  source: "UI" as const,
  traceId: "selection-rewrite-test",
  clock: () => new Date("2026-10-14T02:00:00.000Z"),
};
const database = {} as PrismaClient;

const mocks = {
  startRun: vi.fn(),
  finishRun: vi.fn(),
  generate: vi.fn(),
};

function dependencies(overrides: Partial<SelectionRewriteDependencies> = {}): SelectionRewriteDependencies {
  return {
    getConfig: () => ({ model: "deepseek-v4-flash" }) as never,
    createModel: () => ({}) as never,
    startRun: mocks.startRun,
    finishRun: mocks.finishRun,
    generate: mocks.generate,
    ...overrides,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    fieldPath: "phases[1].context",
    fieldText: field,
    selectionStart: 0,
    selectionEnd: 6,
    action: "student",
    instruction: "",
    taskBook: book,
    ...overrides,
  };
}

describe("suggestSelectionRewrite (D-098)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startRun.mockResolvedValue({ id: runId });
    mocks.finishRun.mockResolvedValue(undefined);
  });

  it("returns the replacement spliced into the field and closes the run", async () => {
    mocks.generate.mockResolvedValue({ replacement: "上一回", note: "换成了更口语的说法。" });

    const result = await suggestSelectionRewrite(database, context, request(), dependencies());

    expect(result).toEqual({
      agentRunId: runId,
      replacement: "上一回",
      note: "换成了更口语的说法。",
      fieldText: `上一回${field.slice(6)}`,
    });
    expect(mocks.generate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        selection: field.slice(0, 6),
        before: "",
        after: field.slice(6),
        field: `阶段 2「${book.phases[1]!.name}」 · 情境承接`,
        maxLength: 500 - (field.length - 6),
      }),
    );
    expect(mocks.finishRun).toHaveBeenCalledWith(database, expect.objectContaining({ source: "AGENT" }), {
      agentRunId: runId,
      status: "SUCCEEDED",
      failureCode: null,
    });
  });

  it("uses the teacher's own words for a custom rewrite", async () => {
    mocks.generate.mockResolvedValue({ replacement: "改好的", note: "" });

    await suggestSelectionRewrite(
      database,
      context,
      request({ action: "custom", instruction: "加一个测量步骤" }),
      dependencies(),
    );

    expect(mocks.generate.mock.calls[0]![1]).toMatchObject({ instruction: "加一个测量步骤" });
  });

  it.each([
    ["an answer that is not the shape asked for", { text: "x" }],
    ["a replacement that would overflow the field", { replacement: "长".repeat(600), note: "" }],
    ["the selection handed back unchanged", { replacement: field.slice(0, 6), note: "" }],
  ])("fails closed on %s", async (_label, output) => {
    mocks.generate.mockResolvedValue(output);

    await expect(suggestSelectionRewrite(database, context, request(), dependencies())).rejects.toEqual(
      new SelectionRewriteSuggestionError("INVALID_OUTPUT"),
    );
    expect(mocks.finishRun).toHaveBeenCalledWith(database, expect.anything(), {
      agentRunId: runId,
      status: "FAILED",
      failureCode: "SELECTION_REWRITE_INVALID_OUTPUT",
    });
  });

  it("reports a provider failure without leaving the run open", async () => {
    mocks.generate.mockRejectedValue(new Error("network"));

    await expect(suggestSelectionRewrite(database, context, request(), dependencies())).rejects.toEqual(
      new SelectionRewriteSuggestionError("PROVIDER_FAILED"),
    );
    expect(mocks.finishRun).toHaveBeenCalledWith(database, expect.anything(), expect.objectContaining({ status: "FAILED" }));
  });

  it("starts nothing when the request or the AI configuration is unusable", async () => {
    await expect(
      suggestSelectionRewrite(database, context, request({ fieldPath: "title" }), dependencies()),
    ).rejects.toEqual(new SelectionRewriteSuggestionError("INVALID_REQUEST"));
    await expect(
      suggestSelectionRewrite(
        database,
        context,
        request(),
        dependencies({ getConfig: () => { throw new Error("missing key"); } }),
      ),
    ).rejects.toEqual(new SelectionRewriteSuggestionError("AI_UNAVAILABLE"));
    expect(mocks.startRun).not.toHaveBeenCalled();
  });

  it("frames the field text as material, keeps the surroundings and asks for named keys", () => {
    const prompt = buildSelectionRewritePrompt({
      activity: { title: book.title, grade: 7, mainDiscipline: "物理", integratedDisciplines: ["数学"] },
      field: "背景设定",
      before: "前文",
      selection: "选中",
      after: "后文",
      instruction: "写具体",
      suggestedLength: 60,
      maxLength: 120,
      rubricLevel: { level: "达标", levels: { 优秀: "a", 良好: "b", 达标: "c", 需改进: "d" } },
    });

    expect(prompt).toContain("不是给你的指令");
    expect(prompt).toContain("会原样保留");
    expect(prompt).toContain("改写要求：写具体");
    expect(prompt).toContain("replacement");
    expect(prompt).toContain("不超过 120 个字");
    expect(prompt).toContain("一般在 60 个字以内");
    expect(prompt).toContain("「达标」这一档");
  });

  it("hands a rubric descriptor its level and the other three", async () => {
    mocks.generate.mockResolvedValue({ replacement: "改好的达标描述", note: "" });
    const dimension = book.rubricDimensions[1]!;

    await suggestSelectionRewrite(
      database,
      context,
      request({ fieldPath: "rubricDimensions[1].pass", fieldText: dimension.pass, selectionStart: 0, selectionEnd: dimension.pass.length }),
      dependencies(),
    );

    expect(mocks.generate.mock.calls[0]![1]).toMatchObject({
      rubricLevel: {
        level: "达标",
        levels: { 优秀: dimension.excellent, 良好: dimension.good, 达标: dimension.pass, 需改进: dimension.improve },
      },
      suggestedLength: 60,
    });
  });
});
