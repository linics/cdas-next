import type { ReactNode } from "react";
import { AuthenticationError } from "../../../server/auth/current-actor";
import {
  WorkspaceRoleGate,
  WorkspaceShell,
  type WorkspaceCrumb,
} from "../../_components/workspace-shell";
import { InlineAlert } from "../../_components/ui";
import Link from "next/link";
import gateStyles from "../../_components/access-gate.module.css";

const adminNavigation = [
  { href: "/admin", label: "概览" },
  { href: "/admin/schools", label: "学校" },
  { href: "/admin/teachers", label: "教师" },
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

export function AdminRoleGate({
  actorName,
  currentAudience,
}: {
  actorName: string;
  currentAudience: "教师" | "学生";
}) {
  return (
    <WorkspaceRoleGate
      actorName={actorName}
      currentAudience={currentAudience}
      requestedAudience="管理员"
    />
  );
}

export function AdminAccessGate({
  code,
}: {
  code: AuthenticationError["code"];
}) {
  const copy =
    code === "AUTH_NOT_CONFIGURED"
      ? {
          eyebrow: "登录服务未设置",
          title: "管理员工作台当前没有开放",
          detail: "系统当前无法验证管理员身份。完成登录服务配置后再进入。",
        }
      : code === "ACCOUNT_DISABLED"
        ? {
            eyebrow: "账号已停用",
            title: "此管理员账号不能进入工作台",
            detail: "账号停用后不会读取学校或教师名单。",
          }
        : code === "USER_NOT_PROVISIONED"
          ? {
              eyebrow: "尚未绑定管理员",
              title: "找不到对应的管理员身份",
            detail: "请使用 pnpm bootstrap:admin 交互式创建管理员账号。",
            }
          : {
              eyebrow: "需要登录",
              title: "先确认管理员身份",
              detail: "未登录时不会读取学校、教师或班级计数。",
            };

  return (
    <div className={gateStyles.gate}>
      <section className={gateStyles.gateAside}>
        <Link className={gateStyles.brand} href="/admin" aria-label="CDAS Next 管理员工作台">
          <strong>CDAS</strong>
          <small>学校组织边界</small>
        </Link>
        <div className={gateStyles.pitch}>
          <p className={gateStyles.eyebrow}>管理员工作台</p>
          <h1>管理学校与教师，不进入教学历史</h1>
          <p>这里只处理学校启停、邀请码和教师登记。活动、提交与评价仍只在教师工作台。</p>
        </div>
      </section>
      <main className={gateStyles.accessGate}>
        <div>
          <p className={gateStyles.eyebrow}>{copy.eyebrow}</p>
          <h2>{copy.title}</h2>
        </div>
        <InlineAlert tone="info">{copy.detail}</InlineAlert>
        <div className={gateStyles.actions}>
          <Link className={gateStyles.backLink} href="/">返回首页</Link>
        </div>
      </main>
    </div>
  );
}
