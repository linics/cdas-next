"use client";

import { useActionState, type ReactNode } from "react";
import {
  adminLoginAction,
  studentLoginAction,
  teacherLoginAction,
  type LoginActionState,
} from "./local-login-actions";
import styles from "./local-login-form.module.css";

export function LocalLoginForm({
  role,
  children,
  error,
}: {
  role: "ADMIN" | "TEACHER" | "STUDENT";
  children?: ReactNode;
  error?: string;
}) {
  const isAdmin = role === "ADMIN";
  const action = role === "ADMIN"
    ? adminLoginAction
    : role === "TEACHER"
      ? teacherLoginAction
      : studentLoginAction;
  const [state, formAction, pending] = useActionState<LoginActionState, FormData>(
    action,
    { error, schoolCode: "", account: "" },
  );
  return (
    <form action={formAction} className={styles.form}>
      {!isAdmin ? (
        <label className={styles.field} htmlFor="login-school">
          <span>学校代码</span>
          <input id="login-school" name="schoolCode" autoComplete="organization" defaultValue={state.schoolCode} required />
        </label>
      ) : null}
      <label className={styles.field} htmlFor="login-account">
        <span>{isAdmin ? "用户名" : role === "TEACHER" ? "工号" : "学号"}</span>
        <input id="login-account" name="identifier" autoComplete="username" defaultValue={state.account} required />
      </label>
      <label className={styles.field} htmlFor="login-password">
        <span>密码</span>
        <input id="login-password" name="password" type="password" autoComplete="current-password" required />
      </label>
      {state.error ? (
        <p className={styles.error} role="alert">
          {state.error === "INVALID_CREDENTIALS"
            ? "账号信息或密码不正确"
            : state.error === "ACCOUNT_LOCKED"
              ? "账号已锁定，请稍后再试"
              : state.error === "ACCOUNT_DISABLED"
                ? "账号已停用"
                : state.error === "SCHOOL_DISABLED"
                  ? "学校已停用"
                  : "登录失败"}
        </p>
      ) : null}
      <button className={styles.submit} disabled={pending} type="submit">
        {pending ? "正在确认…" : "进入工作台"}
        <span aria-hidden="true">→</span>
      </button>
      {children}
    </form>
  );
}
