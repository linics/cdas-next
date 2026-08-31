import { LocalLoginForm } from "../../auth/local-login-form";
import { loginStudentAction } from "../../auth/local-login-actions";

export default function StudentLoginPage() {
  return <LocalLoginForm action={loginStudentAction} fields={[{ name: "schoolCode", label: "学校代码", autoCapitalize: "characters", maxLength: 16 }, { name: "studentNo", label: "学号", inputMode: "numeric", maxLength: 32 }, { name: "password", label: "密码", autoComplete: "current-password", maxLength: 256 }]} title="学生登录" />;
}
