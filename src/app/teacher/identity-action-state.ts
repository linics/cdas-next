export type TeacherIdentityActionState = Readonly<{
  status: "idle" | "verified" | "success" | "validation_error" | "error";
  message: string;
  schoolName: string | null;
  schoolCode: string | null;
}>;

export const initialTeacherIdentityActionState: TeacherIdentityActionState = {
  status: "idle",
  message: "",
  schoolName: null,
  schoolCode: null,
};

export type TeacherWorkspaceActionState = Readonly<{
  status: "idle" | "success" | "validation_error" | "error";
  message: string;
}>;

export const initialTeacherWorkspaceActionState: TeacherWorkspaceActionState = {
  status: "idle",
  message: "",
};
