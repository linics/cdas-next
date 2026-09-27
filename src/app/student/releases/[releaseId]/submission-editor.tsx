"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { PencilLineIcon } from "lucide-react";
import { ConfirmDialog, InlineAlert } from "../../../_components/ui";
import {
  evidenceTypeLabel,
  type ActivityTaskPhase,
} from "../../../../domain/activity/activity-content";
import {
  hasMeaningfulTextEvidence,
  MAX_TEXT_EVIDENCE_CODE_POINTS,
} from "../../../../domain/submission/text-evidence";
import type { StudentReleaseWorkspace } from "../../../../server/queries/submission-workspace";
import { AttachmentEditor } from "./attachment-editor";
import {
  saveWorkingCopyAction,
  startResubmissionAction,
  submitRevisionAction,
} from "./actions";
import {
  initialSubmissionActionState,
  type SubmissionActionState,
} from "./submission-action-state";
import { Textarea } from "@/components/ui/textarea";
import { styles } from "./submission-ui";
import { parseSupportScaffold } from "../../../../domain/activity/support-scaffold";
import type { AttachmentUploadStrategy } from "../../../../server/attachments/attachment-storage-factory";

type Submission = StudentReleaseWorkspace["submission"];

type SubmissionEditorProps = Readonly<{
  releaseId: string;
  phaseIndex: number;
  phase: ActivityTaskPhase | null;
  submission: Submission;
  canWrite: boolean;
  isPastDue: boolean;
  attachmentUpload: AttachmentUploadStrategy | null;
  readOnlyMessage: string;
  workingCopyUpdatedLabel: ReactNode;
  idempotencySeeds: Readonly<{
    save: string;
    submit: string;
    resubmit: string;
  }>;
}>;

/** Quiet period after the last keystroke before the draft saves itself. */
const AUTOSAVE_DELAY_MS = 1_200;

function ActionNotice({
  state,
  quietOnSuccess = false,
}: {
  state: SubmissionActionState;
  quietOnSuccess?: boolean;
}) {
  const router = useRouter();
  if (state.status === "idle" || (quietOnSuccess && state.status === "success")) {
    return null;
  }

  return (
    <div className={styles.actionNotice}>
      <InlineAlert tone={state.status === "success" ? "success" : state.status === "conflict" ? "warning" : "danger"}>
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

function HiddenActionFields({
  releaseId,
  phaseIndex,
  workingCopyId,
  version,
  idempotencyKey,
}: {
  releaseId: string;
  phaseIndex: number;
  workingCopyId?: string | null;
  version?: number | null;
  idempotencyKey: string;
}) {
  return (
    <>
      <input type="hidden" name="releaseId" value={releaseId} />
      <input type="hidden" name="phaseIndex" value={phaseIndex} />
      {workingCopyId !== undefined ? (
        <input
          type="hidden"
          name="workingCopyId"
          value={workingCopyId ?? ""}
        />
      ) : null}
      {version !== undefined ? (
        <input type="hidden" name="version" value={version ?? ""} />
      ) : null}
      <input
        type="hidden"
        name="idempotencyKey"
        value={idempotencyKey}
      />
    </>
  );
}

export function SubmissionEditor({
  releaseId,
  phaseIndex,
  phase,
  submission,
  canWrite,
  isPastDue,
  attachmentUpload,
  readOnlyMessage,
  workingCopyUpdatedLabel,
  idempotencySeeds,
}: SubmissionEditorProps) {
  const workingCopy = submission?.workingCopy ?? null;
  const latestRevisionNumber = submission?.latestRevisionNumber ?? 0;
  const revisionRequested = submission?.followUp === "AWAITING_RESUBMISSION";
  const savedText = workingCopy?.textEvidence ?? "";
  // Local edits belong to the working copy they were typed into. After a
  // formal submission the server hands back another working copy (the next
  // phase, or none); edits made against the old one must not leak into it or
  // keep reporting "unsaved". The component stays mounted so the submit
  // notice survives.
  const baseline = `${phaseIndex}:${workingCopy?.id ?? "none"}:${latestRevisionNumber}`;
  const [textEdit, setTextEdit] = useState<{ baseline: string; value: string } | null>(null);
  const [evidenceEdit, setEvidenceEdit] = useState<{
    baseline: string;
    value: number[];
  } | null>(null);
  const setEditedText = (value: string) => setTextEdit({ baseline, value });
  const setEditedEvidenceIndexes = (value: number[]) =>
    setEvidenceEdit({ baseline, value });
  const text = textEdit?.baseline === baseline ? textEdit.value : savedText;
  const savedEvidenceIndexes =
    workingCopy?.completedEvidenceIndexes ?? [];
  const completedEvidenceIndexes =
    evidenceEdit?.baseline === baseline ? evidenceEdit.value : savedEvidenceIndexes;
  const codePointCount = Array.from(text).length;
  const textOverLimit = codePointCount > MAX_TEXT_EVIDENCE_CODE_POINTS;
  const hasVisibleSavedText = hasMeaningfulTextEvidence(savedText);
  const hasUnsavedChanges =
    text !== savedText ||
    completedEvidenceIndexes.join(",") !== savedEvidenceIndexes.join(",");
  const attachmentsReady =
    workingCopy?.attachments.every(
      (attachment) => attachment.status === "READY",
    ) ?? true;
  const hasSavedEvidence =
    hasVisibleSavedText ||
    savedEvidenceIndexes.length > 0 ||
    (workingCopy?.attachments.some(
      (attachment) => attachment.status === "READY",
    ) ?? false);

  const [saveState, saveAction, savePending] = useActionState(
    saveWorkingCopyAction,
    initialSubmissionActionState,
  );
  const [submitState, submitAction, submitPending] = useActionState(
    submitRevisionAction,
    initialSubmissionActionState,
  );
  const [resubmitState, resubmitAction, resubmitPending] = useActionState(
    startResubmissionAction,
    initialSubmissionActionState,
  );
  const saveFormRef = useRef<HTMLFormElement>(null);
  const submitFormRef = useRef<HTMLFormElement>(null);
  const [submitConfirmationOpen, setSubmitConfirmationOpen] = useState(false);
  const anyPending = savePending || submitPending || resubmitPending;

  const saveIdempotencyKey =
    saveState.nextIdempotencyKey ?? idempotencySeeds.save;
  const submitIdempotencyKey =
    submitState.nextIdempotencyKey ?? idempotencySeeds.submit;
  const resubmitIdempotencyKey =
    resubmitState.nextIdempotencyKey ?? idempotencySeeds.resubmit;

  // The draft saves itself once typing pauses. A failed save is not retried
  // until the draft changes again, and a version conflict stops autosave
  // until the student refreshes — retrying could only fail the same way.
  const draftKey = `${baseline}|${text}|${completedEvidenceIndexes.join(",")}`;
  const [lastAttemptedDraft, setLastAttemptedDraft] = useState<string | null>(
    null,
  );
  const autosaveBlocked =
    saveState.status === "conflict" ||
    (saveState.status === "error" && lastAttemptedDraft === draftKey);
  const canAutosave =
    canWrite &&
    hasUnsavedChanges &&
    !anyPending &&
    !textOverLimit &&
    !autosaveBlocked;
  useEffect(() => {
    if (!canAutosave) return;
    const timer = window.setTimeout(() => {
      setLastAttemptedDraft(draftKey);
      saveFormRef.current?.requestSubmit();
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [canAutosave, draftKey]);

  // 已提交、没有在改的草稿：这里只剩「再改一版」这一个动作。
  // 老师要求修改时它是主按钮；否则只是一个不抢眼的入口。
  if (!workingCopy && latestRevisionNumber > 0) {
    return (
      <section className={styles.resubmitSection} aria-labelledby="submission-title">
        <h2 className={styles.visuallyHidden} id="submission-title">
          第 {latestRevisionNumber} 版已提交
        </h2>

        {canWrite ? (
          <form className={styles.resubmitForm} action={resubmitAction}>
            <HiddenActionFields
              releaseId={releaseId}
              phaseIndex={phaseIndex}
              version={latestRevisionNumber}
              idempotencyKey={resubmitIdempotencyKey}
            />
            <button
              className={
                revisionRequested ? styles.primaryButton : styles.ghostButton
              }
              type="submit"
              disabled={anyPending}
            >
              {resubmitPending
                ? "正在准备…"
                : revisionRequested
                  ? "按老师的反馈修改"
                  : "重新提交一版"}
            </button>
            <p>
              会在第 {latestRevisionNumber} 版的基础上修改，已提交的版本和老师的反馈都会保留。
            </p>
          </form>
        ) : (
          <div className={styles.readOnlyNotice} role="note">
            <p>{readOnlyMessage}</p>
          </div>
        )}
        <ActionNotice state={saveState} quietOnSuccess />
        <ActionNotice state={submitState} />
        <ActionNotice state={resubmitState} />
      </section>
    );
  }

  const saveStatus = savePending
    ? "正在保存…"
    : hasUnsavedChanges
      ? autosaveBlocked
        ? "没有保存"
        : "有修改，稍后自动保存"
      : workingCopy
        ? workingCopyUpdatedLabel
          ? <>已自动保存 · {workingCopyUpdatedLabel}</>
          : "已自动保存"
        : "写下的内容会自动保存；提交前只有你能看到";

  // 支架里的开头句（D-080）：点一下接到正文末尾，学生不必从空白开始。
  const starters =
    canWrite && phase ? parseSupportScaffold(phase.support).starters : [];
  const writingField = (
    <div className={styles.writingField}>
      <label htmlFor="text-evidence">写下你的记录和说明</label>
      {starters.length > 0 ? (
        <div className={styles.starterRow}>
          <span>可以这样开头</span>
          {starters.map((starter) => (
            <button
              key={starter}
              type="button"
              disabled={anyPending}
              onClick={() =>
                setEditedText(
                  text.trim().length === 0
                    ? starter
                    : `${text.replace(/\s+$/, "")}\n${starter}`,
                )
              }
            >
              {starter}
            </button>
          ))}
        </div>
      ) : null}
      <Textarea
        className="min-h-56 text-base leading-7"
        id="text-evidence"
        name={canWrite ? "text" : undefined}
        value={text}
        onChange={(event) => setEditedText(event.target.value)}
        onKeyDown={(event) => {
          if (
            canWrite &&
            (event.metaKey || event.ctrlKey) &&
            (event.key === "Enter" || event.key === "NumpadEnter")
          ) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        placeholder={
          canWrite
            ? "你观察到了什么、数据是多少、你怎么想…"
            : "当前没有保存的草稿。"
        }
        readOnly={!canWrite}
        aria-describedby="text-evidence-count"
        spellCheck="true"
      />
      <div className={styles.fieldMeta}>
        <span aria-live="polite" data-dirty={hasUnsavedChanges ? "true" : "false"}>
          {canWrite ? saveStatus : null}
        </span>
        <span
          id="text-evidence-count"
          data-over-limit={textOverLimit ? "true" : "false"}
        >
          {codePointCount.toLocaleString("zh-CN")} / 20,000
        </span>
      </div>
    </div>
  );

  const submitBlocker = hasUnsavedChanges
    ? autosaveBlocked
      ? "这次修改没有保存成功，请先点「保存」。"
      : "正在保存最新修改…"
    : !attachmentsReady
      ? "附件还在检查，或有文件需要移除。"
      : !hasSavedEvidence
        ? "写点内容、勾选一项或上传一个附件后，就可以提交。"
        : null;

  return (
    <section className={styles.editorSection} aria-labelledby="submission-title">
      <div className={styles.sectionHeading}>
        <h2 className="flex items-center gap-2" id="submission-title">
          <PencilLineIcon aria-hidden="true" className="size-4 text-primary" />
          {workingCopy && workingCopy.baseRevisionNumber > 0
            ? `修改第 ${workingCopy.baseRevisionNumber} 版`
            : "我的作答"}
        </h2>
      </div>
      <ActionNotice state={resubmitState} quietOnSuccess />

      {canWrite ? (
        <form className={styles.writerForm} action={saveAction} ref={saveFormRef}>
          <HiddenActionFields
            releaseId={releaseId}
            phaseIndex={phaseIndex}
            workingCopyId={workingCopy?.id ?? null}
            version={workingCopy?.version ?? null}
            idempotencyKey={saveIdempotencyKey}
          />
          <input
            type="hidden"
            name="completedEvidenceIndexes"
            value={completedEvidenceIndexes.join(",")}
          />
          {phase ? (
            <fieldset className={styles.checkpointFieldset}>
              <legend>要交的内容 · 完成一项勾一项</legend>
              {phase.evidence.map((evidence, index) => {
                const evidenceIndex = index + 1;
                const checked =
                  completedEvidenceIndexes.includes(evidenceIndex);
                return (
                  <label key={`${evidence.type}-${evidence.description}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        const next = event.currentTarget.checked
                          ? [...completedEvidenceIndexes, evidenceIndex]
                          : completedEvidenceIndexes.filter(
                              (item) => item !== evidenceIndex,
                            );
                        setEditedEvidenceIndexes(
                          next.sort((left, right) => left - right),
                        );
                      }}
                    />
                    <span>
                      <strong>{evidence.description}</strong>
                      <small>{evidenceTypeLabel(evidence.type)}</small>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          ) : null}
          {writingField}
          {autosaveBlocked && hasUnsavedChanges ? (
            <button
              className={`${styles.secondaryButton} self-start`}
              type="submit"
              disabled={anyPending || textOverLimit}
            >
              保存
            </button>
          ) : null}
        </form>
      ) : (
        <div className={styles.readOnlyEditor}>
          {writingField}
          <div className={styles.readOnlyNotice} role="note">
            <p>{readOnlyMessage}</p>
          </div>
        </div>
      )}
      <ActionNotice state={saveState} quietOnSuccess />

      {workingCopy ? (
        <AttachmentEditor
          releaseId={releaseId}
          workingCopy={workingCopy}
          upload={attachmentUpload}
          canWrite={canWrite}
        />
      ) : null}

      {canWrite && workingCopy ? (
        <div className={styles.commitArea}>
          <form action={submitAction} ref={submitFormRef}>
            <HiddenActionFields
              releaseId={releaseId}
              phaseIndex={phaseIndex}
              workingCopyId={workingCopy.id}
              version={workingCopy.version}
              idempotencyKey={submitIdempotencyKey}
            />
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() => setSubmitConfirmationOpen(true)}
              disabled={anyPending || submitBlocker !== null || textOverLimit}
            >
              {submitPending
                ? "正在提交…"
                : isPastDue
                  ? "迟交给老师"
                  : "提交给老师"}
              <span aria-hidden="true">→</span>
            </button>
          </form>
          <p className={styles.commitHint}>
            {submitBlocker ??
              (isPastDue
                ? "已过截止时间，这一版会标记为迟交。"
                : "提交后老师就能看到。")}
          </p>
          <ConfirmDialog
            cancelLabel="再改改"
            confirmLabel={isPastDue ? "确认迟交" : "确认提交"}
            detail={`这是你的第 ${latestRevisionNumber + 1} 版。提交后这一版不能再改，之后可以按老师的反馈再交一版。${
              isPastDue ? "已过截止时间，会标记为迟交。" : ""
            }`}
            onCancel={() => setSubmitConfirmationOpen(false)}
            onConfirm={() => {
              setSubmitConfirmationOpen(false);
              submitFormRef.current?.requestSubmit();
            }}
            open={submitConfirmationOpen}
            pending={submitPending}
            title="提交给老师？"
          />
        </div>
      ) : null}
      <ActionNotice state={submitState} />
    </section>
  );
}
