"use client";

import { useActionState } from "react";
import { InlineAlert } from "../../_components/ui";
import { changeTeacherPasswordAction } from "./actions";
import { initialChangePasswordState } from "./state";
import styles from "../teacher-identity.module.css";

export default function TeacherPasswordPage() {
  const [state, action, pending] = useActionState(changeTeacherPasswordAction, initialChangePasswordState);
  return <main className={styles.loginShell}><section className={styles.loginPanel}><h1>设置新的教师密码</h1><p>保存后会撤销当前会话，请使用新密码重新登录。</p><form action={action} className={styles.form}><div className={styles.field}><label htmlFor="new-password">新密码</label><input autoComplete="new-password" id="new-password" minLength={10} name="password" required type="password" /></div><div className={styles.field}><label htmlFor="confirm-password">再次输入新密码</label><input autoComplete="new-password" id="confirm-password" minLength={10} name="confirmation" required type="password" /></div><button className={styles.primaryButton} disabled={pending} type="submit">{pending ? "正在设置…" : "保存新密码并重新登录"}</button></form>{state.status === "error" ? <div className={styles.result}><InlineAlert tone="warning">{state.message}</InlineAlert></div> : null}</section></main>;
}
