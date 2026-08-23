export type SubmissionActionOperation = "save" | "submit" | "resubmit";

export type SubmissionActionState = Readonly<{
  status: "idle" | "success" | "error" | "conflict";
  operation: SubmissionActionOperation | null;
  message: string;
  nextIdempotencyKey: string | null;
}>;

export const initialSubmissionActionState: SubmissionActionState = {
  status: "idle",
  operation: null,
  message: "",
  nextIdempotencyKey: null,
};
