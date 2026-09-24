"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
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
                    className="relative data-active:bg-transparent"
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
                          className="absolute inset-0 -z-10 rounded-md bg-sidebar-accent shadow-[0_1px_0_0_oklch(1_0_0/0.7)_inset]"
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
