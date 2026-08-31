import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  loginTeacher: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("../../auth/local-login-actions", () => ({
  loginTeacherAction: mocks.loginTeacher,
}));
vi.mock("../../_components/ui", () => ({
  InlineAlert: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { TeacherLoginForm } from "./teacher-login-form";

describe("teacher custom login page", () => {
  it("collects the school login triplet without external authentication copy", () => {
    const markup = renderToStaticMarkup(<TeacherLoginForm />);

    expect(markup).toContain("学校代码 · 工号 · 密码");
    expect(markup).toContain('name="schoolCode"');
    expect(markup).toContain('name="staffNo"');
    expect(markup).toContain('name="password"');
    expect(markup).toContain("使用学校代码、工号和密码登录。");
    expect(markup).not.toContain("Clerk");
    expect(markup).toContain('href="/teacher/register"');
  });
});
