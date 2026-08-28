import type {
  TeacherFeedbackNextStep,
  TeacherFeedbackSupportLevel,
} from "../../../../domain/feedback/teacher-feedback-policy";

export type FeedbackSuggestionActionStatus =
  | "idle"
  | "suggested"
  | "stale"
  | "unauthenticated"
  | "unauthorized"
  | "unavailable"
  | "error";

export type FeedbackSuggestionActionState = Readonly<{
  status: FeedbackSuggestionActionStatus;
  message: string;
  suggestion: Readonly<{
    agentRunId: string;
    submissionRevisionId: string;
    submissionRevisionNumber: number;
    body: string;
    nextStep: TeacherFeedbackNextStep;
    supportLevel: TeacherFeedbackSupportLevel;
  }> | null;
}>;

export const initialFeedbackSuggestionActionState: FeedbackSuggestionActionState =
  {
    status: "idle",
    message: "",
    suggestion: null,
  };
