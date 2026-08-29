import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  database: { kind: "teacher-feedback-page-database" },
  getDatabaseClient: vi.fn(),
  createUiCommandContext: vi.fn(),
  getTeacherFeedbackWorkspace: vi.fn(),
  isActivityAssistantEnabled: vi.fn(),
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
  usePathname: () => `/teacher/submissions/${submissionId}`,
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
vi.mock("../../../../server/assistant/assistant-config", () => ({
  isActivityAssistantEnabled: mocks.isActivityAssistantEnabled,
}));
vi.mock("../../../../server/queries/feedback-workspace", () => ({
  FeedbackWorkspaceQueryError: class FeedbackWorkspaceQueryError extends Error {
    constructor(public readonly code: string) {
      super(code);
      this.name = "FeedbackWorkspaceQueryError";
    }
  },
  getTeacherFeedbackWorkspace: mocks.getTeacherFeedbackWorkspace,
}));
vi.mock("./feedback-composer", () => ({
  FeedbackComposer: ({
    submissionRevisionNumber,
    expectedFeedbackVersion,
    initialBody,
  }: {
    submissionRevisionNumber: number;
    expectedFeedbackVersion: number;
    initialBody: string;
  }) => (
    <div
      data-feedback-composer="true"
      data-revision={submissionRevisionNumber}
      data-feedback-version={expectedFeedbackVersion}
      data-initial-body={initialBody}
    />
  ),
}));
vi.mock("./evaluation-composer", () => ({
  EvaluationComposer: ({
    submissionRevisionNumber,
    expectedEvaluationVersion,
    initialSummary,
    assistantEnabled,
  }: {
    submissionRevisionNumber: number;
    expectedEvaluationVersion: number;
    initialSummary: string;
    assistantEnabled: boolean;
  }) => (
    <div
      data-evaluation-composer="true"
      data-revision={submissionRevisionNumber}
      data-evaluation-version={expectedEvaluationVersion}
      data-initial-summary={initialSummary}
      data-assistant-enabled={assistantEnabled}
    />
  ),
}));

import { AuthenticationError } from "../../../../server/auth/current-actor";
import { waterConservationTaskBook } from "../../../../fixtures/water-conservation";
import { FeedbackWorkspaceQueryError } from "../../../../server/queries/feedback-workspace";
import TeacherSubmissionPage from "./page";

const submissionId = "10000000-0000-4000-8000-000000000001";
const trustedContext = {
  actorId: "20000000-0000-4000-8000-000000000002",
  source: "UI" as const,
  traceId: "teacher-page-trace",
  clock: () => new Date("2026-08-18T12:00:00.000Z"),
};
const secretSubmissionBody = "学生正式提交的私密证据";
const currentFeedbackBody = "当前已确认的教师反馈";
const workspace = {
  actor: { displayName: "林老师" },
  group: null,
  student: {
    id: "30000000-0000-4000-8000-000000000003",
    displayName: "陈同学",
  },
  submission: {
    id: submissionId,
    phaseIndex: 0,
    phaseName: null,
    latestRevisionNumber: 1,
    release: {
      id: "40000000-0000-4000-8000-000000000004",
      status: "ACTIVE",
      publishedAt: "2026-08-18T10:00:00.000Z",
      dueAt: "2026-08-20T12:00:00.000Z",
      classroom: {
        id: "50000000-0000-4000-8000-000000000005",
        name: "七年一班",
      },
      snapshot: {
        sourceDraftVersion: 1,
        contentHash: "a".repeat(64),
        content: {
          schemaVersion: 1,
          title: "校园水表观察",
          summary: "记录并解释水表变化",
          learningObjectives: ["使用数据支持结论"],
          taskInstructions: "记录两次水表读数。",
          evidenceRequirements: ["包含时间和读数"],
          feedbackCriteria: ["数据与结论一致"],
        },
      },
    },
    revisions: [
      {
        id: "60000000-0000-4000-8000-000000000006",
        revisionNumber: 1,
        textEvidence: secretSubmissionBody,
        completedEvidenceIndexes: [],
        isLate: false,
        submittedAt: "2026-08-18T11:00:00.000Z",
        attachments: [],
        feedback: {
          id: "70000000-0000-4000-8000-000000000007",
          currentVersion: 1,
          teacher: {
            id: trustedContext.actorId,
            displayName: "林老师",
          },
          revisions: [
            {
              id: "80000000-0000-4000-8000-000000000008",
              version: 1,
              body: currentFeedbackBody,
              nextStep: "CONTINUE",
              supportLevel: "STANDARD",
              source: "MANUAL",
              confirmedAt: "2026-08-18T11:30:00.000Z",
            },
          ],
        },
        evaluation: null,
      },
    ],
  },
};

async function renderPage(): Promise<string> {
  const page = await TeacherSubmissionPage({
    params: Promise.resolve({ submissionId }),
  });
  return renderToStaticMarkup(page);
}

describe("teacher feedback page access boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDatabaseClient.mockReturnValue(mocks.database);
    mocks.createUiCommandContext.mockResolvedValue(trustedContext);
    mocks.getTeacherFeedbackWorkspace.mockResolvedValue(workspace);
    mocks.isActivityAssistantEnabled.mockReturnValue(false);
  });

  it("does not query or render student data and write controls when auth is not configured", async () => {
    mocks.createUiCommandContext.mockRejectedValue(
      new AuthenticationError("AUTH_NOT_CONFIGURED"),
    );

    const markup = await renderPage();

    expect(markup).toContain("教师工作台当前没有开放");
    expect(markup).not.toContain(secretSubmissionBody);
    expect(markup).not.toContain("data-feedback-composer");
    expect(markup).not.toContain("data-clerk-sign-in");
    expect(mocks.getDatabaseClient).not.toHaveBeenCalled();
    expect(mocks.getTeacherFeedbackWorkspace).not.toHaveBeenCalled();
  });

  it("uses the official Clerk sign-in control only when unauthenticated", async () => {
    mocks.createUiCommandContext.mockRejectedValue(
      new AuthenticationError("UNAUTHENTICATED"),
    );

    const markup = await renderPage();

    expect(markup).toContain('data-clerk-sign-in="true"');
    expect(markup).toContain("登录教师账号");
    expect(markup).not.toContain(secretSubmissionBody);
    expect(markup).not.toContain("data-feedback-composer");
  });

  it("renders the authorized formal history and edits only the current revision", async () => {
    const markup = await renderPage();

    expect(mocks.getTeacherFeedbackWorkspace).toHaveBeenCalledWith(
      mocks.database,
      trustedContext,
      { submissionId },
    );
    expect(markup).toContain("陈同学");
    expect(markup).toContain("当前账号：林老师 · 教师");
    expect(markup).toContain("退出登录");
    expect(markup).toContain("学生证据");
    expect(markup).toContain("已确认记录");
    expect(markup).toContain("收起评阅");
    expect(markup).toContain('data-rail-open="true"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("data-fill-viewport");
    expect(markup).not.toContain("正式修订、反馈与评价历史");
    expect(markup).not.toContain("保存规则");
    expect(markup).toContain(secretSubmissionBody);
    expect(markup).toContain(currentFeedbackBody);
    expect(markup).toContain("继续后续阶段");
    expect(markup).toContain("标准任务");
    expect(markup).toContain('data-feedback-composer="true"');
    expect(markup).toContain('data-revision="1"');
    expect(markup).toContain('data-feedback-version="1"');
    expect(markup).toContain(`data-initial-body="${currentFeedbackBody}"`);
    expect(markup).toContain("这份发布快照是 schema v1，没有四档量规");
    expect(markup).not.toContain("data-evaluation-composer");
  });

  it("opens a separate evaluation composer for a schema v2 snapshot", async () => {
    mocks.getTeacherFeedbackWorkspace.mockResolvedValue({
      ...workspace,
      submission: {
        ...workspace.submission,
        phaseIndex: 3,
        phaseName: "建议与公开表达",
        release: {
          ...workspace.submission.release,
          snapshot: {
            ...workspace.submission.release.snapshot,
            content: waterConservationTaskBook,
          },
        },
        revisions: [
          {
            ...workspace.submission.revisions[0],
            completedEvidenceIndexes: [1],
            attachments: [
              {
                id: "90000000-0000-4000-8000-000000000009",
                kind: "IMAGE",
                filename: "evidence.png",
                mediaType: "image/png",
                byteSize: 128,
              },
            ],
            evaluation: {
              id: "a0000000-0000-4000-8000-00000000000a",
              currentVersion: 1,
              teacher: {
                id: trustedContext.actorId,
                displayName: "林老师",
              },
              revisions: [
                {
                  id: "b0000000-0000-4000-8000-00000000000b",
                  version: 1,
                  summary: "按冻结量规给出综评。",
                  outcomes: [
                    {
                      dimensionIndex: 1,
                      dimensionName: "问题意识",
                      status: "LEVEL",
                      level: "excellent",
                      citations: [{ kind: "text" }],
                    },
                    {
                      dimensionIndex: 2,
                      dimensionName: "证据质量",
                      status: "INSUFFICIENT_EVIDENCE",
                      citations: [],
                    },
                    {
                      dimensionIndex: 3,
                      dimensionName: "跨学科连接",
                      status: "LEVEL",
                      level: "good",
                      citations: [
                        {
                          kind: "attachment",
                          attachmentId: "90000000-0000-4000-8000-000000000009",
                        },
                      ],
                    },
                    {
                      dimensionIndex: 4,
                      dimensionName: "方案表达",
                      status: "LEVEL",
                      level: "pass",
                      citations: [{ kind: "checkpoint", evidenceIndex: 1 }],
                    },
                  ],
                  source: "MANUAL",
                  confirmedAt: "2026-08-18T11:40:00.000Z",
                },
              ],
            },
          },
        ],
      },
    });

    const markup = await renderPage();

    expect(markup).toContain("data-evaluation-composer");
    expect(markup).toContain('data-evaluation-version="1"');
    expect(markup).toContain('data-assistant-enabled="false"');
    expect(markup).toContain("按冻结量规给出综评。");
    expect(markup).toContain("证据不足");
    expect(markup).toContain("优秀");
    expect(markup).not.toContain("这份发布快照是 schema v1");
  });

  it("enables the optional AI draft affordance without changing the evaluation layout", async () => {
    mocks.isActivityAssistantEnabled.mockReturnValue(true);
    mocks.getTeacherFeedbackWorkspace.mockResolvedValue({
      ...workspace,
      submission: {
        ...workspace.submission,
        release: {
          ...workspace.submission.release,
          snapshot: {
            ...workspace.submission.release.snapshot,
            content: waterConservationTaskBook,
          },
        },
      },
    });

    const markup = await renderPage();

    expect(markup).toContain('data-evaluation-composer="true"');
    expect(markup).toContain('data-assistant-enabled="true"');
    expect(markup).toContain('data-feedback-composer="true"');
  });

  it("labels shared group feedback with every member and role", async () => {
    mocks.getTeacherFeedbackWorkspace.mockResolvedValue({
      ...workspace,
      group: {
        id: "91000000-0000-4000-8000-000000000001",
        name: "校园调查组",
        members: [
          {
            student: workspace.student,
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
      },
    });

    const markup = await renderPage();

    expect(markup).toContain("校园调查组");
    expect(markup).toContain("陈同学（记录）");
    expect(markup).toContain("周同学（汇报）");
    expect(markup).toContain("反馈绑定这份共享正式修订，并对全组成员可见");
    expect(markup).toContain("继续后续阶段");
    expect(markup).toContain("标准任务");
  });

  it("returns not found for a well-hidden unauthorized submission", async () => {
    mocks.getTeacherFeedbackWorkspace.mockRejectedValue(
      new FeedbackWorkspaceQueryError("NOT_FOUND"),
    );

    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
