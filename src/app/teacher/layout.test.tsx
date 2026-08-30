import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: {
    actorId: "10000000-0000-4000-8000-000000000001",
    source: "UI" as const,
    traceId: "teacher-layout-trace",
    clock: () => new Date("2026-08-28T04:00:00.000Z"),
  },
  database: { kind: "teacher-layout-database" },
  connection: vi.fn(),
  createUiCommandContext: vi.fn(),
  getDatabaseClient: vi.fn(),
  getTeacherAssistantClassrooms: vi.fn(),
  isActivityAssistantEnabled: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({
  connection: mocks.connection,
}));
vi.mock("../../server/commands/create-ui-command-context", () => ({
  createUiCommandContext: mocks.createUiCommandContext,
}));
vi.mock("../../server/db/client", () => ({
  getDatabaseClient: mocks.getDatabaseClient,
}));
vi.mock("../../server/assistant/assistant-config", () => ({
  isActivityAssistantEnabled: mocks.isActivityAssistantEnabled,
}));
vi.mock("../../server/auth/current-actor", () => ({
  AuthenticationError: class AuthenticationError extends Error {
    constructor(public readonly code: string) {
      super(code);
      this.name = "AuthenticationError";
    }
  },
}));
vi.mock("../../server/assistant/teacher-assistant-context", () => ({
  TeacherAssistantContextError: class TeacherAssistantContextError extends Error {
    constructor(public readonly code: string) {
      super(code);
      this.name = "TeacherAssistantContextError";
    }
  },
  getTeacherAssistantClassrooms: mocks.getTeacherAssistantClassrooms,
}));
vi.mock("./_components/teacher-agent-overlay", () => ({
  TeacherAgentOverlay: ({
    children,
    classrooms,
  }: {
    children: ReactNode;
    classrooms: Array<{ id: string; name: string }>;
  }) => (
    <div data-agent-overlay="true" data-classrooms={classrooms.map((item) => item.name).join(",")}>
      {children}
    </div>
  ),
}));

import { AuthenticationError } from "../../server/auth/current-actor";
import { TeacherAssistantContextError } from "../../server/assistant/teacher-assistant-context";
import TeacherLayout from "./layout";

async function renderLayout(): Promise<string> {
  return renderToStaticMarkup(
    await TeacherLayout({ children: <main data-page="teacher" /> }),
  );
}

describe("teacher global Agent layout gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connection.mockResolvedValue(undefined);
    mocks.createUiCommandContext.mockResolvedValue(mocks.context);
    mocks.getDatabaseClient.mockReturnValue(mocks.database);
    mocks.isActivityAssistantEnabled.mockReturnValue(false);
    mocks.getTeacherAssistantClassrooms.mockResolvedValue([
      {
        id: "20000000-0000-4000-8000-000000000001",
        name: "七年一班",
      },
    ]);
  });

  it("defers authenticated teacher work until an incoming request", async () => {
    await renderLayout();

    expect(mocks.connection).toHaveBeenCalledOnce();
    expect(mocks.connection.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createUiCommandContext.mock.invocationCallOrder[0]!,
    );
  });

  it("keeps the teacher page unchanged and performs no assistant query when AI is disabled", async () => {
    const markup = await renderLayout();

    expect(markup).toContain('data-page="teacher"');
    expect(markup).not.toContain('data-agent-overlay="true"');
    expect(mocks.getDatabaseClient).not.toHaveBeenCalled();
    expect(mocks.getTeacherAssistantClassrooms).not.toHaveBeenCalled();
  });

  it("mounts one global overlay with only authorized classroom display data", async () => {
    mocks.isActivityAssistantEnabled.mockReturnValue(true);

    const markup = await renderLayout();

    expect(mocks.getTeacherAssistantClassrooms).toHaveBeenCalledWith(
      mocks.database,
      mocks.context,
    );
    expect(markup).toContain('data-agent-overlay="true"');
    expect(markup).toContain('data-classrooms="七年一班"');
    expect(markup).toContain('data-page="teacher"');
  });

  it("does not inspect AI configuration before authentication", async () => {
    mocks.createUiCommandContext.mockRejectedValue(
      new AuthenticationError("UNAUTHENTICATED"),
    );

    const markup = await renderLayout();

    expect(markup).toContain('data-page="teacher"');
    expect(markup).not.toContain('data-agent-overlay="true"');
    expect(mocks.isActivityAssistantEnabled).not.toHaveBeenCalled();
    expect(mocks.getDatabaseClient).not.toHaveBeenCalled();
  });

  it("fails closed when the authenticated actor is not a teacher", async () => {
    mocks.isActivityAssistantEnabled.mockReturnValue(true);
    mocks.getTeacherAssistantClassrooms.mockRejectedValue(
      new TeacherAssistantContextError("NOT_FOUND"),
    );

    const markup = await renderLayout();

    expect(markup).toContain('data-page="teacher"');
    expect(markup).not.toContain('data-agent-overlay="true"');
  });

  it("keeps the manual teacher route available when assistant context lookup fails", async () => {
    mocks.isActivityAssistantEnabled.mockReturnValue(true);
    mocks.getTeacherAssistantClassrooms.mockRejectedValue(
      new Error("assistant database unavailable"),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const markup = await renderLayout();

    expect(markup).toContain('data-page="teacher"');
    expect(markup).not.toContain('data-agent-overlay="true"');
    expect(errorSpy).toHaveBeenCalledWith(
      "TEACHER_AGENT_CONTEXT_UNAVAILABLE",
      "Error",
    );
    errorSpy.mockRestore();
  });
});
