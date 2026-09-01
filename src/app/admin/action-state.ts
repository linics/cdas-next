export type AdminActionState = {
  status: "idle" | "success" | "error";
  message: string | null;
  inviteCode: string | null;
  oneTimePassword: string | null;
};

export const idleAdminActionState: AdminActionState = {
  status: "idle",
  message: null,
  inviteCode: null,
  oneTimePassword: null,
};
