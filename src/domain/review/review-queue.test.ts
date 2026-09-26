import { describe, expect, it } from "vitest";
import {
  parseReviewQueueFilter,
  reviewQueuePosition,
  reviewQueueQuery,
  type ReviewQueueItem,
} from "./review-queue";

const item = (
  submissionId: string,
  overrides: Partial<ReviewQueueItem> = {},
): ReviewQueueItem => ({
  submissionId,
  phaseIndex: 1,
  hasFeedback: false,
  hasEvaluation: false,
  awaitingResubmission: false,
  ...overrides,
});

const feedback = { status: "feedback" as const, phase: null };

describe("review queue", () => {
  it("walks three pending items without skipping or repeating", () => {
    const roster = [item("a"), item("b"), item("c")];
    expect(reviewQueuePosition(roster, "a", feedback, true)).toEqual({ total: 3, position: 1, previousId: null, nextId: "b" });
    expect(reviewQueuePosition(roster, "b", feedback, true)).toEqual({ total: 3, position: 2, previousId: "a", nextId: "c" });
    expect(reviewQueuePosition(roster, "c", feedback, true)).toEqual({ total: 3, position: 3, previousId: "b", nextId: null });
  });

  it("keeps the next item after the current one leaves the filter by being saved", () => {
    const roster = [item("a", { hasFeedback: true }), item("b", { hasFeedback: true }), item("c")];
    expect(reviewQueuePosition(roster, "b", feedback, true)).toEqual({ total: 1, position: null, previousId: null, nextId: "c" });
  });

  it("skips items that do not match, and handles empty and single queues", () => {
    const roster = [item("a"), item("b", { hasFeedback: true }), item("c")];
    expect(reviewQueuePosition(roster, "a", feedback, true).nextId).toBe("c");
    expect(reviewQueuePosition([item("a")], "a", feedback, true)).toEqual({ total: 1, position: 1, previousId: null, nextId: null });
    expect(reviewQueuePosition([], "a", feedback, true)).toEqual({ total: 0, position: null, previousId: null, nextId: null });
  });

  it("narrows by phase and treats no-rubric releases as having nothing to evaluate", () => {
    const roster = [item("a", { phaseIndex: 1 }), item("b", { phaseIndex: 2 }), item("c", { phaseIndex: 2 })];
    expect(reviewQueuePosition(roster, "b", { status: "all", phase: 2 }, true)).toMatchObject({ total: 2, position: 1, nextId: "c" });
    expect(reviewQueuePosition(roster, "a", { status: "evaluation", phase: null }, false).total).toBe(0);
  });

  it("parses only whitelisted params and round-trips them", () => {
    expect(parseReviewQueueFilter({ queue: "feedback", phase: "2" })).toEqual({ status: "feedback", phase: 2 });
    expect(parseReviewQueueFilter({ queue: "delete-everything", phase: "x" })).toEqual({ status: "all", phase: null });
    expect(reviewQueueQuery({ status: "resubmit", phase: 3 })).toBe("?queue=resubmit&phase=3");
    expect(reviewQueueQuery({ status: "all", phase: null })).toBe("");
  });
});
