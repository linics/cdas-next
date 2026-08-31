import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../auth/local-login-actions", () => ({
  logoutAction: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/teacher/knowledge",
}));

import { WorkspaceShell } from "./workspace-shell";

describe("workspace shell", () => {
  it("renders only real navigation destinations and marks the current page", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceShell
        actorName="林老师"
        audience="教师"
        navigation={[
          { href: "/teacher", label: "工作台" },
          { href: "/teacher/activities", label: "活动设计" },
          { href: "/teacher/knowledge", label: "课程依据" },
        ]}
      >
        <p>教师内容</p>
      </WorkspaceShell>,
    );

    expect(markup).toContain('href="/teacher"');
    expect(markup).toContain('href="/teacher/activities"');
    expect(markup).toContain('href="/teacher/knowledge"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("当前账号：林老师 · 教师");
    expect(markup).toContain("退出登录");
    expect(markup).toContain("<form");
    expect(markup).not.toContain("学生端预览");
    expect(markup).not.toContain("评阅名册");
  });

  it("locks the shell to the remaining viewport when fillViewport is set", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceShell
        actorName="林老师"
        audience="教师"
        fillViewport
        navigation={[{ href: "/teacher", label: "工作台" }]}
      >
        <p>评阅</p>
      </WorkspaceShell>,
    );

    expect(markup).toContain("data-fill-viewport");
  });

  it("turns ancestor crumbs into links and leaves the current page unlinked", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceShell
        actorName="林老师"
        audience="教师"
        breadcrumb={[
          { href: "/teacher", label: "教师工作台" },
          { href: "/teacher/activities", label: "活动设计" },
          { label: "校园节水行动" },
        ]}
        navigation={[
          { href: "/teacher", label: "工作台" },
          { href: "/teacher/activities", label: "活动设计" },
        ]}
      >
        <p>草稿</p>
      </WorkspaceShell>,
    );

    expect(markup).toContain('aria-label="面包屑"');
    expect(markup).toContain('href="/teacher"');
    expect(markup).toContain('href="/teacher/activities"');
    expect(markup).toContain("校园节水行动");
    expect(markup).toContain('aria-current="page"');
    expect(markup).not.toMatch(/<a[^>]*>校园节水行动<\/a>/);
  });
});
