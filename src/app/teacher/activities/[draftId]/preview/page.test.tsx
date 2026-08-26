import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  database: { kind: "preview-page-database" },
  context: { actorId: "10000000-0000-4000-8000-000000000001", source: "UI" as const, traceId: "preview-trace", clock: () => new Date() },
  createUiCommandContext: vi.fn(),
  getDatabaseClient: vi.fn(),
  getTeacherActivityPreview: vi.fn(),
  getTeacherAssistantClassrooms: vi.fn(),
  isActivityAssistantEnabled: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("next/link", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../../../../../server/db/client", () => ({ getDatabaseClient: mocks.getDatabaseClient }));
vi.mock("../../../../../server/commands/create-ui-command-context", () => ({ createUiCommandContext: mocks.createUiCommandContext }));
vi.mock("../../../../../server/assistant/assistant-config", () => ({ isActivityAssistantEnabled: mocks.isActivityAssistantEnabled }));
vi.mock("../../../../../server/assistant/teacher-assistant-context", () => ({
  TeacherAssistantContextError: class TeacherAssistantContextError extends Error {},
  getTeacherAssistantClassrooms: mocks.getTeacherAssistantClassrooms,
}));
vi.mock("../../../../../server/auth/current-actor", () => ({ AuthenticationError: class AuthenticationError extends Error { constructor(public readonly code: string) { super(code); } } }));
vi.mock("../../../../../server/queries/teacher-activity-workspace", () => ({
  TeacherActivityQueryError: class TeacherActivityQueryError extends Error {},
  getTeacherActivityPreview: mocks.getTeacherActivityPreview,
}));
vi.mock("../../../_components/teacher-shell", () => ({
  TeacherAccessGate: () => <div>安全门</div>,
  TeacherPage: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../../../_components/activity-assistant", () => ({
  ActivityAssistant: ({ classrooms, continuationOnly }: { classrooms: Array<{ name: string }>; continuationOnly: boolean }) => <div data-assistant-continuation={continuationOnly}>{classrooms.map((item) => item.name).join(",")}</div>,
}));
vi.mock("./publish-panel", () => ({ PublishPanel: () => <aside data-manual-publish="true" /> }));

import TeacherActivityPreviewPage from "./page";
import { waterConservationTaskBook } from "../../../../../fixtures/water-conservation";

const workspace = {
  actor: { displayName: "林老师" },
  draft: {
    id: "10000000-0000-4000-8000-000000000001",
    version: 1,
    revision: { content: { title: "验证活动", summary: "摘要", learningObjectives: ["目标"], taskInstructions: "任务", evidenceRequirements: ["证据"], feedbackCriteria: ["标准"] } },
  },
  classrooms: [{ id: "20000000-0000-4000-8000-000000000001" }],
};

describe("teacher activity preview assistant continuation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createUiCommandContext.mockResolvedValue(mocks.context);
    mocks.getDatabaseClient.mockReturnValue(mocks.database);
    mocks.getTeacherActivityPreview.mockResolvedValue(workspace);
    mocks.getTeacherAssistantClassrooms.mockResolvedValue([{ id: "20000000-0000-4000-8000-000000000001", name: "七年一班" }]);
    mocks.isActivityAssistantEnabled.mockReturnValue(false);
  });

  it("keeps the manual PublishPanel available when AI is disabled", async () => {
    const markup = renderToStaticMarkup(await TeacherActivityPreviewPage({ params: Promise.resolve({ draftId: workspace.draft.id }) }));
    expect(markup).toContain('data-manual-publish="true"');
    expect(markup).not.toContain("data-assistant-continuation");
    expect(mocks.getTeacherAssistantClassrooms).not.toHaveBeenCalled();
  });

  it("previews every required structured task-book section before publish", async () => {
    mocks.getTeacherActivityPreview.mockResolvedValue({
      ...workspace,
      draft: {
        ...workspace.draft,
        revision: { content: waterConservationTaskBook },
      },
    });

    const markup = renderToStaticMarkup(await TeacherActivityPreviewPage({ params: Promise.resolve({ draftId: workspace.draft.id }) }));

    expect(markup).toContain("基本设置");
    expect(markup).toContain("调查探究");
    expect(markup).toContain("三维目标");
    expect(markup).toContain("总体任务");
    expect(markup).toContain("任务链");
    expect(markup).toContain("文档：统计表或图表及简要分析");
    expect(markup).toContain("评价标准");
    expect(markup).toContain("需改进 证据不足或与结论脱节");
  });

  it("renders only the continuation assistant surface with authorized classroom display names", async () => {
    mocks.isActivityAssistantEnabled.mockReturnValue(true);
    const markup = renderToStaticMarkup(await TeacherActivityPreviewPage({ params: Promise.resolve({ draftId: workspace.draft.id }) }));
    expect(markup).toContain('data-manual-publish="true"');
    expect(markup).toContain('data-assistant-continuation="true"');
    expect(markup).toContain("七年一班");
    expect(mocks.getTeacherAssistantClassrooms).toHaveBeenCalledWith(mocks.database, mocks.context);
  });
});
