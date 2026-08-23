export type CloseActivityOperation = "prepare" | "confirm" | "reject";

export type CloseActivityStatus =
  | "idle"
  | "prepared"
  | "closed"
  | "rejected"
  | "validation_error"
  | "expired"
  | "conflict"
  | "unauthenticated"
  | "unauthorized"
  | "error";

export type PendingCloseActivityConfirmation = Readonly<{
  actionIntentId: string;
  releaseId: string;
  classroomName: string;
  impact: string;
  payloadHash: string;
  expiresAt: string;
  closeIdempotencyKey: string;
}>;

export type CloseActivityActionState = Readonly<{
  operation: CloseActivityOperation | null;
  status: CloseActivityStatus;
  message: string;
  confirmation: PendingCloseActivityConfirmation | null;
  resolvedIntentId: string | null;
  nextPrepareIdempotencyKey: string | null;
}>;

export const initialCloseActivityActionState: CloseActivityActionState = {
  operation: null,
  status: "idle",
  message: "",
  confirmation: null,
  resolvedIntentId: null,
  nextPrepareIdempotencyKey: null,
};
