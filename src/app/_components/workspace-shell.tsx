import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { ChevronDownIcon, LogOutIcon, RepeatIcon } from "lucide-react";
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
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  developmentQuickAdminEntryAction,
  developmentQuickStudentEntryAction,
  developmentQuickTeacherEntryAction,
  logoutAction,
} from "../auth/local-login-actions";
import { isDevelopmentQuickLoginEnabled } from "../../server/auth/development-quick-login";
import { BrandMark } from "./brand-mark";
import { DismissibleDetails } from "./dismissible-details";
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
  const showDevelopmentSwitcher = isDevelopmentQuickLoginEnabled();
  const crumbs =
    breadcrumb && breadcrumb.length > 0
      ? breadcrumb
      : [{ label: `${audience}工作台` }];

  const accountLabel = actorName
    ? `当前账号：${actorName} · ${actorAudience}`
    : null;

  // D-081：一条顶栏代替整列侧栏。每个角色只有一到四个去处，内容区拿满宽度。
  return (
    <TooltipProvider>
      <div
        className={cn(
          "flex flex-col",
          fillViewport ? "h-svh min-h-0" : "min-h-svh",
        )}
        data-fill-viewport={fillViewport || undefined}
      >
        <a
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow"
          href="#main-content"
        >
          跳到主要内容
        </a>
        <header
          className={cn(
            "z-40 shrink-0 px-3 pt-3 md:px-4",
            !fillViewport && "sticky top-0",
          )}
        >
          <div className="glass flex h-14 items-center gap-2 rounded-2xl px-2.5 sm:gap-4 sm:px-3">
            <Link
              aria-label={`CDAS Next ${audience}工作台`}
              className="flex shrink-0 items-center gap-2 rounded-lg p-1 pr-2 transition-colors hover:bg-foreground/5"
              href={workspaceHref}
            >
              <BrandMark />
              <span className="hidden text-sm font-semibold lg:inline">
                CDAS Next
              </span>
            </Link>
            {showNavigation ? (
              <>
                <Separator
                  className="hidden data-[orientation=vertical]:h-5 sm:block"
                  orientation="vertical"
                />
                <WorkspaceNavigation audience={audience} items={navigation} />
              </>
            ) : null}
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              {toolbarAction}
              {actorName && accountLabel ? (
                <DismissibleDetails className="group relative">
                  <summary
                    aria-label={accountLabel}
                    className="flex cursor-pointer list-none items-center gap-2 rounded-full py-1 pr-2.5 pl-1 text-sm transition-colors hover:bg-foreground/5 [&::-webkit-details-marker]:hidden"
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-8 items-center justify-center rounded-full bg-primary/12 text-sm font-semibold text-primary"
                    >
                      {Array.from(actorName)[0]}
                    </span>
                    <span className="hidden max-w-32 truncate md:inline">
                      {actorName}
                    </span>
                    <ChevronDownIcon
                      aria-hidden="true"
                      className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
                    />
                  </summary>
                  <div className="absolute top-full right-0 z-50 mt-2 flex w-64 flex-col gap-1 rounded-xl border bg-background p-2 text-foreground shadow-lg">
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">
                      {accountLabel}
                    </p>
                    {showDevelopmentSwitcher ? (
                      <>
                        <Separator />
                        {(
                          [
                            ["教师", developmentQuickTeacherEntryAction],
                            ["学生", developmentQuickStudentEntryAction],
                            ["管理员", developmentQuickAdminEntryAction],
                          ] as const
                        )
                          .filter(([role]) => role !== actorAudience)
                          .map(([role, action]) => (
                            <form action={action} key={role}>
                              <Button
                                className="w-full justify-start"
                                size="sm"
                                type="submit"
                                variant="ghost"
                              >
                                <RepeatIcon />
                                切换默认{role}
                              </Button>
                            </form>
                          ))}
                      </>
                    ) : null}
                    <Separator />
                    <form action={logoutAction}>
                      <Button
                        className="w-full justify-start"
                        size="sm"
                        type="submit"
                        variant="ghost"
                      >
                        <LogOutIcon />
                        退出登录
                      </Button>
                    </form>
                  </div>
                </DismissibleDetails>
              ) : null}
            </div>
          </div>
        </header>
        {crumbs.length > 1 ? (
          <div className="shrink-0 px-4 pt-3 md:px-6">
            {/* 与多数页面的内容列对齐；贴着窗口左缘是侧栏时代的位置。 */}
            <div className="mx-auto w-full max-w-6xl">
              <WorkspaceBreadcrumb items={crumbs} />
            </div>
          </div>
        ) : null}
        <main
          className={cn(
            "flex flex-1 flex-col outline-none",
            fillViewport ? "min-h-0 p-3 md:px-4" : "p-4 md:p-6",
          )}
          id="main-content"
          tabIndex={-1}
        >
          {/* 锁高的双栏页（评阅）放在一整块玻璃面上，两栏各自滚动。 */}
          {fillViewport ? (
            <div className="glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
              {children}
            </div>
          ) : (
            children
          )}
        </main>
      </div>
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
