import { SignOutButton } from "@clerk/nextjs";
import Link from "next/link";
import type { ReactNode } from "react";
import { WorkspaceNavigation } from "./workspace-navigation";
import styles from "./workspace-shell.module.css";

export type WorkspaceNavigationItem = { href: string; label: string };

export function WorkspaceShell({
  audience,
  actorName,
  actorAudience = audience,
  navigation = [],
  toolbarAction,
  children,
}: {
  audience: "教师" | "学生";
  actorName?: string;
  actorAudience?: "教师" | "学生";
  navigation?: readonly WorkspaceNavigationItem[];
  toolbarAction?: ReactNode;
  children: ReactNode;
}) {
  const workspaceHref = audience === "教师" ? "/teacher" : "/student";
  const showNavigation = navigation.length > 0;

  return (
    <div className={styles.shell} data-with-sidebar={showNavigation || undefined}>
      <a className={styles.skipLink} href="#main-content">跳到主要内容</a>
      {showNavigation ? (
        <aside className={styles.sidebar}>
          <Link
            className={styles.brand}
            href={workspaceHref}
            aria-label={`CDAS Next ${audience}工作台`}
          >
            <strong>CDAS</strong>
            <span>跨学科学习活动</span>
          </Link>
          <WorkspaceNavigation audience={audience} items={navigation} />
          <p className={styles.sidebarNote}>
            AI 负责准备与说明，正式发布和评价始终由教师确认。
          </p>
        </aside>
      ) : null}
      <div className={styles.workspace}>
        <header className={styles.toolbar}>
          {!showNavigation ? (
            <Link
              className={styles.compactBrand}
              href={workspaceHref}
              aria-label={`CDAS Next ${audience}工作台`}
            >
              CDAS
            </Link>
          ) : null}
          <p className={styles.audienceLabel}>{audience}工作区</p>
          <div className={styles.toolbarEnd}>
            <span className={styles.actorLabel}>
              {actorName
                ? `当前账号：${actorName} · ${actorAudience}`
                : `${audience}工作台`}
            </span>
            {toolbarAction}
            {actorName ? (
              <SignOutButton redirectUrl="/">
                <button className={styles.signOutButton} type="button">
                  退出登录
                </button>
              </SignOutButton>
            ) : null}
          </div>
        </header>
        <main className={styles.main} id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}

export function WorkspaceRoleGate({
  actorName,
  currentAudience,
  requestedAudience,
}: {
  actorName: string;
  currentAudience: "教师" | "学生";
  requestedAudience: "教师" | "学生";
}) {
  const currentWorkspaceHref =
    currentAudience === "教师" ? "/teacher" : "/student";

  return (
    <WorkspaceShell
      audience={requestedAudience}
      actorName={actorName}
      actorAudience={currentAudience}
    >
      <section className={styles.roleGate}>
        <p>账号角色不匹配</p>
        <h1>当前登录的是{currentAudience}账号</h1>
        <p>
          {requestedAudience}工作台不会读取或显示任何业务数据。请返回你的
          {currentAudience}工作台，或退出后改用{requestedAudience}账号登录。
        </p>
        <div className={styles.roleGateActions}>
          <Link href={currentWorkspaceHref}>
            返回{currentAudience}工作台
          </Link>
        </div>
      </section>
    </WorkspaceShell>
  );
}
