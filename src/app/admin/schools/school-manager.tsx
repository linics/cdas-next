"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { ConfirmDialog, InlineAlert, StatusBadge } from "../../_components/ui";
import type { AdminSchoolListItem } from "../../../server/queries/admin-dashboard";
import { initialAdminActionState, type AdminActionState } from "../action-state";
import {
  createSchoolAction,
  resetSchoolTeacherInviteAction,
  setSchoolStatusAction,
  updateSchoolNameAction,
} from "../actions";
import styles from "../admin.module.css";

function useOperationKey(prefix: string): [string, () => void] {
  const instanceId = useId().replace(/:/gu, "");
  const [attempt, setAttempt] = useState(0);
  return [`${prefix}_${instanceId}_${attempt}`, useCallback(() => setAttempt((value) => value + 1), [])];
}

function RotateKeyAfterSuccess({ state, rotate }: { state: AdminActionState; rotate: () => void }) {
  const handled = useRef<AdminActionState | null>(null);
  useEffect(() => {
    if (state.status === "success" && handled.current !== state) {
      handled.current = state;
      rotate();
    }
  }, [state, rotate]);
  return null;
}

function ActionResult({ state }: { state: AdminActionState }) {
  if (state.status === "idle") return null;
  return (
    <div className={styles.actionResult}>
      <InlineAlert tone={state.status === "success" ? "success" : state.status === "validation_error" ? "warning" : "danger"}>
        {state.message}
      </InlineAlert>
      {state.oneTimeValue ? (
        <div className={styles.secretResult}>
          <p>{state.oneTimeLabel}</p>
          <code>{state.oneTimeValue}</code>
        </div>
      ) : null}
    </div>
  );
}

function CreateSchoolForm() {
  const [key, rotate] = useOperationKey("create_school");
  const [state, formAction, pending] = useActionState(createSchoolAction, initialAdminActionState);
  return (
    <>
      <form action={formAction} className={styles.createForm}>
        <input name="idempotencyKey" type="hidden" value={key} />
        <div className={styles.field}>
          <label htmlFor="new-school-name">学校名称</label>
          <input autoComplete="organization" id="new-school-name" maxLength={120} name="name" required />
        </div>
        <button className={styles.primaryButton} disabled={pending} type="submit">{pending ? "正在创建…" : "创建学校"}</button>
      </form>
      <RotateKeyAfterSuccess rotate={rotate} state={state} />
      <ActionResult state={state} />
    </>
  );
}

function SchoolNameForm({ school }: { school: AdminSchoolListItem }) {
  const [key, rotate] = useOperationKey(`rename_${school.id}`);
  const [state, formAction, pending] = useActionState(updateSchoolNameAction, initialAdminActionState);
  return (
    <>
      <form action={formAction} className={styles.nameForm}>
        <input name="schoolId" type="hidden" value={school.id} />
        <input name="idempotencyKey" type="hidden" value={key} />
        <div className={styles.field}>
          <label htmlFor={`school-name-${school.id}`}>学校名称</label>
          <input defaultValue={school.name} id={`school-name-${school.id}`} maxLength={120} name="name" required />
        </div>
        <button className={styles.secondaryButton} disabled={pending} type="submit">保存名称</button>
      </form>
      <RotateKeyAfterSuccess rotate={rotate} state={state} />
      <ActionResult state={state} />
    </>
  );
}

function SchoolStatusForm({ school }: { school: AdminSchoolListItem }) {
  const desired = school.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
  const [key, rotate] = useOperationKey(`school_status_${school.id}`);
  const [state, formAction, pending] = useActionState(setSchoolStatusAction, initialAdminActionState);
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <>
      <form action={formAction} ref={formRef}>
        <input name="schoolId" type="hidden" value={school.id} />
        <input name="status" type="hidden" value={desired} />
        <input name="idempotencyKey" type="hidden" value={key} />
        <button className={desired === "DISABLED" ? styles.dangerButton : styles.primaryButton} disabled={pending} onClick={() => setOpen(true)} type="button">
          {desired === "DISABLED" ? "停用学校" : "启用学校"}
        </button>
        <ConfirmDialog
          confirmLabel={desired === "DISABLED" ? "确认停用" : "确认启用"}
          detail={desired === "DISABLED" ? "停用后，该学校的教师和学生将立即无法进入业务工作区；历史教学记录不会删除。" : "启用后，仍为启用状态的该校账号可以恢复进入业务工作区。"}
          disabled={pending}
          onCancel={() => setOpen(false)}
          onConfirm={() => { setOpen(false); formRef.current?.requestSubmit(); }}
          open={open}
          pending={pending}
          title={desired === "DISABLED" ? `停用「${school.name}」？` : `启用「${school.name}」？`}
          tone={desired === "DISABLED" ? "danger" : "primary"}
        />
      </form>
      <RotateKeyAfterSuccess rotate={rotate} state={state} />
      <ActionResult state={state} />
    </>
  );
}

function ResetInviteForm({ school }: { school: AdminSchoolListItem }) {
  const [key, rotate] = useOperationKey(`reset_invite_${school.id}`);
  const [state, formAction, pending] = useActionState(resetSchoolTeacherInviteAction, initialAdminActionState);
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <>
      <form action={formAction} ref={formRef}>
        <input name="schoolId" type="hidden" value={school.id} />
        <input name="idempotencyKey" type="hidden" value={key} />
        <button className={styles.secondaryButton} disabled={pending} onClick={() => setOpen(true)} type="button">重置教师邀请码</button>
        <ConfirmDialog
          confirmLabel="确认重置"
          detail="旧邀请码会立即失效，新邀请码只在本次结果中显示一次。"
          disabled={pending}
          onCancel={() => setOpen(false)}
          onConfirm={() => { setOpen(false); formRef.current?.requestSubmit(); }}
          open={open}
          pending={pending}
          title={`重置「${school.name}」的邀请码？`}
        />
      </form>
      <RotateKeyAfterSuccess rotate={rotate} state={state} />
      <ActionResult state={state} />
    </>
  );
}

export function SchoolManager({ schools }: { schools: readonly AdminSchoolListItem[] }) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <div><h2>学校目录</h2></div>
        <p>学校代码创建后保持不变</p>
      </header>
      <CreateSchoolForm />
      <div className={styles.recordList}>
        {schools.length === 0 ? <p className={styles.empty}>尚未创建学校。</p> : schools.map((school) => (
          <article className={styles.recordCard} key={school.id}>
            <div className={styles.recordHead}>
              <div>
                <h3>{school.name}</h3>
                <div className={styles.recordMeta}>
                  <span>学校代码：<code>{school.code}</code></span>
                  <span>{school.teacherCount} 名教师</span>
                  <span>{school.studentCount} 名学生</span>
                  <span>{school.classroomCount} 个班级</span>
                </div>
              </div>
              <StatusBadge tone={school.status === "ACTIVE" ? "success" : "danger"}>{school.status === "ACTIVE" ? "已启用" : "已停用"}</StatusBadge>
            </div>
            <SchoolNameForm school={school} />
            <div className={styles.recordActions}>
              <SchoolStatusForm school={school} />
              <ResetInviteForm school={school} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
