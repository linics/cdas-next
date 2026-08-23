"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LocalizedDateTime } from "../../../_components/localized-date-time";
import { ConfirmDialog, InlineAlert } from "../../../_components/ui";
import { TEACHER_FEEDBACK_BODY_MAX_LENGTH } from "../../../../domain/feedback/teacher-feedback-policy";
import { hasMeaningfulTextEvidence } from "../../../../domain/submission/text-evidence";
import {
  decideTeacherFeedbackAction,
  prepareTeacherFeedbackAction,
} from "./actions";
import {
  initialFeedbackActionState,
  type FeedbackActionState,
  type PendingFeedbackConfirmation,
} from "./feedback-action-state";
import styles from "./feedback-workspace.module.css";

type FeedbackComposerProps = Readonly<{
  submissionId: string;
  submissionRevisionId: string;
  submissionRevisionNumber: number;
  expectedFeedbackVersion: number;
  initialBody: string;
  prepareIdempotencySeed: string;
}>;

function ActionNotice({
  state,
  onRefresh,
}: {
  state: FeedbackActionState;
  onRefresh: () => void;
}) {
  if (state.status === "idle" || state.status === "prepared") {
    return null;
  }

  const isConflict = [
    "stale",
    "version_conflict",
    "expired",
    "concurrent",
  ].includes(state.status);
  const isSuccess = state.status === "saved" || state.status === "rejected";

  return (
    <div
      className={styles.actionNotice}
      data-tone={isSuccess ? "success" : isConflict ? "conflict" : "error"}
      role={isSuccess ? "status" : "alert"}
      aria-live="polite"
    >
      <span aria-hidden="true">
        {isSuccess ? "✓" : isConflict ? "↻" : "!"}
      </span>
      <p>{state.message}</p>
      {isConflict && state.status !== "concurrent" ? (
        <button type="button" onClick={onRefresh}>
          刷新
        </button>
      ) : null}
    </div>
  );
}

function ConfirmationPanel({
  confirmation,
  decisionAction,
  pending,
  decisionState,
}: {
  confirmation: PendingFeedbackConfirmation;
  decisionAction: (payload: FormData) => void;
  pending: boolean;
  decisionState: FeedbackActionState;
}) {
  const [isConfirmDialogOpen, setConfirmDialogOpen] = useState(true);
  const feedbackFormRef = useRef<HTMLFormElement>(null);
  const blocked = [
    "stale",
    "version_conflict",
    "expired",
    "unauthenticated",
    "unauthorized",
    "error",
  ].includes(decisionState.status);

  return (
    <section className={styles.confirmationPanel} aria-label="最终反馈确认">
      <InlineAlert tone="warning">反馈已准备。取消弹窗不会写入反馈；学生重交会使本确认失效。</InlineAlert>
      <button className={styles.secondaryButton} onClick={() => setConfirmDialogOpen(true)} type="button">查看最终反馈确认</button>
      <form action={decisionAction} className={styles.visuallyHidden} ref={feedbackFormRef}>
        <input type="hidden" name="actionIntentId" value={confirmation.actionIntentId} />
        <input type="hidden" name="decision" value="CONFIRM" />
        <input type="hidden" name="idempotencyKey" value={confirmation.saveIdempotencyKey} />
      </form>
      <ConfirmDialog
        open={isConfirmDialogOpen}
        title="确认并保存最终反馈"
        detail={<div className={styles.dialogDetail}><p>将对第 {confirmation.submissionRevisionNumber} 版正式提交创建反馈版本 {confirmation.expectedFeedbackVersion + 1}。</p><div className={styles.confirmationBody}>{confirmation.body}</div><p>确认有效至 <LocalizedDateTime dateTime={confirmation.expiresAt} includeSeconds />。</p><p>参数摘要：<code>{confirmation.payloadHash}</code></p></div>}
        confirmLabel="确认并保存最终反馈"
        pending={pending}
        disabled={blocked}
        onCancel={() => setConfirmDialogOpen(false)}
        onConfirm={() => {
          if (blocked) return;
          setConfirmDialogOpen(false);
          feedbackFormRef.current?.requestSubmit();
        }}
      />
      <ActionNotice state={decisionState} onRefresh={() => window.location.reload()} />
    </section>
  );
}

export function FeedbackComposer({
  submissionId,
  submissionRevisionId,
  submissionRevisionNumber,
  expectedFeedbackVersion,
  initialBody,
  prepareIdempotencySeed,
}: FeedbackComposerProps) {
  const router = useRouter();
  const [draftBody, setDraftBody] = useState(initialBody);
  const [prepareState, prepareAction, preparePending] = useActionState(
    prepareTeacherFeedbackAction,
    initialFeedbackActionState,
  );
  const [decisionState, decisionAction, decisionPending] = useActionState(
    decideTeacherFeedbackAction,
    initialFeedbackActionState,
  );

  const preparedConfirmation = prepareState.confirmation;
  const confirmationResolved = Boolean(
    preparedConfirmation &&
      decisionState.resolvedIntentId ===
        preparedConfirmation.actionIntentId &&
      (decisionState.status === "saved" ||
        decisionState.status === "rejected"),
  );
  const activeConfirmation = confirmationResolved
    ? null
    : preparedConfirmation;
  const prepareIdempotencyKey =
    decisionState.nextPrepareIdempotencyKey ??
    prepareState.nextPrepareIdempotencyKey ??
    prepareIdempotencySeed;
  const codePointCount = Array.from(draftBody).length;
  const bodyOverLimit =
    codePointCount > TEACHER_FEEDBACK_BODY_MAX_LENGTH;
  const bodyHasVisibleText = hasMeaningfulTextEvidence(draftBody);
  const anyPending = preparePending || decisionPending;
  const relatedDecisionState =
    activeConfirmation &&
    decisionState.resolvedIntentId === activeConfirmation.actionIntentId
      ? decisionState
      : initialFeedbackActionState;

  if (activeConfirmation) {
    return (
      <ConfirmationPanel
        confirmation={activeConfirmation}
        decisionAction={decisionAction}
        pending={decisionPending}
        decisionState={relatedDecisionState}
      />
    );
  }

  return (
    <section
      className={styles.composer}
      aria-labelledby="feedback-editor-title"
      aria-busy={preparePending}
    >
      <header className={styles.composerHeading}>
        <div>
          <p className={styles.eyebrow}>当前正式修订</p>
          <h2 id="feedback-editor-title">
            {expectedFeedbackVersion > 0 ? "修改教师反馈" : "撰写教师反馈"}
          </h2>
        </div>
        <span className={styles.manualMode}>手写模式 · 不呼叫 AI</span>
      </header>

      <p className={styles.composerLead}>
        对第 {submissionRevisionNumber} 版提交创建
        {expectedFeedbackVersion > 0
          ? `第 ${expectedFeedbackVersion + 1} 版反馈`
          : "第一版反馈"}
        。准备后仍需在独立面板明确确认。
      </p>

      <ActionNotice state={prepareState} onRefresh={() => router.refresh()} />
      {decisionState.status === "rejected" ||
      decisionState.status === "saved" ? (
        <ActionNotice state={decisionState} onRefresh={() => router.refresh()} />
      ) : null}

      <form className={styles.composerForm} action={prepareAction}>
        <input type="hidden" name="submissionId" value={submissionId} />
        <input
          type="hidden"
          name="submissionRevisionId"
          value={submissionRevisionId}
        />
        <input
          type="hidden"
          name="submissionRevisionNumber"
          value={submissionRevisionNumber}
        />
        <input
          type="hidden"
          name="expectedFeedbackVersion"
          value={expectedFeedbackVersion}
        />
        <input
          type="hidden"
          name="idempotencyKey"
          value={prepareIdempotencyKey}
        />

        <label htmlFor="teacher-feedback-body">反馈正文</label>
        <textarea
          id="teacher-feedback-body"
          name="body"
          value={draftBody}
          onChange={(event) => setDraftBody(event.target.value)}
          placeholder="写下具体、可行且与学生证据对应的反馈…"
          aria-describedby="teacher-feedback-help teacher-feedback-count"
          spellCheck="true"
          disabled={anyPending}
        />
        <div className={styles.fieldMeta}>
          <p id="teacher-feedback-help">
            正文会统一为 NFC 与 LF；只有完成下一步确认才会保存。
          </p>
          <span
            id="teacher-feedback-count"
            data-over-limit={bodyOverLimit ? "true" : "false"}
          >
            {codePointCount.toLocaleString("zh-CN")} / 10,000
          </span>
        </div>

        <div className={styles.prepareRow}>
          <p>
            {expectedFeedbackVersion > 0
              ? `当前反馈版本 ${expectedFeedbackVersion}；旧版不会被覆盖。`
              : "当前尚无正式反馈。"}
          </p>
          <button
            className={styles.prepareButton}
            type="submit"
            disabled={
              anyPending || bodyOverLimit || !bodyHasVisibleText
            }
          >
            {preparePending ? "正在准备…" : "准备确认"}
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </form>
    </section>
  );
}
