import { describe, expect, it } from "vitest";
import {
  aggregateRubricCard,
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
