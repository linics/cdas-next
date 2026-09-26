import type { ActivityContentV3 } from "../../../../domain/activity/activity-content";
import type { AdaptationChange } from "../../../../domain/activity/activity-adaptation";

export type AdaptationSuggestionState = Readonly<{
  status:
    | "idle"
    | "suggested"
    | "invalid_request"
    | "stale"
    | "unauthorized"
    | "unavailable"
    | "error";
  message: string;
  suggestion: Readonly<{
    agentRunId: string;
    baseVersion: number;
    content: ActivityContentV3;
    changes: readonly AdaptationChange[];
  }> | null;
}>;

export const initialAdaptationSuggestionState: AdaptationSuggestionState = {
  status: "idle",
  message: "",
  suggestion: null,
};

export type AdaptationApplyState = Readonly<{
  status: "idle" | "stale" | "error";
  message: string;
}>;
