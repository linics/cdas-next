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
import { Textarea } from "@/components/ui/textarea";
import { LocalizedDateTime } from "../../../_components/localized-date-time";
import { ConfirmDialog, InlineAlert, PayloadHashDetails } from "../../../_components/ui";
import type { TeacherEvaluationCitation } from "../../../../domain/evaluation/teacher-evaluation-intent";
import {
  TEACHER_EVALUATION_MAX_CITATIONS,
  TEACHER_EVALUATION_SUMMARY_MAX_LENGTH,
  teacherEvaluationCitationKindLabels,
  teacherEvaluationLevelLabels,
  teacherEvaluationLevels,
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
import { useUnsavedChangesWarning } from "./unsaved-changes";
import {
  ChoiceGroup,
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

type DimensionChoice = TeacherEvaluationLevel | "INSUFFICIENT_EVIDENCE";

const dimensionChoices: ReadonlyArray<{ value: DimensionChoice; label: string }> =
  [
    ...teacherEvaluationLevels.map((level) => ({
      value: level,
      label: teacherEvaluationLevelLabels[level],
    })),
    {
      value: "INSUFFICIENT_EVIDENCE",
      label: teacherEvaluationOutcomeStatusLabels.INSUFFICIENT_EVIDENCE,
    },
  ];

type EvidenceSource = Readonly<{
  key: string;
  label: string;
  citation: TeacherEvaluationCitation;
}>;

function sameCitation(
  left: TeacherEvaluationCitation,
  right: TeacherEvaluationCitation,
): boolean {
  if (left.kind === "text" || right.kind === "text") {
    return left.kind === right.kind;
  }
  if (left.kind === "attachment" && right.kind === "attachment") {
    return left.attachmentId === right.attachmentId;
  }
  return (
    left.kind === "checkpoint" &&
    right.kind === "checkpoint" &&
    left.evidenceIndex === right.evidenceIndex
  );
}

function toggleCitation(
  draft: DimensionDraft,
  citation: TeacherEvaluationCitation,
  on: boolean,
): DimensionDraft {
  if (citation.kind === "text") return { ...draft, citeText: on };
  if (citation.kind === "attachment") {
    return {
      ...draft,
      attachmentIds: on
        ? [...draft.attachmentIds, citation.attachmentId]
        : draft.attachmentIds.filter((id) => id !== citation.attachmentId),
    };
  }
  return {
    ...draft,
    evidenceIndexes: on
      ? [...draft.evidenceIndexes, citation.evidenceIndex]
      : draft.evidenceIndexes.filter((value) => value !== citation.evidenceIndex),
  };
}

/**
 * Picking a level for the first time cites every piece of this revision's
 * evidence (up to the limit); the teacher only unticks what does not apply.
 */
function chooseDimension(
  draft: DimensionDraft,
  choice: DimensionChoice,
  sources: readonly EvidenceSource[],
): DimensionDraft {
  if (choice === "INSUFFICIENT_EVIDENCE") {
    return { ...emptyDimensionDraft(), status: "INSUFFICIENT_EVIDENCE" };
  }
  if (draft.status === "LEVEL" && citationsFromDraft(draft).length > 0) {
    return { ...draft, level: choice };
  }
  return sources
    .slice(0, TEACHER_EVALUATION_MAX_CITATIONS)
    .reduce(
      (next, source) => toggleCitation(next, source.citation, true),
      { ...emptyDimensionDraft(), status: "LEVEL", level: choice } as DimensionDraft,
    );
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
    <section className="flex flex-col gap-3 glass rounded-2xl p-4" aria-label="最终量规评价确认">
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
            <p>学生会看到每个维度的等级和综合评价。</p>
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
            <PayloadHashDetails hash={confirmation.payloadHash} />
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
  const [pristineDimensions] = useState(() =>
    JSON.stringify(rubricDimensions.map(() => emptyDimensionDraft())),
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

  useUnsavedChangesWarning(
    decisionState.status !== "saved" &&
      (draftSummary !== initialSummary ||
        JSON.stringify(dimensionDrafts) !== pristineDimensions),
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
  const evidenceSources = useMemo<EvidenceSource[]>(
    () => [
      ...(hasTextEvidence
        ? [{ key: "text", label: "本版文字", citation: { kind: "text" } as const }]
        : []),
      ...attachments.map((attachment) => ({
        key: `attachment:${attachment.id}`,
        label: `附件 ${attachment.filename}`,
        citation: { kind: "attachment", attachmentId: attachment.id } as const,
      })),
      ...checkpoints.map((checkpoint) => ({
        key: `checkpoint:${checkpoint.evidenceIndex}`,
        label: checkpoint.description,
        citation: {
          kind: "checkpoint",
          evidenceIndex: checkpoint.evidenceIndex,
        } as const,
      })),
    ],
    [attachments, checkpoints, hasTextEvidence],
  );
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
      lead={
        expectedEvaluationVersion > 0
          ? `终稿评价 · 修改后保存为第 ${expectedEvaluationVersion + 1} 版`
          : "终稿评价 · 每个维度点选一个等级"
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
              aria-label="让助手起草这一版评价"
              disabled={anyPending}
              size="sm"
              title="AI 只读取本版提交的文字、已确认检查点、量规和可解析附件；起草结果需你确认后才保存。"
              type="submit"
              variant="outline"
            >
              <SparklesIcon />
              {suggestionPending ? "起草中…" : "AI 起草建议"}
            </Button>
          </form>
        ) : null
      }
      title={expectedEvaluationVersion > 0 ? "修改量规评价" : "量规评价"}
      titleId="evaluation-editor-title"
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
          const choice: DimensionChoice | "" =
            draft.status === "INSUFFICIENT_EVIDENCE"
              ? "INSUFFICIENT_EVIDENCE"
              : draft.status === "LEVEL" && draft.level
                ? draft.level
                : "";
          const descriptor =
            choice === "" || choice === "INSUFFICIENT_EVIDENCE"
              ? null
              : dimension[choice];
          const citations = citationsFromDraft(draft);
          return (
            <div
              className="flex flex-col gap-2 border-b pb-4 last:border-b-0 last:pb-0"
              key={`${dimension.name}:${index}`}
            >
              <ChoiceGroup
                detached
                disabled={anyPending}
                legend={`${index + 1}. ${dimension.name}`}
                name={`teacher-evaluation-dimension-${index + 1}`}
                onChange={(next) =>
                  setDimensionDrafts((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index
                        ? chooseDimension(item, next, evidenceSources)
                        : item,
                    ),
                  )
                }
                options={dimensionChoices.map((item) => ({
                  ...item,
                  hint:
                    item.value === "INSUFFICIENT_EVIDENCE"
                      ? "本版证据不足以判断这一维度"
                      : dimension[item.value],
                }))}
                required
                size="sm"
                value={choice}
              />
              {descriptor ? (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {descriptor}
                </p>
              ) : null}
              {draft.status === "LEVEL" && evidenceSources.length > 1 ? (
                <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <legend className="sr-only">
                    {dimension.name}引用的本版证据（1–5 项）
                  </legend>
                  <span aria-hidden="true">依据</span>
                  {evidenceSources.map((source) => {
                    const checked = citations.some((citation) =>
                      sameCitation(citation, source.citation),
                    );
                    return (
                      <label className="inline-flex items-center gap-1.5" key={source.key}>
                        <input
                          checked={checked}
                          className="size-3.5 accent-primary"
                          disabled={anyPending}
                          onChange={(event) => {
                            const on = event.target.checked;
                            setDimensionDrafts((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? toggleCitation(item, source.citation, on)
                                  : item,
                              ),
                            );
                          }}
                          type="checkbox"
                        />
                        {source.label}
                      </label>
                    );
                  })}
                </fieldset>
              ) : draft.status === "LEVEL" && evidenceSources.length === 1 ? (
                <p className="text-xs text-muted-foreground">
                  依据：{evidenceSources[0]!.label}
                </p>
              ) : null}
            </div>
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
          placeholder="写给学生：这份成果做得好的地方、还差什么…"
          aria-describedby="teacher-evaluation-help teacher-evaluation-count"
          spellCheck="true"
          disabled={anyPending}
        />
        <p id="teacher-evaluation-help" className="sr-only">
          评价内容需经确认后才会保存；形成性下一步在上方反馈中单独确认。
        </p>

        <PrepareRow note="学生会看到每个维度的等级和综合评价。">
          <Button
            type="submit"
            disabled={
              anyPending ||
              summaryOverLimit ||
              !summaryHasVisibleText ||
              !dimensionsReady
            }
          >
            {preparePending ? "正在准备…" : "保存评价"}
            <ArrowRightIcon />
          </Button>
        </PrepareRow>
      </form>
    </ComposerFrame>
  );
}
