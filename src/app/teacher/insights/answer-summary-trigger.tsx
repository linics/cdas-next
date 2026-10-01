"use client";

import { useActionState } from "react";
import { SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "../../_components/ui";
import {
  summarizeAnswersAction,
  type AnswerSummaryActionState,
} from "./answer-summary-actions";

export function AnswerSummaryTrigger({
  releaseId,
  phaseIndex,
  answerCount,
  hasSummary,
}: {
  releaseId: string;
  phaseIndex: number;
  answerCount: number;
  hasSummary: boolean;
}) {
  const [state, action, pending] = useActionState<AnswerSummaryActionState, FormData>(
    summarizeAnswersAction,
    { status: "idle", message: "" },
  );
  return (
    <div className="grid gap-2">
      <form action={action}>
        <input name="releaseId" type="hidden" value={releaseId} />
        <input name="phaseIndex" type="hidden" value={phaseIndex} />
        <Button disabled={pending} size="sm" type="submit" variant="outline">
          <SparklesIcon />
          {pending
            ? "正在读这些作答，约半分钟…"
            : hasSummary
              ? `重新归纳这 ${answerCount} 份`
              : `归纳这 ${answerCount} 份作答`}
        </Button>
      </form>
      {state.status !== "idle" ? (
        <InlineAlert tone={state.status === "error" ? "danger" : "warning"}>
          {state.message}
        </InlineAlert>
      ) : null}
    </div>
  );
}
