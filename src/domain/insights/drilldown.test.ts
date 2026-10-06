import { describe, expect, it } from "vitest";
import {
  aggregateRubricCard,
  evaluationGoalScope,
  isDimensionRelevantToPhase,
  isLowBandOutcome,
  stageBucketKey,
  stageBucketKeyPattern,
  type InsightsOutcome,
  type InsightsReleaseInput,
} from "./teacher-insights";

const outcome = (
  dimensionIndex: number,
  level: "excellent" | "good" | "pass" | "improve" | null,
): InsightsOutcome =>
  level === null
    ? { dimensionIndex, dimensionName: `维度${dimensionIndex}`, status: "INSUFFICIENT_EVIDENCE" }
    : { dimensionIndex, dimensionName: `维度${dimensionIndex}`, status: "LEVEL", level };

describe("insights drill-down helpers (D-070)", () => {
  it("counts exactly the submissions the dimension drill-down selects", () => {
    const evaluations: InsightsOutcome[][] = [
      [outcome(1, "improve"), outcome(2, "good")],
      [outcome(1, null), outcome(2, "improve")],
      [outcome(1, "pass"), outcome(2, "excellent")],
    ];
    const release: InsightsReleaseInput = {
      id: "r",
      title: "t",
      classroomName: "c",
      executionVersion: 0,
      submissionMode: "once",
      phases: [],
      rubricDimensions: [{ name: "维度1" }, { name: "维度2" }],
      groups: [],
      currentMemberIds: [],
      submissions: evaluations.map((outcomes, index) => ({
        id: `s${index}`,
        phaseIndex: 0,
        latestRevisionNumber: 1,
        studentId: `u${index}`,
        groupId: null,
        revisions: [{ revisionNumber: 1, nextStep: null, outcomes }],
      })),
    };
    const card = aggregateRubricCard(release);
    for (const dimension of card.dimensions) {
      const drilled = evaluations.filter((outcomes) =>
        isLowBandOutcome(outcomes, dimension.dimensionIndex, dimension.dimensionName),
      ).length;
      expect(drilled).toBe(dimension.improve + dimension.insufficient);
    }
    // A renamed dimension is not the same dimension.
    expect(isLowBandOutcome(evaluations[0]!, 1, "改名后的维度")).toBe(false);
  });

  it("gives every audience one whitelisted stage key", () => {
    const keys = [
      stageBucketKey({ complete: true, started: true, currentPhaseIndex: 3 }, 1),
      stageBucketKey({ complete: false, started: false, currentPhaseIndex: 1 }, 1),
      stageBucketKey({ complete: false, started: true, currentPhaseIndex: 0 }, 0),
      stageBucketKey({ complete: false, started: true, currentPhaseIndex: 0 }, 1),
      stageBucketKey({ complete: false, started: true, currentPhaseIndex: 2 }, 1),
    ];
    expect(keys).toEqual(["complete", "not_started", "in_progress", "final", "phase:2"]);
    expect(keys.every((key) => stageBucketKeyPattern.test(key))).toBe(true);
    expect(stageBucketKeyPattern.test("phase:2;drop")).toBe(false);
  });
});

describe("phase-relevant dimensions (D-076)", () => {
  // The walkthrough case: phase 1 serves goal A; dimensions 2–4 judge later
  // goals, so their 证据不足 on a phase-1 submission is not a weakness. The
  // phase evaluations here predate D-077; phase 3 is the final submission.
  const release: InsightsReleaseInput = {
    id: "r",
    title: "t",
    classroomName: "c",
    executionVersion: 1,
    submissionMode: "phased",
    phases: [
      { name: "定方案", learningGoalIds: ["a"] },
      { name: "实测", learningGoalIds: ["a", "b"] },
      { name: "汇报", learningGoalIds: ["c"] },
    ],
    rubricDimensions: [
      { name: "维度1", learningGoalIds: ["a"] },
      { name: "维度2", learningGoalIds: ["b"] },
      { name: "维度3", learningGoalIds: ["c"] },
      { name: "维度4", learningGoalIds: ["b", "c"] },
    ],
    groups: [],
    currentMemberIds: [],
    submissions: [
      {
        id: "s1",
        phaseIndex: 1,
        latestRevisionNumber: 1,
        studentId: "u1",
        groupId: null,
        revisions: [{ revisionNumber: 1, nextStep: null, outcomes: [outcome(1, "good"), outcome(2, null), outcome(3, null), outcome(4, null)] }],
      },
      {
        id: "s2",
        phaseIndex: 2,
        latestRevisionNumber: 1,
        studentId: "u2",
        groupId: null,
        revisions: [{ revisionNumber: 1, nextStep: null, outcomes: [outcome(1, "pass"), outcome(2, "improve"), outcome(3, null), outcome(4, null)] }],
      },
      {
        id: "s0",
        phaseIndex: 0,
        latestRevisionNumber: 1,
        studentId: "u3",
        groupId: null,
        revisions: [{ revisionNumber: 1, nextStep: null, outcomes: [outcome(1, "good"), outcome(2, "good"), outcome(3, null), outcome(4, "pass")] }],
      },
    ],
  };

  it("counts a dimension only where the phase serves one of its goals", () => {
    const card = aggregateRubricCard(release);
    expect(card.sampleCount).toBe(3);
    expect(card.dimensions.map((d) => [d.sampleCount, d.improve, d.insufficient])).toEqual([
      [3, 0, 0], // goal a: every phase and the final submission
      [2, 1, 0], // goal b: phase 2 and the final submission
      [1, 0, 1], // goal c: only the whole-task submission
      [2, 0, 1], // goals b, c: phase 2 and the final submission
    ]);
    // Dimension 2's real 需改进 outweighs 证据不足 that only phase-1 work caused before.
    expect(card.dimensions.find((d) => d.weak)?.dimensionIndex).toBe(2);
  });

  it("counts every dimension on the final submission (D-091)", () => {
    // The final phase serves only goal c, but its evaluation is the activity's
    // one rubric judgement: dimensions 1 and 2 must not drop out.
    const card = aggregateRubricCard({
      ...release,
      submissions: [
        {
          id: "s3",
          phaseIndex: 3,
          latestRevisionNumber: 1,
          studentId: "u4",
          groupId: null,
          revisions: [{ revisionNumber: 1, nextStep: null, outcomes: [outcome(1, "good"), outcome(2, "improve"), outcome(3, "pass"), outcome(4, null)] }],
        },
      ],
    });
    expect(card.dimensions.map((d) => [d.sampleCount, d.improve, d.insufficient])).toEqual([
      [1, 0, 0],
      [1, 1, 0],
      [1, 0, 0],
      [1, 0, 1],
    ]);
  });

  it("bounds only phase evaluations that are not the final submission", () => {
    expect(evaluationGoalScope(release, 1)).toEqual(["a"]);
    expect(evaluationGoalScope(release, 2)).toEqual(["a", "b"]);
    expect(evaluationGoalScope(release, 3)).toBeUndefined();
    expect(evaluationGoalScope(release, 0)).toBeUndefined();
    // In mixed mode the final submission is the whole-task one, so the last
    // phase is still an ordinary phase.
    expect(evaluationGoalScope({ ...release, submissionMode: "mixed" }, 3)).toEqual(["c"]);
  });

  it("treats missing links (v2, final submission) as relevant", () => {
    expect(isDimensionRelevantToPhase(undefined, ["x"])).toBe(true);
    expect(isDimensionRelevantToPhase(["a"], undefined)).toBe(true);
    expect(isDimensionRelevantToPhase(["a"], ["b"])).toBe(false);
  });
});
