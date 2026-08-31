import Link from "next/link";
import type { ReactNode } from "react";
import type { AuthenticationError } from "../../../server/auth/current-actor";
import { InlineAlert } from "../../_components/ui";
import {
  WorkspaceShell,
  type WorkspaceCrumb,
} from "../../_components/workspace-shell";
import gateStyles from "../../_components/access-gate.module.css";

const adminNavigation = [
  { href: "/admin", label: "管理概览" },
  { href: "/admin/schools", label: "学校管理" },
  { href: "/admin/teachers", label: "教师管理" },
] as const;

export const adminHomeCrumb = {
  href: "/admin",
  label: "管理员工作台",
} as const satisfies WorkspaceCrumb;

export function AdminPage({
  actorName,
  breadcrumb,
  children,
}: {
  actorName?: string;
  breadcrumb?: readonly WorkspaceCrumb[];
  children: ReactNode;
}) {
  return (
    <WorkspaceShell
      audience="管理员"
      actorName={actorName}
      breadcrumb={breadcrumb}
      navigation={adminNavigation}
    >
      {children}
    </WorkspaceShell>
  );
}

export function AdminAccessGate({
  code,
}: {
  code: AuthenticationError["code"] | "FORBIDDEN";
}) {
  const unauthenticated = code === "UNAUTHENTICATED";
  const disabled = code === "ACCOUNT_DISABLED";
  const copy = disabled
      ? {
          title: "当前账号暂不能进入管理员工作台",
          detail: "请联系平台管理员重新启用账号。",
        }
    : code === "FORBIDDEN"
      ? {
          title: "当前账号不是平台管理员",
          detail: "请使用平台管理员账号登录。",
        }
      : {
          title: "登录管理员账号",
          detail: "请使用平台管理员账号继续。",
        };

  return (
    <div className={gateStyles.gate}>
      <main className={gateStyles.accessGate}>
        <div>
          <h2>{copy.title}</h2>
        </div>
        <InlineAlert tone="info">{copy.detail}</InlineAlert>
        <div className={gateStyles.actions}>
          {unauthenticated ? <Link className={gateStyles.primaryButton} href="/admin/login">登录管理员账号</Link> : null}
          <Link className={gateStyles.backLink} href="/">返回首页</Link>
        </div>
      </main>
    </div>
  );
}
