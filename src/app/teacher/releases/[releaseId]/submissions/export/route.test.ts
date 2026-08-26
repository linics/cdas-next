import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

const mocks = vi.hoisted(() => ({
  database: { kind: "teacher-review-roster-export-database" },
  getDatabaseClient: vi.fn(),
  createUiCommandContext: vi.fn(),
  getTeacherReleaseSubmissions: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("../../../../../../server/db/client", () => ({
  getDatabaseClient: mocks.getDatabaseClient,
}));
vi.mock(
  "../../../../../../server/commands/create-ui-command-context",
  () => ({ createUiCommandContext: mocks.createUiCommandContext }),
);
vi.mock("../../../../../../server/auth/current-actor", () => ({
  AuthenticationError: class AuthenticationError extends Error {
    constructor(public readonly code: string) {
      super(code);
      this.name = "AuthenticationError";
    }
  },
}));
vi.mock("../../../../../../server/queries/submission-workspace", () => ({
  SubmissionWorkspaceQueryError: class SubmissionWorkspaceQueryError extends Error {
    constructor(public readonly code: string) {
      super(code);
      this.name = "SubmissionWorkspaceQueryError";
    }
  },
  getTeacherReleaseSubmissions: mocks.getTeacherReleaseSubmissions,
}));

import { AuthenticationError } from "../../../../../../server/auth/current-actor";
import { SubmissionWorkspaceQueryError } from "../../../../../../server/queries/submission-workspace";
import { GET } from "./route";

const releaseId = "10000000-0000-4000-8000-000000000001";
const studentId = "30000000-0000-4000-8000-000000000003";
const trustedContext = {
  actorId: "40000000-0000-4000-8000-000000000004",
  source: "UI" as const,
  traceId: "teacher-review-roster-export-trace",
  clock: () => new Date("2026-08-18T12:00:00.000Z"),
};
const workspace = {
  actor: { displayName: "林老师" },
  release: {
    id: releaseId,
    title: "校园水表观察",
    classroomName: "七年一班",
    status: "ACTIVE",
    publishedAt: "2026-08-18T10:00:00.000Z",
    dueAt: "2026-08-20T12:00:00.000Z",
    executionVersion: 0,
    submissionMode: "once",
    phaseCount: 0,
    rubricAvailable: false,
  },
  submissions: [
    {
      submissionId: "20000000-0000-4000-8000-000000000002",
      phaseIndex: 0,
      phaseName: null,
      student: { id: studentId, displayName: "陈同学" },
      group: null,
      currentRevision: {
        id: "50000000-0000-4000-8000-000000000005",
        revisionNumber: 2,
        isLate: true,
        submittedAt: "2026-08-19T13:00:00.000Z",
        feedback: { currentVersion: 3 },
        evaluation: null,
        followUp: "AWAITING_RESUBMISSION",
      },
    },
  ],
  progress: [],
  reviewCoverage: {
    currentRevisionCount: 1,
    feedbackCount: 1,
    evaluationCount: 0,
  },
};

async function exportRoster() {
  return GET(new Request("https://example.test/export"), {
    params: Promise.resolve({ releaseId }),
  });
}

describe("GET teacher review roster export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDatabaseClient.mockReturnValue(mocks.database);
    mocks.createUiCommandContext.mockResolvedValue(trustedContext);
    mocks.getTeacherReleaseSubmissions.mockResolvedValue(workspace);
  });

  it("downloads the current-revision roster CSV for the publishing teacher", async () => {
    const response = await exportRoster();
    const body = await response.text();

    expect(mocks.getTeacherReleaseSubmissions).toHaveBeenCalledWith(
      mocks.database,
      trustedContext,
      { releaseId },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain(
      "filename*=UTF-8''",
    );
    expect(response.headers.get("content-disposition")).toContain(
      encodeURIComponent("校园水表观察-评阅名册.csv"),
    );
    expect(body).toContain("七年一班,陈同学,整项提交,2,迟交,已反馈 v3,无量规,待重交");
    expect(body).not.toContain(studentId);
    expect(body).not.toContain("学生正式提交正文");
  });

  it("hides the export from unauthenticated callers and other teachers", async () => {
    mocks.createUiCommandContext.mockRejectedValue(
      new AuthenticationError("UNAUTHENTICATED"),
    );
    const unauthenticated = await exportRoster();
    expect(unauthenticated.status).toBe(404);
    await expect(unauthenticated.json()).resolves.toEqual({ error: "NOT_FOUND" });
    expect(mocks.getTeacherReleaseSubmissions).not.toHaveBeenCalled();

    mocks.createUiCommandContext.mockResolvedValue(trustedContext);
    mocks.getTeacherReleaseSubmissions.mockRejectedValue(
      new SubmissionWorkspaceQueryError("NOT_FOUND"),
    );
    const hidden = await exportRoster();
    expect(hidden.status).toBe(404);
    await expect(hidden.json()).resolves.toEqual({ error: "NOT_FOUND" });
  });

  it("maps malformed release identifiers to not found", async () => {
    mocks.getTeacherReleaseSubmissions.mockRejectedValue(new ZodError([]));

    const response = await exportRoster();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "NOT_FOUND" });
  });
});
