"use client";

import { SignOutButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
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
  const pathname = usePathname();
  const workspaceHref = audience === "教师" ? "/teacher" : "/student";
  const showNavigation = navigation.length >= 2;

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content">跳到主要内容</a>
      <header className={styles.toolbar}>
        <Link className={styles.brand} href={workspaceHref} aria-label={`CDAS Next ${audience}工作台`}>
          <span className={styles.brandMark} aria-hidden="true">CD</span>
          <span>CDAS Next</span>
        </Link>
        {showNavigation ? (
          <nav className={styles.navigation} aria-label={`${audience}工作台导航`}>
            {navigation.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return <Link aria-current={active ? "page" : undefined} className={styles.navigationLink} data-active={active || undefined} href={item.href} key={item.href}>{item.label}</Link>;
            })}
          </nav>
        ) : <span className={styles.toolbarSpacer} aria-hidden="true" />}
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
      <main className={styles.main} id="main-content" tabIndex={-1}>{children}</main>
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
