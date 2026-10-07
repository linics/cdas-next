import { describe, expect, it } from "vitest";
import { waterConservationTaskBookV3 } from "../../fixtures/water-conservation-v3";
import { rubricLevelGuidance } from "./rubric-level-guidance";

const dimensions = waterConservationTaskBookV3.rubricDimensions;
const first = dimensions[0]!;

describe("rubricLevelGuidance (D-096)", () => {
  it("gives the awarded level's descriptor and the one above it", () => {
    expect(
      rubricLevelGuidance(dimensions, {
        dimensionIndex: 1,
        dimensionName: first.name,
        status: "LEVEL",
        level: "pass",
      }),
    ).toEqual({
      awarded: { level: "pass", descriptor: first.pass },
      next: { level: "good", descriptor: first.good },
    });
  });

  it("has nothing above the top level", () => {
    expect(
      rubricLevelGuidance(dimensions, {
        dimensionIndex: 1,
        dimensionName: first.name,
        status: "LEVEL",
        level: "excellent",
      })?.next,
    ).toBeNull();
  });

  it("points insufficient evidence at 达标", () => {
    expect(
      rubricLevelGuidance(dimensions, {
        dimensionIndex: 1,
        dimensionName: first.name,
        status: "INSUFFICIENT_EVIDENCE",
      }),
    ).toEqual({ awarded: null, next: { level: "pass", descriptor: first.pass } });
  });

  it("says nothing when the outcome does not match the rubric", () => {
    expect(
      rubricLevelGuidance(dimensions, {
        dimensionIndex: 2,
        dimensionName: first.name,
        status: "LEVEL",
        level: "good",
      }),
    ).toBeNull();
    expect(
      rubricLevelGuidance(dimensions, {
        dimensionIndex: 9,
        dimensionName: "不存在",
        status: "LEVEL",
        level: "good",
      }),
    ).toBeNull();
  });
});
