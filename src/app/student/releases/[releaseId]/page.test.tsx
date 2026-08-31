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
vi.mock("next/server", () => ({
  connection: async () => undefined,
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
import { waterConservationTaskBook } from "../../../../fixtures/water-conservation";
import { FeedbackWorkspaceQueryError } from "../../../../server/queries/feedback-workspace";
import StudentReleasePage from "./page";

const releaseId = "10000000-0000-4000-8000-000000000001";
const submissionId = "20000000-0000-4000-8000-000000000002";
const firstRevisionId = "30000000-0000-4000-8000-000000000003";
const secondRevisionId = "40000000-0000-4000-8000-000000000004";
const imageAttachmentId = "41000000-0000-4000-8000-000000000004";
const docxAttachmentId = "42000000-0000-4000-8000-000000000004";
const teacherId = "60000000-0000-4000-8000-000000000006";
const trustedContext = {
  actorId: "50000000-0000-4000-8000-000000000005",
  source: "UI" as const,
  traceId: "server-page-trace",
  clock: () => new Date("2026-08-18T12:00:00.000Z"),
};
const workspace = {
  actor: { displayName: "陈同学" },
  group: null,
  access: { canWrite: true },
  execution: {
    version: 0,
    mode: "once",
    phaseCount: 0,
    currentPhaseIndex: 0,
  },
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
  submissions: [],
};
const submittedSubmission = {
  id: submissionId,
  phaseIndex: 0,
  latestRevisionNumber: 2,
  workingCopy: null,
  revisions: [
    {
      id: firstRevisionId,
      revisionNumber: 1,
      textEvidence: "第一版正式观察记录",
      completedEvidenceIndexes: [],
      isLate: false,
      submittedAt: "2026-08-18T10:30:00.000Z",
      attachments: [],
    },
    {
      id: secondRevisionId,
      revisionNumber: 2,
      textEvidence: "第二版正式观察记录",
      completedEvidenceIndexes: [],
      isLate: true,
      submittedAt: "2026-08-18T11:30:00.000Z",
      attachments: [],
    },
  ],
};
const submittedWorkspace = {
  ...workspace,
  submission: submittedSubmission,
  submissions: [submittedSubmission],
};
const confirmedFeedbackWorkspace = {
  submission: {
    id: submissionId,
    phaseIndex: 0,
    phaseName: null,
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
              nextStep: null,
              supportLevel: null,
              source: "AI_ASSISTED",
              confirmedAt: "2026-08-18T10:45:00.000Z",
            },
            {
              id: "82000000-0000-4000-8000-000000000008",
              version: 2,
              body: "单位已补齐，再说明两次数据的差值。",
              nextStep: "REVISE",
              supportLevel: "FOUNDATION",
              source: "MANUAL",
              confirmedAt: "2026-08-18T11:00:00.000Z",
            },
          ],
          payloadHash: "feedback-payload-hash-secret",
          agentRun: { id: "agent-run-secret" },
        },
        evaluation: {
          id: "83000000-0000-4000-8000-000000000008",
          currentVersion: 1,
          teacher: { id: teacherId, displayName: "林老师" },
          revisions: [
            {
              id: "84000000-0000-4000-8000-000000000008",
              version: 1,
              summary: "第一版量规综评：问题清楚，证据仍不足。",
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
                  citations: [{ kind: "text" }],
                },
                {
                  dimensionIndex: 4,
                  dimensionName: "方案表达",
                  status: "LEVEL",
                  level: "pass",
                  citations: [{ kind: "text" }],
                },
              ],
              source: "MANUAL",
              confirmedAt: "2026-08-18T11:05:00.000Z",
            },
          ],
        },
      },
      {
        ...submittedWorkspace.submission.revisions[1],
        feedback: null,
        evaluation: null,
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

  it("does not render a local login or write entry when auth is not configured", async () => {
    mocks.createUiCommandContext.mockRejectedValue(
      new AuthenticationError("AUTH_NOT_CONFIGURED"),
    );

    const markup = await renderPage();

    expect(markup).toContain("学生工作台当前没有开放");
    expect(markup).toContain("返回首页");
    expect(markup).not.toContain('href="/student/login"');
    expect(markup).not.toContain("data-submission-editor");
    expect(mocks.getStudentFeedbackWorkspace).not.toHaveBeenCalled();
  });

  it("offers the local student login only when unauthenticated", async () => {
    mocks.createUiCommandContext.mockRejectedValue(
      new AuthenticationError("UNAUTHENTICATED"),
    );

    const markup = await renderPage();

    expect(markup).toContain('href="/student/login"');
    expect(markup).toContain("登录学生账号");
    expect(markup).not.toContain("data-submission-editor");
    expect(mocks.getStudentFeedbackWorkspace).not.toHaveBeenCalled();
  });

  it("does not load a feedback workspace before a submission exists", async () => {
    const markup = await renderPage();

    expect(markup).toContain("当前账号：陈同学 · 学生");
    expect(markup).toContain("退出登录");
    expect(markup).toContain("尚无正式提交");
    expect(mocks.getStudentFeedbackWorkspace).not.toHaveBeenCalled();
  });

  it("shows the shared group identity and member roles", async () => {
    mocks.getStudentReleaseWorkspace.mockResolvedValue({
      ...workspace,
      group: {
        id: "91000000-0000-4000-8000-000000000001",
        name: "校园调查组",
        members: [
          {
            student: { id: trustedContext.actorId, displayName: "陈同学" },
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
    expect(markup).toContain("同一份草稿、附件、提交记录和教师反馈");
  });

  it("renders the complete structured task book from the immutable release snapshot", async () => {
    mocks.getStudentReleaseWorkspace.mockResolvedValue({
      ...workspace,
      release: {
        ...workspace.release,
        snapshot: {
          ...workspace.release.snapshot,
          content: waterConservationTaskBook,
        },
      },
    });

    const markup = await renderPage();

    expect(markup).toContain('aria-label="学生工作台导航"');
    expect(markup).toContain('href="/student"');
    // 背景常驻在折叠之外 —— 收起来学生就从「第 N 阶段」读起，没头没尾。
    expect(markup).toContain("活动背景");
    expect(markup).toContain("你们是七年级节水观察员");
    // 折叠里保留学生用得上的三段
    expect(markup).toContain("总体任务");
    expect(markup).toContain("观察与问题界定");
    expect(markup).toContain("文字记录");
    expect(markup).toContain("评价标准");
    expect(markup).toContain("需改进：证据不足或与结论脱节");
    // 教学设计与审计用的信息不进学生端
    expect(markup).not.toContain("任务设置");
    expect(markup).not.toContain("知识与技能");
    expect(markup).not.toContain("跨学科概念");
    expect(markup).not.toContain("快照摘要");
    // 作业没有课时设计（旧系统把作业和教案搞混留下的表述）
    expect(markup).not.toContain("课时");
  });

  it("shows confirmed feedback history to a historical member without leaking internals", async () => {
    mocks.getStudentReleaseWorkspace.mockResolvedValue({
      ...submittedWorkspace,
      access: { canWrite: false },
    });

    const markup = await renderPage();

    expect(markup).toContain("历史成员 · 只读");
    expect(markup).toContain('data-can-write="false"');
    expect(markup).toContain("第一版正式观察记录");
    expect(markup).toContain("第二版正式观察记录");
    expect(markup).toContain("林老师");
    expect(markup).toContain("反馈第 2 版");
    expect(markup).toContain("反馈第 1 版");
    expect(markup).toContain("教师撰写");
    expect(markup).toContain("AI 建议，教师已确认");
    expect(markup).toContain("按反馈修改并重交");
    expect(markup).toContain("基础支持");
    expect(markup).toContain("早期反馈未包含下一步与支架信息");
    expect(markup).toContain(
      'dateTime="2026-08-18T11:00:00.000Z"',
    );
    expect(markup).not.toContain(`台${"北"}时间`);
    expect(markup).toContain("单位已补齐，再说明两次数据的差值。");
    expect(markup).toContain("先补上两次读数的单位。");
    expect(markup).toContain("该版本尚无教师反馈");
    expect(markup).toContain("评价第 1 版");
    expect(markup).toContain("第一版量规综评：问题清楚，证据仍不足。");
    expect(markup).toContain("证据不足");
    expect(markup).toContain("优秀");
    expect(markup).toContain("该版本尚无量规评价");
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

  it("keeps preview and download available on formal revision attachments", async () => {
    const submissionWithAttachments = {
      ...submittedSubmission,
      revisions: [
        {
          ...submittedSubmission.revisions[0],
          attachments: [
            {
              id: imageAttachmentId,
              filename: "水表记录.png",
              mediaType: "image/png",
              byteSize: 67 * 1024,
            },
            {
              id: docxAttachmentId,
              filename: "节水建议.docx",
              mediaType:
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              byteSize: 32 * 1024,
            },
          ],
        },
        submittedSubmission.revisions[1],
      ],
    };
    mocks.getStudentReleaseWorkspace.mockResolvedValue({
      ...workspace,
      submission: submissionWithAttachments,
      submissions: [submissionWithAttachments],
    });

    const markup = await renderPage();

    expect(markup).toContain("水表记录.png");
    expect(markup).toContain("节水建议.docx");
    expect(markup).toContain("预览");
    expect(markup).toContain(
      `href="/attachments/${imageAttachmentId}/download"`,
    );
    expect(markup).toContain(
      `href="/attachments/${docxAttachmentId}/download"`,
    );
    expect(markup.match(/>预览<\/button>/gu)).toHaveLength(1);
    expect(markup.match(/ download="/gu)).toHaveLength(3);
  });

  it("passes no write capability to the submission workspace when the release is closed", async () => {
    mocks.getStudentReleaseWorkspace.mockResolvedValue({
      ...submittedWorkspace,
      access: { canWrite: false },
      release: { ...submittedWorkspace.release, status: "CLOSED" },
    });

    const markup = await renderPage();

    expect(markup).toContain("已关闭 · 只读");
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
