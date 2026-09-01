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
    <form action={formAction} className={styles.importDisclosureBody}>
      <label htmlFor="classroom-name">班级名称</label>
      <input
        defaultValue={state.name}
        id="classroom-name"
        maxLength={120}
        name="name"
        placeholder="例如：八年级（3）班"
        required
      />
      {state.error ? <p role="alert">{state.error}</p> : null}
      <button className={styles.primaryButton} disabled={pending} type="submit">
        {pending ? "创建中…" : "创建班级"}
      </button>
    </form>
  );
}
