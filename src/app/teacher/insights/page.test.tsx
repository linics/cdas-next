import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  database: { kind: "insights-page-database" },
  context: {
    actorId: "10000000-0000-4000-8000-000000000001",
    source: "UI" as const,
    traceId: "insights-page-trace",
    clock: () => new Date("2026-08-27T00:00:00.000Z"),
  },
  createUiCommandContext: vi.fn(),
  getDatabaseClient: vi.fn(),
  getTeacherInsights: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("server-only", () => ({}));
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
  notFound: mocks.notFound,
  usePathname: () => "/teacher/insights",
}));
vi.mock("@clerk/nextjs", () => ({
  SignOutButton: ({ children }: { children: ReactNode }) => (
    <span data-clerk-sign-out="true">{children}</span>
  ),
}));
vi.mock("../../../server/db/client", () => ({
  getDatabaseClient: mocks.getDatabaseClient,
}));
vi.mock("../../../server/commands/create-ui-command-context", () => ({
  createUiCommandContext: mocks.createUiCommandContext,
}));
vi.mock("../../../server/auth/current-actor", () => ({
  AuthenticationError: class AuthenticationError extends Error {
    constructor(public readonly code: string) {
      super(code);
      this.name = "AuthenticationError";
    }
  },
}));
vi.mock("../../../server/queries/teacher-activity-workspace", () => ({
  TeacherActivityQueryError: class TeacherActivityQueryError extends Error {
    constructor(
      public readonly code: string,
      public readonly actorName?: string,
    ) {
      super(code);
      this.name = "TeacherActivityQueryError";
    }
  },
}));
vi.mock("../../../server/queries/teacher-insights", () => ({
  getTeacherInsights: mocks.getTeacherInsights,
}));
vi.mock("../_components/teacher-shell", () => ({
  TeacherAccessGate: ({ code }: { code: string }) => (
    <div data-access-gate={code}>安全门</div>
  ),
  TeacherPage: ({ children }: { children: ReactNode }) => <>{children}</>,
  teacherHomeCrumb: { href: "/teacher", label: "教师工作台" },
}));

import { AuthenticationError } from "../../../server/auth/current-actor";
import { TeacherActivityQueryError } from "../../../server/queries/teacher-activity-workspace";
import TeacherInsightsPage from "./page";

const emptyImprovement = {
  reviseCount: 0,
  resubmittedCount: 0,
  evaluationPairs: 0,
  rose: 0,
  unchanged: 0,
  fell: 0,
};

async function renderPage(search?: Record<string, string>) {
  return renderToStaticMarkup(
    await TeacherInsightsPage({
      searchParams: Promise.resolve(search ?? {}),
    }),
  );
}

describe("teacher insights page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createUiCommandContext.mockResolvedValue(mocks.context);
    mocks.getDatabaseClient.mockReturnValue(mocks.database);
  });

  it("shows the no-release empty state", async () => {
    mocks.getTeacherInsights.mockResolvedValue({
      actor: { displayName: "林老师" },
      selectedReleaseId: null,
      releaseOptions: [],
      rubric: [],
      stages: [],
      improvement: emptyImprovement,
    });

    const markup = await renderPage();
    expect(markup).toContain("还没有可查看的发布");
    expect(markup).not.toContain("NaN");
  });

  it("shows the no-evaluation empty state without leaking summaries", async () => {
    mocks.getTeacherInsights.mockResolvedValue({
      actor: { displayName: "林老师" },
      selectedReleaseId: null,
      releaseOptions: [
        {
          id: "60000000-0000-4000-8000-000000000006",
          title: "校园节水行动",
          classroomName: "七年一班",
          status: "ACTIVE",
          publishedAt: "2026-08-18T10:00:00.000Z",
        },
      ],
      rubric: [
        {
          releaseId: "60000000-0000-4000-8000-000000000006",
          title: "校园节水行动",
          classroomName: "七年一班",
          status: "no_evaluations",
          sampleCount: 0,
          dimensions: [],
        },
      ],
      stages: [
        {
          releaseId: "60000000-0000-4000-8000-000000000006",
          title: "校园节水行动",
          classroomName: "七年一班",
          audienceCount: 0,
          buckets: [],
        },
      ],
      improvement: emptyImprovement,
    });

    const markup = await renderPage();
    expect(markup).toContain("还没有已确认的量规评价");
    expect(markup).toContain("当前班级没有可统计的学生或小组");
    expect(markup).toContain("还没有要求修改并重交的反馈");
    expect(markup).not.toContain("NaN");
  });

  it("renders rubric counts and the weak-dimension mark", async () => {
    mocks.getTeacherInsights.mockResolvedValue({
      actor: { displayName: "林老师" },
      selectedReleaseId: null,
      releaseOptions: [
        {
          id: "60000000-0000-4000-8000-000000000006",
          title: "校园节水行动",
          classroomName: "七年一班",
          status: "ACTIVE",
          publishedAt: "2026-08-18T10:00:00.000Z",
        },
      ],
      rubric: [
        {
          releaseId: "60000000-0000-4000-8000-000000000006",
          title: "校园节水行动",
          classroomName: "七年一班",
          status: "ready",
          sampleCount: 2,
          dimensions: [
            {
              dimensionIndex: 1,
              dimensionName: "问题意识",
              excellent: 1,
              good: 1,
              pass: 0,
              improve: 0,
              insufficient: 0,
              weak: false,
            },
            {
              dimensionIndex: 2,
              dimensionName: "证据质量",
              excellent: 0,
              good: 0,
              pass: 0,
              improve: 2,
              insufficient: 0,
              weak: true,
            },
          ],
        },
      ],
      stages: [
        {
          releaseId: "60000000-0000-4000-8000-000000000006",
          title: "校园节水行动",
          classroomName: "七年一班",
          audienceCount: 2,
          buckets: [
            { key: "not_started", label: "尚未开始", count: 1 },
            { key: "phase:2", label: "调查与分析", count: 1 },
          ],
        },
      ],
      improvement: {
        reviseCount: 1,
        resubmittedCount: 0,
        evaluationPairs: 0,
        rose: 0,
        unchanged: 0,
        fell: 0,
      },
    });

    const markup = await renderPage();
    expect(markup).toContain("证据质量");
    expect(markup).toContain("薄弱维度");
    expect(markup).toContain("调查与分析");
    expect(markup).toContain("样本不足，暂不统计百分比");
    expect(mocks.getTeacherInsights).toHaveBeenCalledWith(
      mocks.database,
      mocks.context,
      {},
    );
  });

  it("guides a student back without reading insights", async () => {
    mocks.getTeacherInsights.mockRejectedValue(
      new TeacherActivityQueryError("WRONG_ROLE", "陈同学"),
    );

    const markup = await renderPage();
    expect(markup).toContain("当前登录的是学生账号");
    expect(markup).toContain('href="/student"');
    expect(markup).not.toContain("量规薄弱项");
  });

  it("authenticates before reading insights", async () => {
    mocks.createUiCommandContext.mockRejectedValue(
      new AuthenticationError("UNAUTHENTICATED"),
    );

    const markup = await renderPage();
    expect(markup).toContain("安全门");
    expect(mocks.getTeacherInsights).not.toHaveBeenCalled();
  });
});
