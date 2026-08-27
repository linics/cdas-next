import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssistantMarkdown } from "./assistant-markdown";

function render(markdown: string) {
  return renderToStaticMarkup(<AssistantMarkdown>{markdown}</AssistantMarkdown>);
}

describe("AssistantMarkdown", () => {
  it("renders markdown emphasis instead of leftover asterisks", () => {
    const markup = render("请用**观察记录**支持判断。");
    expect(markup).toContain("<strong>观察记录</strong>");
    expect(markup).not.toContain("**观察记录**");
  });

  it("renders a markdown list", () => {
    const markup = render("- 问题\n- 证据\n- 建议");
    expect(markup).toContain("<li>");
    expect(markup).toContain("问题");
    expect(markup).toContain("证据");
  });

  it("renders inline and display LaTeX with KaTeX", () => {
    const inline = render("面积公式是 $S=a^{2}$。");
    expect(inline).toContain("katex");
    expect(inline).not.toContain("$S=a^{2}$");

    const display = render("$$\n\\frac{1}{2}mv^2\n$$");
    expect(display).toContain("katex");
    expect(display).toContain("mfrac");
    expect(display).not.toContain("$$");
  });

  it("does not execute raw HTML from the model", () => {
    const markup = render('<script>alert(1)</script>\n<img src="x" onerror="alert(1)" />');
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<img");
  });
});
