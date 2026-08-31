export type LocalLoginState = Readonly<{
  status: "idle" | "error" | "success";
  message: string;
  destination: string | null;
}>;

export const initialLocalLoginState: LocalLoginState = {
  status: "idle",
  message: "",
  destination: null,
};
