import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  database: { kind: "teacher-release-submissions-page-database" },
  getDatabaseClient: vi.fn(),
  createUiCommandContext: vi.fn(),
  getTeacherReleaseSubmissions: vi.fn(),
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
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => `/teacher/releases/${releaseId}/submissions`,
}));
vi.mock("../../../../../server/db/client", () => ({
  getDatabaseClient: mocks.getDatabaseClient,
}));
vi.mock(
  "../../../../../server/commands/create-ui-command-context",
  () => ({ createUiCommandContext: mocks.createUiCommandContext }),
);
vi.mock("../../../../../server/auth/current-actor", () => ({
  AuthenticationError: class AuthenticationError extends Error {
    constructor(public readonly code: string) {
      super(code);
      this.name = "AuthenticationError";
    }
  },
}));
vi.mock("../../../../../server/queries/submission-workspace", () => ({
  SubmissionWorkspaceQueryError: class SubmissionWorkspaceQueryError extends Error {
    constructor(public readonly code: string) {
      super(code);
      this.name = "SubmissionWorkspaceQueryError";
    }
  },
  getTeacherReleaseSubmissions: mocks.getTeacherReleaseSubmissions,
}));

import { AuthenticationError } from "../../../../../server/auth/current-actor";
import { SubmissionWorkspaceQueryError } from "../../../../../server/queries/submission-workspace";
import TeacherReleaseSubmissionsPage from "./page";

const releaseId = "10000000-0000-4000-8000-000000000001";
const classroomId = "60000000-0000-4000-8000-000000000006";
const submissionId = "20000000-0000-4000-8000-000000000002";
const studentId = "30000000-0000-4000-8000-000000000003";
const trustedContext = {
  actorId: "40000000-0000-4000-8000-000000000004",
  source: "UI" as const,
  traceId: "teacher-release-page-trace",
  clock: () => new Date("2026-08-18T12:00:00.000Z"),
};
const workspace = {
  actor: { displayName: "林老师" },
  release: {
    id: releaseId,
    title: "校园水表观察",
    classroomId,
    classroomName: "七年一班",
    status: "ACTIVE",
    publishedAt: "2026-08-18T10:00:00.000Z",
    dueAt: "2026-08-20T12:00:00.000Z",
    executionVersion: 0,
    submissionMode: "once",
    phaseCount: 0,
    rubricAvailable: false,
  },
  submissions: [
    {
      submissionId,
      phaseIndex: 0,
      phaseName: null,
      student: { id: studentId, displayName: "陈同学" },
      group: null,
      workingCopy: { textEvidence: "学生工作副本正文" },
      currentRevision: {
        id: "50000000-0000-4000-8000-000000000005",
        revisionNumber: 2,
        isLate: true,
        submittedAt: "2026-08-19T13:00:00.000Z",
        textEvidence: "学生正式提交正文",
        feedback: {
          currentVersion: 3,
          body: "教师正式反馈正文",
        },
        evaluation: null,
        followUp: null,
      },
    },
  ],
  progress: [
    {
      student: { id: studentId, displayName: "陈同学" },
      group: null,
      started: true,
      completedPhaseCount: 0,
      totalPhaseCount: 0,
      currentPhaseIndex: 0,
      complete: true,
      awaitingFormalRevision: false,
    },
  ],
  reviewCoverage: {
    currentRevisionCount: 1,
    feedbackCount: 1,
    evaluationCount: 0,
  },
};

async function renderPage(): Promise<string> {
  const page = await TeacherReleaseSubmissionsPage({
    params: Promise.resolve({ releaseId }),
  });
  return renderToStaticMarkup(page);
}

describe("teacher release submissions page boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDatabaseClient.mockReturnValue(mocks.database);
    mocks.createUiCommandContext.mockResolvedValue(trustedContext);
    mocks.getTeacherReleaseSubmissions.mockResolvedValue(workspace);
  });

  it("does not open the database or query release data when auth is not configured", async () => {
    mocks.createUiCommandContext.mockRejectedValue(
      new AuthenticationError("AUTH_NOT_CONFIGURED"),
    );

    const markup = await renderPage();

    expect(markup).toContain("教师工作台当前没有开放");
    expect(markup).not.toContain("校园水表观察");
    expect(markup).not.toContain("陈同学");
    expect(markup).not.toContain("导出评阅名册");
    expect(markup).not.toContain("准备关闭活动");
    expect(mocks.getDatabaseClient).not.toHaveBeenCalled();
    expect(mocks.getTeacherReleaseSubmissions).not.toHaveBeenCalled();
  });

  it("does not render a close write entrypoint for an unauthorized actor", async () => {
    mocks.createUiCommandContext.mockRejectedValue(
      new AuthenticationError("USER_NOT_PROVISIONED"),
    );

    const markup = await renderPage();

    expect(markup).toContain('href="/teacher/login"');
    expect(markup).toContain("切换教师账号");
    expect(markup).not.toContain("准备关闭活动");
    expect(markup).not.toContain("确认并关闭活动");
    expect(markup).not.toContain("导出评阅名册");
    expect(mocks.getDatabaseClient).not.toHaveBeenCalled();
    expect(mocks.getTeacherReleaseSubmissions).not.toHaveBeenCalled();
  });

  it("renders only safe release and current formal revision metadata", async () => {
    const markup = await renderPage();

    expect(mocks.getTeacherReleaseSubmissions).toHaveBeenCalledWith(
      mocks.database,
      trustedContext,
      { releaseId },
    );
    expect(markup).toContain("校园水表观察");
    expect(markup).toContain("七年一班");
    expect(markup).toContain('aria-label="面包屑"');
    expect(markup).toContain(`href="/teacher/classrooms/${classroomId}/members"`);
    expect(markup).toContain("陈同学");
    expect(markup).toContain("正式修订 2");
    expect(markup).toContain("已反馈 v3");
    expect(markup).toContain("已反馈 1/1");
    expect(markup).toContain("无量规");
    expect(markup).toContain("查看反馈与评价");
    expect(markup).toContain(
      `href="/teacher/releases/${releaseId}/submissions/export"`,
    );
    expect(markup).toContain("导出评阅名册");
    expect(markup).not.toContain("待评价");
    expect(markup).not.toContain("已评价");
    expect(markup).toContain("迟交");
    expect(markup).not.toContain("学生工作副本正文");
    expect(markup).not.toContain("待重交");
    expect(markup).not.toContain("重交中");
    expect(markup).not.toContain("尚未正式提交");
    expect(markup).not.toContain("学生正式提交正文");
    expect(markup).not.toContain("教师正式反馈正文");
    expect(markup).not.toContain("auth_subject");
    expect(markup).toContain("准备关闭活动");
    expect(markup).not.toContain("确认并关闭活动");
  });

  it("shows pending or confirmed evaluation status only for schema v2 releases", async () => {
    mocks.getTeacherReleaseSubmissions.mockResolvedValue({
      ...workspace,
      release: { ...workspace.release, rubricAvailable: true },
      submissions: [
        {
          ...workspace.submissions[0],
          currentRevision: {
            ...workspace.submissions[0]!.currentRevision,
            evaluation: null,
          },
        },
      ],
      reviewCoverage: {
        currentRevisionCount: 1,
        feedbackCount: 1,
        evaluationCount: 0,
      },
    });

    expect(await renderPage()).toContain("待评价");
    expect(await renderPage()).toContain("已评价 0/1");
    expect(await renderPage()).not.toContain("无量规");

    mocks.getTeacherReleaseSubmissions.mockResolvedValue({
      ...workspace,
      release: { ...workspace.release, rubricAvailable: true },
      submissions: [
        {
          ...workspace.submissions[0],
          currentRevision: {
            ...workspace.submissions[0]!.currentRevision,
            evaluation: { currentVersion: 1, summary: "不应出现在列表" },
          },
        },
      ],
      reviewCoverage: {
        currentRevisionCount: 1,
        feedbackCount: 1,
        evaluationCount: 1,
      },
    });

    const confirmed = await renderPage();
    expect(confirmed).toContain("已评价 v1");
    expect(confirmed).toContain("已评价 1/1");
    expect(confirmed).not.toContain("不应出现在列表");
    expect(confirmed).not.toContain("待评价");
    expect(confirmed).not.toContain("已评价 0/1");
  });

  it("renders one shared group progress row with member roles", async () => {
    const group = {
      id: "91000000-0000-4000-8000-000000000001",
      name: "校园调查组",
      members: [
        {
          student: { id: studentId, displayName: "陈同学" },
          roleLabel: "记录",
        },
        {
          student: {
            id: "92000000-0000-4000-8000-000000000002",
            displayName: "周同学",
          },
          roleLabel: "汇报",
        },
      ],
    };
    mocks.getTeacherReleaseSubmissions.mockResolvedValue({
      ...workspace,
      release: {
        ...workspace.release,
        executionVersion: 1,
        submissionMode: "phased",
        phaseCount: 3,
      },
      submissions: [{ ...workspace.submissions[0], group }],
      progress: [
        {
          student: { id: group.id, displayName: group.name },
          group,
          started: true,
          completedPhaseCount: 1,
          totalPhaseCount: 3,
          currentPhaseIndex: 2,
          complete: false,
          awaitingFormalRevision: false,
        },
      ],
    });

    const markup = await renderPage();

    expect(markup).toContain("共享提交分组");
    expect(markup).toContain("校园调查组");
    expect(markup).toContain("陈同学（记录）");
    expect(markup).toContain("周同学（汇报）");
    expect(markup).toContain("已有提交 · 已锁定");
    expect(markup).toContain("当前第 2 阶段");
    expect(markup).not.toContain("尚未正式提交");
  });

  it("renders follow-up flags without leaking working-copy or evaluation bodies", async () => {
    mocks.getTeacherReleaseSubmissions.mockResolvedValue({
      ...workspace,
      release: {
        ...workspace.release,
        executionVersion: 1,
        submissionMode: "phased",
        phaseCount: 3,
      },
      submissions: [
        {
          ...workspace.submissions[0],
          currentRevision: {
            ...workspace.submissions[0]!.currentRevision,
            followUp: "AWAITING_RESUBMISSION",
          },
        },
      ],
      progress: [
        {
          ...workspace.progress[0]!,
          complete: false,
          started: true,
          currentPhaseIndex: 2,
          completedPhaseCount: 1,
          totalPhaseCount: 3,
          awaitingFormalRevision: true,
        },
      ],
    });

    const awaiting = await renderPage();
    expect(awaiting).toContain("待重交 1");
    expect(awaiting).toContain(" · 待重交");
    expect(awaiting).toContain("尚未正式提交");
    expect(awaiting).not.toContain("重交中");
    expect(awaiting).not.toContain("学生工作副本正文");
    expect(awaiting).not.toContain("教师正式反馈正文");

    mocks.getTeacherReleaseSubmissions.mockResolvedValue({
      ...workspace,
      submissions: [
        {
          ...workspace.submissions[0],
          currentRevision: {
            ...workspace.submissions[0]!.currentRevision,
            followUp: "RESUBMISSION_IN_PROGRESS",
          },
        },
      ],
    });

    const inProgress = await renderPage();
    expect(inProgress).toContain("重交中");
    expect(inProgress).not.toContain("待重交");
  });

  it("does not render a close write entrypoint for a closed release", async () => {
    mocks.getTeacherReleaseSubmissions.mockResolvedValue({
      ...workspace,
      release: { ...workspace.release, status: "CLOSED" },
    });

    const markup = await renderPage();

    expect(markup).not.toContain("准备关闭活动");
    expect(markup).not.toContain("确认并关闭活动");
  });

  it("maps a hidden unauthorized release to not found", async () => {
    mocks.getTeacherReleaseSubmissions.mockRejectedValue(
      new SubmissionWorkspaceQueryError("NOT_FOUND"),
    );

    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
