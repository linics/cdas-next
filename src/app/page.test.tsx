import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import HomePage from "./page";

describe("home page", () => {
  it("keeps the teacher and student entries with an accessible education-scene hero", () => {
    const markup = renderToStaticMarkup(<HomePage />);

    expect(markup).toContain('href="/teacher"');
    expect(markup).toContain('href="/student"');
    expect(markup).toContain('alt="跨学科学习场景插图"');
    expect(markup).not.toContain("完整的教学闭环");
    expect(markup).not.toContain("反馈与量规评价");
  });
});
