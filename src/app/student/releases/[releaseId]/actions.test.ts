import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  database: { kind: "test-database" },
  getDatabaseClient: vi.fn(),
  createUiCommandContext: vi.fn(),
  saveWorkingCopy: vi.fn(),
  submitRevision: vi.fn(),
  startResubmission: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
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
vi.mock(
  "../../../../server/commands/save-submission-working-copy",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("../../../../server/commands/save-submission-working-copy")
    >();
    return {
      ...actual,
      saveSubmissionWorkingCopy: mocks.saveWorkingCopy,
    };
  },
);
vi.mock(
  "../../../../server/commands/submit-submission-revision",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("../../../../server/commands/submit-submission-revision")
    >();
    return {
      ...actual,
      submitSubmissionRevision: mocks.submitRevision,
    };
  },
);
vi.mock(
  "../../../../server/commands/start-submission-resubmission",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("../../../../server/commands/start-submission-resubmission")
    >();
    return {
      ...actual,
      startSubmissionResubmission: mocks.startResubmission,
    };
  },
);

import { AuthenticationError } from "../../../../server/auth/current-actor";
import { SubmitSubmissionRevisionError } from "../../../../server/commands/submit-submission-revision";
import {
  saveWorkingCopyAction,
  startResubmissionAction,
  submitRevisionAction,
} from "./actions";
import { initialSubmissionActionState } from "./submission-action-state";

const releaseId = "10000000-0000-4000-8000-000000000001";
const workingCopyId = "20000000-0000-4000-8000-000000000002";
const submissionId = "30000000-0000-4000-8000-000000000003";
const revisionId = "40000000-0000-4000-8000-000000000004";
const actorId = "50000000-0000-4000-8000-000000000005";
const trustedContext = {
  actorId,
  source: "UI" as const,
  traceId: "server-trace",
  clock: () => new Date("2026-08-18T12:00:00.000Z"),
};

function formData(
  fields: Record<string, string>,
): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

describe("student submission server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDatabaseClient.mockReturnValue(mocks.database);
    mocks.createUiCommandContext.mockResolvedValue(trustedContext);
    mocks.saveWorkingCopy.mockResolvedValue({
      submissionId,
      workingCopyId,
      workingVersion: 3,
      baseRevisionNumber: 1,
      savedAt: "2026-08-18T12:00:00.000Z",
    });
    mocks.submitRevision.mockResolvedValue({
      submissionId,
      revisionId,
      revisionNumber: 2,
      isLate: false,
      submittedAt: "2026-08-18T12:00:00.000Z",
      nextSubmissionId: null,
      nextPhaseIndex: null,
    });
    mocks.startResubmission.mockResolvedValue({
      submissionId,
      workingCopyId,
      workingVersion: 1,
      baseRevisionNumber: 1,
      startedAt: "2026-08-18T12:00:00.000Z",
    });
  });

  it("creates a trusted UI context and maps only save business fields", async () => {
    const result = await saveWorkingCopyAction(
      initialSubmissionActionState,
      formData({
        releaseId,
        phaseIndex: "0",
        workingCopyId,
        version: "2",
        idempotencyKey: "save_request_001",
        text: "第一行\r\n第二行",
        completedEvidenceIndexes: "",
      }),
    );

    expect(mocks.createUiCommandContext).toHaveBeenCalledWith();
    expect(mocks.saveWorkingCopy).toHaveBeenCalledWith(
      mocks.database,
      trustedContext,
      {
        releaseId,
        phaseIndex: 0,
        expectedWorkingCopyId: workingCopyId,
        expectedWorkingVersion: 2,
        idempotencyKey: "save_request_001",
        textEvidence: "第一行\n第二行",
        completedEvidenceIndexes: [],
      },
    );
    expect(result).toMatchObject({
      status: "success",
      operation: "save",
    });
    expect(result.nextIdempotencyKey).toMatch(/^save_[0-9a-f-]{36}$/);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      `/student/releases/${releaseId}`,
    );
  });

  it("rejects injected trust facts before authentication or a command call", async () => {
    const data = formData({
      releaseId,
      phaseIndex: "0",
      workingCopyId: "",
      version: "",
      idempotencyKey: "save_request_002",
      text: "我的证据",
      actorId: "60000000-0000-4000-8000-000000000006",
    });

    const result = await saveWorkingCopyAction(
      initialSubmissionActionState,
      data,
    );

    expect(result.status).toBe("error");
    expect(mocks.createUiCommandContext).not.toHaveBeenCalled();
    expect(mocks.getDatabaseClient).not.toHaveBeenCalled();
    expect(mocks.saveWorkingCopy).not.toHaveBeenCalled();
  });

  it("rejects duplicate save fields before auth and preserves submitted text", async () => {
    const data = formData({
      releaseId,
      phaseIndex: "0",
      workingCopyId: "",
      version: "",
      idempotencyKey: "save_request_duplicate",
      text: "这段尚未保存的正文必须留在页面",
    });
    data.append("text", "注入的第二份正文");

    const result = await saveWorkingCopyAction(
      initialSubmissionActionState,
      data,
    );

    expect(result).toMatchObject({
      status: "error",
      operation: "save",
      nextIdempotencyKey: "save_request_duplicate",
    });
    expect(data.getAll("text")).toEqual([
      "这段尚未保存的正文必须留在页面",
      "注入的第二份正文",
    ]);
    expect(mocks.createUiCommandContext).not.toHaveBeenCalled();
    expect(mocks.getDatabaseClient).not.toHaveBeenCalled();
    expect(mocks.saveWorkingCopy).not.toHaveBeenCalled();
  });

  it("rejects duplicate submit fields before auth and command execution", async () => {
    const data = formData({
      releaseId,
      workingCopyId,
      version: "3",
      idempotencyKey: "submit_request_duplicate",
    });
    data.append("workingCopyId", workingCopyId);

    const result = await submitRevisionAction(
      initialSubmissionActionState,
      data,
    );

    expect(result.status).toBe("error");
    expect(mocks.createUiCommandContext).not.toHaveBeenCalled();
    expect(mocks.getDatabaseClient).not.toHaveBeenCalled();
    expect(mocks.submitRevision).not.toHaveBeenCalled();
  });

  it("rejects duplicate resubmission fields before auth and command execution", async () => {
    const data = formData({
      releaseId,
      version: "1",
      idempotencyKey: "resubmit_request_duplicate",
    });
    data.append("version", "1");

    const result = await startResubmissionAction(
      initialSubmissionActionState,
      data,
    );

    expect(result.status).toBe("error");
    expect(mocks.createUiCommandContext).not.toHaveBeenCalled();
    expect(mocks.getDatabaseClient).not.toHaveBeenCalled();
    expect(mocks.startResubmission).not.toHaveBeenCalled();
  });

  it("rejects missing expected fields before auth and command execution", async () => {
    const data = formData({
      releaseId,
      version: "3",
      idempotencyKey: "submit_request_missing",
    });

    const result = await submitRevisionAction(
      initialSubmissionActionState,
      data,
    );

    expect(result.status).toBe("error");
    expect(mocks.createUiCommandContext).not.toHaveBeenCalled();
    expect(mocks.getDatabaseClient).not.toHaveBeenCalled();
    expect(mocks.submitRevision).not.toHaveBeenCalled();
  });

  it("ignores framework action metadata while keeping business fields exact", async () => {
    const data = formData({
      releaseId,
      phaseIndex: "0",
      workingCopyId: "",
      version: "",
      idempotencyKey: "save_request_action_meta",
      text: "框架字段不应改变正文",
      completedEvidenceIndexes: "",
    });
    data.append("$ACTION_TEST", "opaque-framework-value");

    const result = await saveWorkingCopyAction(
      initialSubmissionActionState,
      data,
    );

    expect(result.status).toBe("success");
    expect(mocks.createUiCommandContext).toHaveBeenCalledOnce();
    expect(mocks.saveWorkingCopy).toHaveBeenCalledWith(
      mocks.database,
      trustedContext,
      expect.objectContaining({
        textEvidence: "框架字段不应改变正文",
      }),
    );
  });

  it("surfaces a stale formal-submit version as a reloadable conflict", async () => {
    mocks.submitRevision.mockRejectedValue(
      new SubmitSubmissionRevisionError("STALE_WORKING_COPY"),
    );

    const result = await submitRevisionAction(
      initialSubmissionActionState,
      formData({
        releaseId,
        phaseIndex: "0",
        workingCopyId,
        version: "3",
        idempotencyKey: "submit_request_001",
      }),
    );

    expect(result).toMatchObject({
      status: "conflict",
      operation: "submit",
      nextIdempotencyKey: "submit_request_001",
    });
    expect(result.message).toContain("没有覆盖较新的内容");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("starts resubmission from the exact latest formal revision", async () => {
    const result = await startResubmissionAction(
      initialSubmissionActionState,
      formData({
        releaseId,
        phaseIndex: "0",
        version: "1",
        idempotencyKey: "resubmit_request_001",
      }),
    );

    expect(mocks.startResubmission).toHaveBeenCalledWith(
      mocks.database,
      trustedContext,
      {
        releaseId,
        phaseIndex: 0,
        expectedLatestRevisionNumber: 1,
        idempotencyKey: "resubmit_request_001",
      },
    );
    expect(result).toMatchObject({
      status: "success",
      operation: "resubmit",
    });
  });

  it("does not call a write command when the Clerk session is unavailable", async () => {
    mocks.createUiCommandContext.mockRejectedValue(
      new AuthenticationError("UNAUTHENTICATED"),
    );

    const result = await saveWorkingCopyAction(
      initialSubmissionActionState,
      formData({
        releaseId,
        phaseIndex: "0",
        workingCopyId: "",
        version: "",
        idempotencyKey: "save_request_003",
        text: "尚未提交的内容",
        completedEvidenceIndexes: "",
      }),
    );

    expect(result.status).toBe("error");
    expect(result.message).toContain("登录状态已失效");
    expect(mocks.getDatabaseClient).not.toHaveBeenCalled();
    expect(mocks.saveWorkingCopy).not.toHaveBeenCalled();
  });
});
