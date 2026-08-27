"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { InlineAlert } from "../../../_components/ui";
import { startResubmissionAction } from "./actions";
import {
  initialSubmissionActionState,
  type SubmissionActionState,
} from "./submission-action-state";
import styles from "./submission-workspace.module.css";

function ActionNotice({ state }: { state: SubmissionActionState }) {
  const router = useRouter();
  if (state.status === "idle") {
    return null;
  }

  return (
    <div className={styles.actionNotice}>
      <InlineAlert
        tone={
          state.status === "success"
            ? "success"
            : state.status === "conflict"
              ? "warning"
              : "danger"
        }
      >
        {state.message}
      </InlineAlert>
      {state.status === "conflict" ? (
        <button type="button" onClick={() => router.refresh()}>
          刷新最新版本
        </button>
      ) : null}
    </div>
  );
}

export function StartResubmitForm({
  releaseId,
  phaseIndex,
  latestRevisionNumber,
  idempotencyKey,
  layout = "card",
}: {
  releaseId: string;
  phaseIndex: number;
  latestRevisionNumber: number;
  idempotencyKey: string;
  layout?: "card" | "inline";
}) {
  const [resubmitState, resubmitAction, resubmitPending] = useActionState(
    startResubmissionAction,
    initialSubmissionActionState,
  );
  const key = resubmitState.nextIdempotencyKey ?? idempotencyKey;

  return (
    <div>
      <form
        action={resubmitAction}
        className={
          layout === "card" ? styles.stagePrimaryForm : styles.inlineResubmitForm
        }
      >
        <input type="hidden" name="releaseId" value={releaseId} />
        <input type="hidden" name="phaseIndex" value={phaseIndex} />
        <input type="hidden" name="version" value={latestRevisionNumber} />
        <input type="hidden" name="idempotencyKey" value={key} />
        <button
          className={
            layout === "card" ? styles.primaryButton : styles.secondaryButton
          }
          disabled={resubmitPending}
          type="submit"
        >
          {resubmitPending ? "正在创建…" : "开始重交"}
        </button>
      </form>
      <ActionNotice state={resubmitState} />
    </div>
  );
}
