import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  database: { kind: "new-activity-page-database" },
  context: {
    actorId: "10000000-0000-4000-8000-000000000001",
    source: "UI" as const,
    traceId: "new-activity-page-trace",
    clock: () => new Date("2026-08-20T04:00:00.000Z"),
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
vi.mock("../../../../server/queries/teacher-activity-workspace", () => ({
  TeacherActivityQueryError: class TeacherActivityQueryError extends Error {
    constructor(public readonly code: string) {
      super(code);
      this.name = "TeacherActivityQueryError";
    }
  },
  getTeacherIdentity: mocks.getTeacherIdentity,
}));
vi.mock("../../_components/teacher-shell", () => ({
  TeacherAccessGate: ({ code }: { code: string }) => (
    <div data-access-gate={code}>安全门</div>
  ),
  TeacherPage: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../activity-draft-form", () => ({
  ActivityDraftForm: () => <form data-manual-draft="true" />,
}));

import { AuthenticationError } from "../../../../server/auth/current-actor";
import NewTeacherActivityPage from "./page";

async function renderPage(): Promise<string> {
  return renderToStaticMarkup(await NewTeacherActivityPage());
}

describe("new teacher activity page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createUiCommandContext.mockResolvedValue(mocks.context);
    mocks.getDatabaseClient.mockReturnValue(mocks.database);
    mocks.getTeacherIdentity.mockResolvedValue({ displayName: "林老师" });
  });

  it("keeps the manual form and official knowledge link", async () => {
    const markup = await renderPage();

    expect(markup).toContain('data-manual-draft="true"');
    expect(markup).toContain('href="/teacher/knowledge"');
    expect(markup).toContain("检索课程标准");
  });

  it("does not touch the page database before authentication", async () => {
    mocks.createUiCommandContext.mockRejectedValue(
      new AuthenticationError("AUTH_NOT_CONFIGURED"),
    );

    const markup = await renderPage();

    expect(markup).toContain("安全门");
    expect(mocks.getDatabaseClient).not.toHaveBeenCalled();
  });
});
