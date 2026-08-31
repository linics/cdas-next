"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { disciplineCatalog } from "../../../domain/activity/activity-content";
import { ConfirmDialog, InlineAlert, StatusBadge } from "../../_components/ui";
import type { AdminTeacherListItem } from "../../../server/queries/admin-dashboard";
import { initialAdminActionState, type AdminActionState } from "../action-state";
import {
  resetTeacherPasswordAction,
  setTeacherAccountStatusAction,
} from "../actions";
import styles from "../admin.module.css";

function disciplineName(code: string | null): string {
  if (!code) return "历史资料待补充";
  return disciplineCatalog.find((discipline) => discipline.code === code)?.label ?? code;
}

function useOperationKey(prefix: string): [string, () => void] {
  const instanceId = useId().replace(/:/gu, "");
  const [attempt, setAttempt] = useState(0);
  return [`${prefix}_${instanceId}_${attempt}`, useCallback(() => setAttempt((value) => value + 1), [])];
}

function RotateKeyAfterSuccess({ state, rotate }: { state: AdminActionState; rotate: () => void }) {
  const handled = useRef<AdminActionState | null>(null);
  useEffect(() => {
    if (state.status === "success" && handled.current !== state) { handled.current = state; rotate(); }
  }, [state, rotate]);
  return null;
}

function RotateKeyAfterRetryableFailure({ state, rotate }: { state: AdminActionState; rotate: () => void }) {
  const handled = useRef<AdminActionState | null>(null);
  useEffect(() => {
    if (state.status === "error" && state.canRetry && handled.current !== state) { handled.current = state; rotate(); }
  }, [state, rotate]);
  return null;
}

function ActionResult({ state }: { state: AdminActionState }) {
  if (state.status === "idle") return null;
  return (
    <div className={styles.actionResult}>
      <InlineAlert tone={state.status === "success" ? "success" : state.status === "validation_error" ? "warning" : "danger"}>{state.message}</InlineAlert>
      {state.oneTimeValue ? <div className={styles.secretResult}><p>{state.oneTimeLabel}</p><code>{state.oneTimeValue}</code></div> : null}
    </div>
  );
}

function TeacherStatusForm({ teacher }: { teacher: AdminTeacherListItem }) {
  const desired = teacher.accountStatus === "ACTIVE" ? "DISABLED" : "ACTIVE";
  const [key, rotate] = useOperationKey(`teacher_status_${teacher.id}`);
  const [state, formAction, pending] = useActionState(setTeacherAccountStatusAction, initialAdminActionState);
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <>
      <form action={formAction} ref={formRef}>
        <input name="teacherId" type="hidden" value={teacher.id} /><input name="accountStatus" type="hidden" value={desired} /><input name="idempotencyKey" type="hidden" value={key} />
        <button className={desired === "DISABLED" ? styles.dangerButton : styles.primaryButton} disabled={pending} onClick={() => setOpen(true)} type="button">{desired === "DISABLED" ? "停用教师" : "启用教师"}</button>
        <ConfirmDialog
          confirmLabel={desired === "DISABLED" ? "确认停用" : "确认启用"}
          detail={desired === "DISABLED" ? "停用后，该教师不能进入教师工作区；其历史任务与评价不会删除。" : "启用后，如所属学校也已启用，该教师可以恢复进入教师工作区。"}
          disabled={pending}
          onCancel={() => setOpen(false)}
          onConfirm={() => { setOpen(false); formRef.current?.requestSubmit(); }}
          open={open}
          pending={pending}
          title={desired === "DISABLED" ? `停用「${teacher.displayName}」？` : `启用「${teacher.displayName}」？`}
          tone={desired === "DISABLED" ? "danger" : "primary"}
        />
      </form>
      <RotateKeyAfterSuccess rotate={rotate} state={state} /><ActionResult state={state} />
    </>
  );
}

function TeacherPasswordResetForm({ teacher }: { teacher: AdminTeacherListItem }) {
  const [key, rotate] = useOperationKey(`teacher_password_${teacher.id}`);
  const [state, formAction, pending] = useActionState(resetTeacherPasswordAction, initialAdminActionState);
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <>
      <form action={formAction} ref={formRef}>
        <input name="teacherId" type="hidden" value={teacher.id} /><input name="idempotencyKey" type="hidden" value={key} />
        <button className={styles.secondaryButton} disabled={pending} onClick={() => setOpen(true)} type="button">重置一次性密码</button>
        <ConfirmDialog
          confirmLabel="确认重置密码"
          detail="系统会撤销该教师的旧会话，并仅在本次确认结果中显示新的临时密码一次。"
          disabled={pending}
          onCancel={() => setOpen(false)}
          onConfirm={() => { setOpen(false); formRef.current?.requestSubmit(); }}
          open={open}
          pending={pending}
          title={`重置「${teacher.displayName}」的密码？`}
          tone="danger"
        />
      </form>
      <RotateKeyAfterSuccess rotate={rotate} state={state} /><RotateKeyAfterRetryableFailure rotate={rotate} state={state} /><ActionResult state={state} />
    </>
  );
}

export function TeacherManager({ teachers }: { teachers: readonly AdminTeacherListItem[] }) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}><h2>教师账号</h2></header>
      <div className={styles.recordList}>
        {teachers.length === 0 ? <p className={styles.empty}>当前没有教师账号。</p> : teachers.map((teacher) => (
          <article className={styles.recordCard} key={teacher.id}>
            <div className={styles.recordHead}>
              <div><h3>{teacher.displayName}</h3><div className={styles.recordMeta}><span>{teacher.school.name} · <code>{teacher.school.code}</code></span><span>工号：{teacher.staffNo ?? "历史资料待补充"}</span><span>主学科：{disciplineName(teacher.primaryDisciplineCode)}</span>{teacher.secondaryDisciplineCodes.length > 0 ? <span>兼教学科：{teacher.secondaryDisciplineCodes.map((code) => disciplineName(code)).join("、")}</span> : null}</div></div>
              <StatusBadge tone={teacher.accountStatus === "ACTIVE" ? "success" : "danger"}>{teacher.accountStatus === "ACTIVE" ? "账号启用" : "账号停用"}</StatusBadge>
            </div>
            <div className={styles.recordActions}><TeacherStatusForm teacher={teacher} /><TeacherPasswordResetForm teacher={teacher} /></div>
          </article>
        ))}
      </div>
    </section>
  );
}
