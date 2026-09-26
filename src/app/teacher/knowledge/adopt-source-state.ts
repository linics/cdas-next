export type AdoptSourceState = Readonly<{
  status: "idle" | "adopted" | "rejected" | "error";
  message: string;
  draftId: string | null;
}>;

export const initialAdoptSourceState: AdoptSourceState = {
  status: "idle",
  message: "",
  draftId: null,
};
