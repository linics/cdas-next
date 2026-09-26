import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import type { ActivityContentV3 } from "../../domain/activity/activity-content";

export const activityAdaptationSuggestionActionName = "suggest_activity_adaptation";

function sha256(value: unknown): string {
  const canonical = canonicalize(value);
  if (canonical === undefined) {
    throw new TypeError("Adaptation binding cannot be canonicalized");
  }
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * The success audit of an adaptation suggestion stores this hash instead of
 * the proposed task book. When the teacher confirms, the page sends the
 * proposal back and the apply command recomputes the hash: only the exact
 * words this run produced, for this draft at this version, can be written
 * under the run's provenance. Neither the prompt nor the model text is kept.
 */
export function activityAdaptationBindingHash(input: {
  agentRunId: string;
  draftId: string;
  baseVersion: number;
  content: ActivityContentV3;
}): string {
  return sha256({
    actionName: activityAdaptationSuggestionActionName,
    agentRunId: input.agentRunId,
    draftId: input.draftId,
    baseVersion: input.baseVersion,
    contentHash: sha256(input.content),
  });
}
