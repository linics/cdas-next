"use client";

import { useActionState } from "react";
import {
  changeStudentPasswordAction,
  changeTeacherPasswordAction,
  type PasswordActionState,
} from "./password-change-actions";
import { ArrowRightIcon, CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AccessGateLayout } from "../_components/access-gate-layout";

export function PasswordChangeForm({ role, actorName }: { role: "teacher" | "student"; actorName: string }) {
  const action = role === "teacher"
    ? changeTeacherPasswordAction
    : changeStudentPasswordAction;
  const [state, formAction, pending] = useActionState<PasswordActionState, FormData>(
    action,
    {},
  );
  return (
    <AccessGateLayout
      eyebrow={`当前账号 · ${actorName}`}
      pitchBody="完成设置后，即可进入你的工作台。这个初始密码不会继续保留。"
      pitchTitle="先设置一份只属于你的新密码"
      steps={["设置新密码", "进入工作台"]}
      title="请先设置新密码"
      workspace={`${role === "teacher" ? "教师" : "学生"} · 首次登录`}
    >
      <form action={formAction}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="new-password">新密码</FieldLabel>
            <Input id="new-password" name="password" type="password" autoComplete="new-password" required />
          </Field>
          <Field>
            <FieldLabel htmlFor="password-confirmation">确认密码</FieldLabel>
            <Input id="password-confirmation" name="confirmation" type="password" autoComplete="new-password" required />
          </Field>
          {state.error ? (
            <Alert role="alert" variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}
          <Button disabled={pending} type="submit">
            {pending ? "正在保存…" : "保存新密码"}
            {pending ? null : <ArrowRightIcon />}
          </Button>
        </FieldGroup>
      </form>
    </AccessGateLayout>
  );
}
