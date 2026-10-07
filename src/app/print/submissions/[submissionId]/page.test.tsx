import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createUiCommandContext: vi.fn(),
  getDatabaseClient: vi.fn(),
  getTeacherFeedbackWorkspace: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("../../../../server/db/client", () => ({ getDatabaseClient: mocks.getDatabaseClient }));
vi.mock("../../../../server/commands/create-ui-command-context", () => ({
  createUiCommandContext: mocks.createUiCommandContext,
}));
vi.mock("../../../../server/auth/current-actor", () => ({
  AuthenticationError: class AuthenticationError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  },
}));
vi.mock("../../../teacher/_components/teacher-shell", () => ({
  TeacherAccessGate: ({ code }: { code: string }) => <div data-gate={code} />,
}));
vi.mock("../../../../server/queries/feedback-workspace", () => ({
  FeedbackWorkspaceQueryError: class FeedbackWorkspaceQueryError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  },
  getTeacherFeedbackWorkspace: mocks.getTeacherFeedbackWorkspace,
}));

import { waterConservationTaskBookV3 } from "../../../../fixtures/water-conservation-v3";
import { FeedbackWorkspaceQueryError } from "../../../../server/queries/feedback-workspace";
import PrintSubmissionReportPage from "./page";

const submissionId = "10000000-0000-4000-8000-000000000001";

function feedback(version: number, body: string) {
  return {
    id: `70000000-0000-4000-8000-00000000000${version}`,
    version,
    body,
    nextStep: "REVISE",
    supportLevel: "FOUNDATION",
    source: "AI_ASSISTED",
    confirmedAt: "2026-09-18T11:30:00.000Z",
  };
}

const workspace = {
  actor: { displayName: "林老师" },
  group: null,
  earlierPhases: [],
  student: { id: "30000000-0000-4000-8000-000000000003", displayName: "陈同学" },
  submission: {
    id: submissionId,
    phaseIndex: 2,
    phaseName: "调查与分析",
    latestRevisionNumber: 2,
    release: {
      id: "40000000-0000-4000-8000-000000000004",
      classroom: { id: "50000000-0000-4000-8000-000000000005", name: "七年一班" },
      snapshot: { content: waterConservationTaskBookV3 },
    },
    revisions: [
      {
        id: "60000000-0000-4000-8000-000000000001",
        revisionNumber: 1,
        textEvidence: "第一版的旧文字",
        completedEvidenceIndexes: [],
        isLate: false,
        submittedAt: "2026-09-17T11:00:00.000Z",
        attachments: [],
        feedback: { currentVersion: 1, revisions: [feedback(1, "针对第一版的反馈")] },
        evaluation: null,
      },
      {
        id: "60000000-0000-4000-8000-000000000002",
        revisionNumber: 2,
        textEvidence: "第二版的当前文字",
        completedEvidenceIndexes: [1],
        isLate: true,
        submittedAt: "2026-09-18T11:00:00.000Z",
        attachments: [{ id: "a1", filename: "数据表.pdf", storageKey: "secret/storage/key" }],
        feedback: {
          currentVersion: 2,
          revisions: [feedback(1, "已被取代的旧反馈"), feedback(2, "当前确认的反馈")],
        },
        evaluation: {
          currentVersion: 1,
          revisions: [
            {
              version: 1,
              outcomes: [
                { dimensionIndex: 2, dimensionName: "数据与证据", status: "LEVEL", level: "good", citations: [] },
                { dimensionIndex: 3, dimensionName: "跨学科连接", status: "INSUFFICIENT_EVIDENCE", citations: [] },
              ],
              summary: "数据完整，连接还需补充。",
              confirmedAt: "2026-09-18T12:00:00.000Z",
            },
          ],
        },
      },
    ],
  },
};

async function render() {
  return renderToStaticMarkup(
    await PrintSubmissionReportPage({ params: Promise.resolve({ submissionId }) }),
  );
}

describe("learning outcome report (D-072)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createUiCommandContext.mockResolvedValue({});
    mocks.getTeacherFeedbackWorkspace.mockResolvedValue(workspace);
  });

  it("shows only the current revision and what the teacher confirmed about it", async () => {
    const html = await render();
    expect(html).toContain("陈同学");
    expect(html).toContain("第 2 版正式提交");
    expect(html).toContain("第二版的当前文字");
    expect(html).toContain("学生自查已完成：数据表与分析说明");
    expect(html).toContain("数据表.pdf");
    expect(html).toContain("当前确认的反馈");
    expect(html).toContain("按反馈修改并重交");
    expect(html).toContain("数据与证据</strong>：良好");
    expect(html).toContain("数据完整，连接还需补充。");

    for (const excluded of ["第一版的旧文字", "针对第一版的反馈", "已被取代的旧反馈", "secret/storage/key", "AI"]) {
      expect(html).not.toContain(excluded);
    }
  });

  it("is resource-level absent when the review page would be", async () => {
    mocks.getTeacherFeedbackWorkspace.mockRejectedValue(new FeedbackWorkspaceQueryError("NOT_FOUND"));
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
