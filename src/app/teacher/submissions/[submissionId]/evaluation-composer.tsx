"use client";

import {
  useActionState,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
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
import styles from "./feedback-workspace.module.css";

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
    <section className={styles.confirmationPanel} aria-label="最终量规评价确认">
      <InlineAlert tone="warning">
        量规评价已准备。取消弹窗不会写入评价；学生重交会使本确认失效。
      </InlineAlert>
      <button
        className={styles.secondaryButton}
        onClick={() => setConfirmDialogOpen(true)}
        type="button"
      >
        查看最终量规评价确认
      </button>
      <form
        action={decisionAction}
        className={styles.visuallyHidden}
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
          <div className={styles.dialogDetail}>
            <p>
              将对第 {confirmation.submissionRevisionNumber} 版正式提交创建评价版本{" "}
              {confirmation.expectedEvaluationVersion + 1}。
            </p>
            <ul className={styles.evaluationOutcomeList}>
              {confirmation.outcomes.map((outcome) => (
                <li key={outcome.dimensionIndex}>
                  <strong>
                    {outcome.dimensionIndex}. {outcome.dimensionName}
                  </strong>
                  <span>
                    {outcome.status === "LEVEL" && outcome.level
                      ? teacherEvaluationLevelLabels[outcome.level]
                      : teacherEvaluationOutcomeStatusLabels.INSUFFICIENT_EVIDENCE}
                  </span>
                  {outcome.citations.length > 0 ? (
                    <small>
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
            <div className={styles.confirmationBody}>{confirmation.summary}</div>
            <p>
              确认有效至{" "}
              <LocalizedDateTime
                dateTime={confirmation.expiresAt}
                includeSeconds
              />
              。
            </p>
            <p>
              参数摘要：<code>{confirmation.payloadHash}</code>
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
            attachmentIds: [],
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
    <section
      className={styles.composer}
      aria-labelledby="evaluation-editor-title"
      aria-busy={preparePending || suggestionPending}
    >
      <header className={styles.composerHeading}>
        <div>
          <h2 id="evaluation-editor-title">
            {expectedEvaluationVersion > 0
              ? "修改量规评价"
              : "撰写量规评价"}
          </h2>
          <p className={styles.composerLead}>
            第 {submissionRevisionNumber} 版提交 ·{" "}
            {expectedEvaluationVersion > 0
              ? `第 ${expectedEvaluationVersion + 1} 版评价`
              : "第一版评价"}
            · 每维须等级并引用证据，或标证据不足
          </p>
        </div>
        <div className={styles.composerActions}>
          <span className={styles.manualMode}>
            {assistantEnabled ? "教师终审 · AI 可选" : "手写模式 · 不呼叫 AI"}
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
                aria-label="让助手起草这一版评价"
              >
                {suggestionPending ? "起草中…" : "AI 起草建议"}
              </button>
            </form>
          ) : null}
        </div>
      </header>

      {assistantEnabled ? (
        <p className={styles.aiNote} role="note">
          这是 AI 建议，未经你确认不会保存。只读本版文字与检查点。
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
        <ActionNotice
          state={decisionState}
          onRefresh={() => router.refresh()}
        />
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
              className={styles.evaluationDimension}
              key={`${dimension.name}:${index}`}
            >
              <legend>
                维度 {index + 1}：{dimension.name}
              </legend>
              <dl className={styles.levelScale}>
                <div>
                  <dt>优秀</dt>
                  <dd>{dimension.excellent}</dd>
                </div>
                <div>
                  <dt>良好</dt>
                  <dd>{dimension.good}</dd>
                </div>
                <div>
                  <dt>合格</dt>
                  <dd>{dimension.pass}</dd>
                </div>
                <div>
                  <dt>需改进</dt>
                  <dd>{dimension.improve}</dd>
                </div>
              </dl>
              <div className={styles.choiceGrid}>
                <div>
                  <label htmlFor={statusId}>判断方式</label>
                  <select
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
                    <option value="" disabled>
                      请选择判断方式
                    </option>
                    <option value="LEVEL">给出等级</option>
                    <option value="INSUFFICIENT_EVIDENCE">证据不足</option>
                  </select>
                </div>
                {draft.status === "LEVEL" ? (
                  <div>
                    <label htmlFor={levelId}>达成等级</label>
                    <select
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
                      <option value="" disabled>
                        请选择等级
                      </option>
                      <option value="excellent">优秀</option>
                      <option value="good">良好</option>
                      <option value="pass">合格</option>
                      <option value="improve">需改进</option>
                    </select>
                  </div>
                ) : null}
              </div>
              {draft.status === "LEVEL" ? (
                  <fieldset className={styles.evaluationCitations}>
                    <legend>引用本版证据（1–5 项）</legend>
                    {hasTextEvidence ? (
                      <label>
                        <input
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
                      <label key={attachment.id}>
                        <input
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
                      <label key={checkpoint.evidenceIndex}>
                        <input
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

        <div className={styles.fieldHead}>
          <label htmlFor="teacher-evaluation-summary">综合评价</label>
          <span
            id="teacher-evaluation-count"
            data-over-limit={summaryOverLimit ? "true" : "false"}
          >
            {codePointCount.toLocaleString("zh-CN")} / 10,000
          </span>
        </div>
        <textarea
          id="teacher-evaluation-summary"
          className={styles.compactTextarea}
          name="summary"
          value={draftSummary}
          onChange={(event) => setDraftSummary(event.target.value)}
          placeholder="说明这次量规判断的依据、不足与下一步关注点…"
          aria-describedby="teacher-evaluation-help teacher-evaluation-count"
          spellCheck="true"
          disabled={anyPending}
        />
        <p id="teacher-evaluation-help" className={styles.visuallyHidden}>
          综评会统一为 NFC 与 LF；只有完成下一步确认才会保存。形成性继续/重交建议仍在上方反馈中单独确认。
        </p>

        <div className={styles.prepareRow}>
          <p>
            {expectedEvaluationVersion > 0
              ? `当前评价版本 ${expectedEvaluationVersion}；确认后新增一版，旧版不会被覆盖。形成性下一步仍在上方单独确认。`
              : "确认后才会写入第一版评价。形成性下一步仍在上方单独确认。"}
          </p>
          <button
            className={styles.prepareButton}
            type="submit"
            disabled={
              anyPending ||
              summaryOverLimit ||
              !summaryHasVisibleText ||
              !dimensionsReady
            }
          >
            {preparePending ? "正在准备…" : "准备评价确认"}
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </form>
    </section>
  );
}
