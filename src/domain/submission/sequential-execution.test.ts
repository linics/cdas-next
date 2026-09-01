import { describe, expect, it } from "vitest";
import { waterConservationTaskBook } from "../../fixtures/water-conservation";
import { waterConservationTaskBookV3 } from "../../fixtures/water-conservation-v3";
import {
  executionVersionForContent,
  resolveSubmissionExecutionScope,
  SubmissionExecutionError,
} from "./sequential-execution";

describe("sequential submission execution", () => {
  it("enables new phased and mixed task books but leaves once mode whole-task", () => {
    expect(executionVersionForContent(waterConservationTaskBook)).toBe(1);
    expect(
      executionVersionForContent({
        ...waterConservationTaskBook,
        submissionMode: "once",
      }),
    ).toBe(0);
    expect(
      executionVersionForContent({
        ...waterConservationTaskBookV3,
        submissionMode: "phased",
      }),
    ).toBe(1);
  });

  it("resolves v3 phased and mixed scopes without downgrading them", () => {
    const phased = {
      ...waterConservationTaskBookV3,
      submissionMode: "phased" as const,
    };
    const first = resolveSubmissionExecutionScope(1, phased, 1, [1]);
    expect(first.phase?.name).toBe(phased.phases[0]?.name);
    expect(first.nextPhaseIndex).toBe(2);

    const mixed = { ...phased, submissionMode: "mixed" as const };
    expect(
      resolveSubmissionExecutionScope(1, mixed, mixed.phases.length, [1])
        .nextPhaseIndex,
    ).toBe(0);
    expect(resolveSubmissionExecutionScope(1, mixed, 0).phase).toBeNull();
  });

  it("resolves the next frozen phase and the mixed final", () => {
    const first = resolveSubmissionExecutionScope(
      1,
      waterConservationTaskBook,
      1,
      [1],
    );
    expect(first.phase?.name).toBe(waterConservationTaskBook.phases[0]?.name);
    expect(first.nextPhaseIndex).toBe(2);

    const mixed = {
      ...waterConservationTaskBook,
      submissionMode: "mixed" as const,
    };
    expect(
      resolveSubmissionExecutionScope(
        1,
        mixed,
        mixed.phases.length,
        [1],
      ).nextPhaseIndex,
    ).toBe(0);
    expect(resolveSubmissionExecutionScope(1, mixed, 0).phase).toBeNull();
  });

  it("rejects phase and evidence indexes outside the release snapshot", () => {
    expect(() =>
      resolveSubmissionExecutionScope(1, waterConservationTaskBook, 4),
    ).toThrowError(new SubmissionExecutionError("INVALID_PHASE"));
    expect(() =>
      resolveSubmissionExecutionScope(1, waterConservationTaskBook, 1, [4]),
    ).toThrowError(new SubmissionExecutionError("INVALID_CHECKPOINTS"));
    expect(() =>
      resolveSubmissionExecutionScope(0, waterConservationTaskBook, 1),
    ).toThrowError(new SubmissionExecutionError("INVALID_PHASE"));
  });
});
