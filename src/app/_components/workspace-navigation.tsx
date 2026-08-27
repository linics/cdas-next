"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import styles from "./workspace-shell.module.css";

export function WorkspaceNavigation({
  audience,
  items,
}: {
  audience: "教师" | "学生";
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
        {items.map((item, index) => {
          const active =
            pathname === item.href ||
            (item.href !== "/teacher" &&
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
              <span aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
