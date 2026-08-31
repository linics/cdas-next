export type AdminActionState = Readonly<{
  status: "idle" | "success" | "validation_error" | "error";
  message: string;
  oneTimeLabel: string | null;
  oneTimeValue: string | null;
  canRetry: boolean;
}>;

export const initialAdminActionState: AdminActionState = {
  status: "idle",
  message: "",
  oneTimeLabel: null,
  oneTimeValue: null,
  canRetry: false,
};
