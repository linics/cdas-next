import type { TeacherEvaluationOutcome } from "../../../../domain/evaluation/teacher-evaluation-intent";

export type EvaluationSuggestionActionStatus =
  | "idle"
  | "suggested"
  | "stale"
  | "unauthenticated"
  | "unauthorized"
  | "unavailable"
  | "error";

export type EvaluationSuggestionActionState = Readonly<{
  status: EvaluationSuggestionActionStatus;
  message: string;
  suggestion: Readonly<{
    agentRunId: string;
    submissionRevisionId: string;
    submissionRevisionNumber: number;
    summary: string;
    outcomes: readonly TeacherEvaluationOutcome[];
  }> | null;
}>;

export const initialEvaluationSuggestionActionState: EvaluationSuggestionActionState = {
  status: "idle",
  message: "",
  suggestion: null,
};
