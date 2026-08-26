export type ReviewFollowUp =
  | "AWAITING_RESUBMISSION"
  | "RESUBMISSION_IN_PROGRESS"
  | null;

export function reviewFollowUp(input: {
  nextStep: "CONTINUE" | "REVISE" | null | undefined;
  hasWorkingCopy: boolean;
}): ReviewFollowUp {
  if (input.nextStep !== "REVISE") {
    return null;
  }
  return input.hasWorkingCopy
    ? "RESUBMISSION_IN_PROGRESS"
    : "AWAITING_RESUBMISSION";
}
