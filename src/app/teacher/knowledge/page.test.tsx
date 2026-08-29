import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  database: { kind: "knowledge-page-database" },
  context: {
    actorId: "10000000-0000-4000-8000-000000000001",
    source: "UI" as const,
    traceId: "knowledge-page-trace",
    clock: () => new Date("2026-08-27T00:00:00.000Z"),
  },
  createUiCommandContext: vi.fn(),
  getDatabaseClient: vi.fn(),
  getTeacherIdentity: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
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
    constructor(public readonly code: string) {
      super(code);
      this.name = "TeacherActivityQueryError";
    }
  },
  getTeacherIdentity: mocks.getTeacherIdentity,
}));
vi.mock("../_components/teacher-shell", () => ({
  TeacherAccessGate: ({ code }: { code: string }) => (
    <div data-access-gate={code}>安全门</div>
  ),
  TeacherPage: ({ children }: { children: ReactNode }) => <>{children}</>,
  teacherHomeCrumb: { href: "/teacher", label: "教师工作台" },
}));

import { AuthenticationError } from "../../../server/auth/current-actor";
import TeacherKnowledgePage from "./page";

describe("teacher official knowledge page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createUiCommandContext.mockResolvedValue(mocks.context);
    mocks.getDatabaseClient.mockReturnValue(mocks.database);
    mocks.getTeacherIdentity.mockResolvedValue({ displayName: "林老师" });
  });

  it("lists only the approved five sources and supports model-independent search", async () => {
    const initial = renderToStaticMarkup(
      await TeacherKnowledgePage({ searchParams: Promise.resolve({}) }),
    );
    const searched = renderToStaticMarkup(
      await TeacherKnowledgePage({
        searchParams: Promise.resolve({ q: "初中跨学科实践 数据分析 评价" }),
      }),
    );

    expect(initial).toContain("已收录的官方来源");
    expect(initial).toContain("义务教育课程方案（2022年版）");
    expect(initial).toContain("义务教育信息科技课程标准（2022年版）");
    expect(initial).not.toContain("UbD");
    expect(searched).toContain("检索结果");
    expect(searched).toContain("不依赖 AI");
    expect(searched).toContain('href="/teacher/knowledge?source=');
  });

  it("authenticates before reading the teacher page", async () => {
    mocks.createUiCommandContext.mockRejectedValue(
      new AuthenticationError("UNAUTHENTICATED"),
    );

    const markup = renderToStaticMarkup(
      await TeacherKnowledgePage({ searchParams: Promise.resolve({}) }),
    );

    expect(markup).toContain("安全门");
    expect(mocks.getDatabaseClient).not.toHaveBeenCalled();
    expect(mocks.getTeacherIdentity).not.toHaveBeenCalled();
  });
});
