import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptyState, InlineAlert, StatusBadge } from "./ui";

describe("shared teaching workspace UI", () => {
  it("keeps state and recovery text available without color-only cues", () => {
    const markup = renderToStaticMarkup(
      <>
        <StatusBadge tone="warning">迟交仍可提交</StatusBadge>
        <InlineAlert tone="danger">请修改证据后重试。</InlineAlert>
        <EmptyState title="还没有活动">教师发布活动后会出现在这里。</EmptyState>
      </>,
    );

    expect(markup).toContain("迟交仍可提交");
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("教师发布活动后会出现在这里。");
  });
});
