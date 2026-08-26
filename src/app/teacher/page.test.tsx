import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  database: { kind: "teacher-dashboard-test-database" },
  getDatabaseClient: vi.fn(),
  createUiCommandContext: vi.fn(),
  getTeacherActivityDashboard: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs", () => ({
  SignInButton: ({ children }: { children: ReactNode }) => (
    <span data-clerk-sign-in="true">{children}</span>
  ),
  SignOutButton: ({ children }: { children: ReactNode }) => (
    <span data-clerk-sign-out="true">{children}</span>
  ),
}));
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
  usePathname: () => "/teacher",
}));
vi.mock("../../server/db/client", () => ({
  getDatabaseClient: mocks.getDatabaseClient,
}));
vi.mock("../../server/commands/create-ui-command-context", () => ({
  createUiCommandContext: mocks.createUiCommandContext,
}));
vi.mock("../../server/auth/current-actor", () => ({
  AuthenticationError: class AuthenticationError extends Error {
    constructor(public readonly code: string) {
      super(code);
      this.name = "AuthenticationError";
    }
  },
}));
vi.mock("../../server/queries/teacher-activity-workspace", () => ({
  TeacherActivityQueryError: class TeacherActivityQueryError extends Error {
    constructor(
      public readonly code: string,
      public readonly actorName?: string,
    ) {
      super(code);
      this.name = "TeacherActivityQueryError";
    }
  },
  getTeacherActivityDashboard: mocks.getTeacherActivityDashboard,
}));

import {
  TeacherActivityQueryError,
} from "../../server/queries/teacher-activity-workspace";
import TeacherDashboardPage from "./page";

const trustedContext = {
  actorId: "50000000-0000-4000-8000-000000000005",
  source: "UI" as const,
  traceId: "teacher-dashboard-trace",
  clock: () => new Date("2026-08-18T12:00:00.000Z"),
};

async function renderPage(): Promise<string> {
  return renderToStaticMarkup(await TeacherDashboardPage());
}

describe("teacher dashboard role guidance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDatabaseClient.mockReturnValue(mocks.database);
    mocks.createUiCommandContext.mockResolvedValue(trustedContext);
  });

  it("guides a student back without rendering teacher resources", async () => {
    mocks.getTeacherActivityDashboard.mockRejectedValue(
      new TeacherActivityQueryError("WRONG_ROLE", "陈同学"),
    );

    const markup = await renderPage();

    expect(markup).toContain("当前登录的是学生账号");
    expect(markup).toContain('href="/student"');
    expect(markup).toContain("当前账号：陈同学 · 学生");
    expect(markup).toContain("退出登录");
    expect(markup).not.toContain("新建学习活动");
  });

  it("keeps ordinary query failures on the not-found boundary", async () => {
    mocks.getTeacherActivityDashboard.mockRejectedValue(
      new TeacherActivityQueryError("NOT_FOUND"),
    );

    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("renders release attention counts without leaking evaluation or draft bodies", async () => {
    mocks.getTeacherActivityDashboard.mockResolvedValue({
      actor: { displayName: "林老师" },
      drafts: [],
      classrooms: [],
      releases: [
        {
          id: "60000000-0000-4000-8000-000000000006",
          title: "校园水表观察",
          classroomName: "七年一班",
          status: "ACTIVE",
          publishedAt: "2026-08-18T10:00:00.000Z",
          dueAt: null,
          canViewSubmissions: true,
          attention: {
            pendingFeedbackCount: 2,
            pendingEvaluationCount: 2,
            awaitingResubmissionCount: 1,
          },
        },
      ],
    });

    const markup = await renderPage();
    expect(markup).toContain("校园水表观察");
    expect(markup).toContain("待反馈 2");
    expect(markup).toContain("待评价 2");
    expect(markup).toContain("待重交 1");
    expect(markup).toContain("查看提交");
    expect(markup).not.toContain("学生工作副本正文");
    expect(markup).not.toContain("综评");
    expect(markup).not.toContain("已评价");
  });

  it("hides pending evaluation copy when the count is zero", async () => {
    mocks.getTeacherActivityDashboard.mockResolvedValue({
      actor: { displayName: "林老师" },
      drafts: [],
      classrooms: [],
      releases: [
        {
          id: "60000000-0000-4000-8000-000000000006",
          title: "校园水表观察",
          classroomName: "七年一班",
          status: "ACTIVE",
          publishedAt: "2026-08-18T10:00:00.000Z",
          dueAt: null,
          canViewSubmissions: true,
          attention: {
            pendingFeedbackCount: 2,
            pendingEvaluationCount: 0,
            awaitingResubmissionCount: 1,
          },
        },
      ],
    });

    const markup = await renderPage();
    expect(markup).toContain("待反馈 2");
    expect(markup).toContain("待重交 1");
    expect(markup).not.toContain("待评价");
  });
});
