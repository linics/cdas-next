"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  registerTeacherAction,
  type RegisterTeacherActionState,
} from "./actions";
import { ArrowRightIcon, CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AccessGateLayout } from "../../_components/access-gate-layout";

// A "use server" module may only export async functions, so the idle state
// lives with the form that owns it.
const idleState: RegisterTeacherActionState = {
  schoolCode: "",
  staffNo: "",
  displayName: "",
};

export default function TeacherRegisterPage() {
  const [state, formAction, pending] = useActionState(
    registerTeacherAction,
    idleState,
  );
  return (
    <AccessGateLayout
      eyebrow="教师账号开通"
      pitchBody="填写学校提供的邀请码与身份信息。开通完成后，可以直接进入活动设计与班级管理。"
      pitchTitle="用邀请码建立你的教师工作台"
      steps={["确认学校", "验证邀请", "开始设计"]}
      title="使用学校邀请码开通"
      workspace="教师账号开通"
    >
      <form action={formAction}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="register-school">学校代码</FieldLabel>
            <Input id="register-school" name="schoolCode" autoComplete="organization" defaultValue={state.schoolCode} required />
          </Field>
          <Field>
            <FieldLabel htmlFor="register-invite">学校邀请码</FieldLabel>
            <Input id="register-invite" name="inviteCode" autoComplete="one-time-code" required />
          </Field>
          <Field>
            <FieldLabel htmlFor="register-staff">工号</FieldLabel>
            <Input id="register-staff" name="staffNo" autoComplete="username" defaultValue={state.staffNo} required />
          </Field>
          <Field>
            <FieldLabel htmlFor="register-name">显示名称</FieldLabel>
            <Input id="register-name" name="displayName" defaultValue={state.displayName} required />
          </Field>
          <Field>
            <FieldLabel htmlFor="register-password">密码</FieldLabel>
            <Input id="register-password" name="password" type="password" autoComplete="new-password" required />
          </Field>
          {state.error ? (
            <Alert role="alert" variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}
          <Field>
            <Button disabled={pending} type="submit">
              {pending ? "正在开通…" : "开通账号"}
              {pending ? null : <ArrowRightIcon />}
            </Button>
            <Button asChild variant="link">
              <Link href="/teacher">返回教师工作台</Link>
            </Button>
          </Field>
        </FieldGroup>
      </form>
    </AccessGateLayout>
  );
}
