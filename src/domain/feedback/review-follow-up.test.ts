import { describe, expect, it } from "vitest";
import { reviewFollowUp } from "./review-follow-up";

describe("reviewFollowUp", () => {
  it("flags revise without a working copy as awaiting resubmission", () => {
    expect(
      reviewFollowUp({ nextStep: "REVISE", hasWorkingCopy: false }),
    ).toBe("AWAITING_RESUBMISSION");
  });

  it("flags revise with a working copy as in progress", () => {
    expect(
      reviewFollowUp({ nextStep: "REVISE", hasWorkingCopy: true }),
    ).toBe("RESUBMISSION_IN_PROGRESS");
  });

  it("does not flag continue or missing next steps", () => {
    expect(
      reviewFollowUp({ nextStep: "CONTINUE", hasWorkingCopy: false }),
    ).toBeNull();
    expect(
      reviewFollowUp({ nextStep: null, hasWorkingCopy: false }),
    ).toBeNull();
    expect(
      reviewFollowUp({ nextStep: undefined, hasWorkingCopy: true }),
    ).toBeNull();
  });
});
