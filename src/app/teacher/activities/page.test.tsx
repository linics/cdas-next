import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  database: { kind: "teacher-activity-studio-test-database" },
  getDatabaseClient: vi.fn(),
  createUiCommandContext: vi.fn(),
  getTeacherActivityDashboard: vi.fn(),
  listOwnTaskBookWorkingCopies: vi.fn(),
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
  usePathname: () => "/teacher/activities",
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
  getTeacherActivityDashboard: mocks.getTeacherActivityDashboard,
}));

vi.mock("../../../server/queries/activity-draft-working-copy", () => ({
  listOwnTaskBookWorkingCopies: mocks.listOwnTaskBookWorkingCopies,
}));

import TeacherActivityStudioPage from "./page";

const trustedContext = {
  actorId: "50000000-0000-4000-8000-000000000005",
  source: "UI" as const,
  traceId: "teacher-activity-studio-trace",
  clock: () => new Date("2026-08-18T12:00:00.000Z"),
};

async function renderPage(): Promise<string> {
  return renderToStaticMarkup(await TeacherActivityStudioPage());
}

describe("teacher activity studio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDatabaseClient.mockReturnValue(mocks.database);
    mocks.createUiCommandContext.mockResolvedValue(trustedContext);
    mocks.listOwnTaskBookWorkingCopies.mockResolvedValue([]);
  });

  it("lists a task book that was started but never saved as a version (D-093)", async () => {
    mocks.getTeacherActivityDashboard.mockResolvedValue({
      actor: { displayName: "林老师" },
      classrooms: [],
      drafts: [
        {
          id: "70000000-0000-4000-8000-000000000007",
          title: "饮水区用水记录",
          status: "EDITING",
          version: 2,
          updatedAt: "2026-08-18T11:00:00.000Z",
          releaseId: null,
        },
      ],
    });
    mocks.listOwnTaskBookWorkingCopies.mockResolvedValue([
      { id: "80000000-0000-4000-8000-000000000008", draftId: null, title: "", savedAt: "2026-08-18T11:20:00.000Z", gapCount: 12 },
      { id: "80000000-0000-4000-8000-000000000009", draftId: "70000000-0000-4000-8000-000000000007", title: "饮水区用水记录", savedAt: "2026-08-18T11:25:00.000Z", gapCount: 0 },
    ]);

    const markup = await renderPage();

    expect(markup).toContain('href="/teacher/activities/new?wc=80000000-0000-4000-8000-000000000008"');
    expect(markup).toContain("未命名任务书");
    expect(markup).toContain("还差 12 项");
    expect(markup).toContain("有没保存的修改");
    expect(markup).toContain("2 份");
  });

  it("lists open drafts and hides sealed source drafts of published releases", async () => {
    mocks.getTeacherActivityDashboard.mockResolvedValue({
      actor: { displayName: "林老师" },
      classrooms: [],
      drafts: [
        {
          id: "70000000-0000-4000-8000-000000000007",
          title: "饮水区用水记录",
          status: "EDITING",
          version: 1,
          updatedAt: "2026-08-18T11:00:00.000Z",
          releaseId: null,
        },
        {
          id: "70000000-0000-4000-8000-000000000008",
          title: "教室采光改造提案",
          status: "READY_FOR_PREVIEW",
          version: 1,
          updatedAt: "2026-08-18T11:10:00.000Z",
          releaseId: null,
        },
        {
          id: "70000000-0000-4000-8000-000000000009",
          title: "校园用水现场调查",
          status: "SEALED",
          version: 1,
          updatedAt: "2026-08-18T11:30:00.000Z",
          releaseId: "60000000-0000-4000-8000-000000000006",
        },
      ],
      releases: [],
    });

    const markup = await renderPage();
    expect(markup).toContain("饮水区用水记录");
    expect(markup).toContain("教室采光改造提案");
    expect(markup).toContain("新建学习活动");
    expect(markup).not.toContain("校园用水现场调查");
  });
});
