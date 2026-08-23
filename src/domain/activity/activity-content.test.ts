import { describe, expect, it } from "vitest";
import { waterConservationActivity } from "../../fixtures/water-conservation";
import { activityContentSchema } from "./activity-content";

describe("activityContentSchema", () => {
  it("accepts the canonical water conservation fixture", () => {
    expect(activityContentSchema.parse(waterConservationActivity)).toEqual(
      waterConservationActivity,
    );
  });

  it("rejects an activity without evidence requirements", () => {
    const result = activityContentSchema.safeParse({
      ...waterConservationActivity,
      evidenceRequirements: [],
    });

    expect(result.success).toBe(false);
  });

  it("trims content and rejects blank task instructions", () => {
    const result = activityContentSchema.safeParse({
      ...waterConservationActivity,
      taskInstructions: "   ",
    });

    expect(result.success).toBe(false);
  });
});
