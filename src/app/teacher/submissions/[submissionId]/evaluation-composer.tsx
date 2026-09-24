"use client";

import {
  useActionState,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { LocalizedDateTime } from "../../../_components/localized-date-time";
import { ConfirmDialog, InlineAlert } from "../../../_components/ui";
import type { TeacherEvaluationCitation } from "../../../../domain/evaluation/teacher-evaluation-intent";
import {
  TEACHER_EVALUATION_SUMMARY_MAX_LENGTH,
  teacherEvaluationCitationKindLabels,
  teacherEvaluationLevelLabels,
  teacherEvaluationOutcomeStatusLabels,
  type TeacherEvaluationLevel,
  type TeacherEvaluationOutcomeStatus,
} from "../../../../domain/evaluation/teacher-evaluation-policy";
import { hasMeaningfulTextEvidence } from "../../../../domain/submission/text-evidence";
import {
  decideTeacherEvaluationAction,
  prepareTeacherEvaluationAction,
  suggestTeacherEvaluationAction,
} from "./evaluation-actions";
import {
  initialEvaluationActionState,
  type EvaluationActionState,
  type PendingEvaluationConfirmation,
} from "./evaluation-action-state";
import {
  initialEvaluationSuggestionActionState,
  type EvaluationSuggestionActionState,
} from "./evaluation-suggestion-action-state";
import {
  AiNote,
  ComposerFrame,
  FieldHead,
  PrepareRow,
  ReviewNotice,
} from "./review-ui";

type RubricDimension = Readonly<{
  name: string;
  excellent: string;
  good: string;
  pass: string;
  improve: string;
}>;

type EvaluationComposerProps = Readonly<{
  submissionId: string;
  submissionRevisionId: string;
  submissionRevisionNumber: number;
  expectedEvaluationVersion: number;
  rubricDimensions: readonly RubricDimension[];
  hasTextEvidence: boolean;
  attachments: ReadonlyArray<{ id: string; filename: string }>;
  checkpoints: ReadonlyArray<{ evidenceIndex: number; description: string }>;
  initialSummary: string;
  prepareIdempotencySeed: string;
  assistantEnabled: boolean;
}>;

type DimensionDraft = Readonly<{
  status: TeacherEvaluationOutcomeStatus | "";
  level: TeacherEvaluationLevel | "";
  citeText: boolean;
  attachmentIds: readonly string[];
  evidenceIndexes: readonly number[];
}>;

function emptyDimensionDraft(): DimensionDraft {
  return {
    status: "",
    level: "",
    citeText: false,
    attachmentIds: [],
    evidenceIndexes: [],
  };
}

function citationsFromDraft(draft: DimensionDraft): TeacherEvaluationCitation[] {
  const citations: TeacherEvaluationCitation[] = [];
  if (draft.citeText) citations.push({ kind: "text" });
  for (const attachmentId of draft.attachmentIds) {
    citations.push({ kind: "attachment", attachmentId });
  }
  for (const evidenceIndex of draft.evidenceIndexes) {
    citations.push({ kind: "checkpoint", evidenceIndex });
  }
  return citations;
}

function ActionNotice({
  state,
  onRefresh,
}: {
  state: EvaluationActionState;
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

function SuggestionNotice({
  state,
  onRefresh,
}: {
  state: EvaluationSuggestionActionState;
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

function citationLabel(
  citation: TeacherEvaluationCitation,
  attachments: EvaluationComposerProps["attachments"],
  checkpoints: EvaluationComposerProps["checkpoints"],
): string {
  if (citation.kind === "text") {
    return teacherEvaluationCitationKindLabels.text;
  }
  if (citation.kind === "attachment") {
    const filename =
      attachments.find((attachment) => attachment.id === citation.attachmentId)
        ?.filename ?? citation.attachmentId;
    return `${teacherEvaluationCitationKindLabels.attachment}：${filename}`;
  }
  const checkpoint = checkpoints.find(
    (item) => item.evidenceIndex === citation.evidenceIndex,
  );
  return `${teacherEvaluationCitationKindLabels.checkpoint} ${citation.evidenceIndex}${
    checkpoint ? `：${checkpoint.description}` : ""
  }`;
}

function ConfirmationPanel({
  confirmation,
  attachments,
  checkpoints,
  decisionAction,
  pending,
  decisionState,
}: {
  confirmation: PendingEvaluationConfirmation;
  attachments: EvaluationComposerProps["attachments"];
  checkpoints: EvaluationComposerProps["checkpoints"];
  decisionAction: (payload: FormData) => void;
  pending: boolean;
  decisionState: EvaluationActionState;
}) {
  const [isConfirmDialogOpen, setConfirmDialogOpen] = useState(true);
  const evaluationFormRef = useRef<HTMLFormElement>(null);
  const blocked = [
    "stale",
    "version_conflict",
    "expired",
    "unauthenticated",
    "unauthorized",
    "error",
  ].includes(decisionState.status);

  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4" aria-label="最终量规评价确认">
      <InlineAlert tone="warning">
        量规评价已准备待确认；确认前不会保存，学生重新提交会使该确认失效。
      </InlineAlert>
      <Button
        onClick={() => setConfirmDialogOpen(true)}
        type="button"
        variant="outline"
      >
        查看最终量规评价确认
      </Button>
      <form
        action={decisionAction}
        className="sr-only"
        ref={evaluationFormRef}
      >
        <input
          type="hidden"
          name="actionIntentId"
          value={confirmation.actionIntentId}
        />
        <input type="hidden" name="decision" value="CONFIRM" />
        <input
          type="hidden"
          name="idempotencyKey"
          value={confirmation.saveIdempotencyKey}
        />
      </form>
      <ConfirmDialog
        open={isConfirmDialogOpen}
        title="确认并保存量规评价"
        detail={
          <div className="flex flex-col gap-3 text-sm">
            <p>
              将对第 {confirmation.submissionRevisionNumber} 版正式提交创建评价版本{" "}
              {confirmation.expectedEvaluationVersion + 1}。
            </p>
            <ul className="flex flex-col divide-y rounded-md border">
              {confirmation.outcomes.map((outcome) => (
                <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-2" key={outcome.dimensionIndex}>
                  <strong className="font-medium text-foreground">
                    {outcome.dimensionIndex}. {outcome.dimensionName}
                  </strong>
                  <span className="ml-auto font-medium text-foreground">
                    {outcome.status === "LEVEL" && outcome.level
                      ? teacherEvaluationLevelLabels[outcome.level]
                      : teacherEvaluationOutcomeStatusLabels.INSUFFICIENT_EVIDENCE}
                  </span>
                  {outcome.citations.length > 0 ? (
                    <small className="w-full text-xs">
                      {outcome.citations
                        .map((citation) =>
                          citationLabel(citation, attachments, checkpoints),
                        )
                        .join("；")}
                    </small>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="max-h-48 overflow-auto rounded-md border p-3 whitespace-pre-wrap text-foreground">{confirmation.summary}</div>
            <p>
              确认有效至{" "}
              <LocalizedDateTime
                dateTime={confirmation.expiresAt}
                includeSeconds
              />
              。
            </p>
            <p>
              参数摘要：<code className="font-mono text-xs break-all">{confirmation.payloadHash}</code>
            </p>
          </div>
        }
        confirmLabel="确认并保存量规评价"
        pending={pending}
        disabled={blocked}
        onCancel={() => setConfirmDialogOpen(false)}
        onConfirm={() => {
          if (blocked) return;
          setConfirmDialogOpen(false);
          evaluationFormRef.current?.requestSubmit();
        }}
      />
      <ActionNotice
        state={decisionState}
        onRefresh={() => window.location.reload()}
      />
    </section>
  );
}

export function EvaluationComposer({
  submissionId,
  submissionRevisionId,
  submissionRevisionNumber,
  expectedEvaluationVersion,
  rubricDimensions,
  hasTextEvidence,
  attachments,
  checkpoints,
  initialSummary,
  prepareIdempotencySeed,
  assistantEnabled,
}: EvaluationComposerProps) {
  const router = useRouter();
  const [draftSummary, setDraftSummary] = useState(initialSummary);
  const [dimensionDrafts, setDimensionDrafts] = useState<DimensionDraft[]>(() =>
    rubricDimensions.map(() => emptyDimensionDraft()),
  );
  const [suggestionAgentRunId, setSuggestionAgentRunId] = useState<string | null>(
    null,
  );
  const [suggestionState, setSuggestionState] =
    useState<EvaluationSuggestionActionState>(
      initialEvaluationSuggestionActionState,
    );
  const [suggestionPending, startSuggestionTransition] = useTransition();
  const [prepareState, prepareAction, preparePending] = useActionState(
    prepareTeacherEvaluationAction,
    initialEvaluationActionState,
  );
  const [decisionState, decisionAction, decisionPending] = useActionState(
    decideTeacherEvaluationAction,
    initialEvaluationActionState,
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
  const codePointCount = Array.from(draftSummary).length;
  const summaryOverLimit =
    codePointCount > TEACHER_EVALUATION_SUMMARY_MAX_LENGTH;
  const summaryHasVisibleText = hasMeaningfulTextEvidence(draftSummary);
  const anyPending = preparePending || decisionPending || suggestionPending;
  const relatedDecisionState =
    activeConfirmation &&
    decisionState.resolvedIntentId === activeConfirmation.actionIntentId
      ? decisionState
      : initialEvaluationActionState;

  const outcomesJson = useMemo(
    () =>
      JSON.stringify(
        rubricDimensions.map((dimension, index) => {
          const draft = dimensionDrafts[index] ?? emptyDimensionDraft();
          if (draft.status === "INSUFFICIENT_EVIDENCE") {
            return {
              dimensionIndex: index + 1,
              dimensionName: dimension.name,
              status: "INSUFFICIENT_EVIDENCE",
              citations: [],
            };
          }
          return {
            dimensionIndex: index + 1,
            dimensionName: dimension.name,
            status: "LEVEL",
            level: draft.level || "good",
            citations: citationsFromDraft(draft),
          };
        }),
      ),
    [dimensionDrafts, rubricDimensions],
  );

  const dimensionsReady = dimensionDrafts.every((draft) => {
    if (draft.status === "INSUFFICIENT_EVIDENCE") return true;
    if (draft.status !== "LEVEL" || !draft.level) return false;
    return citationsFromDraft(draft).length > 0;
  });

  const requestSuggestion = (formData: FormData) => {
    startSuggestionTransition(async () => {
      const nextState = await suggestTeacherEvaluationAction(
        initialEvaluationSuggestionActionState,
        formData,
      );
      setSuggestionState(nextState);
      const suggestion = nextState.suggestion;
      if (!suggestion) return;

      setDraftSummary(suggestion.summary);
      setSuggestionAgentRunId(suggestion.agentRunId);
      setDimensionDrafts(
        rubricDimensions.map((_, index) => {
          const outcome = suggestion.outcomes[index];
          if (!outcome) return emptyDimensionDraft();
          if (outcome.status === "INSUFFICIENT_EVIDENCE") {
            return {
              ...emptyDimensionDraft(),
              status: "INSUFFICIENT_EVIDENCE",
            };
          }
          return {
            status: "LEVEL",
            level: outcome.level,
            citeText: outcome.citations.some(
              (citation) => citation.kind === "text",
            ),
            attachmentIds: outcome.citations.flatMap((citation) =>
              citation.kind === "attachment"
                ? [citation.attachmentId]
                : [],
            ),
            evidenceIndexes: outcome.citations.flatMap((citation) =>
              citation.kind === "checkpoint" ? [citation.evidenceIndex] : [],
            ),
          };
        }),
      );
    });
  };

  if (activeConfirmation) {
    return (
      <ConfirmationPanel
        confirmation={activeConfirmation}
        attachments={attachments}
        checkpoints={checkpoints}
        decisionAction={decisionAction}
        pending={decisionPending}
        decisionState={relatedDecisionState}
      />
    );
  }

  return (
    <ComposerFrame
      assistantEnabled={assistantEnabled}
      busy={preparePending || suggestionPending}
      lead={`第 ${submissionRevisionNumber} 版提交 · ${
        expectedEvaluationVersion > 0
          ? `第 ${expectedEvaluationVersion + 1} 版评价`
          : "第一版评价"
      } · 每个维度给出等级并引用证据，或标为证据不足`}
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
              aria-label="让助手起草这一版评价"
              disabled={anyPending}
              size="sm"
              type="submit"
              variant="outline"
            >
              <SparklesIcon />
              {suggestionPending ? "起草中…" : "AI 起草建议"}
            </Button>
          </form>
        ) : null
      }
      title={expectedEvaluationVersion > 0 ? "修改量规评价" : "撰写量规评价"}
      titleId="evaluation-editor-title"
    >
      {assistantEnabled ? (
        <AiNote>
          AI 建议需你确认后才保存。助手只读取本版正式提交的文字、已确认检查点、量规和可解析附件。
        </AiNote>
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
        <ActionNotice
          state={decisionState}
          onRefresh={() => router.refresh()}
        />
      ) : null}

      <form className="flex flex-col gap-4" action={prepareAction}>
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
          name="expectedEvaluationVersion"
          value={expectedEvaluationVersion}
        />
        <input type="hidden" name="outcomes" value={outcomesJson} />
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

        {rubricDimensions.map((dimension, index) => {
          const draft = dimensionDrafts[index] ?? emptyDimensionDraft();
          const statusId = `teacher-evaluation-status-${index + 1}`;
          const levelId = `teacher-evaluation-level-${index + 1}`;
          return (
            <fieldset
              className="flex flex-col gap-3 rounded-lg border p-3"
              key={`${dimension.name}:${index}`}
            >
              <legend className="px-1 text-sm font-semibold">
                维度 {index + 1}：{dimension.name}
              </legend>
              <dl className="grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2">
                <div className="rounded-md bg-muted/60 p-2">
                  <dt className="font-medium">优秀</dt>
                  <dd className="text-muted-foreground">{dimension.excellent}</dd>
                </div>
                <div className="rounded-md bg-muted/60 p-2">
                  <dt className="font-medium">良好</dt>
                  <dd className="text-muted-foreground">{dimension.good}</dd>
                </div>
                <div className="rounded-md bg-muted/60 p-2">
                  <dt className="font-medium">合格</dt>
                  <dd className="text-muted-foreground">{dimension.pass}</dd>
                </div>
                <div className="rounded-md bg-muted/60 p-2">
                  <dt className="font-medium">需改进</dt>
                  <dd className="text-muted-foreground">{dimension.improve}</dd>
                </div>
              </dl>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium" htmlFor={statusId}>判断方式</label>
                  <NativeSelect
                    className="w-full"
                    id={statusId}
                    value={draft.status}
                    onChange={(event) => {
                      const status = event.target
                        .value as TeacherEvaluationOutcomeStatus | "";
                      setDimensionDrafts((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                status,
                                level: status === "LEVEL" ? item.level : "",
                                citeText:
                                  status === "INSUFFICIENT_EVIDENCE"
                                    ? false
                                    : item.citeText,
                                attachmentIds:
                                  status === "INSUFFICIENT_EVIDENCE"
                                    ? []
                                    : item.attachmentIds,
                                evidenceIndexes:
                                  status === "INSUFFICIENT_EVIDENCE"
                                    ? []
                                    : item.evidenceIndexes,
                              }
                            : item,
                        ),
                      );
                    }}
                    disabled={anyPending}
                    required
                  >
                    <NativeSelectOption value="" disabled>
                      请选择判断方式
                    </NativeSelectOption>
                    <NativeSelectOption value="LEVEL">给出等级</NativeSelectOption>
                    <NativeSelectOption value="INSUFFICIENT_EVIDENCE">证据不足</NativeSelectOption>
                  </NativeSelect>
                </div>
                {draft.status === "LEVEL" ? (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium" htmlFor={levelId}>达成等级</label>
                    <NativeSelect
                      className="w-full"
                      id={levelId}
                      value={draft.level}
                      onChange={(event) => {
                        const level = event.target
                          .value as TeacherEvaluationLevel | "";
                        setDimensionDrafts((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, level } : item,
                          ),
                        );
                      }}
                      disabled={anyPending}
                      required
                    >
                      <NativeSelectOption value="" disabled>
                        请选择等级
                      </NativeSelectOption>
                      <NativeSelectOption value="excellent">优秀</NativeSelectOption>
                      <NativeSelectOption value="good">良好</NativeSelectOption>
                      <NativeSelectOption value="pass">合格</NativeSelectOption>
                      <NativeSelectOption value="improve">需改进</NativeSelectOption>
                    </NativeSelect>
                  </div>
                ) : null}
              </div>
              {draft.status === "LEVEL" ? (
                  <fieldset className="flex flex-col gap-2 rounded-md bg-muted/40 p-3">
                    <legend className="text-xs font-medium text-muted-foreground">引用本版证据（1–5 项）</legend>
                    {hasTextEvidence ? (
                      <label className="flex items-start gap-2 text-sm">
                        <input
                          className="mt-0.5 size-4 accent-primary"
                          type="checkbox"
                          checked={draft.citeText}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setDimensionDrafts((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, citeText: checked }
                                  : item,
                              ),
                            );
                          }}
                          disabled={anyPending}
                        />
                        引用本版文字证据
                      </label>
                    ) : null}
                    {attachments.map((attachment) => (
                      <label className="flex items-start gap-2 text-sm" key={attachment.id}>
                        <input
                          className="mt-0.5 size-4 accent-primary"
                          type="checkbox"
                          checked={draft.attachmentIds.includes(attachment.id)}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setDimensionDrafts((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...item,
                                      attachmentIds: checked
                                        ? [...item.attachmentIds, attachment.id]
                                        : item.attachmentIds.filter(
                                            (id) => id !== attachment.id,
                                          ),
                                    }
                                  : item,
                              ),
                            );
                          }}
                          disabled={anyPending}
                        />
                        引用附件 {attachment.filename}
                      </label>
                    ))}
                    {checkpoints.map((checkpoint) => (
                      <label className="flex items-start gap-2 text-sm" key={checkpoint.evidenceIndex}>
                        <input
                          className="mt-0.5 size-4 accent-primary"
                          type="checkbox"
                          checked={draft.evidenceIndexes.includes(
                            checkpoint.evidenceIndex,
                          )}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setDimensionDrafts((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...item,
                                      evidenceIndexes: checked
                                        ? [
                                            ...item.evidenceIndexes,
                                            checkpoint.evidenceIndex,
                                          ]
                                        : item.evidenceIndexes.filter(
                                            (value) =>
                                              value !== checkpoint.evidenceIndex,
                                          ),
                                    }
                                  : item,
                              ),
                            );
                          }}
                          disabled={anyPending}
                        />
                        引用检查点 {checkpoint.evidenceIndex}：
                        {checkpoint.description}
                      </label>
                    ))}
                  </fieldset>
              ) : null}
            </fieldset>
          );
        })}

        <FieldHead
          count={codePointCount}
          countId="teacher-evaluation-count"
          htmlFor="teacher-evaluation-summary"
          label="综合评价"
          overLimit={summaryOverLimit}
        />
        <Textarea
          className="min-h-28"
          id="teacher-evaluation-summary"
          name="summary"
          value={draftSummary}
          onChange={(event) => setDraftSummary(event.target.value)}
          placeholder="说明这次量规判断的依据、不足与下一步关注点…"
          aria-describedby="teacher-evaluation-help teacher-evaluation-count"
          spellCheck="true"
          disabled={anyPending}
        />
        <p id="teacher-evaluation-help" className="sr-only">
          评价内容需经确认后才会保存；形成性下一步在上方反馈中单独确认。
        </p>

        <PrepareRow
          note={
            expectedEvaluationVersion > 0
              ? `确认后保存为第 ${expectedEvaluationVersion + 1} 版评价，旧版保留。`
              : "确认后才会保存。"
          }
        >
          <Button
            type="submit"
            disabled={
              anyPending ||
              summaryOverLimit ||
              !summaryHasVisibleText ||
              !dimensionsReady
            }
          >
            {preparePending ? "正在准备…" : "准备评价确认"}
            <ArrowRightIcon />
          </Button>
        </PrepareRow>
      </form>
    </ComposerFrame>
  );
}
