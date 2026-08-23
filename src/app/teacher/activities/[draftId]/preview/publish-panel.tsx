"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { LocalizedDateTime } from "../../../../_components/localized-date-time";
import { ConfirmDialog, InlineAlert } from "../../../../_components/ui";
import type { TeacherActivityPreview } from "../../../../../server/queries/teacher-activity-workspace";
import styles from "../../../teacher-workspace.module.css";
import {
  decidePublishActivityAction,
  preparePublishActivityAction,
} from "./actions";
import {
  initialPublishDecisionState,
  type PublishPreparationState,
} from "./publish-action-state";
import { localDateTimeToIsoInstant } from "./local-date-time-input";

export function PublishPanel({
  workspace,
  initialPreparationState,
}: {
  workspace: TeacherActivityPreview;
  initialPreparationState: PublishPreparationState;
}) {
  const [preparationState, prepareAction, preparePending] = useActionState(
    preparePublishActivityAction,
    initialPreparationState,
  );
  const [decisionState, decideAction, decisionPending] = useActionState(
    decidePublishActivityAction,
    initialPublishDecisionState,
  );
  const [localDateTimeInput, setLocalDateTimeInput] = useState("");
  const [dismissedConfirmationId, setDismissedConfirmationId] = useState<string | null>(null);
  const publishFormRef = useRef<HTMLFormElement>(null);
  const dueAtInstant = localDateTimeToIsoInstant(localDateTimeInput);
  const confirmation = preparationState.confirmation;
  const canPrepare =
    workspace.draft.status === "READY_FOR_PREVIEW" &&
    workspace.classrooms.length > 0 &&
    dueAtInstant !== null;

  const isConfirmDialogOpen = Boolean(confirmation) && dismissedConfirmationId !== confirmation?.actionIntentId;

  return (
    <>
      <aside className={styles.publishRail} aria-label="发布参数">
        <p className={styles.eyebrow}>发布参数</p>
        <h2>选择班级与期限</h2>
        <p>
          准备动作只会固定精确版本与参数；活动仍需在独立确认面板中由教师确认。
        </p>

        {workspace.classrooms.length === 0 ? (
          <p className={styles.configurationNote} role="note">
            当前没有由你管理的班级。班级必须先由系统预先配置，这里不提供无效的新增按钮。
          </p>
        ) : workspace.draft.status !== "READY_FOR_PREVIEW" ? (
          <p className={styles.configurationNote} role="note">
            {workspace.draft.status === "SEALED"
              ? "这份草稿已封存，不能再次准备发布。"
              : "请先回到编辑页，将精确版本保存为「可预览」。"}
          </p>
        ) : (
          <form className={styles.parameterForm} action={prepareAction}>
            <input
              type="hidden"
              name="draftId"
              value={workspace.draft.id}
            />
            <input
              type="hidden"
              name="expectedDraftVersion"
              value={workspace.draft.version}
            />
            <input
              type="hidden"
              name="idempotencyKey"
              value={preparationState.nextPrepareIdempotencyKey}
            />
            <input type="hidden" name="dueAt" value={dueAtInstant ?? ""} />
            <label>
              发布班级
              <select
                name="classroomId"
                defaultValue={preparationState.selectedClassroomId}
                required
              >
                {workspace.classrooms.map((classroom) => (
                  <option value={classroom.id} key={classroom.id}>
                    {classroom.name} · {classroom.currentMemberCount} 名当前成员
                  </option>
                ))}
              </select>
            </label>
            <label>
              截止时间（依当前装置时区，可不填）
              <input
                type="datetime-local"
                value={localDateTimeInput}
                onChange={(event) => setLocalDateTimeInput(event.target.value)}
                aria-invalid={dueAtInstant === null}
              />
              <small>
                提交时会转成固定时间点。超过截止时间但活动仍为开放状态时，学生可迟交并保留迟交标记。
              </small>
            </label>
            <button
              className={styles.primaryButton}
              type="submit"
              disabled={preparePending || !canPrepare}
            >
              {preparePending ? "正在准备…" : "准备精确发布确认"}
            </button>
          </form>
        )}

        {preparationState.status !== "idle" ? <InlineAlert tone={preparationState.status === "prepared" ? "success" : "danger"}>{preparationState.message}</InlineAlert> : null}
        {confirmation ? <button className={styles.secondaryButton} onClick={() => setDismissedConfirmationId(null)} type="button">查看发布确认</button> : null}
      </aside>

      {confirmation ? (
        <>
          <form action={decideAction} ref={publishFormRef} className={styles.visuallyHidden}>
            <input type="hidden" name="actionIntentId" value={confirmation.actionIntentId} />
            <input type="hidden" name="idempotencyKey" value={confirmation.publishIdempotencyKey} />
            <input type="hidden" name="decision" value="CONFIRM" />
          </form>
          <ConfirmDialog
            open={isConfirmDialogOpen}
            title="确认发布活动"
            detail={<div className={styles.dialogDetail}><p>将草稿版本 {confirmation.draftVersion} 发布给 {confirmation.classroom.name}。发布后内容不可原位修改。</p><dl><div><dt>截止时间</dt><dd>{confirmation.dueAt ? <LocalizedDateTime dateTime={confirmation.dueAt} /> : "未设置"}</dd></div><div><dt>确认有效至</dt><dd><LocalizedDateTime dateTime={confirmation.expiresAt} includeSeconds /></dd></div></dl><p>参数摘要：<code>{confirmation.payloadHash}</code></p></div>}
            confirmLabel="确认并发布"
            pending={decisionPending}
            onCancel={() => setDismissedConfirmationId(confirmation.actionIntentId)}
            onConfirm={() => {
              setDismissedConfirmationId(confirmation.actionIntentId);
              publishFormRef.current?.requestSubmit();
            }}
          />
          {decisionState.status !== "idle" ? <InlineAlert tone={decisionState.status === "published" ? "success" : "danger"}>{decisionState.message}</InlineAlert> : null}
          {decisionState.status === "published" && decisionState.releaseId ? <Link className={styles.primaryLink} href={`/teacher/releases/${decisionState.releaseId}/submissions`}>查看发布与学生提交</Link> : null}
        </>
      ) : null}
    </>
  );
}
