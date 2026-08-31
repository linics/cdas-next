import Link from "next/link";
import type { ReactNode } from "react";
import type { AuthenticationError } from "../../../server/auth/current-actor";
import { InlineAlert } from "../../_components/ui";
import {
  WorkspaceShell,
  type WorkspaceCrumb,
} from "../../_components/workspace-shell";
import gateStyles from "../../_components/access-gate.module.css";

const teacherNavigation = [
  { href: "/teacher", label: "工作台" },
  { href: "/teacher/activities", label: "活动设计" },
  { href: "/teacher/classrooms", label: "我的班级" },
  { href: "/teacher/insights", label: "过程诊断" },
  { href: "/teacher/knowledge", label: "课程依据" },
  { href: "/teacher/profile", label: "我的资料" },
] as const;

export const teacherHomeCrumb = {
  href: "/teacher",
  label: "教师工作台",
} as const satisfies WorkspaceCrumb;

export const activityStudioCrumb = {
  href: "/teacher/activities",
  label: "活动设计",
} as const satisfies WorkspaceCrumb;

export function TeacherPage({
  actorName,
  breadcrumb,
  fillViewport = false,
  children,
}: {
  actorName?: string;
  breadcrumb?: readonly WorkspaceCrumb[];
  fillViewport?: boolean;
  children: ReactNode;
}) {
  return (
    <WorkspaceShell
      audience="教师"
      actorName={actorName}
      breadcrumb={breadcrumb}
      navigation={teacherNavigation}
      fillViewport={fillViewport}
    >
      {children}
    </WorkspaceShell>
  );
}

export function TeacherAccessGate({
  code,
  returnPath: _returnPath,
}: {
  code: AuthenticationError["code"];
  returnPath: string;
}) {
  // Kept for callers that preserve the requested route in their access state.
  void _returnPath;
  const copy =
    code === "ACCOUNT_DISABLED"
        ? {
            title: "当前账号暂不能进入教师工作台",
            detail: "请联系平台管理员重新启用账号。",
          }
        : code === "SCHOOL_DISABLED"
          ? {
              title: "当前学校暂不能进入业务工作区",
              detail: "请联系平台管理员确认学校状态。",
            }
      : {
            title: "登录教师账号",
            detail: "使用学校代码、工号和密码继续。",
          };

  return (
    <div className={gateStyles.gate}>
      <main className={gateStyles.accessGate}>
        <div>
          <h2>{copy.title}</h2>
        </div>
        <InlineAlert tone="info">{copy.detail}</InlineAlert>
        <div className={gateStyles.actions}>
          {code === "UNAUTHENTICATED" ? <><Link className={gateStyles.primaryButton} href="/teacher/login">使用学校代码登录</Link><Link className={gateStyles.secondaryButton} href="/teacher/register">使用邀请码开通教师账号</Link></> : null}
          <Link className={gateStyles.backLink} href="/">返回首页</Link>
        </div>
      </main>
    </div>
  );
}
