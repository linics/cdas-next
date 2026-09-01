"use client";

import { useActionState, type ReactNode } from "react";
import {
  adminLoginAction,
  studentLoginAction,
  teacherLoginAction,
  type LoginActionState,
} from "./local-login-actions";
import styles from "../_components/access-gate.module.css";

export function LocalLoginForm({
  role,
  children,
  error,
}: {
  role: "ADMIN" | "TEACHER" | "STUDENT";
  children: ReactNode;
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
    <form action={formAction} className={styles.accessGate}>
      {children}
      {!isAdmin ? <label htmlFor="login-school">学校代码<input id="login-school" name="schoolCode" autoComplete="organization" defaultValue={state.schoolCode} required /></label> : null}
      <label htmlFor="login-account">{isAdmin ? "用户名" : role === "TEACHER" ? "工号" : "学号"}
        <input id="login-account" name="identifier" autoComplete="username" defaultValue={state.account} required />
      </label>
      <label htmlFor="login-password">密码<input id="login-password" name="password" type="password" autoComplete="current-password" required /></label>
      {state.error ? (
        <p role="alert">
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
      <button className={styles.primaryButton} disabled={pending} type="submit">
        {pending ? "登录中…" : "登录"}
      </button>
    </form>
  );
}
