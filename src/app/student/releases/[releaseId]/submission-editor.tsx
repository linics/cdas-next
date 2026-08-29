"use client";

import { useActionState, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, InlineAlert } from "../../../_components/ui";
import {
  evidenceTypeLabel,
  type ActivityContentV2,
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
import styles from "./submission-workspace.module.css";

type Submission = StudentReleaseWorkspace["submission"];

type SubmissionEditorProps = Readonly<{
  releaseId: string;
  phaseIndex: number;
  phase: ActivityContentV2["phases"][number] | null;
  submission: Submission;
  canWrite: boolean;
  isPastDue: boolean;
  attachmentStorageEnabled: boolean;
  readOnlyMessage: string;
  workingCopyUpdatedLabel: ReactNode;
  idempotencySeeds: Readonly<{
    save: string;
    submit: string;
    resubmit: string;
  }>;
}>;

function ActionNotice({ state }: { state: SubmissionActionState }) {
  const router = useRouter();
  if (state.status === "idle") {
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
  attachmentStorageEnabled,
  readOnlyMessage,
  workingCopyUpdatedLabel,
  idempotencySeeds,
}: SubmissionEditorProps) {
  const workingCopy = submission?.workingCopy ?? null;
  const latestRevisionNumber = submission?.latestRevisionNumber ?? 0;
  const savedText = workingCopy?.textEvidence ?? "";
  const [editedText, setEditedText] = useState<string | null>(null);
  const [editedEvidenceIndexes, setEditedEvidenceIndexes] = useState<
    number[] | null
  >(null);
  const text = editedText ?? savedText;
  const savedEvidenceIndexes =
    workingCopy?.completedEvidenceIndexes ?? [];
  const completedEvidenceIndexes =
    editedEvidenceIndexes ?? savedEvidenceIndexes;
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
  const submitFormRef = useRef<HTMLFormElement>(null);
  const [submitConfirmationOpen, setSubmitConfirmationOpen] = useState(false);
  const anyPending = savePending || submitPending || resubmitPending;

  const saveIdempotencyKey =
    saveState.nextIdempotencyKey ?? idempotencySeeds.save;
  const submitIdempotencyKey =
    submitState.nextIdempotencyKey ?? idempotencySeeds.submit;
  const resubmitIdempotencyKey =
    resubmitState.nextIdempotencyKey ?? idempotencySeeds.resubmit;

  const draftKind =
    workingCopy && workingCopy.baseRevisionNumber > 0
      ? `第 ${workingCopy.baseRevisionNumber + 1} 版重交草稿`
      : "未提交草稿";

  // 已正式提交且没有在改的草稿时，这一段只剩一个动作，而且这个动作是针对第 N 版的 ——
  // 状态本身由下面的「我的提交与反馈」时间线负责讲，不再重复一张卡。
  if (!workingCopy && latestRevisionNumber > 0) {
    return (
      <section className={styles.editorSection} aria-labelledby="submission-title">
        <h2 className={styles.visuallyHidden} id="submission-title">
          第 {latestRevisionNumber} 版已正式提交
        </h2>

        {canWrite ? (
          <form className={styles.resubmitForm} action={resubmitAction}>
            <HiddenActionFields
              releaseId={releaseId}
              phaseIndex={phaseIndex}
              version={latestRevisionNumber}
              idempotencyKey={resubmitIdempotencyKey}
            />
            <div>
              <strong>第 {latestRevisionNumber} 版 · 开始下一版</strong>
              <p>
                已提交的版本不可修改。开始重交后，系统会以第 {latestRevisionNumber} 版内容为基础创建新草稿，已有版本与反馈全部保留。
              </p>
            </div>
            <button
              className={styles.secondaryButton}
              type="submit"
              disabled={anyPending}
            >
              {resubmitPending ? "正在创建…" : "开始重交"}
            </button>
          </form>
        ) : (
          <div className={styles.readOnlyNotice} role="note">
            <span aria-hidden="true">◇</span>
            <p>{readOnlyMessage}</p>
          </div>
        )}
        <ActionNotice state={saveState} />
        <ActionNotice state={submitState} />
        <ActionNotice state={resubmitState} />
      </section>
    );
  }

  const writingField = (
    <div className={styles.writingField}>
      <label htmlFor="text-evidence">文字证据</label>
      <textarea
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
            ? "在这里整理你的观察、数据与说明…"
            : "当前没有保存的草稿。"
        }
        readOnly={!canWrite}
        aria-describedby="text-evidence-help text-evidence-count"
        spellCheck="true"
      />
      <div className={styles.fieldMeta}>
        <p id="text-evidence-help">
          {canWrite
            ? "按 ⌘ / Ctrl + Enter 保存草稿；正式提交以最近一次保存的内容为准。"
            : readOnlyMessage}
        </p>
        <span
          id="text-evidence-count"
          data-over-limit={textOverLimit ? "true" : "false"}
        >
          {codePointCount.toLocaleString("zh-CN")} / 20,000
        </span>
      </div>
    </div>
  );

  return (
    <section className={styles.editorSection} aria-labelledby="submission-title">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>作业内容</p>
          <h2 id="submission-title">{draftKind}</h2>
        </div>
        <span className={styles.draftBadge}>尚未正式提交</span>
      </div>
      <p className={styles.sectionLead}>
        {workingCopy ? (
          <>
            工作草稿版本 {workingCopy.version}
            {workingCopyUpdatedLabel ? (
              <> · {workingCopyUpdatedLabel} 保存</>
            ) : null}
          </>
        ) : (
          "先保存草稿，再正式提交。正式提交前，草稿内容不会对教师可见。"
        )}
      </p>
      <ActionNotice state={resubmitState} />

      {canWrite ? (
        <form className={styles.writerForm} action={saveAction}>
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
              <legend>阶段证据检查点</legend>
              <p>
                勾选本阶段已完成的证据要求；这些选择会随正式提交一并记录。
              </p>
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
          <div className={styles.saveRow}>
            <span data-dirty={hasUnsavedChanges ? "true" : "false"}>
              {hasUnsavedChanges
                ? "有尚未保存的修改"
                : workingCopy
                  ? "所有修改已保存"
                  : "尚未创建草稿"}
            </span>
            <button
              className={styles.secondaryButton}
              type="submit"
              disabled={anyPending || textOverLimit}
            >
              {savePending ? "正在保存…" : "保存草稿"}
            </button>
          </div>
        </form>
      ) : (
        <div className={styles.readOnlyEditor}>
          {writingField}
          <div className={styles.readOnlyNotice} role="note">
            <span aria-hidden="true">◇</span>
            <p>{readOnlyMessage}</p>
          </div>
        </div>
      )}
      <ActionNotice state={saveState} />

      {workingCopy ? (
        <AttachmentEditor
          releaseId={releaseId}
          workingCopy={workingCopy}
          enabled={attachmentStorageEnabled}
          canWrite={canWrite}
        />
      ) : null}

      {canWrite && workingCopy ? (
        <div className={styles.commitArea}>
          <div>
            <p className={styles.eyebrow}>正式提交</p>
            <h3>
              {isPastDue
                ? `提交第 ${latestRevisionNumber + 1} 版（迟交）`
                : `提交第 ${latestRevisionNumber + 1} 版`}
            </h3>
            <p>
              将以当前已保存的草稿为准。提交后内容不可修改；如需调整，可开始重交，历史版本会保留。
            </p>
          </div>
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
              disabled={
                anyPending ||
                hasUnsavedChanges ||
                !attachmentsReady ||
                !hasSavedEvidence ||
                textOverLimit
              }
            >
              {submitPending
                ? "正在正式提交…"
                : isPastDue
                  ? "正式迟交"
                  : "正式提交"}
              <span aria-hidden="true">→</span>
            </button>
          </form>
          <ConfirmDialog
            cancelLabel="继续修改"
            confirmLabel={isPastDue ? "确认正式迟交" : "确认正式提交"}
            detail={
              isPastDue
                ? `将把当前草稿提交为第 ${latestRevisionNumber + 1} 版，并标记为迟交。提交后该版本不可修改。`
                : `将把当前草稿提交为第 ${latestRevisionNumber + 1} 版。提交后该版本不可修改。`
            }
            onCancel={() => setSubmitConfirmationOpen(false)}
            onConfirm={() => {
              setSubmitConfirmationOpen(false);
              submitFormRef.current?.requestSubmit();
            }}
            open={submitConfirmationOpen}
            pending={submitPending}
            title="确认正式提交？"
          />
          {hasUnsavedChanges ? (
            <p className={styles.commitHint}>请先保存当前修改，再正式提交。</p>
          ) : !hasVisibleSavedText ? (
            <p className={styles.commitHint}>请先保存一段文字内容，再正式提交。</p>
          ) : !attachmentsReady ? (
            <p className={styles.commitHint}>请等待附件完成内容验证，或移除未通过的附件。</p>
          ) : null}
        </div>
      ) : null}
      <ActionNotice state={submitState} />
    </section>
  );
}
