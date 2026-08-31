"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  idleRegisterTeacherState,
  registerTeacherAction,
} from "./actions";
import styles from "../../_components/access-gate.module.css";

export default function TeacherRegisterPage() {
  const [state, formAction, pending] = useActionState(
    registerTeacherAction,
    idleRegisterTeacherState,
  );
  return (
    <main className={styles.accessGate}>
      <p className={styles.eyebrow}>教师账号开通</p>
      <h1>使用学校邀请码开通</h1>
      <form action={formAction} className={styles.accessGate}>
        <label htmlFor="register-school">学校代码</label>
        <input id="register-school" name="schoolCode" autoComplete="organization" defaultValue={state.schoolCode} required />
        <label htmlFor="register-invite">学校邀请码</label>
        <input id="register-invite" name="inviteCode" autoComplete="one-time-code" required />
        <label htmlFor="register-staff">工号</label>
        <input id="register-staff" name="staffNo" autoComplete="username" defaultValue={state.staffNo} required />
        <label htmlFor="register-name">显示名称</label>
        <input id="register-name" name="displayName" defaultValue={state.displayName} required />
        <label htmlFor="register-password">密码</label>
        <input id="register-password" name="password" type="password" autoComplete="new-password" required />
        {state.error ? <p role="alert">{state.error}</p> : null}
        <button className={styles.primaryButton} disabled={pending} type="submit">
          {pending ? "开通中…" : "开通账号"}
        </button>
      </form>
      <Link className={styles.backLink} href="/teacher/login">返回登录</Link>
    </main>
  );
}
