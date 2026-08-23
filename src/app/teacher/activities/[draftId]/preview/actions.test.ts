import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublishPreparationState } from "./publish-action-state";

const mocks = vi.hoisted(() => ({
  database: { kind: "publish-action-database" },
  getDatabaseClient: vi.fn(),
  createUiCommandContext: vi.fn(),
  preparePublish: vi.fn(),
  getConfirmation: vi.fn(),
  decideIntent: vi.fn(),
  publishRelease: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("../../../../../server/db/client", () => ({
  getDatabaseClient: mocks.getDatabaseClient,
}));
vi.mock("../../../../../server/commands/create-ui-command-context", () => ({
  createUiCommandContext: mocks.createUiCommandContext,
}));
vi.mock("../../../../../server/auth/current-actor", () => ({
  AuthenticationError: class AuthenticationError extends Error {
    constructor(public readonly code: string) {
      super(code);
      this.name = "AuthenticationError";
    }
  },
}));
vi.mock(
  "../../../../../server/commands/prepare-publish-activity-intent",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("../../../../../server/commands/prepare-publish-activity-intent")
    >();
    return {
      ...actual,
      preparePublishActivityIntent: mocks.preparePublish,
    };
  },
);
vi.mock(
  "../../../../../server/commands/decide-action-intent",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("../../../../../server/commands/decide-action-intent")
    >();
    return { ...actual, decideActionIntent: mocks.decideIntent };
  },
);
vi.mock(
  "../../../../../server/commands/publish-activity-release",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("../../../../../server/commands/publish-activity-release")
    >();
    return { ...actual, publishActivityRelease: mocks.publishRelease };
  },
);
vi.mock("../../../../../server/queries/teacher-activity-workspace", () => ({
  TeacherActivityQueryError: class TeacherActivityQueryError extends Error {
    constructor(public readonly code: string) {
      super(code);
      this.name = "TeacherActivityQueryError";
    }
  },
  getTeacherPublishConfirmation: mocks.getConfirmation,
}));

import { DecideActionIntentError } from "../../../../../server/commands/decide-action-intent";
import { PreparePublishActivityIntentError } from "../../../../../server/commands/prepare-publish-activity-intent";
import {
  decidePublishActivityAction,
  preparePublishActivityAction,
} from "./actions";
import { initialPublishDecisionState } from "./publish-action-state";

const actorId = "10000000-0000-4000-8000-000000000001";
const draftId = "20000000-0000-4000-8000-000000000002";
const classroomId = "30000000-0000-4000-8000-000000000003";
const intentId = "40000000-0000-4000-8000-000000000004";
const releaseId = "50000000-0000-4000-8000-000000000005";
const newYorkDueAt = "2026-09-01T03:59:00.000Z";
const trustedContext = {
  actorId,
  source: "UI" as const,
  traceId: "trusted-publish-ui-trace",
  clock: () => new Date("2026-08-18T12:00:00.000Z"),
};
const payloadHash = "a".repeat(64);
const preparedConfirmation = {
  actionIntentId: intentId,
  status: "PREPARED" as const,
  draftId,
  draftVersion: 3,
  classroom: { id: classroomId, name: "七年一班" },
  dueAt: newYorkDueAt,
  payloadHash,
  expiresAt: "2026-08-18T12:10:00.000Z",
  content: {
    schemaVersion: 1,
    title: "校园节水行动",
    summary: "观察并解释校园水表变化",
    learningObjectives: ["使用数据支持结论"],
    taskInstructions: "记录两次水表读数。",
    evidenceRequirements: ["包含时间与读数"],
    feedbackCriteria: ["证据与结论一致"],
  },
};
const initialPreparationState: PublishPreparationState = {
  status: "idle",
  message: "",
  confirmation: null,
  selectedClassroomId: classroomId,
  dueAtInstant: "",
  nextPrepareIdempotencyKey: "prepare_publish_request_001",
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
    draftId,
    expectedDraftVersion: "3",
    classroomId,
    dueAt: newYorkDueAt,
    idempotencyKey: "prepare_publish_request_001",
    ...overrides,
  });
}

function confirmForm(overrides?: Record<string, string>): FormData {
  return formData({
    actionIntentId: intentId,
    decision: "CONFIRM",
    idempotencyKey: "publish_activity_request_001",
    ...overrides,
  });
}

describe("teacher activity publish server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDatabaseClient.mockReturnValue(mocks.database);
    mocks.createUiCommandContext.mockResolvedValue(trustedContext);
    mocks.preparePublish.mockResolvedValue({
      actionIntentId: intentId,
      draftId,
      expectedDraftVersion: 3,
      payloadHash,
      expiresAt: "2026-08-18T12:10:00.000Z",
    });
    mocks.getConfirmation.mockResolvedValue(preparedConfirmation);
    mocks.decideIntent.mockResolvedValue({
      actionIntentId: intentId,
      status: "CONFIRMED",
      decidedAt: new Date("2026-08-18T12:01:00.000Z"),
    });
    mocks.publishRelease.mockResolvedValue({
      releaseId,
      snapshotHash: "b".repeat(64),
      publishedAt: "2026-08-18T12:01:00.000Z",
    });
  });

  it("passes a non-Taipei browser instant unchanged through trusted UI context", async () => {
    vi.stubEnv("AI_PROVIDER_DISABLED", "true");
    const result = await preparePublishActivityAction(
      initialPreparationState,
      prepareForm(),
    );

    expect(mocks.preparePublish).toHaveBeenCalledWith(
      mocks.database,
      trustedContext,
      {
        draftId,
        expectedDraftVersion: 3,
        classroomId,
        dueAt: newYorkDueAt,
        agentRunId: null,
        idempotencyKey: "prepare_publish_request_001",
      },
    );
    expect(mocks.getConfirmation).toHaveBeenCalledWith(
      mocks.database,
      trustedContext,
      { actionIntentId: intentId },
    );
    expect(result).toMatchObject({
      status: "prepared",
      confirmation: {
        actionIntentId: intentId,
        payloadHash,
        content: { title: "校园节水行动" },
      },
    });
    expect(result.confirmation?.publishIdempotencyKey).toMatch(
      /^publish_activity_[0-9a-f-]{36}$/,
    );
    vi.unstubAllEnvs();
  });

  it("rejects injected or duplicate prepare fields before authentication", async () => {
    const injected = await preparePublishActivityAction(
      initialPreparationState,
      prepareForm({ actorId }),
    );
    const duplicatedForm = prepareForm();
    duplicatedForm.append("dueAt", newYorkDueAt);
    const duplicated = await preparePublishActivityAction(
      initialPreparationState,
      duplicatedForm,
    );
    const missingForm = prepareForm();
    missingForm.delete("dueAt");
    const missing = await preparePublishActivityAction(
      initialPreparationState,
      missingForm,
    );

    expect(injected.status).toBe("validation_error");
    expect(duplicated.status).toBe("validation_error");
    expect(missing.status).toBe("validation_error");
    expect(mocks.createUiCommandContext).not.toHaveBeenCalled();
    expect(mocks.preparePublish).not.toHaveBeenCalled();
  });

  it("rejects an offset-free deadline before authentication", async () => {
    const result = await preparePublishActivityAction(
      initialPreparationState,
      prepareForm({ dueAt: "2026-08-31T23:59" }),
    );

    expect(result.status).toBe("validation_error");
    expect(mocks.createUiCommandContext).not.toHaveBeenCalled();
    expect(mocks.preparePublish).not.toHaveBeenCalled();
  });

  it("keeps classroom and due time visible when the draft version is stale", async () => {
    mocks.preparePublish.mockRejectedValue(
      new PreparePublishActivityIntentError("STALE_VERSION"),
    );
    const result = await preparePublishActivityAction(
      initialPreparationState,
      prepareForm(),
    );

    expect(result).toMatchObject({
      status: "conflict",
      selectedClassroomId: classroomId,
      dueAtInstant: newYorkDueAt,
      confirmation: null,
    });
  });

  it("does not present an expired idempotent preparation as confirmable", async () => {
    mocks.preparePublish.mockResolvedValue({
      actionIntentId: intentId,
      draftId,
      expectedDraftVersion: 3,
      payloadHash,
      expiresAt: "2026-08-18T11:59:59.999Z",
    });
    mocks.getConfirmation.mockResolvedValue({
      ...preparedConfirmation,
      expiresAt: "2026-08-18T11:59:59.999Z",
    });

    const result = await preparePublishActivityAction(
      initialPreparationState,
      prepareForm(),
    );

    expect(result).toMatchObject({
      status: "conflict",
      confirmation: null,
      selectedClassroomId: classroomId,
      dueAtInstant: newYorkDueAt,
    });
    expect(result.message).toContain("已过期或已被处理");
    expect(result.nextPrepareIdempotencyKey).not.toBe(
      initialPreparationState.nextPrepareIdempotencyKey,
    );
    expect(mocks.decideIntent).not.toHaveBeenCalled();
    expect(mocks.publishRelease).not.toHaveBeenCalled();
  });

  it("does not present an already decided preparation as confirmable", async () => {
    mocks.getConfirmation.mockResolvedValue({
      ...preparedConfirmation,
      status: "CONFIRMED",
    });

    const result = await preparePublishActivityAction(
      initialPreparationState,
      prepareForm(),
    );

    expect(result.status).toBe("conflict");
    expect(result.confirmation).toBeNull();
    expect(mocks.publishRelease).not.toHaveBeenCalled();
  });

  it("confirms before publishing with the exact idempotency key", async () => {
    const result = await decidePublishActivityAction(
      initialPublishDecisionState,
      confirmForm(),
    );

    expect(mocks.decideIntent).toHaveBeenCalledWith(
      mocks.database,
      trustedContext,
      { actionIntentId: intentId, decision: "CONFIRM" },
    );
    expect(mocks.publishRelease).toHaveBeenCalledWith(
      mocks.database,
      trustedContext,
      {
        actionIntentId: intentId,
        idempotencyKey: "publish_activity_request_001",
      },
    );
    expect(mocks.decideIntent.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.publishRelease.mock.invocationCallOrder[0]!,
    );
    expect(result).toEqual({
      status: "published",
      message: "活动已发布，学生将读取不可变发布快照。",
      releaseId,
    });
  });

  it("rejects injected confirm fields before authentication", async () => {
    const injected = await decidePublishActivityAction(
      initialPublishDecisionState,
      confirmForm({ actorId }),
    );
    const duplicated = confirmForm();
    duplicated.append("actionIntentId", intentId);
    const duplicateResult = await decidePublishActivityAction(
      initialPublishDecisionState,
      duplicated,
    );

    expect(injected.status).toBe("error");
    expect(duplicateResult.status).toBe("error");
    expect(mocks.createUiCommandContext).not.toHaveBeenCalled();
    expect(mocks.decideIntent).not.toHaveBeenCalled();
    expect(mocks.publishRelease).not.toHaveBeenCalled();
  });

  it("replays publish after ALREADY_DECIDED and does not create a second intent", async () => {
    mocks.decideIntent.mockRejectedValue(
      new DecideActionIntentError("ALREADY_DECIDED"),
    );
    const result = await decidePublishActivityAction(
      initialPublishDecisionState,
      confirmForm(),
    );

    expect(mocks.publishRelease).toHaveBeenCalledOnce();
    expect(mocks.publishRelease).toHaveBeenCalledWith(
      mocks.database,
      trustedContext,
      expect.objectContaining({
        actionIntentId: intentId,
        idempotencyKey: "publish_activity_request_001",
      }),
    );
    expect(mocks.preparePublish).not.toHaveBeenCalled();
    expect(result.status).toBe("published");
  });

  it("rejects the prepared intent without publishing", async () => {
    const result = await decidePublishActivityAction(
      initialPublishDecisionState,
      formData({ actionIntentId: intentId, decision: "REJECT" }),
    );

    expect(mocks.decideIntent).toHaveBeenCalledWith(
      mocks.database,
      trustedContext,
      { actionIntentId: intentId, decision: "REJECT" },
    );
    expect(mocks.publishRelease).not.toHaveBeenCalled();
    expect(result.status).toBe("rejected");
  });
});
