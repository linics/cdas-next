"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "../../../_components/ui";
import { diagnoseDraftAction, type DiagnosisActionState } from "./diagnosis-actions";

export function DiagnosisTrigger({
  draftId,
  version,
}: {
  draftId: string;
  version: number;
}) {
  const [state, action, pending] = useActionState<DiagnosisActionState, FormData>(
    diagnoseDraftAction,
    { status: "idle", message: "" },
  );
  return (
    <div className="grid gap-3">
      <form action={action}>
        <input name="draftId" type="hidden" value={draftId} />
        <input name="expectedVersion" type="hidden" value={version} />
        <Button disabled={pending} size="sm" type="submit" variant="outline">
          {pending ? "检查中…" : `检查第 ${version} 版`}
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
