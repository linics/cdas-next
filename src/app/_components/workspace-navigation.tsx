"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { WorkspaceIcon, iconForNavigationHref } from "./workspace-icons";
import styles from "./workspace-shell.module.css";

export function WorkspaceNavigation({
  audience,
  items,
}: {
  audience: "管理员" | "教师" | "学生";
  items: readonly { href: string; label: string }[];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.navigationRegion}>
      <button
        aria-controls="workspace-navigation"
        aria-expanded={open}
        aria-label={`打开${audience}工作台导航`}
        className={styles.navigationToggle}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span aria-hidden="true" />
        导航
      </button>
      <nav
        aria-label={`${audience}工作台导航`}
        className={styles.navigation}
        data-open={open || undefined}
        id="workspace-navigation"
      >
        {items.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/admin" &&
              item.href !== "/teacher" &&
              item.href !== "/student" &&
              pathname.startsWith(`${item.href}/`));
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={styles.navigationLink}
              data-active={active || undefined}
              href={item.href}
              key={item.href}
              onClick={() => setOpen(false)}
            >
              <WorkspaceIcon name={iconForNavigationHref(item.href)} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
