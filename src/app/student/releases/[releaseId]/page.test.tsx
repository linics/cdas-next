import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  database: { kind: "page-test-database" },
  getDatabaseClient: vi.fn(),
  createUiCommandContext: vi.fn(),
  getStudentReleaseWorkspace: vi.fn(),
  getStudentFeedbackWorkspace: vi.fn(),
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
  usePathname: () => `/student/releases/${releaseId}`,
}));
vi.mock("../../../../server/db/client", () => ({
  getDatabaseClient: mocks.getDatabaseClient,
}));
vi.mock("../../../../server/commands/create-ui-command-context", () => ({
  createUiCommandContext: mocks.createUiCommandContext,
}));
vi.mock("../../../../server/auth/current-actor", () => ({
  AuthenticationError: class AuthenticationError extends Error {
    constructor(public readonly code: string) {
      super(code);
      this.name = "AuthenticationError";
    }
  },
}));
vi.mock("../../../../server/queries/submission-workspace", () => ({
  SubmissionWorkspaceQueryError: class SubmissionWorkspaceQueryError extends Error {
    constructor(public readonly code: string) {
      super(code);
      this.name = "SubmissionWorkspaceQueryError";
    }
  },
  getStudentReleaseWorkspace: mocks.getStudentReleaseWorkspace,
}));
vi.mock("../../../../server/queries/feedback-workspace", () => ({
  FeedbackWorkspaceQueryError: class FeedbackWorkspaceQueryError extends Error {
    constructor(public readonly code: string) {
      super(code);
      this.name = "FeedbackWorkspaceQueryError";
    }
  },
  getStudentFeedbackWorkspace: mocks.getStudentFeedbackWorkspace,
}));
vi.mock("./submission-editor", () => ({
  SubmissionEditor: ({ canWrite }: { canWrite: boolean }) => (
    <div data-submission-editor="true" data-can-write={String(canWrite)} />
  ),
}));

import { AuthenticationError } from "../../../../server/auth/current-actor";
import { FeedbackWorkspaceQueryError } from "../../../../server/queries/feedback-workspace";
import StudentReleasePage from "./page";

const releaseId = "10000000-0000-4000-8000-000000000001";
const submissionId = "20000000-0000-4000-8000-000000000002";
const firstRevisionId = "30000000-0000-4000-8000-000000000003";
const secondRevisionId = "40000000-0000-4000-8000-000000000004";
const teacherId = "60000000-0000-4000-8000-000000000006";
const trustedContext = {
  actorId: "50000000-0000-4000-8000-000000000005",
  source: "UI" as const,
  traceId: "server-page-trace",
  clock: () => new Date("2026-08-18T12:00:00.000Z"),
};
const workspace = {
  actor: { displayName: "陈同学" },
  access: { canWrite: true },
  release: {
    id: releaseId,
    status: "ACTIVE",
    publishedAt: "2026-08-18T10:00:00.000Z",
    dueAt: "2026-08-20T12:00:00.000Z",
    snapshot: {
      sourceDraftVersion: 1,
      contentHash: "a".repeat(64),
      content: {
        schemaVersion: 1,
        title: "校园水表观察",
        summary: "记录并解释水表变化",
        learningObjectives: ["使用数据支持结论"],
        taskInstructions: "记录两次水表读数并解释差异。",
        evidenceRequirements: ["包含时间和读数"],
        feedbackCriteria: ["数据与结论一致"],
      },
    },
  },
  submission: null,
};
const submittedWorkspace = {
  ...workspace,
  submission: {
    id: submissionId,
    latestRevisionNumber: 2,
    workingCopy: null,
    revisions: [
      {
        id: firstRevisionId,
        revisionNumber: 1,
        textEvidence: "第一版正式观察记录",
        isLate: false,
        submittedAt: "2026-08-18T10:30:00.000Z",
        attachments: [],
      },
      {
        id: secondRevisionId,
        revisionNumber: 2,
        textEvidence: "第二版正式观察记录",
        isLate: true,
        submittedAt: "2026-08-18T11:30:00.000Z",
        attachments: [],
      },
    ],
  },
};
const confirmedFeedbackWorkspace = {
  submission: {
    id: submissionId,
    latestRevisionNumber: 2,
    release: {
      ...workspace.release,
      classroom: {
        id: "70000000-0000-4000-8000-000000000007",
        name: "七年一班",
      },
    },
    revisions: [
      {
        ...submittedWorkspace.submission.revisions[0],
        feedback: {
          id: "80000000-0000-4000-8000-000000000008",
          currentVersion: 2,
          teacher: { id: teacherId, displayName: "林老师" },
          revisions: [
            {
              id: "81000000-0000-4000-8000-000000000008",
              version: 1,
              body: "先补上两次读数的单位。",
              source: "AI_ASSISTED",
              confirmedAt: "2026-08-18T10:45:00.000Z",
            },
            {
              id: "82000000-0000-4000-8000-000000000008",
              version: 2,
              body: "单位已补齐，再说明两次数据的差值。",
              source: "MANUAL",
              confirmedAt: "2026-08-18T11:00:00.000Z",
            },
          ],
          payloadHash: "feedback-payload-hash-secret",
          agentRun: { id: "agent-run-secret" },
        },
      },
      {
        ...submittedWorkspace.submission.revisions[1],
        feedback: null,
      },
    ],
    pendingIntent: {
      body: "尚未确认的反馈不能显示",
      payloadHash: "pending-intent-hash-secret",
    },
    otherStudent: { displayName: "另一位学生的秘密" },
  },
};

async function renderPage(): Promise<string> {
  const page = await StudentReleasePage({
    params: Promise.resolve({ releaseId }),
  });
  return renderToStaticMarkup(page);
}

describe("student release page access boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDatabaseClient.mockReturnValue(mocks.database);
    mocks.createUiCommandContext.mockResolvedValue(trustedContext);
    mocks.getStudentReleaseWorkspace.mockResolvedValue(workspace);
    mocks.getStudentFeedbackWorkspace.mockResolvedValue(
      confirmedFeedbackWorkspace,
    );
  });

  it("does not render Clerk or a write entry when auth is not configured", async () => {
    mocks.createUiCommandContext.mockRejectedValue(
      new AuthenticationError("AUTH_NOT_CONFIGURED"),
    );

    const markup = await renderPage();

    expect(markup).toContain("提交入口当前没有开放");
    expect(markup).not.toContain("data-clerk-sign-in");
    expect(markup).not.toContain("data-submission-editor");
    expect(mocks.getStudentFeedbackWorkspace).not.toHaveBeenCalled();
  });

  it("offers the official Clerk sign-in control only when unauthenticated", async () => {
    mocks.createUiCommandContext.mockRejectedValue(
      new AuthenticationError("UNAUTHENTICATED"),
    );

    const markup = await renderPage();

    expect(markup).toContain('data-clerk-sign-in="true"');
    expect(markup).toContain("登录学生账号");
    expect(markup).not.toContain("data-submission-editor");
    expect(mocks.getStudentFeedbackWorkspace).not.toHaveBeenCalled();
  });

  it("does not load a feedback workspace before a submission exists", async () => {
    const markup = await renderPage();

    expect(markup).toContain("当前账号：陈同学 · 学生");
    expect(markup).toContain("退出登录");
    expect(markup).toContain("还没有正式修订");
    expect(mocks.getStudentFeedbackWorkspace).not.toHaveBeenCalled();
  });

  it("shows confirmed feedback history to a historical member without leaking internals", async () => {
    mocks.getStudentReleaseWorkspace.mockResolvedValue({
      ...submittedWorkspace,
      access: { canWrite: false },
    });

    const markup = await renderPage();

    expect(markup).toContain("历史成员 · 唯读");
    expect(markup).toContain('data-can-write="false"');
    expect(markup).toContain("第一版正式观察记录");
    expect(markup).toContain("第二版正式观察记录");
    expect(markup).toContain("林老师");
    expect(markup).toContain("反馈第 2 版");
    expect(markup).toContain("反馈第 1 版");
    expect(markup).toContain("教师手写");
    expect(markup).toContain("AI 建议，教师已确认");
    expect(markup).toContain(
      'dateTime="2026-08-18T11:00:00.000Z"',
    );
    expect(markup).not.toContain(`台${"北"}时间`);
    expect(markup).toContain("单位已补齐，再说明两次数据的差值。");
    expect(markup).toContain("先补上两次读数的单位。");
    expect(markup).toContain("此正式修订尚无教师已确认的反馈");
    expect(markup).not.toContain("feedback-payload-hash-secret");
    expect(markup).not.toContain("agent-run-secret");
    expect(markup).not.toContain("尚未确认的反馈不能显示");
    expect(markup).not.toContain("pending-intent-hash-secret");
    expect(markup).not.toContain("另一位学生的秘密");
    expect(markup).not.toContain(teacherId);
    expect(mocks.getStudentReleaseWorkspace).toHaveBeenCalledWith(
      mocks.database,
      trustedContext,
      { releaseId },
    );
    expect(mocks.getStudentFeedbackWorkspace).toHaveBeenCalledWith(
      mocks.database,
      trustedContext,
      { submissionId },
    );
  });

  it("passes no write capability to the submission workspace when the release is closed", async () => {
    mocks.getStudentReleaseWorkspace.mockResolvedValue({
      ...submittedWorkspace,
      access: { canWrite: false },
      release: { ...submittedWorkspace.release, status: "CLOSED" },
    });

    const markup = await renderPage();

    expect(markup).toContain("已关闭 · 唯读");
    expect(markup).toContain('data-submission-editor="true" data-can-write="false"');
    expect(markup).not.toContain('data-can-write="true"');
  });

  it("uses the existing not-found boundary for an unauthorized feedback workspace", async () => {
    mocks.getStudentReleaseWorkspace.mockResolvedValue(submittedWorkspace);
    mocks.getStudentFeedbackWorkspace.mockRejectedValue(
      new FeedbackWorkspaceQueryError("NOT_FOUND"),
    );

    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
