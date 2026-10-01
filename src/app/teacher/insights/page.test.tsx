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
  getTeacherReleaseDiagnosis: vi.fn(),
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
vi.mock("../../../server/queries/teacher-release-diagnosis", () => ({
  getTeacherReleaseDiagnosis: mocks.getTeacherReleaseDiagnosis,
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

const ACTIVE_ID = "60000000-0000-4000-8000-000000000006";
const CLOSED_ID = "60000000-0000-4000-8000-000000000007";

const emptyImprovement = {
  reviseCount: 0,
  resubmittedCount: 0,
  evaluationPairs: 0,
  rose: 0,
  unchanged: 0,
  fell: 0,
};

function dashboard(
  releaseOptions: { id: string; title: string; status: string }[],
) {
  return {
    actor: { displayName: "林老师" },
    selectedReleaseId: null,
    releaseOptions: releaseOptions.map((option) => ({
      ...option,
      classroomName: "七年一班",
      publishedAt: "2026-08-18T10:00:00.000Z",
    })),
    rubric: [],
    stages: [],
    improvement: emptyImprovement,
  };
}

function dimension(
  dimensionIndex: number,
  dimensionName: string,
  sampleCount: number,
  lowCount: number,
  weak = false,
) {
  return {
    dimensionIndex,
    dimensionName,
    sampleCount,
    excellent: 0,
    good: sampleCount - lowCount,
    pass: 0,
    improve: lowCount,
    insufficient: 0,
    weak,
    lowCount,
  };
}

function diagnosis(overrides: Record<string, unknown> = {}) {
  return {
    releaseId: ACTIVE_ID,
    title: "校园节水行动",
    classroomName: "七年一班",
    status: "ACTIVE",
    dueAt: null,
    unit: "人",
    audienceCount: 3,
    completeCount: 1,
    lanes: [
      {
        key: "not_started",
        label: "尚未开始",
        audiences: [
          {
            key: "student:c",
            kind: "student",
            name: "赵强",
            stageKey: "not_started",
            idleDays: null,
            stalled: false,
            latestSubmissionId: null,
          },
        ],
      },
      {
        key: "phase:1",
        label: "读数与估算",
        audiences: [
          {
            key: "student:b",
            kind: "student",
            name: "王芳",
            stageKey: "phase:1",
            idleDays: 6,
            stalled: true,
            latestSubmissionId: "80000000-0000-4000-8000-000000000002",
          },
        ],
      },
      {
        key: "complete",
        label: "全部完成",
        audiences: [
          {
            key: "student:a",
            kind: "student",
            name: "陈同学",
            stageKey: "complete",
            idleDays: 1,
            stalled: false,
            latestSubmissionId: "80000000-0000-4000-8000-000000000001",
          },
        ],
      },
    ],
    matrix: {
      status: "ready",
      sampleCount: 4,
      dimensions: [
        dimension(1, "数据与证据", 4, 0),
        dimension(2, "跨学科连接", 4, 3, true),
      ],
      rows: [
        {
          submissionId: "80000000-0000-4000-8000-000000000001",
          audienceName: "陈同学",
          phaseLabel: null,
          evaluated: true,
          cells: ["good", "improve"],
        },
        {
          submissionId: "80000000-0000-4000-8000-000000000003",
          audienceName: "李明",
          phaseLabel: "现场认定",
          evaluated: true,
          cells: ["irrelevant", "insufficient"],
        },
      ],
    },
    improvement: emptyImprovement,
    alerts: [
      {
        kind: "stalled",
        tone: "attention",
        text: "「读数与估算」有 1 人超过 5 天没有改动",
        basis: "王芳 · 最久 6 天",
        action: { label: "查看是谁", query: "?stage=phase%3A1#progress", primary: false },
      },
      {
        kind: "awaiting_feedback",
        tone: "attention",
        text: "1 份提交在等你的反馈",
        basis: "最早的一份已经等了 2 天",
        action: { label: "开始评阅", query: "?queue=feedback", primary: true },
      },
    ],
    ...overrides,
  };
}

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

  it("shows the no-release empty state without asking for a diagnosis", async () => {
    mocks.getTeacherInsights.mockResolvedValue(dashboard([]));

    const markup = await renderPage();
    expect(markup).toContain("暂无可查看的发布");
    expect(markup).not.toContain("NaN");
    expect(mocks.getTeacherReleaseDiagnosis).not.toHaveBeenCalled();
  });

  it("opens the most recent open release when none is requested", async () => {
    mocks.getTeacherInsights.mockResolvedValue(
      dashboard([
        { id: CLOSED_ID, title: "节水倡议展示", status: "CLOSED" },
        { id: ACTIVE_ID, title: "校园节水行动", status: "ACTIVE" },
      ]),
    );
    mocks.getTeacherReleaseDiagnosis.mockResolvedValue(diagnosis());

    const markup = await renderPage();
    expect(mocks.getTeacherReleaseDiagnosis).toHaveBeenCalledWith(
      mocks.database,
      mocks.context,
      { releaseId: ACTIVE_ID },
    );
    // Every release stays one click away, and only the open one is current.
    expect(markup).toContain(`href="/teacher/insights?release=${CLOSED_ID}"`);
    expect(markup).toMatch(
      new RegExp(`href="/teacher/insights\\?release=${ACTIVE_ID}" aria-current="page"`),
    );
  });

  it("falls back to the default release when the requested one is not visible", async () => {
    mocks.getTeacherInsights.mockResolvedValue(
      dashboard([{ id: ACTIVE_ID, title: "校园节水行动", status: "ACTIVE" }]),
    );
    mocks.getTeacherReleaseDiagnosis.mockResolvedValue(diagnosis());

    await renderPage({ release: "90000000-0000-4000-8000-000000000009" });
    expect(mocks.getTeacherReleaseDiagnosis).toHaveBeenCalledWith(
      mocks.database,
      mocks.context,
      { releaseId: ACTIVE_ID },
    );
  });

  it("turns each alert into a link to the matching roster view", async () => {
    mocks.getTeacherInsights.mockResolvedValue(
      dashboard([{ id: ACTIVE_ID, title: "校园节水行动", status: "ACTIVE" }]),
    );
    mocks.getTeacherReleaseDiagnosis.mockResolvedValue(diagnosis());

    const markup = await renderPage({ release: ACTIVE_ID });
    expect(markup).toContain("3 人中 1 人已全部完成");
    expect(markup).toContain("「读数与估算」有 1 人超过 5 天没有改动");
    expect(markup).toContain(
      `href="/teacher/releases/${ACTIVE_ID}/submissions?stage=phase%3A1#progress"`,
    );
    expect(markup).toContain(
      `href="/teacher/releases/${ACTIVE_ID}/submissions?queue=feedback"`,
    );
    expect(markup).toContain("开始评阅");
  });

  it("names who sits in each stage and links only audiences with a submission", async () => {
    mocks.getTeacherInsights.mockResolvedValue(
      dashboard([{ id: ACTIVE_ID, title: "校园节水行动", status: "ACTIVE" }]),
    );
    mocks.getTeacherReleaseDiagnosis.mockResolvedValue(diagnosis());

    const markup = await renderPage({ release: ACTIVE_ID });
    expect(markup).toContain("王芳");
    expect(markup).toContain("6 天没动");
    expect(markup).toContain(
      'href="/teacher/submissions/80000000-0000-4000-8000-000000000002"',
    );
    // 赵强 has not started: named, but there is nothing to open.
    expect(markup).toContain("赵强");
    expect(markup).not.toMatch(/<a[^>]*>(?:(?!<\/a>).)*赵强/);
  });

  it("renders the matrix with counts instead of percentages", async () => {
    mocks.getTeacherInsights.mockResolvedValue(
      dashboard([{ id: ACTIVE_ID, title: "校园节水行动", status: "ACTIVE" }]),
    );
    mocks.getTeacherReleaseDiagnosis.mockResolvedValue(diagnosis());

    const markup = await renderPage({ release: ACTIVE_ID });
    expect(markup).toContain("4 份当前正式修订已评价");
    expect(markup).toContain("多数偏弱");
    expect(markup).toContain("4 份中 3 份");
    expect(markup).toContain(
      `href="/teacher/releases/${ACTIVE_ID}/submissions?dim=2"`,
    );
    expect(markup).toContain("4 份中 0 份");
    expect(markup).not.toContain(
      `href="/teacher/releases/${ACTIVE_ID}/submissions?dim=1"`,
    );
    expect(markup).toContain("现场认定");
    expect(markup).toContain("与该阶段无关");
    expect(markup).not.toMatch(/\d\s*%(?![0-9A-F]{2})/);
    expect(markup).not.toContain("综评");
  });

  it("says so plainly when nothing has been evaluated or nothing needs attention", async () => {
    mocks.getTeacherInsights.mockResolvedValue(
      dashboard([{ id: ACTIVE_ID, title: "校园节水行动", status: "ACTIVE" }]),
    );
    mocks.getTeacherReleaseDiagnosis.mockResolvedValue(
      diagnosis({
        alerts: [],
        matrix: { status: "no_evaluations", sampleCount: 0, dimensions: [], rows: [] },
      }),
    );

    const markup = await renderPage({ release: ACTIVE_ID });
    expect(markup).toContain("目前没有需要特别留意的地方");
    expect(markup).toContain("暂无已确认的量规评价");
    expect(markup).not.toContain("重交之后");
  });

  it("guides a student back without reading insights", async () => {
    mocks.getTeacherInsights.mockRejectedValue(
      new TeacherActivityQueryError("WRONG_ROLE", "陈同学"),
    );

    const markup = await renderPage();
    expect(markup).toContain("当前登录的是学生账号");
    expect(markup).toContain('href="/student"');
    expect(markup).not.toContain("量规评价");
    expect(mocks.getTeacherReleaseDiagnosis).not.toHaveBeenCalled();
  });

  it("authenticates before reading insights", async () => {
    mocks.createUiCommandContext.mockRejectedValue(
      new AuthenticationError("UNAUTHENTICATED"),
    );

    const markup = await renderPage();
    expect(markup).toContain("安全门");
    expect(mocks.getTeacherInsights).not.toHaveBeenCalled();
    expect(mocks.getTeacherReleaseDiagnosis).not.toHaveBeenCalled();
  });
});
