export type ChangePasswordState = Readonly<{ status: "idle" | "error"; message: string }>;
export const initialChangePasswordState: ChangePasswordState = { status: "idle", message: "" };
