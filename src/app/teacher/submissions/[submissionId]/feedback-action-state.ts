export type FeedbackActionOperation =
  | "prepare"
  | "confirm"
  | "reject";

export type FeedbackActionStatus =
  | "idle"
  | "prepared"
  | "saved"
  | "rejected"
  | "validation_error"
  | "stale"
  | "version_conflict"
  | "expired"
  | "concurrent"
  | "unauthenticated"
  | "unauthorized"
  | "error";

export type PendingFeedbackConfirmation = Readonly<{
  actionIntentId: string;
  submissionRevisionId: string;
  submissionRevisionNumber: number;
  expectedFeedbackVersion: number;
  body: string;
  nextStep: "CONTINUE" | "REVISE";
  supportLevel: "FOUNDATION" | "STANDARD" | "CHALLENGE";
  payloadHash: string;
  expiresAt: string;
  saveIdempotencyKey: string;
}>;

export type FeedbackActionState = Readonly<{
  operation: FeedbackActionOperation | null;
  status: FeedbackActionStatus;
  message: string;
  confirmation: PendingFeedbackConfirmation | null;
  resolvedIntentId: string | null;
  nextPrepareIdempotencyKey: string | null;
}>;

export const initialFeedbackActionState: FeedbackActionState = {
  operation: null,
  status: "idle",
  message: "",
  confirmation: null,
  resolvedIntentId: null,
  nextPrepareIdempotencyKey: null,
};
