import type {
  TeacherEvaluationLevel,
  TeacherEvaluationOutcomeStatus,
} from "../../../../domain/evaluation/teacher-evaluation-policy";
import type { TeacherEvaluationCitation } from "../../../../domain/evaluation/teacher-evaluation-intent";

export type EvaluationActionOperation = "prepare" | "confirm" | "reject";

export type EvaluationActionStatus =
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

export type PendingEvaluationConfirmation = Readonly<{
  actionIntentId: string;
  submissionRevisionId: string;
  submissionRevisionNumber: number;
  expectedEvaluationVersion: number;
  summary: string;
  outcomes: ReadonlyArray<{
    dimensionIndex: number;
    dimensionName: string;
    status: TeacherEvaluationOutcomeStatus;
    level?: TeacherEvaluationLevel;
    citations: readonly TeacherEvaluationCitation[];
  }>;
  payloadHash: string;
  expiresAt: string;
  saveIdempotencyKey: string;
}>;

export type EvaluationActionState = Readonly<{
  operation: EvaluationActionOperation | null;
  status: EvaluationActionStatus;
  message: string;
  confirmation: PendingEvaluationConfirmation | null;
  resolvedIntentId: string | null;
  nextPrepareIdempotencyKey: string | null;
}>;

export const initialEvaluationActionState: EvaluationActionState = {
  operation: null,
  status: "idle",
  message: "",
  confirmation: null,
  resolvedIntentId: null,
  nextPrepareIdempotencyKey: null,
};
