import Link from "next/link";
import type { ReactNode } from "react";
import type { AuthenticationError } from "../../../server/auth/current-actor";
import {
  WorkspaceShell,
  type WorkspaceCrumb,
} from "../../_components/workspace-shell";
import { LocalLoginForm } from "../../auth/local-login-form";
import gateStyles from "../../_components/access-gate.module.css";
import { isDevelopmentQuickLoginEnabled } from "../../../server/auth/development-quick-login";

const teacherNavigation = [
  { href: "/teacher", label: "工作台" },
  { href: "/teacher/activities", label: "活动设计" },
  { href: "/teacher/insights", label: "过程诊断" },
  { href: "/teacher/knowledge", label: "课程依据" },
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
          title: "教师工作台当前没有开放",
        }
      : code === "ACCOUNT_DISABLED" || code === "SCHOOL_DISABLED"
        ? {
            eyebrow: "账号或学校已停用",
            title: "教师工作台当前不能进入",
          }
        : code === "USER_NOT_PROVISIONED"
        ? {
            eyebrow: "教师账号尚未创建",
            title: "找不到对应的工作台身份",
          }
        : {
            eyebrow: "需要登录",
            title: "先确认教师身份",
          };

  return (
    <div className={gateStyles.gate}>
      <section className={gateStyles.gateAside}>
        <Link
          className={gateStyles.brand}
          href="/"
          aria-label="返回 CDAS Next 首页"
        >
          <strong>CDAS</strong>
          <small>跨学科学习活动</small>
        </Link>
        <div className={gateStyles.pitch}>
          <p className={gateStyles.eyebrow}>教师工作台</p>
          <h1>设计一次活动，走完一整条反馈闭环</h1>
          <p>
            从任务书草稿到确认发布，从学生的阶段证据到反馈与量规评价，每一步留存版本记录。
          </p>
        </div>
        <ol className={gateStyles.steps}>
          <li>
            <span>01</span>设计任务书
          </li>
          <li>
            <span>02</span>确认发布
          </li>
          <li>
            <span>03</span>学生提交证据
          </li>
          <li>
            <span>04</span>反馈与评价
          </li>
        </ol>
      </section>
      <main className={gateStyles.accessGate}>
        <div>
          <p className={gateStyles.eyebrow}>{copy.eyebrow}</p>
          <h2>{copy.title}</h2>
        </div>
        {code === "UNAUTHENTICATED" || code === "USER_NOT_PROVISIONED" ? (
          <LocalLoginForm role="TEACHER" quickLogin={isDevelopmentQuickLoginEnabled()}>
            <Link className={gateStyles.backLink} href="/teacher/register">
              使用邀请码开通教师账号
            </Link>
          </LocalLoginForm>
        ) : code === "PASSWORD_CHANGE_REQUIRED" ? (
          <div className={gateStyles.actions}>
            <Link className={gateStyles.primaryButton} href="/teacher/password">修改密码后继续</Link>
          </div>
        ) : null}
      </main>
    </div>
  );
}
