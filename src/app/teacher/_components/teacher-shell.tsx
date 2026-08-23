import { SignInButton, SignOutButton } from "@clerk/nextjs";
import Link from "next/link";
import type { ReactNode } from "react";
import type { AuthenticationError } from "../../../server/auth/current-actor";
import { SignInIcon } from "../../_components/flat-icons";
import { InlineAlert } from "../../_components/ui";
import { WorkspaceShell } from "../../_components/workspace-shell";
import styles from "../teacher-workspace.module.css";

export function TeacherPage({
  actorName,
  children,
}: {
  actorName?: string;
  children: ReactNode;
}) {
  return (
    <WorkspaceShell audience="教师" actorName={actorName}>
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
    <div className={styles.teacherApp}>
      <header className={styles.gateMasthead}>
        <Link className={styles.brand} href="/teacher" aria-label="CDAS Next 教师工作台">
          <span aria-hidden="true">C</span>
          <span>
            <strong>CDAS Next</strong>
            <small>跨学科学习活动</small>
          </span>
        </Link>
        <span>教师工作区</span>
      </header>
      <main className={styles.accessGate}>
        <p className={styles.eyebrow}>{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <InlineAlert tone="info">{copy.detail}</InlineAlert>
        <div className={styles.gateActions}>
          {code === "UNAUTHENTICATED" ? (
            <SignInButton mode="modal" fallbackRedirectUrl={returnPath}>
              <button className={styles.primaryButton} type="button">
                <SignInIcon /> 登录教师账号
              </button>
            </SignInButton>
          ) : code === "USER_NOT_PROVISIONED" ? (
            <SignOutButton redirectUrl={returnPath}>
              <button className={styles.secondaryButton} type="button">
                退出当前账号
              </button>
            </SignOutButton>
          ) : null}
          <Link href="/">返回首页</Link>
        </div>
      </main>
    </div>
  );
}
