"use client";

import { useActionState } from "react";
import {
  createClassroomAction,
  type CreateClassroomActionState,
} from "./actions";
import styles from "../../teacher-workspace.module.css";

// A "use server" module may only export async functions, so the idle state
// lives with the form that owns it.
const idleState: CreateClassroomActionState = { name: "" };

export function ClassroomForm() {
  const [state, formAction, pending] = useActionState(
    createClassroomAction,
    idleState,
  );
  return (
    <form action={formAction} className={styles.classroomSetupForm}>
      <div className={styles.classroomSetupField}>
        <label htmlFor="classroom-name">班级名称</label>
        <p id="classroom-name-help">创建后可继续导入学生名单或按名单码加入既有学生。</p>
        <input
          aria-describedby="classroom-name-help"
          defaultValue={state.name}
          id="classroom-name"
          maxLength={120}
          name="name"
          placeholder="例如：八年级（3）班"
          required
        />
      </div>
      {state.error ? <p className={styles.formError} role="alert">{state.error}</p> : null}
      <div className={styles.classroomSetupActions}>
        <button className={styles.primaryButton} disabled={pending} type="submit">
          {pending ? "创建中…" : "创建班级"}
        </button>
        <p>创建班级不会修改任何现有学生、班级或发布记录。</p>
      </div>
    </form>
  );
}
