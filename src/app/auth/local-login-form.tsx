"use client";

import { useActionState, type ReactNode } from "react";
import { ArrowRightIcon, CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  adminLoginAction,
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
          : "登录失败";
}

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
    <form action={formAction}>
      <FieldGroup>
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
        {state.error ? (
          <Alert role="alert" variant="destructive">
            <CircleAlertIcon />
            <AlertDescription>{errorMessage(state.error)}</AlertDescription>
          </Alert>
        ) : null}
        <Field>
          <Button disabled={pending} type="submit">
            {pending ? "正在确认…" : "进入工作台"}
            {pending ? null : <ArrowRightIcon />}
          </Button>
          {children}
        </Field>
      </FieldGroup>
    </form>
  );
}
