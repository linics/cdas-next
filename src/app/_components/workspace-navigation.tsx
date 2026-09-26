"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { iconForNavigationHref } from "./workspace-icons";

const workspaceRoots = new Set(["/teacher", "/student", "/admin"]);

export function WorkspaceNavigation({
  audience,
  items,
}: {
  audience: "教师" | "学生" | "管理员";
  items: readonly { href: string; label: string }[];
}) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{audience}工作台</SidebarGroupLabel>
      <SidebarGroupContent>
        <nav aria-label={`${audience}工作台导航`}>
          <SidebarMenu className="isolate">
            {items.map((item) => {
              const active =
                pathname === item.href ||
                (!workspaceRoots.has(item.href) &&
                  pathname.startsWith(`${item.href}/`));
              const Icon = iconForNavigationHref(item.href);
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    className={cn(
                      "relative text-sidebar-foreground/80 transition-colors",
                      // 三级：平时透明 → 悬停极淡的中性底 → 选中主色浅底 + 主色字 + 竖线，逐级加深
                      "hover:bg-foreground/[0.04] hover:text-foreground active:bg-foreground/[0.08]",
                      // 选中：底色交给下面滑动的浮起白块，这里只负责文字和图标
                      "data-active:bg-transparent data-active:font-semibold data-active:text-primary data-active:hover:bg-transparent data-active:hover:text-primary",
                    )}
                    isActive={active}
                    tooltip={item.label}
                  >
                    <Link
                      aria-current={active ? "page" : undefined}
                      href={item.href}
                      onClick={() => setOpenMobile(false)}
                    >
                      {/* 选中底块在各项之间滑动（共享布局动画），不是瞬间跳过去。 */}
                      {active ? (
                        <motion.span
                          aria-hidden="true"
                          className="absolute inset-0 -z-10 rounded-md bg-primary/12 shadow-[0_0_0_1px_color-mix(in_oklch,var(--primary)_14%,transparent)] after:absolute after:top-1/2 after:left-0.5 after:h-4 after:w-[3px] after:-translate-y-1/2 after:rounded-full after:bg-primary group-data-[collapsible=icon]:after:hidden"
                          layoutId={`workspace-nav-active-${audience}`}
                          transition={{ type: "spring", stiffness: 420, damping: 36 }}
                        />
                      ) : null}
                      <Icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </nav>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
