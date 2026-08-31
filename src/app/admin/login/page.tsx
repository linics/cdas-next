import { LocalLoginForm } from "../../auth/local-login-form";
import { loginAdminAction } from "../../auth/local-login-actions";

export default function AdminLoginPage() {
  return <LocalLoginForm action={loginAdminAction} fields={[{ name: "username", label: "管理员用户名", autoCapitalize: "none", autoComplete: "username", maxLength: 64 }, { name: "password", label: "管理员密码", autoComplete: "current-password", maxLength: 256 }]} title="登录平台管理端" />;
}
