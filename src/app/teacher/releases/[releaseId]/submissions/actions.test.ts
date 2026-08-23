import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  database: { kind: "close-release-actions-database" },
  getDatabaseClient: vi.fn(),
  createUiCommandContext: vi.fn(),
  prepareClose: vi.fn(),
  decideIntent: vi.fn(),
  closeRelease: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("../../../../../server/db/client", () => ({
  getDatabaseClient: mocks.getDatabaseClient,
}));
vi.mock(
  "../../../../../server/commands/create-ui-command-context",
  () => ({ createUiCommandContext: mocks.createUiCommandContext }),
);
vi.mock("../../../../../server/commands/prepare-close-activity-intent", () => {
  class PrepareCloseActivityIntentError extends Error {
    constructor(public readonly code: string) {
      super(code);
      this.name = "PrepareCloseActivityIntentError";
    }
  }
  return {
    prepareCloseActivityIntent: mocks.prepareClose,
    PrepareCloseActivityIntentError,
  };
});
vi.mock("../../../../../server/commands/close-activity-release", () => {
  class CloseActivityReleaseError extends Error {
    constructor(public readonly code: string) {
      super(code);
      this.name = "CloseActivityReleaseError";
    }
  }
  return { closeActivityRelease: mocks.closeRelease, CloseActivityReleaseError };
});
vi.mock("../../../../../server/commands/decide-action-intent", () => {
  class DecideActionIntentError extends Error {
    constructor(public readonly code: string) {
      super(code);
      this.name = "DecideActionIntentError";
    }
  }
  return { decideActionIntent: mocks.decideIntent, DecideActionIntentError };
});

import {
  decideCloseActivityAction,
  prepareCloseActivityAction,
} from "./actions";
import { initialCloseActivityActionState } from "./close-activity-action-state";

const releaseId = "10000000-0000-4000-8000-000000000001";
const intentId = "20000000-0000-4000-8000-000000000002";
const context = {
  actorId: "30000000-0000-4000-8000-000000000003",
  source: "UI" as const,
  traceId: "close-ui-test",
  clock: () => new Date("2026-08-20T12:00:00.000Z"),
};

function formData(entries: Record<string, string>): FormData {
  const form = new FormData();
  Object.entries(entries).forEach(([key, value]) => form.append(key, value));
  return form;
}

describe("teacher close activity server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDatabaseClient.mockReturnValue(mocks.database);
    mocks.createUiCommandContext.mockResolvedValue(context);
    mocks.prepareClose.mockResolvedValue({
      actionIntentId: intentId,
      releaseId,
      classroomName: "七年一班",
      payloadHash: "a".repeat(64),
      expiresAt: "2026-08-20T12:10:00.000Z",
    });
    mocks.closeRelease.mockResolvedValue({
      releaseId,
      status: "CLOSED",
      closedAt: "2026-08-20T12:01:00.000Z",
    });
  });

  it("prepares only an ACTIVE release with the server-owned UI context", async () => {
    const state = await prepareCloseActivityAction(
      initialCloseActivityActionState,
      formData({
        releaseId,
        expectedStatus: "ACTIVE",
        idempotencyKey: "prepare_close_activity_test",
      }),
    );

    expect(state.status).toBe("prepared");
    expect(state.confirmation).toMatchObject({
      actionIntentId: intentId,
      releaseId,
      classroomName: "七年一班",
      impact: expect.stringContaining("停止"),
    });
    expect(mocks.prepareClose).toHaveBeenCalledWith(mocks.database, context, {
      releaseId,
      expectedStatus: "ACTIVE",
      idempotencyKey: "prepare_close_activity_test",
    });
  });

  it.each([
    ["duplicate release id", "releaseId", releaseId],
    ["injected actor", "actorId", context.actorId],
    ["injected source", "source", "AGENT"],
    ["injected clock", "now", "2026-08-20T12:00:00.000Z"],
  ])("rejects %s before authenticating or writing", async (_label, field, value) => {
    const form = formData({
      releaseId,
      expectedStatus: "ACTIVE",
      idempotencyKey: "prepare_close_activity_test",
    });
    form.append(field, value);

    const state = await prepareCloseActivityAction(
      initialCloseActivityActionState,
      form,
    );

    expect(state.status).toBe("validation_error");
    expect(mocks.createUiCommandContext).not.toHaveBeenCalled();
    expect(mocks.prepareClose).not.toHaveBeenCalled();
  });

  it("rejecting an intent never invokes the close command", async () => {
    const state = await decideCloseActivityAction(
      initialCloseActivityActionState,
      formData({ actionIntentId: intentId, decision: "REJECT" }),
    );

    expect(state.status).toBe("rejected");
    expect(mocks.decideIntent).toHaveBeenCalledWith(mocks.database, context, {
      actionIntentId: intentId,
      decision: "REJECT",
    });
    expect(mocks.closeRelease).not.toHaveBeenCalled();
  });

  it("only replays ALREADY_DECIDED through the same close idempotency key", async () => {
    const { DecideActionIntentError } = await import(
      "../../../../../server/commands/decide-action-intent"
    );
    mocks.decideIntent.mockRejectedValue(
      new DecideActionIntentError("ALREADY_DECIDED"),
    );

    const state = await decideCloseActivityAction(
      initialCloseActivityActionState,
      formData({
        actionIntentId: intentId,
        decision: "CONFIRM",
        idempotencyKey: "close_activity_replay_test",
      }),
    );

    expect(state.status).toBe("closed");
    expect(mocks.closeRelease).toHaveBeenCalledWith(mocks.database, context, {
      actionIntentId: intentId,
      idempotencyKey: "close_activity_replay_test",
    });
  });
});
