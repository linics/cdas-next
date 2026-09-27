"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { LocalizedDateTime } from "../../../_components/localized-date-time";
import { ConfirmDialog, InlineAlert, PayloadHashDetails } from "../../../_components/ui";
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
import { useUnsavedChangesWarning } from "./unsaved-changes";
import {
  ChoiceGroup,
  ComposerFrame,
  FieldHead,
  PrepareRow,
  ReviewNotice,
} from "./review-ui";

type FeedbackComposerProps = Readonly<{
  submissionId: string;
  submissionRevisionId: string;
  submissionRevisionNumber: number;
  expectedFeedbackVersion: number;
  initialBody: string;
  /** The last confirmed support level; a new version starts from it. */
  initialSupportLevel: TeacherFeedbackSupportLevel | null;
  /** The final submission has no later phase to continue to. */
  finalSubmission: boolean;
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
    <ReviewNotice
      message={state.message}
      onRefresh={isConflict ? onRefresh : undefined}
      tone={isSuccess ? "success" : isConflict ? "conflict" : "error"}
    />
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
    <ReviewNotice
      message={state.message}
      onRefresh={
        isConflict && state.status !== "concurrent" ? onRefresh : undefined
      }
      tone={isSuccess ? "success" : isConflict ? "conflict" : "error"}
    />
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
    <section className="flex flex-col gap-3 glass rounded-2xl p-4" aria-label="最终反馈确认">
      <InlineAlert tone="warning">反馈还没保存，确认后才会保存。</InlineAlert>
      <Button onClick={() => setConfirmDialogOpen(true)} type="button" variant="outline">查看最终反馈确认</Button>
      <form action={decisionAction} className="sr-only" ref={feedbackFormRef}>
        <input type="hidden" name="actionIntentId" value={confirmation.actionIntentId} />
        <input type="hidden" name="decision" value="CONFIRM" />
        <input type="hidden" name="idempotencyKey" value={confirmation.saveIdempotencyKey} />
      </form>
      <ConfirmDialog
        open={isConfirmDialogOpen}
        title="确认并保存最终反馈"
        detail={<div className="flex flex-col gap-3 text-sm"><p>学生会看到这条反馈和下一步。</p><dl className="grid grid-cols-2 gap-2"><div className="rounded-md bg-muted p-2"><dt className="text-xs text-muted-foreground">下一步</dt><dd className="font-medium">{teacherFeedbackNextStepLabels[confirmation.nextStep]}</dd></div><div className="rounded-md bg-muted p-2"><dt className="text-xs text-muted-foreground">支架</dt><dd className="font-medium">{teacherFeedbackSupportLevelLabels[confirmation.supportLevel]}</dd></div></dl><div className="max-h-48 overflow-auto rounded-md border p-3 whitespace-pre-wrap text-foreground">{confirmation.body}</div><p>确认有效至 <LocalizedDateTime dateTime={confirmation.expiresAt} includeSeconds />。</p><PayloadHashDetails hash={confirmation.payloadHash} /></div>}
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
  initialSupportLevel,
  finalSubmission,
  prepareIdempotencySeed,
  assistantEnabled,
}: FeedbackComposerProps) {
  const startingSupportLevel = initialSupportLevel ?? "STANDARD";
  const router = useRouter();
  const [draftBody, setDraftBody] = useState(initialBody);
  const [draftNextStep, setDraftNextStep] = useState<
    TeacherFeedbackNextStep | ""
  >("");
  const [draftSupportLevel, setDraftSupportLevel] = useState<
    TeacherFeedbackSupportLevel | ""
  >(startingSupportLevel);
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
  useUnsavedChangesWarning(
    decisionState.status !== "saved" &&
      (draftBody !== initialBody ||
        draftNextStep !== "" ||
        draftSupportLevel !== startingSupportLevel),
  );

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
    <ComposerFrame
      assistantEnabled={assistantEnabled}
      busy={preparePending}
      lead={
        expectedFeedbackVersion > 0
          ? `修改后保存为第 ${expectedFeedbackVersion + 1} 版，学生看到最新一版`
          : "学生会看到反馈正文和你选的下一步"
      }
      suggestion={
        assistantEnabled ? (
          <form action={requestSuggestion}>
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
            <Button
              aria-label="让助手起草这一版反馈"
              disabled={anyPending}
              size="sm"
              title="AI 只读取本版提交的文字、已确认检查点和可解析附件；起草结果需你确认后才保存。"
              type="submit"
              variant="outline"
            >
              <SparklesIcon />
              {suggestionPending ? "起草中…" : "AI 起草建议"}
            </Button>
          </form>
        ) : null
      }
      title={expectedFeedbackVersion > 0 ? "修改反馈" : "反馈"}
      titleId="feedback-editor-title"
    >
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

      <form className="flex flex-col gap-3" action={prepareAction}>
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

        <FieldHead
          count={codePointCount}
          countId="teacher-feedback-count"
          htmlFor="teacher-feedback-body"
          label="反馈正文"
          overLimit={bodyOverLimit}
        />
        <Textarea
          className="min-h-32"
          id="teacher-feedback-body"
          name="body"
          value={draftBody}
          onChange={(event) => setDraftBody(event.target.value)}
          placeholder="写下具体、可行且与学生证据对应的反馈…"
          aria-describedby="teacher-feedback-help teacher-feedback-count"
          spellCheck="true"
          disabled={anyPending}
        />
        <p id="teacher-feedback-help" className="sr-only">
          反馈内容需经确认后才会保存。
        </p>

        <ChoiceGroup
          disabled={anyPending}
          legend="下一步"
          name="nextStep"
          onChange={setDraftNextStep}
          options={[
            {
              value: "CONTINUE",
              label: finalSubmission ? "完成，无需重交" : "进入下一阶段",
            },
            { value: "REVISE", label: "修改后重交" },
          ]}
          required
          value={draftNextStep}
        />
        <ChoiceGroup
          disabled={anyPending}
          legend={
            <span>
              支架{" "}
              <span className="font-normal text-muted-foreground">
                · 调整下一步建议的难度，不给学生显示
              </span>
            </span>
          }
          name="supportLevel"
          onChange={setDraftSupportLevel}
          options={[
            { value: "FOUNDATION", label: "基础支持" },
            { value: "STANDARD", label: "标准任务" },
            { value: "CHALLENGE", label: "挑战拓展" },
          ]}
          required
          size="sm"
          value={draftSupportLevel}
        />

        <PrepareRow note="保存前会再请你确认一次。">
          <Button
            type="submit"
            disabled={
              anyPending ||
              bodyOverLimit ||
              !bodyHasVisibleText ||
              !draftNextStep ||
              !draftSupportLevel
            }
          >
            {preparePending ? "正在准备…" : "保存反馈"}
            <ArrowRightIcon />
          </Button>
        </PrepareRow>
      </form>
    </ComposerFrame>
  );
}
