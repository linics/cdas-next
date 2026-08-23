"use client";

import { useActionState, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightIcon } from "../../../_components/flat-icons";
import { ConfirmDialog, InlineAlert } from "../../../_components/ui";
import {
  hasMeaningfulTextEvidence,
  MAX_TEXT_EVIDENCE_CODE_POINTS,
} from "../../../../domain/submission/text-evidence";
import type { StudentReleaseWorkspace } from "../../../../server/queries/submission-workspace";
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
  submission: Submission;
  canWrite: boolean;
  isPastDue: boolean;
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
  workingCopyId,
  version,
  idempotencyKey,
}: {
  releaseId: string;
  workingCopyId?: string | null;
  version?: number | null;
  idempotencyKey: string;
}) {
  return (
    <>
      <input type="hidden" name="releaseId" value={releaseId} />
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
  submission,
  canWrite,
  isPastDue,
  readOnlyMessage,
  workingCopyUpdatedLabel,
  idempotencySeeds,
}: SubmissionEditorProps) {
  const workingCopy = submission?.workingCopy ?? null;
  const latestRevisionNumber = submission?.latestRevisionNumber ?? 0;
  const savedText = workingCopy?.textEvidence ?? "";
  const [editedText, setEditedText] = useState<string | null>(null);
  const text = editedText ?? savedText;
  const codePointCount = Array.from(text).length;
  const textOverLimit = codePointCount > MAX_TEXT_EVIDENCE_CODE_POINTS;
  const hasVisibleSavedText = hasMeaningfulTextEvidence(savedText);
  const hasUnsavedChanges = text !== savedText;

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

  if (!workingCopy && latestRevisionNumber > 0) {
    return (
      <section className={styles.editorSection} aria-labelledby="submission-title">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>当前状态</p>
            <h2 id="submission-title">第 {latestRevisionNumber} 版已正式提交</h2>
          </div>
          <span className={styles.formalBadge}>正式修订</span>
        </div>
        <p className={styles.sectionLead}>
          当前没有未提交的修改。正式修订不可覆盖；若要补充内容，需另外创建重交草稿。
        </p>

        {canWrite ? (
          <form className={styles.resubmitForm} action={resubmitAction}>
            <HiddenActionFields
              releaseId={releaseId}
              version={latestRevisionNumber}
              idempotencyKey={resubmitIdempotencyKey}
            />
            <div>
              <strong>开始下一版</strong>
              <p>
                系统会复制第 {latestRevisionNumber} 版文字作为新草稿，现有修订与反馈都会保留。
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
            ? "在这里整理可核验的观察、数据与说明…"
            : "当前没有保存的工作草稿。"
        }
        readOnly={!canWrite}
        aria-describedby="text-evidence-help text-evidence-count"
        spellCheck="true"
      />
      <div className={styles.fieldMeta}>
        <p id="text-evidence-help">
          {canWrite
            ? "⌘ / Ctrl + Enter 可保存草稿；正式提交只采用最近一次已保存版本。"
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
          "先保存一份工作草稿，再确认正式提交。未正式提交的工作草稿只有你自己可见。"
        )}
      </p>
      <ActionNotice state={resubmitState} />

      {canWrite ? (
        <form className={styles.writerForm} action={saveAction}>
          <HiddenActionFields
            releaseId={releaseId}
            workingCopyId={workingCopy?.id ?? null}
            version={workingCopy?.version ?? null}
            idempotencyKey={saveIdempotencyKey}
          />
          {writingField}
          <div className={styles.saveRow}>
            <span data-dirty={hasUnsavedChanges ? "true" : "false"}>
              {hasUnsavedChanges
                ? "有尚未保存的修改"
                : workingCopy
                  ? "页面内容与已保存草稿一致"
                  : "尚未创建工作草稿"}
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

      {canWrite && workingCopy ? (
        <div className={styles.commitArea}>
          <div>
            <p className={styles.eyebrow}>正式提交</p>
            <h3>
              {isPastDue
                ? `迟交第 ${latestRevisionNumber + 1} 版`
                : `创建第 ${latestRevisionNumber + 1} 版正式修订`}
            </h3>
            <p>
              将固定采用工作草稿 {workingCopy.version}。提交后若要修改，需显式开始重交，旧版不会被覆盖。
            </p>
          </div>
          <form action={submitAction} ref={submitFormRef}>
            <HiddenActionFields
              releaseId={releaseId}
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
                !hasVisibleSavedText ||
                textOverLimit
              }
            >
              {submitPending
                ? "正在正式提交…"
                : isPastDue
                  ? "正式迟交"
                  : "正式提交"}
              <ArrowRightIcon />
            </button>
          </form>
          <ConfirmDialog
            cancelLabel="继续修改"
            confirmLabel={isPastDue ? "确认正式迟交" : "确认正式提交"}
            detail={
              isPastDue
                ? `将工作草稿 ${workingCopy.version} 固定为第 ${latestRevisionNumber + 1} 版正式迟交。提交后不能覆盖此版本。`
                : `将工作草稿 ${workingCopy.version} 固定为第 ${latestRevisionNumber + 1} 版正式修订。提交后不能覆盖此版本。`
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
            <p className={styles.commitHint}>至少保存一段可见文字后才能正式提交。</p>
          ) : null}
        </div>
      ) : null}
      <ActionNotice state={submitState} />
    </section>
  );
}
