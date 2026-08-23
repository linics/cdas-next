"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import styles from "./workspace-shell.module.css";

export type WorkspaceNavigationItem = { href: string; label: string };

export function WorkspaceShell({
  audience,
  actorName,
  navigation = [],
  toolbarAction,
  children,
}: {
  audience: "教师" | "学生";
  actorName?: string;
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
          <span className={styles.actorLabel}>{actorName ? `${actorName} · ${audience}` : `${audience}工作台`}</span>
          {toolbarAction}
        </div>
      </header>
      <main className={styles.main} id="main-content" tabIndex={-1}>{children}</main>
    </div>
  );
}
