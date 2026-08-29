import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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

import HomePage from "./page";

describe("public workspace entry", () => {
  it("links only to the real teacher and student workspaces", () => {
    const markup = renderToStaticMarkup(<HomePage />);

    expect(markup).toContain('href="/teacher"');
    expect(markup).toContain('href="/student"');
    expect(markup).toContain("选择工作台");
    expect(markup).toContain("完整的教学闭环");
    expect(markup).toContain("关闭活动");
    expect(markup).not.toContain("版本 7 · 已保存");
    expect(markup).not.toContain("七年一班");
  });
});
