"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { iconForNavigationHref } from "./workspace-icons";

const workspaceRoots = new Set(["/teacher", "/student", "/admin"]);

/**
 * 顶栏里的导航标签（D-081）。每个角色只有一到四个去处，一整列侧栏太浪费；
 * 这里是一排标签：平时透明 → 悬停极淡中性底 → 选中主色浅底 + 主色字，
 * 选中底块在各项之间滑动。窄屏只留图标，名称交给无障碍标签。
 */
export function WorkspaceNavigation({
  audience,
  items,
}: {
  audience: "教师" | "学生" | "管理员";
  items: readonly { href: string; label: string }[];
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={`${audience}工作台导航`}
      className="min-w-0 overflow-x-auto"
      id="workspace-navigation"
    >
      <ul className="isolate flex items-center gap-1">
        {items.map((item) => {
          const active =
            pathname === item.href ||
            (!workspaceRoots.has(item.href) &&
              pathname.startsWith(`${item.href}/`));
          const Icon = iconForNavigationHref(item.href);
          return (
            <li key={item.href}>
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm whitespace-nowrap text-muted-foreground transition-colors",
                  "hover:bg-foreground/[0.05] hover:text-foreground",
                  "aria-[current=page]:font-semibold aria-[current=page]:text-primary aria-[current=page]:hover:bg-transparent",
                  "[&_svg]:size-4 [&_svg]:shrink-0",
                )}
                href={item.href}
                title={item.label}
              >
                {active ? (
                  <motion.span
                    aria-hidden="true"
                    className="absolute inset-0 -z-10 rounded-lg bg-primary/12 shadow-[0_0_0_1px_color-mix(in_oklch,var(--primary)_14%,transparent)]"
                    layoutId={`workspace-nav-active-${audience}`}
                    transition={{ type: "spring", stiffness: 420, damping: 36 }}
                  />
                ) : null}
                <Icon aria-hidden="true" />
                <span className="max-sm:sr-only">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
