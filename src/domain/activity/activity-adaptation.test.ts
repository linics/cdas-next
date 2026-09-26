import { describe, expect, it } from "vitest";
import { waterConservationTaskBookV3 as current } from "../../fixtures/water-conservation-v3";
import {
  adaptationModelOutputSchema,
  adaptationModelSource,
  adaptationRequestProblem,
  AdaptationMergeError,
  describeAdaptationChanges,
  mergeAdaptation,
  type ActivityAdaptationRequest,
  type AdaptationModelOutput,
} from "./activity-adaptation";

function request(
  overrides: Partial<ActivityAdaptationRequest> = {},
): ActivityAdaptationRequest {
  return {
    targetGrade: null,
    totalLessons: null,
    contextNote: "改为八年级的社区节水情境",
    areas: ["BACKGROUND", "PHASES"],
    ...overrides,
  };
}

function mergeError(run: () => unknown) {
  try {
    run();
  } catch (error) {
    if (error instanceof AdaptationMergeError) return error.code;
    throw error;
  }
  return null;
}

describe("adaptation request", () => {
  it("needs a grade, lesson total or context to adapt towards", () => {
    expect(
      adaptationRequestProblem(current, request({ contextNote: "" })),
    ).toBe("NOTHING_TO_ADAPT");
    expect(
      adaptationRequestProblem(
        current,
        request({ contextNote: "", targetGrade: current.grade }),
      ),
    ).toBe("NOTHING_TO_ADAPT");
    expect(adaptationRequestProblem(current, request())).toBeNull();
  });

  it("only redistributes lessons when phases may change", () => {
    expect(
      adaptationRequestProblem(
        current,
        request({ totalLessons: 6, areas: ["BACKGROUND"] }),
      ),
    ).toBe("LESSONS_NEED_PHASES");
    expect(
      adaptationRequestProblem(current, request({ totalLessons: 3 })),
    ).toBeNull();
  });

  it("rejects a grade the chosen disciplines do not cover", () => {
    // Physics is a middle-school discipline; grade 4 is primary school.
    expect(
      adaptationRequestProblem(current, request({ targetGrade: 4 })),
    ).toBe("GRADE_INCOMPATIBLE");
    expect(
      adaptationRequestProblem(current, request({ targetGrade: 8 })),
    ).toBeNull();
  });
});

describe("model output contract", () => {
  it("accepts exactly the selected areas", () => {
    const schema = adaptationModelOutputSchema(["BACKGROUND"]);
    expect(
      schema.safeParse({ BACKGROUND: { backgroundSetting: "新的背景" } })
        .success,
    ).toBe(true);
    expect(
      schema.safeParse({
        BACKGROUND: { backgroundSetting: "新的背景" },
        TASK_INSTRUCTIONS: { taskInstructions: "越界改写" },
      }).success,
    ).toBe(false);
  });

  it("shows the model only the selected areas' words", () => {
    const source = adaptationModelSource(current, ["RUBRIC"]);
    expect(Object.keys(source)).toEqual(["RUBRIC"]);
    expect(source.RUBRIC?.rubricDimensions[0]).not.toHaveProperty(
      "learningGoalIds",
    );
  });
});

describe("mergeAdaptation", () => {
  const adaptedPhases = (): AdaptationModelOutput["PHASES"] =>
    adaptationModelSource(current, ["PHASES"]).PHASES!;

  it("rewrites selected words and keeps everything else", () => {
    const phases = adaptedPhases()!;
    phases.phases[0]!.context = "从社区公共用水点位出发。";
    const merged = mergeAdaptation(current, request({ targetGrade: 8 }), {
      BACKGROUND: { backgroundSetting: "社区希望根据学生调查改进公共用水。" },
      PHASES: phases,
    });

    expect(merged.grade).toBe(8);
    expect(merged.schoolStage).toBe("MIDDLE");
    expect(merged.backgroundSetting).toBe("社区希望根据学生调查改进公共用水。");
    expect(merged.phases[0]!.context).toBe("从社区公共用水点位出发。");
    expect(merged.phases[0]!.learningGoalIds).toEqual(
      current.phases[0]!.learningGoalIds,
    );
    expect(merged.phases[1]!.evidence[0]!.type).toBe("document");
    expect(merged.title).toBe(current.title);
    expect(merged.taskInstructions).toBe(current.taskInstructions);
    expect(merged.rubricDimensions).toEqual(current.rubricDimensions);

    expect(describeAdaptationChanges(current, merged).map((c) => c.label)).toEqual([
      "年级",
      "背景设定",
      "阶段 1 · 情境",
    ]);
  });

  it("refuses to add, drop or re-key structure", () => {
    const phases = adaptedPhases()!;
    phases.phases.pop();
    expect(
      mergeError(() => mergeAdaptation(current, request(), { PHASES: phases })),
    ).toBe("STRUCTURE_CHANGED");

    const extraEvidence = adaptedPhases()!;
    extraEvidence.phases[0]!.evidence.push({ description: "多出来的证据" });
    expect(
      mergeError(() =>
        mergeAdaptation(current, request(), { PHASES: extraEvidence }),
      ),
    ).toBe("STRUCTURE_CHANGED");

    const objectives = adaptationModelSource(current, ["OBJECTIVES"]).OBJECTIVES!;
    objectives.learningGoals[0]!.id = "goal-renamed";
    expect(
      mergeError(() =>
        mergeAdaptation(current, request({ areas: ["OBJECTIVES"] }), {
          OBJECTIVES: objectives,
        }),
      ),
    ).toBe("STRUCTURE_CHANGED");
  });

  it("holds the lesson total the teacher asked for", () => {
    const phases = adaptedPhases()!;
    phases.phases[1]!.suggestedLessons = 3; // 1 + 3 + 1 = 5
    expect(
      mergeError(() =>
        mergeAdaptation(current, request({ totalLessons: 6 }), { PHASES: phases }),
      ),
    ).toBe("LESSONS_MISMATCH");
    expect(
      mergeAdaptation(current, request({ totalLessons: 5 }), { PHASES: phases })
        .phases[1]!.suggestedLessons,
    ).toBe(3);
  });

  it("fails an adaptation that changes nothing", () => {
    expect(
      mergeError(() =>
        mergeAdaptation(current, request({ areas: ["BACKGROUND"] }), {
          BACKGROUND: { backgroundSetting: current.backgroundSetting },
        }),
      ),
    ).toBe("NO_CHANGE");
  });
});
