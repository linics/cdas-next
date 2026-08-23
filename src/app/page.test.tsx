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
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

import HomePage from "./page";

describe("public workspace entry", () => {
  it("links only to the real teacher and student workspaces", async () => {
    const markup = renderToStaticMarkup(await HomePage());

    expect(markup).toContain('href="/teacher"');
    expect(markup).toContain('href="/student"');
    expect(markup).toContain("选择你的工作区");
    expect(markup).toContain("本阶段支持的教学闭环");
    expect(markup).not.toContain("视觉原型（仅本分支）");
    expect(markup).not.toContain("版本 7 · 已保存");
    expect(markup).not.toContain("七年一班");
  });

  it("shows the prototype comparison bar only when a visual query is present", async () => {
    const markup = renderToStaticMarkup(
      await HomePage({
        searchParams: Promise.resolve({ visual: "warm-paper" }),
      }),
    );

    expect(markup).toContain('data-visual="warm-paper"');
    expect(markup).toContain("视觉原型（仅本分支）");
    expect(markup).toContain("暖纸工作台");
    expect(markup).toContain("墨结构");
    expect(markup).toContain("柔和教室");
    expect(markup).toContain("选择你的工作区");
  });
});
