"use client";

import { useActionState } from "react";
import {
  changeStudentPasswordAction,
  changeTeacherPasswordAction,
  type PasswordActionState,
} from "./password-change-actions";
import styles from "../_components/access-gate.module.css";

export function PasswordChangeForm({ role, actorName }: { role: "teacher" | "student"; actorName: string }) {
  const action = role === "teacher"
    ? changeTeacherPasswordAction
    : changeStudentPasswordAction;
  const [state, formAction, pending] = useActionState<PasswordActionState, FormData>(
    action,
    {},
  );
  return (
    <main className={styles.accessGate}>
      <p className={styles.eyebrow}>
        {role === "teacher" ? "教师" : "学生"} · 首次登录
      </p>
      <h1>请先设置新密码</h1>
      <p>当前账号：{actorName}</p>
      <form action={formAction} className={styles.accessGate}>
        <label htmlFor="new-password">
          新密码
          <input id="new-password" name="password" type="password" autoComplete="new-password" required />
        </label>
        <label htmlFor="password-confirmation">
          确认密码
          <input id="password-confirmation" name="confirmation" type="password" autoComplete="new-password" required />
        </label>
        {state.error ? <p role="alert">{state.error}</p> : null}
        <button className={styles.primaryButton} disabled={pending} type="submit">
          {pending ? "保存中…" : "保存新密码"}
        </button>
      </form>
    </main>
  );
}
