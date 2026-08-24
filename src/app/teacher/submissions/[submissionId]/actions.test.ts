import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  database: { kind: "teacher-feedback-action-database" },
  getDatabaseClient: vi.fn(),
  createUiCommandContext: vi.fn(),
  prepareFeedback: vi.fn(),
  decideIntent: vi.fn(),
  saveFeedback: vi.fn(),
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
  "../../../../server/commands/prepare-teacher-feedback-intent",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("../../../../server/commands/prepare-teacher-feedback-intent")
    >();
    return {
      ...actual,
      prepareTeacherFeedbackIntent: mocks.prepareFeedback,
    };
  },
);
vi.mock(
  "../../../../server/commands/decide-action-intent",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("../../../../server/commands/decide-action-intent")
    >();
    return {
      ...actual,
      decideActionIntent: mocks.decideIntent,
    };
  },
);
vi.mock(
  "../../../../server/commands/save-teacher-feedback",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("../../../../server/commands/save-teacher-feedback")
    >();
    return {
      ...actual,
      saveTeacherFeedback: mocks.saveFeedback,
    };
  },
);

import { AuthenticationError } from "../../../../server/auth/current-actor";
import { hashTeacherFeedbackPayload } from "../../../../domain/feedback/teacher-feedback-intent";
import { DecideActionIntentError } from "../../../../server/commands/decide-action-intent";
import { PrepareTeacherFeedbackIntentError } from "../../../../server/commands/prepare-teacher-feedback-intent";
import { SaveTeacherFeedbackError } from "../../../../server/commands/save-teacher-feedback";
import {
  decideTeacherFeedbackAction,
  prepareTeacherFeedbackAction,
} from "./actions";
import { initialFeedbackActionState } from "./feedback-action-state";

const submissionId = "10000000-0000-4000-8000-000000000001";
const revisionId = "20000000-0000-4000-8000-000000000002";
const intentId = "30000000-0000-4000-8000-000000000003";
const feedbackId = "40000000-0000-4000-8000-000000000004";
const feedbackRevisionId = "50000000-0000-4000-8000-000000000005";
const actorId = "60000000-0000-4000-8000-000000000006";
const payloadHash = hashTeacherFeedbackPayload({
  schemaVersion: 2,
  submissionId,
  submissionRevisionId: revisionId,
  expectedSubmissionRevisionNumber: 2,
  expectedFeedbackVersion: 1,
  body: "  évidence\n第二行  ",
  nextStep: "REVISE",
  supportLevel: "FOUNDATION",
  suggestionAgentRunId: null,
});
const trustedContext = {
  actorId,
  source: "UI" as const,
  traceId: "trusted-feedback-ui-trace",
  clock: () => new Date("2026-08-18T12:00:00.000Z"),
};

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

function prepareForm(overrides?: Record<string, string>): FormData {
  return formData({
    submissionId,
    submissionRevisionId: revisionId,
    submissionRevisionNumber: "2",
    expectedFeedbackVersion: "1",
    body: "  e\u0301vidence\r\n第二行  ",
    nextStep: "REVISE",
    supportLevel: "FOUNDATION",
    idempotencyKey: "prepare_feedback_request_001",
    ...overrides,
  });
}

function confirmForm(overrides?: Record<string, string>): FormData {
  return formData({
    actionIntentId: intentId,
    decision: "CONFIRM",
    idempotencyKey: "save_feedback_request_001",
    ...overrides,
  });
}

describe("teacher feedback server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDatabaseClient.mockReturnValue(mocks.database);
    mocks.createUiCommandContext.mockResolvedValue(trustedContext);
    mocks.prepareFeedback.mockResolvedValue({
      actionIntentId: intentId,
      submissionRevisionId: revisionId,
      expectedFeedbackVersion: 1,
      payloadHash,
      expiresAt: "2026-08-18T12:10:00.000Z",
    });
    mocks.decideIntent.mockResolvedValue({
      actionIntentId: intentId,
      status: "CONFIRMED",
      decidedAt: new Date("2026-08-18T12:01:00.000Z"),
    });
    mocks.saveFeedback.mockResolvedValue({
      teacherFeedbackId: feedbackId,
      teacherFeedbackRevisionId: feedbackRevisionId,
      submissionRevisionId: revisionId,
      version: 2,
      confirmedAt: "2026-08-18T12:01:00.000Z",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prepares a persisted manual intent with trusted context and returns the exact canonical body", async () => {
    vi.stubEnv("AI_PROVIDER_DISABLED", "true");

    const state = await prepareTeacherFeedbackAction(
      initialFeedbackActionState,
      prepareForm(),
    );

    expect(mocks.createUiCommandContext).toHaveBeenCalledWith(
      mocks.database,
    );
    expect(mocks.prepareFeedback).toHaveBeenCalledWith(
      mocks.database,
      trustedContext,
      {
        submissionId,
        expectedSubmissionRevisionId: revisionId,
        expectedSubmissionRevisionNumber: 2,
        expectedFeedbackVersion: 1,
        body: "  évidence\n第二行  ",
        nextStep: "REVISE",
        supportLevel: "FOUNDATION",
        suggestionAgentRunId: null,
        idempotencyKey: "prepare_feedback_request_001",
      },
    );
    expect(state).toMatchObject({
      operation: "prepare",
      status: "prepared",
      confirmation: {
        actionIntentId: intentId,
        submissionRevisionId: revisionId,
        submissionRevisionNumber: 2,
        expectedFeedbackVersion: 1,
        body: "  évidence\n第二行  ",
        nextStep: "REVISE",
        supportLevel: "FOUNDATION",
        payloadHash,
        expiresAt: "2026-08-18T12:10:00.000Z",
      },
    });
    expect(state.confirmation?.saveIdempotencyKey).toMatch(
      /^save_teacher_feedback_[0-9a-f-]{36}$/,
    );
  });

  it("rejects extra or duplicate form fields before authentication", async () => {
    const injected = prepareForm({ actorId });
    const injectedState = await prepareTeacherFeedbackAction(
      initialFeedbackActionState,
      injected,
    );

    const duplicated = prepareForm();
    duplicated.append("body", "另一份正文");
    const duplicatedState = await prepareTeacherFeedbackAction(
      initialFeedbackActionState,
      duplicated,
    );

    expect(injectedState.status).toBe("validation_error");
    expect(duplicatedState.status).toBe("validation_error");
    expect(mocks.createUiCommandContext).not.toHaveBeenCalled();
    expect(mocks.prepareFeedback).not.toHaveBeenCalled();
  });

  it("requires both structured feedback choices before authentication", async () => {
    const missingNextStep = prepareForm();
    missingNextStep.delete("nextStep");
    const missingSupportLevel = prepareForm();
    missingSupportLevel.set("supportLevel", "UNSUPPORTED");

    await expect(
      prepareTeacherFeedbackAction(initialFeedbackActionState, missingNextStep),
    ).resolves.toMatchObject({ status: "validation_error" });
    await expect(
      prepareTeacherFeedbackAction(
        initialFeedbackActionState,
        missingSupportLevel,
      ),
    ).resolves.toMatchObject({ status: "validation_error" });
    expect(mocks.createUiCommandContext).not.toHaveBeenCalled();
    expect(mocks.prepareFeedback).not.toHaveBeenCalled();
  });

  it("does not expose a confirmation panel when the persisted payload hash differs", async () => {
    mocks.prepareFeedback.mockResolvedValue({
      actionIntentId: intentId,
      submissionRevisionId: revisionId,
      expectedFeedbackVersion: 1,
      payloadHash: "f".repeat(64),
      expiresAt: "2026-08-18T12:10:00.000Z",
    });

    const state = await prepareTeacherFeedbackAction(
      initialFeedbackActionState,
      prepareForm(),
    );

    expect(state.status).toBe("error");
    expect(state.confirmation).toBeNull();
    expect(state.message).not.toContain("payload");
  });

  it.each([
    ["STALE_SUBMISSION_REVISION", "stale"],
    ["FEEDBACK_VERSION_CONFLICT", "version_conflict"],
    ["CONCURRENT_WRITE", "concurrent"],
  ] as const)(
    "maps prepare %s without exposing the internal exception",
    async (code, expectedStatus) => {
      mocks.prepareFeedback.mockRejectedValue(
        new PrepareTeacherFeedbackIntentError(code),
      );

      const state = await prepareTeacherFeedbackAction(
        initialFeedbackActionState,
        prepareForm(),
      );

      expect(state.status).toBe(expectedStatus);
      expect(state.message).not.toContain(code);
      expect(state.confirmation).toBeNull();
    },
  );

  it("does not prepare when the Clerk session is unavailable", async () => {
    mocks.createUiCommandContext.mockRejectedValue(
      new AuthenticationError("UNAUTHENTICATED"),
    );

    const state = await prepareTeacherFeedbackAction(
      initialFeedbackActionState,
      prepareForm(),
    );

    expect(state.status).toBe("unauthenticated");
    expect(mocks.prepareFeedback).not.toHaveBeenCalled();
  });

  it("confirms before saving and revalidates the teacher submission route", async () => {
    const state = await decideTeacherFeedbackAction(
      initialFeedbackActionState,
      confirmForm(),
    );

    expect(mocks.decideIntent).toHaveBeenCalledWith(
      mocks.database,
      trustedContext,
      { actionIntentId: intentId, decision: "CONFIRM" },
    );
    expect(mocks.saveFeedback).toHaveBeenCalledWith(
      mocks.database,
      trustedContext,
      {
        actionIntentId: intentId,
        idempotencyKey: "save_feedback_request_001",
      },
    );
    expect(
      mocks.decideIntent.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.saveFeedback.mock.invocationCallOrder[0]!);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/teacher/submissions/[submissionId]",
      "page",
    );
    expect(state).toMatchObject({
      operation: "confirm",
      status: "saved",
      resolvedIntentId: intentId,
    });
  });

  it("replays the same save when the intent is already executed after a lost response", async () => {
    mocks.decideIntent.mockRejectedValue(
      new DecideActionIntentError("ALREADY_DECIDED"),
    );

    const state = await decideTeacherFeedbackAction(
      initialFeedbackActionState,
      confirmForm(),
    );

    expect(mocks.saveFeedback).toHaveBeenCalledWith(
      mocks.database,
      trustedContext,
      {
        actionIntentId: intentId,
        idempotencyKey: "save_feedback_request_001",
      },
    );
    expect(state.status).toBe("saved");
  });

  it("distinguishes expired confirmation from a stale submission and a feedback version conflict", async () => {
    mocks.decideIntent.mockRejectedValue(
      new DecideActionIntentError("ACTION_EXPIRED"),
    );
    const expired = await decideTeacherFeedbackAction(
      initialFeedbackActionState,
      confirmForm(),
    );
    expect(expired.status).toBe("expired");
    expect(mocks.saveFeedback).not.toHaveBeenCalled();

    mocks.decideIntent.mockResolvedValue({
      actionIntentId: intentId,
      status: "CONFIRMED",
      decidedAt: new Date(),
    });
    mocks.saveFeedback.mockRejectedValueOnce(
      new SaveTeacherFeedbackError("STALE_SUBMISSION_REVISION"),
    );
    const stale = await decideTeacherFeedbackAction(
      initialFeedbackActionState,
      confirmForm(),
    );
    expect(stale.status).toBe("stale");

    mocks.saveFeedback.mockRejectedValueOnce(
      new SaveTeacherFeedbackError("FEEDBACK_VERSION_CONFLICT"),
    );
    const versionConflict = await decideTeacherFeedbackAction(
      initialFeedbackActionState,
      confirmForm(),
    );
    expect(versionConflict.status).toBe("version_conflict");
  });

  it("rejects a prepared intent without calling the save command", async () => {
    mocks.decideIntent.mockResolvedValue({
      actionIntentId: intentId,
      status: "REJECTED",
      decidedAt: new Date("2026-08-18T12:02:00.000Z"),
    });

    const state = await decideTeacherFeedbackAction(
      initialFeedbackActionState,
      formData({ actionIntentId: intentId, decision: "REJECT" }),
    );

    expect(mocks.decideIntent).toHaveBeenCalledWith(
      mocks.database,
      trustedContext,
      { actionIntentId: intentId, decision: "REJECT" },
    );
    expect(mocks.saveFeedback).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(state).toMatchObject({
      operation: "reject",
      status: "rejected",
      resolvedIntentId: intentId,
    });
  });

  it("rejects decision-form trust injection before creating a context", async () => {
    const state = await decideTeacherFeedbackAction(
      initialFeedbackActionState,
      confirmForm({ actorId }),
    );

    expect(state.status).toBe("validation_error");
    expect(mocks.createUiCommandContext).not.toHaveBeenCalled();
    expect(mocks.decideIntent).not.toHaveBeenCalled();
    expect(mocks.saveFeedback).not.toHaveBeenCalled();
  });
});
