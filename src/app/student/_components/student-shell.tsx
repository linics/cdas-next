import Link from "next/link";
import type { AuthenticationError } from "../../../server/auth/current-actor";
import { isDevelopmentQuickLoginEnabled } from "../../../server/auth/development-quick-login";
import { LocalLoginForm } from "../../auth/local-login-form";
import { Button } from "@/components/ui/button";
import { AccessGateLayout } from "../../_components/access-gate-layout";

export function StudentAccessGate({
  code,
  returnPath,
}: {
  code: AuthenticationError["code"];
  returnPath: string;
}) {
  void returnPath;
  const copy =
    code === "AUTH_NOT_CONFIGURED"
      ? {
          eyebrow: "登录服务未设置",
          title: "学生工作台当前没有开放",
        }
      : code === "ACCOUNT_DISABLED" || code === "SCHOOL_DISABLED"
        ? {
            eyebrow: "账号或学校已停用",
            title: "学生工作台当前不能进入",
          }
        : code === "USER_NOT_PROVISIONED"
        ? {
            eyebrow: "学生账号尚未创建",
            title: "找不到对应的学生身份",
          }
        : {
            eyebrow: "需要登录",
            title: "先确认学生身份",
          };

  return (
    <AccessGateLayout
      eyebrow={copy.eyebrow}
      pitchBody="这里只显示发布给你所在班级的活动。每次正式提交都会保留版本，收到教师反馈后可以继续修改或推进。"
      pitchTitle="查看活动、提交证据、获得教师反馈"
      steps={["查看活动", "提交证据", "阅读反馈", "按需重交"]}
      title={copy.title}
      workspace="学生工作台"
    >
      {code === "UNAUTHENTICATED" || code === "USER_NOT_PROVISIONED" ? (
        <LocalLoginForm role="STUDENT" quickLogin={isDevelopmentQuickLoginEnabled()} />
      ) : code === "PASSWORD_CHANGE_REQUIRED" ? (
        <Button asChild>
          <Link href="/student/password">修改密码后继续</Link>
        </Button>
      ) : null}
    </AccessGateLayout>
  );
}
