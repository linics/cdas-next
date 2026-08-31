import Link from "next/link";
import type { ReactNode } from "react";
import { logoutAction } from "../auth/local-login-actions";
import { WorkspaceNavigation } from "./workspace-navigation";
import styles from "./workspace-shell.module.css";

export type WorkspaceNavigationItem = { href: string; label: string };
export type WorkspaceAudience = "管理员" | "教师" | "学生";

/** Ancestor crumbs may carry `href`; the last crumb is always the current page. */
export type WorkspaceCrumb = {
  label: string;
  href?: string;
};

function WorkspaceBreadcrumb({
  items,
}: {
  items: readonly WorkspaceCrumb[];
}) {
  return (
    <nav aria-label="面包屑" className={styles.audienceLabel}>
      <ol className={styles.breadcrumbList}>
        {items.map((item, index) => {
          const isCurrent = index === items.length - 1;
          const showLink = !isCurrent && Boolean(item.href);

          return (
            <li key={`${item.label}-${index}`} className={styles.breadcrumbItem}>
              {index > 0 ? (
                <span aria-hidden="true" className={styles.breadcrumbSeparator}>
                  ›
                </span>
              ) : null}
              {showLink && item.href ? (
                <Link className={styles.breadcrumbLink} href={item.href}>
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={isCurrent ? "page" : undefined}
                  className={styles.breadcrumbCurrent}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function WorkspaceShell({
  audience,
  actorName,
  actorAudience = audience,
  breadcrumb,
  navigation = [],
  toolbarAction,
  fillViewport = false,
  children,
}: {
  audience: WorkspaceAudience;
  actorName?: string;
  actorAudience?: WorkspaceAudience;
  breadcrumb?: readonly WorkspaceCrumb[];
  navigation?: readonly WorkspaceNavigationItem[];
  toolbarAction?: ReactNode;
  fillViewport?: boolean;
  children: ReactNode;
}) {
  const workspaceHref =
    audience === "管理员"
      ? "/admin"
      : audience === "教师"
        ? "/teacher"
        : "/student";
  const showNavigation = navigation.length > 0;
  const crumbs = breadcrumb && breadcrumb.length > 1 ? breadcrumb : null;

  return (
    <div
      className={styles.shell}
      data-with-sidebar={showNavigation || undefined}
      data-fill-viewport={fillViewport || undefined}
    >
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
          {crumbs ? <WorkspaceBreadcrumb items={crumbs} /> : null}
          <div className={styles.toolbarEnd}>
            <span className={styles.actorLabel}>
              {actorName
                ? `当前账号：${actorName} · ${actorAudience}`
                : `${audience}工作台`}
            </span>
            {toolbarAction}
            {actorName ? (
              <form action={logoutAction}>
                <button className={styles.signOutButton} type="submit">退出登录</button>
              </form>
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
          {requestedAudience}工作台仅对{requestedAudience}账号开放。请返回
          {currentAudience}工作台，或退出后使用{requestedAudience}账号登录。
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
