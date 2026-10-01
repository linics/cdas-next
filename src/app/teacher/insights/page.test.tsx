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
  getReleaseAnswerSummaries: vi.fn(),
  isActivityAssistantEnabled: vi.fn(),
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
vi.mock("../../../server/queries/release-answer-summaries", () => ({
  getReleaseAnswerSummaries: mocks.getReleaseAnswerSummaries,
}));
vi.mock("../../../server/assistant/assistant-config", () => ({
  isActivityAssistantEnabled: mocks.isActivityAssistantEnabled,
}));
vi.mock("./answer-summary-trigger", () => ({
  AnswerSummaryTrigger: ({
    answerCount,
    hasSummary,
    phaseIndex,
  }: {
    answerCount: number;
    hasSummary: boolean;
    phaseIndex: number;
  }) => (
    <button data-phase={phaseIndex} type="button">
      {hasSummary ? `重新归纳这 ${answerCount} 份` : `归纳这 ${answerCount} 份作答`}
    </button>
  ),
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
    evidence: [
      {
        phaseIndex: 1,
        phaseName: "现场认定",
        submittedCount: 3,
        items: [
          {
            evidenceIndex: 1,
            description: "漏水点的位置与照片",
            typeLabel: "图片",
            doneCount: 1,
            missing: [
              {
                submissionId: "80000000-0000-4000-8000-000000000004",
                audienceName: "李明",
                phaseLabel: null,
              },
              {
                submissionId: "80000000-0000-4000-8000-000000000002",
                audienceName: "王芳",
                phaseLabel: null,
              },
            ],
          },
        ],
      },
    ],
    resubmission: {
      reviseCount: 2,
      resubmittedCount: 1,
      awaiting: [
        {
          submissionId: "80000000-0000-4000-8000-000000000002",
          audienceName: "王芳",
          phaseLabel: "读数与估算",
        },
      ],
      pairs: [
        {
          submissionId: "80000000-0000-4000-8000-000000000001",
          audienceName: "陈同学",
          phaseLabel: null,
          moves: [
            { dimensionName: "数据与证据", before: "improve", after: "pass", movement: "rose" },
            { dimensionName: "跨学科连接", before: "improve", after: "improve", movement: "unchanged" },
          ],
        },
      ],
      rose: 1,
      unchanged: 1,
      fell: 0,
    },
    support: {
      tiers: [
        {
          level: "FOUNDATION",
          label: "基础支持",
          audiences: [
            { name: "王芳", submissionId: "80000000-0000-4000-8000-000000000002" },
          ],
        },
        { level: "STANDARD", label: "标准任务", audiences: [] },
        { level: "CHALLENGE", label: "挑战拓展", audiences: [] },
      ],
    },
    alerts: [
      {
        kind: "stalled",
        tone: "attention",
        text: "「读数与估算」有 1 人超过 5 天没有改动",
        basis: "王芳 · 最久 6 天",
        action: {
          label: "查看是谁",
          target: "roster",
          query: "?stage=phase%3A1#progress",
          primary: false,
        },
      },
      {
        kind: "awaiting_feedback",
        tone: "attention",
        text: "1 份提交在等你的反馈",
        basis: "最早的一份已经等了 2 天",
        action: {
          label: "开始评阅",
          target: "roster",
          query: "?queue=feedback",
          primary: true,
        },
      },
      {
        kind: "evidence_gap",
        tone: "attention",
        text: "「现场认定」的「漏水点的位置与照片」3 份中 2 份没勾选",
        basis: "多数人没交这一项，可能是任务书没讲清要交什么，或这一项要求过重",
        action: { label: "看是哪几份", target: "page", query: "#evidence", primary: false },
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
    mocks.getReleaseAnswerSummaries.mockResolvedValue([]);
    mocks.isActivityAssistantEnabled.mockReturnValue(true);
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
        evidence: [],
        resubmission: {
          reviseCount: 0,
          resubmittedCount: 0,
          awaiting: [],
          pairs: [],
          rose: 0,
          unchanged: 0,
          fell: 0,
        },
        support: null,
      }),
    );

    const markup = await renderPage({ release: ACTIVE_ID });
    expect(markup).toContain("目前没有需要特别留意的地方");
    expect(markup).toContain("暂无已确认的量规评价");
    expect(markup).not.toContain("重交之后");
    expect(markup).not.toContain("证据交齐了吗");
    expect(markup).not.toContain("你给的支架");
  });

  it("shows which evidence item was skipped and by whom", async () => {
    mocks.getTeacherInsights.mockResolvedValue(
      dashboard([{ id: ACTIVE_ID, title: "校园节水行动", status: "ACTIVE" }]),
    );
    mocks.getTeacherReleaseDiagnosis.mockResolvedValue(diagnosis());

    const markup = await renderPage({ release: ACTIVE_ID });
    expect(markup).toContain('id="evidence"');
    expect(markup).toContain("漏水点的位置与照片");
    expect(markup).toContain("3 份中 1 份已勾选");
    expect(markup).toContain(
      'href="/teacher/submissions/80000000-0000-4000-8000-000000000004"',
    );
    // The evidence alert stays on this page instead of going to the roster.
    expect(markup).toContain('href="#evidence"');
  });

  it("shows resubmission changes per person and the scaffold tiers", async () => {
    mocks.getTeacherInsights.mockResolvedValue(
      dashboard([{ id: ACTIVE_ID, title: "校园节水行动", status: "ACTIVE" }]),
    );
    mocks.getTeacherReleaseDiagnosis.mockResolvedValue(diagnosis());

    const markup = await renderPage({ release: ACTIVE_ID });
    expect(markup).toContain("要求重交 2 份，其中 1 份已重交");
    expect(markup).toContain("还没重交：");
    expect(markup).toContain('aria-label="上升到"');
    expect(markup).toContain('aria-label="保持"');
    expect(markup).toContain("按维度合计：上升 1，持平 1，下降 0。");
    expect(markup).toContain("你给的支架");
    expect(markup).toContain("基础支持");
    expect(markup).toContain("学生看不到");
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

  const answerPhases = [
    {
      phaseIndex: 1,
      phaseLabel: "现场认定",
      answerCount: 4,
      canSummarize: true,
      latest: {
        id: "70000000-0000-4000-8000-000000000001",
        createdAt: "2026-10-01T08:00:00.000Z",
        summary: "多数作答写了漏水点的位置，但很少说明是怎么判断的。",
        basisCount: 3,
        changedSinceCount: 1,
        themes: [
          {
            kind: "GAP",
            statement: "只写了位置，没有写判断依据",
            sources: [
              {
                submissionId: "80000000-0000-4000-8000-000000000001",
                audienceName: "陈同学",
                quote: "二楼饮水机旁边在漏水",
              },
              {
                submissionId: "80000000-0000-4000-8000-000000000004",
                audienceName: "李明",
                quote: "操场水龙头一直滴水",
              },
            ],
          },
        ],
      },
    },
    { phaseIndex: 2, phaseLabel: "读数与估算", answerCount: 2, canSummarize: false, latest: null },
    { phaseIndex: 3, phaseLabel: "建议书", answerCount: 0, canSummarize: false, latest: null },
  ];

  it("shows saved answer themes with named, checkable quotes", async () => {
    mocks.getTeacherInsights.mockResolvedValue(
      dashboard([{ id: ACTIVE_ID, title: "校园节水行动", status: "ACTIVE" }]),
    );
    mocks.getTeacherReleaseDiagnosis.mockResolvedValue(diagnosis());
    mocks.getReleaseAnswerSummaries.mockResolvedValue(answerPhases);

    const markup = await renderPage({ release: ACTIVE_ID });
    expect(markup).toContain('id="answers"');
    expect(markup).toContain("只写了位置，没有写判断依据");
    expect(markup).toContain("多数没做到");
    expect(markup).toContain("<q");
    expect(markup).toContain("二楼饮水机旁边在漏水");
    expect(markup).toContain("之后有 1 份新提交或重交，未计入");
    expect(markup).toContain("重新归纳这 4 份");
    // Too few answers: no button, and the reason is stated.
    expect(markup).toContain("有文字的作答不足 3 份");
    expect(markup).not.toContain('data-phase="2"');
    // A phase with nothing to read and nothing saved is left out.
    expect(markup).not.toContain("0 份有文字的作答");
  });

  it("keeps saved themes readable and offers no button when AI is off", async () => {
    mocks.getTeacherInsights.mockResolvedValue(
      dashboard([{ id: ACTIVE_ID, title: "校园节水行动", status: "ACTIVE" }]),
    );
    mocks.getTeacherReleaseDiagnosis.mockResolvedValue(diagnosis());
    mocks.getReleaseAnswerSummaries.mockResolvedValue(answerPhases);
    mocks.isActivityAssistantEnabled.mockReturnValue(false);

    const markup = await renderPage({ release: ACTIVE_ID });
    expect(markup).toContain("只写了位置，没有写判断依据");
    expect(markup).not.toContain("归纳这");
  });
});
