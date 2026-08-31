import Link from "next/link";
import { LocalLoginForm } from "../../auth/local-login-form";
import { loginTeacherAction } from "../../auth/local-login-actions";

export function TeacherLoginForm() {
  return (
    <LocalLoginForm
      action={loginTeacherAction}
      detail="使用学校代码、工号和密码登录。"
      fields={[
        { name: "schoolCode", label: "学校代码", autoCapitalize: "characters", maxLength: 16 },
        { name: "staffNo", label: "工号", autoCapitalize: "characters", maxLength: 32 },
        { name: "password", label: "密码", autoComplete: "current-password", maxLength: 256 },
      ]}
      footer={<Link href="/teacher/register">没有教师账号？使用邀请码开通</Link>}
      title="学校代码 · 工号 · 密码"
      variant="teacher"
    />
  );
}
