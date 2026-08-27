import { SignInButton, SignOutButton } from "@clerk/nextjs";
import Link from "next/link";
import type { ReactNode } from "react";
import type { AuthenticationError } from "../../../server/auth/current-actor";
import { isClickthroughAuthEnabled } from "../../../server/auth/clickthrough-auth";
import { InlineAlert } from "../../_components/ui";
import { WorkspaceShell } from "../../_components/workspace-shell";
import gateStyles from "./teacher-gate.module.css";

const teacherNavigation = [
  { href: "/teacher", label: "工作台" },
  { href: "/teacher/activities/new", label: "活动设计" },
  { href: "/teacher/insights", label: "过程诊断" },
  { href: "/teacher/knowledge", label: "课程依据" },
] as const;

export function TeacherPage({
  actorName,
  breadcrumb,
  children,
}: {
  actorName?: string;
  breadcrumb?: string;
  children: ReactNode;
}) {
  return (
    <WorkspaceShell
      audience="教师"
      actorName={actorName}
      breadcrumb={breadcrumb}
      navigation={teacherNavigation}
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
  const copy =
    code === "AUTH_NOT_CONFIGURED"
      ? {
          eyebrow: "登录服务未设置",
          title: "教师工作台当前没有开放",
          detail:
            "系统无法验证教师身份，因此不会读取草稿、班级、发布记录或显示任何写入按钮。设置 Clerk 后再存取。",
        }
      : code === "USER_NOT_PROVISIONED"
        ? {
            eyebrow: "教师账号尚未创建",
            title: "找不到对应的工作台身份",
            detail:
              "当前 Clerk 账号尚未关联 CDAS Next 教师。请先完成账号预先设置与班级归属设置。",
          }
        : {
            eyebrow: "需要登录",
            title: "先确认教师身份",
            detail:
              "未登录时不会读取任何教师草稿、班级、发布记录或学生提交。请登录后重新进入。",
          };

  return (
    <div className={gateStyles.gate}>
      <section className={gateStyles.gateAside}>
        <Link
          className={gateStyles.brand}
          href="/teacher"
          aria-label="CDAS Next 教师工作台"
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
            <span>03</span>学生交证据
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
        <InlineAlert tone="info">{copy.detail}</InlineAlert>
        <div className={gateStyles.actions}>
          {isClickthroughAuthEnabled() ? null : code === "UNAUTHENTICATED" ? (
            <SignInButton mode="modal" fallbackRedirectUrl={returnPath}>
              <button className={gateStyles.primaryButton} type="button">
                登录教师账号
              </button>
            </SignInButton>
          ) : code === "USER_NOT_PROVISIONED" ? (
            <SignOutButton redirectUrl={returnPath}>
              <button className={gateStyles.secondaryButton} type="button">
                退出当前账号
              </button>
            </SignOutButton>
          ) : null}
          <Link className={gateStyles.backLink} href="/">返回首页</Link>
        </div>
        <p className={gateStyles.gateNote}>
          教师工作区 · 未通过身份确认前不会读取任何草稿、班级与提交数据。
        </p>
      </main>
    </div>
  );
}
