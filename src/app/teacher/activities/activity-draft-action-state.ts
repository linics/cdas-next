export type ActivityDraftFormValues = Readonly<{
  title: string;
  summary: string;
  learningObjectives: string;
  taskInstructions: string;
  evidenceRequirements: string;
  feedbackCriteria: string;
}>;

export type ActivityDraftActionState = Readonly<{
  status:
    | "idle"
    | "success"
    | "validation_error"
    | "conflict"
    | "unauthorized"
    | "error";
  message: string;
  values: ActivityDraftFormValues;
  draftId: string | null;
  expectedVersion: number | null;
  persistedStatus: "EDITING" | "READY_FOR_PREVIEW" | "SEALED" | null;
  nextIdempotencyKey: string;
}>;

export const emptyActivityDraftValues: ActivityDraftFormValues = {
  title: "",
  summary: "",
  learningObjectives: "",
  taskInstructions: "",
  evidenceRequirements: "",
  feedbackCriteria: "",
};
