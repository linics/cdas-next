import { z } from "zod";
import {
  activityContentSchema,
  type ActivityContent,
  type ActivityContentStructured,
  isStructuredTaskBook,
} from "../activity/activity-content";

export const phaseIndexSchema = z.int().min(0).max(4);

export const completedEvidenceIndexesSchema = z
  .array(z.int().min(1).max(4))
  .max(4)
  .superRefine((indexes, context) => {
    if (new Set(indexes).size !== indexes.length) {
      context.addIssue({
        code: "custom",
        message: "Completed evidence indexes must not repeat",
      });
    }
  })
  .transform((indexes) => [...indexes].sort((left, right) => left - right));

export type SubmissionExecutionScope = Readonly<{
  phaseIndex: number;
  phaseCount: number;
  evidenceCount: number;
  mode: "once" | "phased" | "mixed";
  nextPhaseIndex: number | null;
  phase: ActivityContentStructured["phases"][number] | null;
}>;

export class SubmissionExecutionError extends Error {
  constructor(
    public readonly code: "INVALID_PHASE" | "INVALID_CHECKPOINTS",
  ) {
    super(code);
    this.name = "SubmissionExecutionError";
  }
}

export function executionVersionForContent(content: ActivityContent): 0 | 1 {
  return isStructuredTaskBook(content) && content.submissionMode !== "once"
    ? 1
    : 0;
}

export function resolveSubmissionExecutionScope(
  executionVersion: number,
  rawContent: unknown,
  phaseIndex: number,
  completedEvidenceIndexes: readonly number[] = [],
): SubmissionExecutionScope {
  const content = activityContentSchema.parse(rawContent);

  if (executionVersion === 0) {
    if (phaseIndex !== 0 || completedEvidenceIndexes.length > 0) {
      throw new SubmissionExecutionError(
        phaseIndex !== 0 ? "INVALID_PHASE" : "INVALID_CHECKPOINTS",
      );
    }
    return {
      phaseIndex: 0,
      phaseCount: 0,
      evidenceCount: 0,
      mode: "once",
      nextPhaseIndex: null,
      phase: null,
    };
  }

  if (
    executionVersion !== 1 ||
    !isStructuredTaskBook(content) ||
    content.submissionMode === "once"
  ) {
    throw new SubmissionExecutionError("INVALID_PHASE");
  }

  const phaseCount = content.phases.length;
  if (phaseIndex === 0) {
    if (
      content.submissionMode !== "mixed" ||
      completedEvidenceIndexes.length > 0
    ) {
      throw new SubmissionExecutionError(
        content.submissionMode !== "mixed"
          ? "INVALID_PHASE"
          : "INVALID_CHECKPOINTS",
      );
    }
    return {
      phaseIndex,
      phaseCount,
      evidenceCount: 0,
      mode: content.submissionMode,
      nextPhaseIndex: null,
      phase: null,
    };
  }

  const phase = content.phases[phaseIndex - 1];
  if (!phase) {
    throw new SubmissionExecutionError("INVALID_PHASE");
  }
  if (
    completedEvidenceIndexes.some(
      (evidenceIndex) =>
        evidenceIndex < 1 || evidenceIndex > phase.evidence.length,
    )
  ) {
    throw new SubmissionExecutionError("INVALID_CHECKPOINTS");
  }

  const nextPhaseIndex =
    phaseIndex < phaseCount
      ? phaseIndex + 1
      : content.submissionMode === "mixed"
        ? 0
        : null;

  return {
    phaseIndex,
    phaseCount,
    evidenceCount: phase.evidence.length,
    mode: content.submissionMode,
    nextPhaseIndex,
    phase,
  };
}
