import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { LogOutIcon } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { logoutAction } from "../auth/local-login-actions";
import { WorkspaceNavigation } from "./workspace-navigation";

export type WorkspaceNavigationItem = { href: string; label: string };

/** Ancestor crumbs may carry `href`; the last crumb is always the current page. */
export type WorkspaceCrumb = {
  label: string;
  href?: string;
};

type Audience = "教师" | "学生" | "管理员";

function workspaceHrefFor(audience: Audience) {
  return audience === "教师"
    ? "/teacher"
    : audience === "学生"
      ? "/student"
      : "/admin";
}

function BrandMark() {
  return (
    <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground">
      CD
    </span>
  );
}

function WorkspaceBreadcrumb({ items }: { items: readonly WorkspaceCrumb[] }) {
  return (
    <Breadcrumb aria-label="面包屑">
      <BreadcrumbList>
        {items.map((item, index) => {
          const isCurrent = index === items.length - 1;
          return (
            <Fragment key={`${item.label}-${index}`}>
              {index > 0 ? <BreadcrumbSeparator /> : null}
              <BreadcrumbItem>
                {!isCurrent && item.href ? (
                  <BreadcrumbLink asChild>
                    <Link href={item.href}>{item.label}</Link>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage aria-current={isCurrent ? "page" : undefined}>
                    {item.label}
                  </BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
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
  audience: Audience;
  actorName?: string;
  actorAudience?: Audience;
  breadcrumb?: readonly WorkspaceCrumb[];
  navigation?: readonly WorkspaceNavigationItem[];
  toolbarAction?: ReactNode;
  fillViewport?: boolean;
  children: ReactNode;
}) {
  const workspaceHref = workspaceHrefFor(audience);
  const showNavigation = navigation.length > 0;
  const crumbs =
    breadcrumb && breadcrumb.length > 0
      ? breadcrumb
      : [{ label: `${audience}工作台` }];

  return (
    <TooltipProvider>
      <SidebarProvider data-fill-viewport={fillViewport || undefined}>
        <a
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow"
          href="#main-content"
        >
          跳到主要内容
        </a>
        {showNavigation ? (
          <Sidebar collapsible="icon" variant="inset">
            <SidebarHeader>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    className="hover:bg-foreground/5 active:bg-foreground/10"
                    size="lg"
                  >
                    <Link
                      aria-label={`CDAS Next ${audience}工作台`}
                      href={workspaceHref}
                    >
                      <BrandMark />
                      <span className="grid flex-1 text-left leading-tight">
                        <span className="truncate font-semibold">
                          CDAS Next
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          跨学科学习活动
                        </span>
                      </span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarHeader>
            <SidebarContent>
              <WorkspaceNavigation audience={audience} items={navigation} />
            </SidebarContent>
              <SidebarRail />
          </Sidebar>
        ) : null}
        <SidebarInset className={cn(fillViewport && "min-h-0 overflow-hidden")}>
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            {showNavigation ? (
              <>
                <SidebarTrigger aria-label="展开或收起导航" className="-ml-1" />
                <Separator
                  className="mr-2 data-[orientation=vertical]:h-4"
                  orientation="vertical"
                />
              </>
            ) : (
              <Link
                aria-label={`CDAS Next ${audience}工作台`}
                className="mr-2"
                href={workspaceHref}
              >
                <BrandMark />
              </Link>
            )}
            <WorkspaceBreadcrumb items={crumbs} />
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden text-sm text-muted-foreground sm:inline">
                {actorName
                  ? `当前账号：${actorName} · ${actorAudience}`
                  : `${audience}工作台`}
              </span>
              {toolbarAction}
              {actorName ? (
                <form action={logoutAction}>
                  <Button size="sm" type="submit" variant="ghost">
                    <LogOutIcon />
                    退出登录
                  </Button>
                </form>
              ) : null}
            </div>
          </header>
          <main
            className={cn(
              "flex flex-1 flex-col outline-none",
              fillViewport ? "min-h-0" : "p-4 md:p-6",
            )}
            id="main-content"
            tabIndex={-1}
          >
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

export function WorkspaceRoleGate({
  actorName,
  currentAudience,
  requestedAudience,
}: {
  actorName: string;
  currentAudience: Audience;
  requestedAudience: Audience;
}) {
  return (
    <WorkspaceShell
      audience={requestedAudience}
      actorName={actorName}
      actorAudience={currentAudience}
    >
      <div className="flex flex-1 items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardDescription>账号角色不匹配</CardDescription>
            <CardTitle className="type-section-title">
              当前登录的是{currentAudience}账号
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {requestedAudience}工作台只对{requestedAudience}账号开放。请返回
            {currentAudience}工作台，或者退出后用{requestedAudience}账号登录。
          </CardContent>
          <CardFooter>
            <Button asChild>
              <Link href={workspaceHrefFor(currentAudience)}>
                返回{currentAudience}工作台
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </WorkspaceShell>
  );
}
