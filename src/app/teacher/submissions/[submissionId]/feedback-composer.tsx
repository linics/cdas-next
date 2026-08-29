"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LocalizedDateTime } from "../../../_components/localized-date-time";
import { ConfirmDialog, InlineAlert } from "../../../_components/ui";
import { TEACHER_FEEDBACK_BODY_MAX_LENGTH } from "../../../../domain/feedback/teacher-feedback-policy";
import {
  teacherFeedbackNextStepLabels,
  teacherFeedbackSupportLevelLabels,
  type TeacherFeedbackNextStep,
  type TeacherFeedbackSupportLevel,
} from "../../../../domain/feedback/teacher-feedback-policy";
import { hasMeaningfulTextEvidence } from "../../../../domain/submission/text-evidence";
import {
  decideTeacherFeedbackAction,
  prepareTeacherFeedbackAction,
  suggestTeacherFeedbackAction,
} from "./actions";
import {
  initialFeedbackActionState,
  type FeedbackActionState,
  type PendingFeedbackConfirmation,
} from "./feedback-action-state";
import {
  initialFeedbackSuggestionActionState,
  type FeedbackSuggestionActionState,
} from "./feedback-suggestion-action-state";
import styles from "./feedback-workspace.module.css";

type FeedbackComposerProps = Readonly<{
  submissionId: string;
  submissionRevisionId: string;
  submissionRevisionNumber: number;
  expectedFeedbackVersion: number;
  initialBody: string;
  prepareIdempotencySeed: string;
  assistantEnabled: boolean;
}>;

function SuggestionNotice({
  state,
  onRefresh,
}: {
  state: FeedbackSuggestionActionState;
  onRefresh: () => void;
}) {
  if (state.status === "idle") return null;
  const isSuccess = state.status === "suggested";
  const isConflict = state.status === "stale";
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
      {isConflict ? (
        <button type="button" onClick={onRefresh}>
          刷新
        </button>
      ) : null}
    </div>
  );
}

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
      <InlineAlert tone="warning">反馈已准备待确认；确认前不会保存，学生重新提交会使该确认失效。</InlineAlert>
      <button className={styles.secondaryButton} onClick={() => setConfirmDialogOpen(true)} type="button">查看最终反馈确认</button>
      <form action={decisionAction} className={styles.visuallyHidden} ref={feedbackFormRef}>
        <input type="hidden" name="actionIntentId" value={confirmation.actionIntentId} />
        <input type="hidden" name="decision" value="CONFIRM" />
        <input type="hidden" name="idempotencyKey" value={confirmation.saveIdempotencyKey} />
      </form>
      <ConfirmDialog
        open={isConfirmDialogOpen}
        title="确认并保存最终反馈"
        detail={<div className={styles.dialogDetail}><p>将对第 {confirmation.submissionRevisionNumber} 版正式提交创建反馈版本 {confirmation.expectedFeedbackVersion + 1}。</p><dl className={styles.structuredFeedbackDetails}><div><dt>形成性下一步</dt><dd>{teacherFeedbackNextStepLabels[confirmation.nextStep]}</dd></div><div><dt>支架层级</dt><dd>{teacherFeedbackSupportLevelLabels[confirmation.supportLevel]}</dd></div></dl><div className={styles.confirmationBody}>{confirmation.body}</div><p>确认有效至 <LocalizedDateTime dateTime={confirmation.expiresAt} includeSeconds />。</p><p>参数摘要：<code>{confirmation.payloadHash}</code></p></div>}
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
  assistantEnabled,
}: FeedbackComposerProps) {
  const router = useRouter();
  const [draftBody, setDraftBody] = useState(initialBody);
  const [draftNextStep, setDraftNextStep] = useState<
    TeacherFeedbackNextStep | ""
  >("");
  const [draftSupportLevel, setDraftSupportLevel] = useState<
    TeacherFeedbackSupportLevel | ""
  >("");
  const [suggestionAgentRunId, setSuggestionAgentRunId] = useState<
    string | null
  >(null);
  const [suggestionState, setSuggestionState] =
    useState<FeedbackSuggestionActionState>(
      initialFeedbackSuggestionActionState,
    );
  const [suggestionPending, startSuggestionTransition] = useTransition();
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
  const anyPending = preparePending || decisionPending || suggestionPending;

  const requestSuggestion = (formData: FormData) => {
    startSuggestionTransition(async () => {
      const nextState = await suggestTeacherFeedbackAction(
        initialFeedbackSuggestionActionState,
        formData,
      );
      setSuggestionState(nextState);
      const suggestion = nextState.suggestion;
      if (!suggestion) return;
      setDraftBody(suggestion.body);
      setDraftNextStep(suggestion.nextStep);
      setDraftSupportLevel(suggestion.supportLevel);
      setSuggestionAgentRunId(suggestion.agentRunId);
    });
  };
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
          <h2 id="feedback-editor-title">
            {expectedFeedbackVersion > 0 ? "修改教师反馈" : "撰写教师反馈"}
          </h2>
          <p className={styles.composerLead}>
            第 {submissionRevisionNumber} 版提交 ·{" "}
            {expectedFeedbackVersion > 0
              ? `第 ${expectedFeedbackVersion + 1} 版反馈`
              : "第一版反馈"}
          </p>
        </div>
        <div className={styles.composerActions}>
          <span className={styles.manualMode}>
            {assistantEnabled ? "教师终审 · AI 可选" : "手动撰写 · 未启用 AI"}
          </span>
          {assistantEnabled ? (
            <form className={styles.suggestionAction} action={requestSuggestion}>
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
              <button
                className={styles.secondaryButton}
                type="submit"
                disabled={anyPending}
                aria-label="让助手起草这一版反馈"
              >
                {suggestionPending ? "起草中…" : "AI 起草建议"}
              </button>
            </form>
          ) : null}
        </div>
      </header>

      {assistantEnabled ? (
        <p className={styles.aiNote} role="note">
          这是 AI 建议，未经你确认不会保存。助手只读取本版文字与已确认检查点，不读取附件内容。
        </p>
      ) : null}
      {assistantEnabled ? (
        <SuggestionNotice
          state={suggestionState}
          onRefresh={() => router.refresh()}
        />
      ) : null}

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
          name="suggestionAgentRunId"
          value={suggestionAgentRunId ?? ""}
        />
        <input
          type="hidden"
          name="idempotencyKey"
          value={prepareIdempotencyKey}
        />

        <div className={styles.fieldHead}>
          <label htmlFor="teacher-feedback-body">反馈正文</label>
          <span
            id="teacher-feedback-count"
            data-over-limit={bodyOverLimit ? "true" : "false"}
          >
            {codePointCount.toLocaleString("zh-CN")} / 10,000
          </span>
        </div>
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
        <p id="teacher-feedback-help" className={styles.visuallyHidden}>
          反馈内容需经确认后才会保存。
        </p>

        <fieldset className={styles.structuredFeedbackFields}>
          <legend className={styles.visuallyHidden}>形成性下一步与支架</legend>
          <div className={styles.choiceGrid}>
            <div>
              <label htmlFor="teacher-feedback-next-step">形成性下一步</label>
              <select
                id="teacher-feedback-next-step"
                name="nextStep"
                value={draftNextStep}
                onChange={(event) =>
                  setDraftNextStep(
                    event.target.value as TeacherFeedbackNextStep | "",
                  )
                }
                disabled={anyPending}
                required
              >
                <option value="" disabled>请选择下一步</option>
                <option value="CONTINUE">继续后续阶段</option>
                <option value="REVISE">按反馈修改并重交</option>
              </select>
            </div>
            <div>
              <label htmlFor="teacher-feedback-support-level">支架层级</label>
              <select
                id="teacher-feedback-support-level"
                name="supportLevel"
                value={draftSupportLevel}
                onChange={(event) =>
                  setDraftSupportLevel(
                    event.target.value as TeacherFeedbackSupportLevel | "",
                  )
                }
                disabled={anyPending}
                required
              >
                <option value="" disabled>请选择支架层级</option>
                <option value="FOUNDATION">基础支持</option>
                <option value="STANDARD">标准任务</option>
                <option value="CHALLENGE">挑战拓展</option>
              </select>
            </div>
          </div>
          <p className={styles.fieldHint}>
            与正文一同保存，仅作为对学生的行动建议。
          </p>
        </fieldset>

        <div className={styles.prepareRow}>
          <p>
            {expectedFeedbackVersion > 0
              ? `当前反馈版本 ${expectedFeedbackVersion}；确认后新增一版，旧版不会被覆盖。`
              : "确认后才会写入第一版反馈。"}
          </p>
          <button
            className={styles.prepareButton}
            type="submit"
            disabled={
              anyPending ||
              bodyOverLimit ||
              !bodyHasVisibleText ||
              !draftNextStep ||
              !draftSupportLevel
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
