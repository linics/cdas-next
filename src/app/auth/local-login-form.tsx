"use client";

import { useActionState, type ReactNode } from "react";
import {
  adminLoginAction,
  developmentQuickAdminLoginAction,
  developmentQuickStudentLoginAction,
  developmentQuickTeacherLoginAction,
  studentLoginAction,
  teacherLoginAction,
  type LoginActionState,
} from "./local-login-actions";
import styles from "./local-login-form.module.css";

export function LocalLoginForm({
  role,
  children,
  error,
  quickLogin = false,
}: {
  role: "ADMIN" | "TEACHER" | "STUDENT";
  children?: ReactNode;
  error?: string;
  quickLogin?: boolean;
}) {
  const isAdmin = role === "ADMIN";
  const passwordAction = role === "ADMIN"
    ? adminLoginAction
    : role === "TEACHER"
      ? teacherLoginAction
      : studentLoginAction;
  const quickAction = role === "ADMIN"
    ? developmentQuickAdminLoginAction
    : role === "TEACHER"
      ? developmentQuickTeacherLoginAction
      : developmentQuickStudentLoginAction;
  const action = quickLogin ? quickAction : passwordAction;
  const [state, formAction, pending] = useActionState<LoginActionState, FormData>(
    action,
    { error, schoolCode: "", account: "" },
  );
  return (
    <form action={formAction} className={styles.form}>
      {quickLogin ? (
        <p className={styles.quickLoginNote}>
          本地开发模式会使用默认{role === "TEACHER" ? "教师" : role === "STUDENT" ? "学生" : "管理员"}账号；生产与测试环境仍需密码登录。
        </p>
      ) : !isAdmin ? (
        <label className={styles.field} htmlFor="login-school">
          <span>学校代码</span>
          <input id="login-school" name="schoolCode" autoComplete="organization" defaultValue={state.schoolCode} required />
        </label>
      ) : null}
      {!quickLogin ? <label className={styles.field} htmlFor="login-account">
        <span>{isAdmin ? "用户名" : role === "TEACHER" ? "工号" : "学号"}</span>
        <input id="login-account" name="identifier" autoComplete="username" defaultValue={state.account} required />
      </label> : null}
      {!quickLogin ? <label className={styles.field} htmlFor="login-password">
        <span>密码</span>
        <input id="login-password" name="password" type="password" autoComplete="current-password" required />
      </label> : null}
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
              : state.error}
        </p>
      ) : null}
      <button className={styles.submit} disabled={pending} type="submit">
        {pending ? "正在确认…" : quickLogin ? "使用默认账号进入" : "进入工作台"}
        <span aria-hidden="true">→</span>
      </button>
      {children}
    </form>
  );
}
