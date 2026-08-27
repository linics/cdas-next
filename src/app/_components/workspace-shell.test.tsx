import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs", () => ({
  SignOutButton: ({ children }: { children: ReactNode }) => (
    <span data-clerk-sign-out="true">{children}</span>
  ),
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
          { href: "/teacher/activities/new", label: "活动设计" },
          { href: "/teacher/knowledge", label: "课程依据" },
        ]}
      >
        <p>教师内容</p>
      </WorkspaceShell>,
    );

    expect(markup).toContain('href="/teacher"');
    expect(markup).toContain('href="/teacher/activities/new"');
    expect(markup).toContain('href="/teacher/knowledge"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("当前账号：林老师 · 教师");
    expect(markup).toContain('data-clerk-sign-out="true"');
    expect(markup).not.toContain("学生端预览");
    expect(markup).not.toContain("评阅名册");
  });
});
