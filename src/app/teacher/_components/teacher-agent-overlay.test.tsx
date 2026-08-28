import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./activity-assistant", () => ({
  ActivityAssistantSessionProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  ActivityAssistant: () => <div data-agent-conversation="true" />,
}));

import { TeacherAgentOverlay } from "./teacher-agent-overlay";

describe("TeacherAgentOverlay", () => {
  it("starts as a layout-independent disclosure launcher", () => {
    const markup = renderToStaticMarkup(
      <TeacherAgentOverlay classrooms={[]}>
        <main data-page-content="true" />
      </TeacherAgentOverlay>,
    );

    expect(markup).toContain('data-page-content="true"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-controls="teacher-agent-panel"');
    expect(markup).toContain("打开 CDAS Agent 独立会话");
    expect(markup).not.toContain('data-agent-conversation="true"');
  });
});
