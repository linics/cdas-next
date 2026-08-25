import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  database: { kind: "teacher-evaluation-action-database" },
  getDatabaseClient: vi.fn(),
  createUiCommandContext: vi.fn(),
  prepareEvaluation: vi.fn(),
  decideIntent: vi.fn(),
  saveEvaluation: vi.fn(),
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
  "../../../../server/commands/prepare-teacher-evaluation-intent",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("../../../../server/commands/prepare-teacher-evaluation-intent")
    >();
    return {
      ...actual,
      prepareTeacherEvaluationIntent: mocks.prepareEvaluation,
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
  "../../../../server/commands/save-teacher-evaluation",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("../../../../server/commands/save-teacher-evaluation")
    >();
    return {
      ...actual,
      saveTeacherEvaluation: mocks.saveEvaluation,
    };
  },
);

import { AuthenticationError } from "../../../../server/auth/current-actor";
import { hashTeacherEvaluationPayload } from "../../../../domain/evaluation/teacher-evaluation-intent";
import { DecideActionIntentError } from "../../../../server/commands/decide-action-intent";
import { PrepareTeacherEvaluationIntentError } from "../../../../server/commands/prepare-teacher-evaluation-intent";
import { SaveTeacherEvaluationError } from "../../../../server/commands/save-teacher-evaluation";
import {
  decideTeacherEvaluationAction,
  prepareTeacherEvaluationAction,
} from "./evaluation-actions";
import { initialEvaluationActionState } from "./evaluation-action-state";

const submissionId = "10000000-0000-4000-8000-000000000001";
const revisionId = "20000000-0000-4000-8000-000000000002";
const intentId = "30000000-0000-4000-8000-000000000003";
const evaluationId = "40000000-0000-4000-8000-000000000004";
const evaluationRevisionId = "50000000-0000-4000-8000-000000000005";
const actorId = "60000000-0000-4000-8000-000000000006";
const attachmentId = "70000000-0000-4000-8000-000000000007";
const releaseId = "80000000-0000-4000-8000-000000000008";
const outcomes = [
  {
    dimensionIndex: 1,
    dimensionName: "问题意识",
    status: "LEVEL" as const,
    level: "excellent" as const,
    citations: [{ kind: "text" as const }],
  },
  {
    dimensionIndex: 2,
    dimensionName: "证据质量",
    status: "INSUFFICIENT_EVIDENCE" as const,
    citations: [],
  },
  {
    dimensionIndex: 3,
    dimensionName: "跨学科连接",
    status: "LEVEL" as const,
    level: "good" as const,
    citations: [{ kind: "attachment" as const, attachmentId }],
  },
  {
    dimensionIndex: 4,
    dimensionName: "方案表达",
    status: "LEVEL" as const,
    level: "pass" as const,
    citations: [{ kind: "checkpoint" as const, evidenceIndex: 1 }],
  },
];
const payloadHash = hashTeacherEvaluationPayload({
  schemaVersion: 1,
  submissionId,
  submissionRevisionId: revisionId,
  expectedSubmissionRevisionNumber: 2,
  expectedEvaluationVersion: 1,
  summary: "  évidence\n第二行  ",
  outcomes,
  suggestionAgentRunId: null,
});
const trustedContext = {
  actorId,
  source: "UI" as const,
  traceId: "trusted-evaluation-ui-trace",
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
    expectedEvaluationVersion: "1",
    summary: "  e\u0301vidence\r\n第二行  ",
    outcomes: JSON.stringify(outcomes),
    idempotencyKey: "prepare_evaluation_request_001",
    ...overrides,
  });
}

function confirmForm(overrides?: Record<string, string>): FormData {
  return formData({
    actionIntentId: intentId,
    decision: "CONFIRM",
    idempotencyKey: "save_evaluation_request_001",
    ...overrides,
  });
}

describe("teacher evaluation server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDatabaseClient.mockReturnValue(mocks.database);
    mocks.createUiCommandContext.mockResolvedValue(trustedContext);
    mocks.prepareEvaluation.mockResolvedValue({
      actionIntentId: intentId,
      submissionRevisionId: revisionId,
      expectedEvaluationVersion: 1,
      payloadHash,
      expiresAt: "2026-08-18T12:10:00.000Z",
    });
    mocks.decideIntent.mockResolvedValue({
      actionIntentId: intentId,
      status: "CONFIRMED",
      decidedAt: new Date("2026-08-18T12:01:00.000Z"),
    });
    mocks.saveEvaluation.mockResolvedValue({
      teacherEvaluationId: evaluationId,
      teacherEvaluationRevisionId: evaluationRevisionId,
      submissionRevisionId: revisionId,
      releaseId,
      version: 2,
      confirmedAt: "2026-08-18T12:01:00.000Z",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prepares a persisted manual intent with trusted context and returns the exact canonical summary", async () => {
    vi.stubEnv("AI_PROVIDER_DISABLED", "true");

    const state = await prepareTeacherEvaluationAction(
      initialEvaluationActionState,
      prepareForm(),
    );

    expect(mocks.createUiCommandContext).toHaveBeenCalledWith(
      mocks.database,
    );
    expect(mocks.prepareEvaluation).toHaveBeenCalledWith(
      mocks.database,
      trustedContext,
      {
        submissionId,
        expectedSubmissionRevisionId: revisionId,
        expectedSubmissionRevisionNumber: 2,
        expectedEvaluationVersion: 1,
        summary: "  évidence\n第二行  ",
        outcomes,
        suggestionAgentRunId: null,
        idempotencyKey: "prepare_evaluation_request_001",
      },
    );
    expect(state).toMatchObject({
      operation: "prepare",
      status: "prepared",
      confirmation: {
        actionIntentId: intentId,
        submissionRevisionId: revisionId,
        submissionRevisionNumber: 2,
        expectedEvaluationVersion: 1,
        summary: "  évidence\n第二行  ",
        outcomes,
        payloadHash,
        expiresAt: "2026-08-18T12:10:00.000Z",
      },
    });
    expect(state.confirmation?.saveIdempotencyKey).toMatch(
      /^save_teacher_evaluation_[0-9a-f-]{36}$/,
    );
  });

  it("rejects extra or duplicate form fields before authentication", async () => {
    const injected = prepareForm({ actorId });
    const injectedState = await prepareTeacherEvaluationAction(
      initialEvaluationActionState,
      injected,
    );

    const duplicated = prepareForm();
    duplicated.append("summary", "另一份综评");
    const duplicatedState = await prepareTeacherEvaluationAction(
      initialEvaluationActionState,
      duplicated,
    );

    expect(injectedState.status).toBe("validation_error");
    expect(duplicatedState.status).toBe("validation_error");
    expect(mocks.createUiCommandContext).not.toHaveBeenCalled();
    expect(mocks.prepareEvaluation).not.toHaveBeenCalled();
  });

  it("rejects malformed outcomes JSON before authentication", async () => {
    const state = await prepareTeacherEvaluationAction(
      initialEvaluationActionState,
      prepareForm({ outcomes: "{not-json" }),
    );

    expect(state.status).toBe("validation_error");
    expect(mocks.createUiCommandContext).not.toHaveBeenCalled();
    expect(mocks.prepareEvaluation).not.toHaveBeenCalled();
  });

  it("does not expose a confirmation panel when the persisted payload hash differs", async () => {
    mocks.prepareEvaluation.mockResolvedValue({
      actionIntentId: intentId,
      submissionRevisionId: revisionId,
      expectedEvaluationVersion: 1,
      payloadHash: "f".repeat(64),
      expiresAt: "2026-08-18T12:10:00.000Z",
    });

    const state = await prepareTeacherEvaluationAction(
      initialEvaluationActionState,
      prepareForm(),
    );

    expect(state.status).toBe("error");
    expect(state.confirmation).toBeNull();
    expect(state.message).toContain("未能与提交内容对齐");
    expect(state.message).not.toContain("payload");
  });

  it.each([
    ["STALE_SUBMISSION_REVISION", "stale"],
    ["EVALUATION_VERSION_CONFLICT", "version_conflict"],
    ["CONCURRENT_WRITE", "concurrent"],
    ["RUBRIC_UNAVAILABLE", "validation_error"],
    ["INVALID_EVALUATION", "validation_error"],
    ["INVALID_AGENT_RUN", "validation_error"],
  ] as const)(
    "maps prepare %s without exposing the internal exception",
    async (code, expectedStatus) => {
      mocks.prepareEvaluation.mockRejectedValue(
        new PrepareTeacherEvaluationIntentError(code),
      );

      const state = await prepareTeacherEvaluationAction(
        initialEvaluationActionState,
        prepareForm(),
      );

      expect(state.status).toBe(expectedStatus);
      expect(state.message).not.toContain(code);
      expect(state.confirmation).toBeNull();
    },
  );

  it("maps a ZodError-shaped exception from a different Zod copy as validation", async () => {
    const foreign = new Error("hidden schema path");
    foreign.name = "ZodError";
    mocks.prepareEvaluation.mockRejectedValue(foreign);

    const state = await prepareTeacherEvaluationAction(
      initialEvaluationActionState,
      prepareForm(),
    );

    expect(state.status).toBe("validation_error");
    expect(state.message).toContain("量规评价必须覆盖全部冻结维度");
    expect(state.message).not.toContain("hidden schema path");
  });

  it("does not prepare when the Clerk session is unavailable", async () => {
    mocks.createUiCommandContext.mockRejectedValue(
      new AuthenticationError("UNAUTHENTICATED"),
    );

    const state = await prepareTeacherEvaluationAction(
      initialEvaluationActionState,
      prepareForm(),
    );

    expect(state.status).toBe("unauthenticated");
    expect(mocks.prepareEvaluation).not.toHaveBeenCalled();
  });

  it("confirms before saving and revalidates the teacher submission route", async () => {
    const state = await decideTeacherEvaluationAction(
      initialEvaluationActionState,
      confirmForm(),
    );

    expect(mocks.decideIntent).toHaveBeenCalledWith(
      mocks.database,
      trustedContext,
      { actionIntentId: intentId, decision: "CONFIRM" },
    );
    expect(mocks.saveEvaluation).toHaveBeenCalledWith(
      mocks.database,
      trustedContext,
      {
        actionIntentId: intentId,
        idempotencyKey: "save_evaluation_request_001",
      },
    );
    expect(
      mocks.decideIntent.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.saveEvaluation.mock.invocationCallOrder[0]!);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/teacher/submissions/[submissionId]",
      "page",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      `/student/releases/${releaseId}`,
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/student");
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

    const state = await decideTeacherEvaluationAction(
      initialEvaluationActionState,
      confirmForm(),
    );

    expect(mocks.saveEvaluation).toHaveBeenCalledWith(
      mocks.database,
      trustedContext,
      {
        actionIntentId: intentId,
        idempotencyKey: "save_evaluation_request_001",
      },
    );
    expect(state.status).toBe("saved");
  });

  it("distinguishes expired confirmation from a stale submission and an evaluation version conflict", async () => {
    mocks.decideIntent.mockRejectedValue(
      new DecideActionIntentError("ACTION_EXPIRED"),
    );
    const expired = await decideTeacherEvaluationAction(
      initialEvaluationActionState,
      confirmForm(),
    );
    expect(expired.status).toBe("expired");
    expect(mocks.saveEvaluation).not.toHaveBeenCalled();

    mocks.decideIntent.mockResolvedValue({
      actionIntentId: intentId,
      status: "CONFIRMED",
      decidedAt: new Date(),
    });
    mocks.saveEvaluation.mockRejectedValueOnce(
      new SaveTeacherEvaluationError("STALE_SUBMISSION_REVISION"),
    );
    const stale = await decideTeacherEvaluationAction(
      initialEvaluationActionState,
      confirmForm(),
    );
    expect(stale.status).toBe("stale");

    mocks.saveEvaluation.mockRejectedValueOnce(
      new SaveTeacherEvaluationError("EVALUATION_VERSION_CONFLICT"),
    );
    const versionConflict = await decideTeacherEvaluationAction(
      initialEvaluationActionState,
      confirmForm(),
    );
    expect(versionConflict.status).toBe("version_conflict");

    mocks.saveEvaluation.mockRejectedValueOnce(
      new SaveTeacherEvaluationError("INTENT_TAMPERED"),
    );
    const tampered = await decideTeacherEvaluationAction(
      initialEvaluationActionState,
      confirmForm(),
    );
    expect(tampered.status).toBe("concurrent");
    expect(tampered.message).not.toContain("INTENT_TAMPERED");
  });

  it("rejects a prepared intent without calling the save command", async () => {
    mocks.decideIntent.mockResolvedValue({
      actionIntentId: intentId,
      status: "REJECTED",
      decidedAt: new Date("2026-08-18T12:02:00.000Z"),
    });

    const state = await decideTeacherEvaluationAction(
      initialEvaluationActionState,
      formData({ actionIntentId: intentId, decision: "REJECT" }),
    );

    expect(mocks.decideIntent).toHaveBeenCalledWith(
      mocks.database,
      trustedContext,
      { actionIntentId: intentId, decision: "REJECT" },
    );
    expect(mocks.saveEvaluation).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(state).toMatchObject({
      operation: "reject",
      status: "rejected",
      resolvedIntentId: intentId,
    });
  });

  it("rejects decision-form trust injection before creating a context", async () => {
    const state = await decideTeacherEvaluationAction(
      initialEvaluationActionState,
      confirmForm({ actorId }),
    );

    expect(state.status).toBe("validation_error");
    expect(mocks.createUiCommandContext).not.toHaveBeenCalled();
    expect(mocks.decideIntent).not.toHaveBeenCalled();
    expect(mocks.saveEvaluation).not.toHaveBeenCalled();
  });
});
