import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  database: { kind: "student-dashboard-test-database" },
  getDatabaseClient: vi.fn(),
  createUiCommandContext: vi.fn(),
  listStudentReleases: vi.fn(),
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
  usePathname: () => "/student",
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
vi.mock("../../server/queries/student-releases", () => ({
  StudentReleaseListQueryError: class StudentReleaseListQueryError extends Error {
    constructor(public readonly code: string) {
      super(code);
      this.name = "StudentReleaseListQueryError";
    }
  },
  listStudentReleases: mocks.listStudentReleases,
}));

import { AuthenticationError } from "../../server/auth/current-actor";
import StudentDashboardPage from "./page";

const trustedContext = {
  actorId: "50000000-0000-4000-8000-000000000005",
  source: "UI" as const,
  traceId: "student-dashboard-trace",
  clock: () => new Date("2026-08-18T12:00:00.000Z"),
};
const pendingReleaseId = "10000000-0000-4000-8000-000000000001";
const feedbackReleaseId = "20000000-0000-4000-8000-000000000002";
const historyReleaseId = "30000000-0000-4000-8000-000000000003";
const releaseList = {
  releases: [
    {
      id: pendingReleaseId,
      status: "ACTIVE",
      publishedAt: "2026-08-18T10:00:00.000Z",
      dueAt: "2026-08-18T11:00:00.000Z",
      access: { canWrite: true },
      snapshot: {
        title: "待提交活动",
        summary: "仍有工作草稿",
      },
      submission: {
        latestRevisionNumber: 0,
        hasWorkingCopy: true,
        hasCurrentFeedback: false,
      },
    },
    {
      id: feedbackReleaseId,
      status: "ACTIVE",
      publishedAt: "2026-08-18T09:00:00.000Z",
      dueAt: null,
      access: { canWrite: true },
      snapshot: {
        title: "已有反馈活动",
        summary: "查看教师反馈",
      },
      submission: {
        latestRevisionNumber: 1,
        hasWorkingCopy: false,
        hasCurrentFeedback: true,
      },
    },
    {
      id: historyReleaseId,
      status: "CLOSED",
      publishedAt: "2026-08-17T09:00:00.000Z",
      dueAt: null,
      access: { canWrite: false },
      snapshot: {
        title: "历史活动",
        summary: "只读保留",
      },
      submission: {
        latestRevisionNumber: 1,
        hasWorkingCopy: false,
        hasCurrentFeedback: false,
      },
    },
  ],
};

async function renderPage(): Promise<string> {
  return renderToStaticMarkup(await StudentDashboardPage());
}

describe("student dashboard page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDatabaseClient.mockReturnValue(mocks.database);
    mocks.createUiCommandContext.mockResolvedValue(trustedContext);
    mocks.listStudentReleases.mockResolvedValue(releaseList);
  });

  it("does not touch the database or render Clerk when auth is unconfigured", async () => {
    mocks.createUiCommandContext.mockRejectedValue(
      new AuthenticationError("AUTH_NOT_CONFIGURED"),
    );

    const markup = await renderPage();

    expect(markup).toContain("学习活动入口尚未开放");
    expect(markup).not.toContain("data-clerk-sign-in");
    expect(mocks.getDatabaseClient).not.toHaveBeenCalled();
    expect(mocks.listStudentReleases).not.toHaveBeenCalled();
  });

  it("renders the official Clerk sign-in control only when unauthenticated", async () => {
    mocks.createUiCommandContext.mockRejectedValue(
      new AuthenticationError("UNAUTHENTICATED"),
    );

    const markup = await renderPage();

    expect(markup).toContain('data-clerk-sign-in="true"');
    expect(markup).toContain("登录学生账号");
    expect(mocks.listStudentReleases).not.toHaveBeenCalled();
  });

  it("lets an unbound user sign out and switch to a test account", async () => {
    mocks.createUiCommandContext.mockRejectedValue(
      new AuthenticationError("USER_NOT_PROVISIONED"),
    );

    const markup = await renderPage();

    expect(markup).toContain('data-clerk-sign-out="true"');
    expect(markup).toContain("退出当前账号");
    expect(markup).not.toContain('data-clerk-sign-in="true"');
  });

  it("groups real release links by progress without placeholder buttons", async () => {
    const markup = await renderPage();

    expect(markup).toContain("待提交");
    expect(markup).toContain("已有反馈");
    expect(markup).toContain("历史与关闭");
    expect(markup).toContain("仍可迟交");
    expect(markup).toContain(`/student/releases/${pendingReleaseId}`);
    expect(markup).toContain(`/student/releases/${feedbackReleaseId}`);
    expect(markup).toContain(`/student/releases/${historyReleaseId}`);
    expect(markup).not.toContain("创建活动");
    expect(markup).not.toContain("打开导航");
    expect(markup).not.toContain("<button");
    expect(mocks.listStudentReleases).toHaveBeenCalledWith(
      mocks.database,
      trustedContext,
      {},
    );
  });

  it("renders a truthful empty state without a fake action", async () => {
    mocks.listStudentReleases.mockResolvedValue({ releases: [] });

    const markup = await renderPage();

    expect(markup).toContain("还没有对你开放的学习活动");
    expect(markup).not.toContain("创建活动");
    expect(markup).not.toContain("提交活动");
  });
});
