"use client";

import { useActionState, useRef, useState } from "react";
import { LocalizedDateTime } from "../../../../_components/localized-date-time";
import { ConfirmDialog, InlineAlert } from "../../../../_components/ui";
import styles from "../../../teacher-workspace.module.css";
import {
  decideCloseActivityAction,
  prepareCloseActivityAction,
} from "./actions";
import {
  initialCloseActivityActionState,
  type CloseActivityActionState,
} from "./close-activity-action-state";

type CloseActivityPanelProps = Readonly<{
  releaseId: string;
  classroomName: string;
  prepareIdempotencySeed: string;
}>;

function ActionNotice({ state }: { state: CloseActivityActionState }) {
  if (state.status === "idle" || state.status === "prepared") {
    return null;
  }

  const succeeded = state.status === "closed" || state.status === "rejected";
  return (
    <div
      className={styles.actionNotice}
      data-status={succeeded ? "success" : state.status}
      role={succeeded ? "status" : "alert"}
      aria-live="polite"
    >
      <span aria-hidden="true">{succeeded ? "✓" : "!"}</span>
      <p>{state.message}</p>
    </div>
  );
}

export function CloseActivityPanel({
  releaseId,
  classroomName,
  prepareIdempotencySeed,
}: CloseActivityPanelProps) {
  const [prepareState, prepareAction, preparePending] = useActionState(
    prepareCloseActivityAction,
    initialCloseActivityActionState,
  );
  const [decisionState, decideAction, decisionPending] = useActionState(
    decideCloseActivityAction,
    initialCloseActivityActionState,
  );
  const [dismissedConfirmationId, setDismissedConfirmationId] = useState<string | null>(null);
  const closeFormRef = useRef<HTMLFormElement>(null);

  const confirmation = prepareState.confirmation;
  const isConfirmDialogOpen = Boolean(confirmation) && dismissedConfirmationId !== confirmation?.actionIntentId;
  const resolved =
    confirmation &&
    decisionState.resolvedIntentId === confirmation.actionIntentId &&
    (decisionState.status === "closed" || decisionState.status === "rejected");

  if (resolved) {
    return <ActionNotice state={decisionState} />;
  }

  if (!confirmation) {
    return (
      <section className={styles.closeActivityPanel} aria-labelledby="close-release-title">
        <p className={styles.eyebrow}>活动控制</p>
        <h2 id="close-release-title">停止新的学生提交</h2>
        <p>
          关闭后不能重新打开；学生仍可查看现有工作与正式修订，教师仍可反馈。
        </p>
        <ActionNotice state={prepareState} />
        <form action={prepareAction}>
          <input type="hidden" name="releaseId" value={releaseId} />
          <input type="hidden" name="expectedStatus" value="ACTIVE" />
          <input
            type="hidden"
            name="idempotencyKey"
            value={prepareState.nextPrepareIdempotencyKey ?? prepareIdempotencySeed}
          />
          <button
            className={styles.dangerButton}
            type="submit"
            disabled={preparePending || decisionPending}
          >
            {preparePending ? "正在准备…" : "准备关闭活动"}
          </button>
        </form>
      </section>
    );
  }

  const relatedDecisionState =
    decisionState.resolvedIntentId === confirmation.actionIntentId
      ? decisionState
      : initialCloseActivityActionState;
  const blocked = [
    "validation_error",
    "expired",
    "conflict",
    "unauthenticated",
    "unauthorized",
    "error",
  ].includes(relatedDecisionState.status);

  return (
    <section className={styles.closeActivityPanel} aria-label="关闭活动确认">
      <InlineAlert tone="warning">关闭确认已准备。取消弹窗不会写入或关闭活动。</InlineAlert>
      <button className={styles.secondaryButton} onClick={() => setDismissedConfirmationId(null)} type="button">查看关闭确认</button>
      <form action={decideAction} className={styles.visuallyHidden} ref={closeFormRef}>
        <input type="hidden" name="actionIntentId" value={confirmation.actionIntentId} />
        <input type="hidden" name="idempotencyKey" value={confirmation.closeIdempotencyKey} />
        <input type="hidden" name="decision" value="CONFIRM" />
      </form>
      <ConfirmDialog
        open={isConfirmDialogOpen}
        title="确认关闭这个活动"
        detail={<div className={styles.dialogDetail}><p>将停止 {confirmation.classroomName || classroomName} 的新学生提交。关闭后不能重新打开，但教师仍可查看并反馈已有正式提交。</p><p>{confirmation.impact}</p><p>确认有效至 <LocalizedDateTime dateTime={confirmation.expiresAt} includeSeconds />。</p><p>参数摘要：<code>{confirmation.payloadHash}</code></p></div>}
        confirmLabel="确认并关闭活动"
        tone="danger"
        pending={decisionPending}
        disabled={blocked}
        onCancel={() => setDismissedConfirmationId(confirmation.actionIntentId)}
        onConfirm={() => {
          setDismissedConfirmationId(confirmation.actionIntentId);
          closeFormRef.current?.requestSubmit();
        }}
      />
      <ActionNotice state={relatedDecisionState} />
    </section>
  );
}
