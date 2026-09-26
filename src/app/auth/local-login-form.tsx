"use client";

import { useActionState, type ReactNode } from "react";
import { ArrowRightIcon, CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  adminLoginAction,
  developmentQuickAdminLoginAction,
  developmentQuickStudentLoginAction,
  developmentQuickTeacherLoginAction,
  studentLoginAction,
  teacherLoginAction,
  type LoginActionState,
} from "./local-login-actions";

function errorMessage(code: string) {
  return code === "INVALID_CREDENTIALS"
    ? "账号信息或密码不正确"
    : code === "ACCOUNT_LOCKED"
      ? "账号已锁定，请稍后再试"
      : code === "ACCOUNT_DISABLED"
        ? "账号已停用"
        : code === "SCHOOL_DISABLED"
          ? "学校已停用"
          : code;
}

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
    <form action={formAction}>
      <FieldGroup>
        {quickLogin ? (
          <p className="rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-sm leading-relaxed text-muted-foreground">
            本地开发模式会使用默认{role === "TEACHER" ? "教师" : role === "STUDENT" ? "学生" : "管理员"}账号；生产与测试环境仍需密码登录。
          </p>
        ) : (
          <>
            {!isAdmin ? (
              <Field>
                <FieldLabel htmlFor="login-school">学校代码</FieldLabel>
                <Input
                  autoComplete="organization"
                  defaultValue={state.schoolCode}
                  id="login-school"
                  name="schoolCode"
                  required
                />
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor="login-account">
                {isAdmin ? "用户名" : role === "TEACHER" ? "工号" : "学号"}
              </FieldLabel>
              <Input
                autoComplete="username"
                defaultValue={state.account}
                id="login-account"
                name="identifier"
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="login-password">密码</FieldLabel>
              <Input
                autoComplete="current-password"
                id="login-password"
                name="password"
                required
                type="password"
              />
            </Field>
          </>
        )}
        {state.error ? (
          <Alert role="alert" variant="destructive">
            <CircleAlertIcon />
            <AlertDescription>{errorMessage(state.error)}</AlertDescription>
          </Alert>
        ) : null}
        <Field>
          <Button disabled={pending} type="submit">
            {pending ? "正在确认…" : quickLogin ? "使用默认账号进入" : "进入工作台"}
            {pending ? null : <ArrowRightIcon />}
          </Button>
          {children}
        </Field>
      </FieldGroup>
    </form>
  );
}
