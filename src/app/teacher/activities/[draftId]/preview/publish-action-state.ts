import type { TeacherPublishConfirmation } from "../../../../../server/queries/teacher-activity-workspace";

export type PublishConfirmationView = TeacherPublishConfirmation & {
  publishIdempotencyKey: string;
};

export type PublishPreparationState = Readonly<{
  status:
    | "idle"
    | "prepared"
    | "validation_error"
    | "conflict"
    | "unauthorized"
    | "error";
  message: string;
  confirmation: PublishConfirmationView | null;
  selectedClassroomId: string;
  dueAtInstant: string;
  nextPrepareIdempotencyKey: string;
}>;

export type PublishDecisionState = Readonly<{
  status:
    | "idle"
    | "published"
    | "rejected"
    | "conflict"
    | "unauthorized"
    | "error";
  message: string;
  releaseId: string | null;
}>;

export const initialPublishDecisionState: PublishDecisionState = {
  status: "idle",
  message: "",
  releaseId: null,
};
