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
  evaluationOpen: true,
  hasEvaluation: false,
  awaitingResubmission: false,
  lowDimensionIndexes: [],
  ...overrides,
});

const feedback = { status: "feedback" as const, phase: null, dimension: null };

describe("review queue", () => {
  it("walks three pending items without skipping or repeating", () => {
    const roster = [item("a"), item("b"), item("c")];
    expect(reviewQueuePosition(roster, "a", feedback)).toEqual({ total: 3, position: 1, previousId: null, nextId: "b" });
    expect(reviewQueuePosition(roster, "b", feedback)).toEqual({ total: 3, position: 2, previousId: "a", nextId: "c" });
    expect(reviewQueuePosition(roster, "c", feedback)).toEqual({ total: 3, position: 3, previousId: "b", nextId: null });
  });

  it("keeps the next item after the current one leaves the filter by being saved", () => {
    const roster = [item("a", { hasFeedback: true }), item("b", { hasFeedback: true }), item("c")];
    expect(reviewQueuePosition(roster, "b", feedback)).toEqual({ total: 1, position: null, previousId: null, nextId: "c" });
  });

  it("skips items that do not match, and handles empty and single queues", () => {
    const roster = [item("a"), item("b", { hasFeedback: true }), item("c")];
    expect(reviewQueuePosition(roster, "a", feedback).nextId).toBe("c");
    expect(reviewQueuePosition([item("a")], "a", feedback)).toEqual({ total: 1, position: 1, previousId: null, nextId: null });
    expect(reviewQueuePosition([], "a", feedback)).toEqual({ total: 0, position: null, previousId: null, nextId: null });
  });

  it("narrows by phase and only queues final submissions for evaluation (D-077)", () => {
    const roster = [item("a", { phaseIndex: 1 }), item("b", { phaseIndex: 2 }), item("c", { phaseIndex: 2 })];
    expect(reviewQueuePosition(roster, "b", { status: "all", phase: 2, dimension: null })).toMatchObject({ total: 2, position: 1, nextId: "c" });
    const staged = [item("a", { evaluationOpen: false }), item("b", { evaluationOpen: true }), item("c", { evaluationOpen: true, hasEvaluation: true })];
    expect(reviewQueuePosition(staged, "a", { status: "evaluation", phase: null, dimension: null })).toEqual({ total: 1, position: null, previousId: null, nextId: "b" });
  });

  it("parses only whitelisted params and round-trips them", () => {
    expect(parseReviewQueueFilter({ queue: "feedback", phase: "2", dim: "3" })).toEqual({ status: "feedback", phase: 2, dimension: 3 });
    expect(parseReviewQueueFilter({ queue: "delete-everything", phase: "x", dim: "9" })).toEqual({ status: "all", phase: null, dimension: null });
    expect(reviewQueueQuery({ status: "resubmit", phase: 3, dimension: 2 })).toBe("?queue=resubmit&phase=3&dim=2");
    expect(reviewQueueQuery({ status: "all", phase: null, dimension: null })).toBe("");
  });

  it("drills into one rubric dimension's low band", () => {
    const roster = [item("a", { lowDimensionIndexes: [2] }), item("b", { lowDimensionIndexes: [1] }), item("c", { lowDimensionIndexes: [1, 2] })];
    const filter = { status: "all" as const, phase: null, dimension: 2 };
    expect(reviewQueuePosition(roster, "a", filter)).toEqual({ total: 2, position: 1, previousId: null, nextId: "c" });
  });
});
