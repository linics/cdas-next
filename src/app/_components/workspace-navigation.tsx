"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
          <SidebarMenu>
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
                    isActive={active}
                    tooltip={item.label}
                  >
                    <Link
                      aria-current={active ? "page" : undefined}
                      href={item.href}
                      onClick={() => setOpenMobile(false)}
                    >
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
