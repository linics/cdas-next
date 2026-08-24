import { beforeEach, describe, expect, it, vi } from "vitest";
import { waterConservationTaskBook } from "../../../fixtures/water-conservation";
import { emptyActivityDraftValues, normalizeTaskBookValues } from "./activity-draft-action-state";

const mocks = vi.hoisted(() => ({
  database: { kind: "activity-action-database" },
  getDatabaseClient: vi.fn(),
  createUiCommandContext: vi.fn(),
  saveDraft: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
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
vi.mock(
  "../../../server/commands/save-activity-draft",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("../../../server/commands/save-activity-draft")
    >();
    return { ...actual, saveActivityDraft: mocks.saveDraft };
  },
);

import { AuthenticationError } from "../../../server/auth/current-actor";
import { SaveActivityDraftError } from "../../../server/commands/save-activity-draft";
import { saveActivityDraftAction } from "./actions";

const draftId = "10000000-0000-4000-8000-000000000001";
const actorId = "20000000-0000-4000-8000-000000000002";
const trustedContext = {
  actorId,
  source: "UI" as const,
  traceId: "trusted-draft-ui-trace",
  clock: () => new Date("2026-08-18T12:00:00.000Z"),
};
const initialState = {
  status: "idle" as const,
  message: "",
  values: emptyActivityDraftValues,
  draftId: null,
  expectedVersion: null,
  persistedStatus: null,
  nextIdempotencyKey: "save_activity_request_001",
};

function formData(overrides?: Record<string, string>): FormData {
  const { title: requestedTitle, ...formOverrides } = overrides ?? {};
  const taskBook = {
    ...waterConservationTaskBook,
    title: requestedTitle ?? waterConservationTaskBook.title,
  };
  const values = {
    draftId: "",
    expectedVersion: "",
    desiredStatus: "EDITING",
    content: JSON.stringify(taskBook),
    idempotencyKey: "save_activity_request_001",
    ...formOverrides,
  };
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    data.set(key, value);
  }
  return data;
}

describe("teacher activity draft server action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDatabaseClient.mockReturnValue(mocks.database);
    mocks.createUiCommandContext.mockResolvedValue(trustedContext);
    mocks.saveDraft.mockResolvedValue({
      draftId,
      revisionId: "30000000-0000-4000-8000-000000000003",
      version: 1,
      status: "EDITING",
      savedAt: "2026-08-18T12:00:00.000Z",
    });
  });

  it("uses only trusted context and maps the complete v2 task book", async () => {
    vi.stubEnv("AI_PROVIDER_DISABLED", "true");
    const result = await saveActivityDraftAction(
      initialState,
      formData(),
    );

    expect(mocks.createUiCommandContext).toHaveBeenCalledWith();
    expect(mocks.saveDraft).toHaveBeenCalledWith(
      mocks.database,
      trustedContext,
      {
        draftId: null,
        expectedVersion: null,
        desiredStatus: "EDITING",
        content: normalizeTaskBookValues(waterConservationTaskBook),
        agentRunId: null,
        idempotencyKey: "save_activity_request_001",
      },
    );
    expect(result).toMatchObject({
      status: "success",
      draftId,
      expectedVersion: 1,
      persistedStatus: "EDITING",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/teacher");
    vi.unstubAllEnvs();
  });

  it("rejects injected and duplicate fields before authentication", async () => {
    const injected = formData({ actorId });
    const injectedState = await saveActivityDraftAction(
      initialState,
      injected,
    );
    const duplicated = formData();
    duplicated.append("content", "{}");
    const duplicatedState = await saveActivityDraftAction(
      initialState,
      duplicated,
    );

    expect(injectedState.status).toBe("validation_error");
    expect(duplicatedState.status).toBe("validation_error");
    expect(mocks.createUiCommandContext).not.toHaveBeenCalled();
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });

  it("preserves submitted values when the expected version is stale", async () => {
    mocks.saveDraft.mockRejectedValue(
      new SaveActivityDraftError("STALE_VERSION"),
    );
    const result = await saveActivityDraftAction(
      {
        ...initialState,
        draftId,
        expectedVersion: 4,
        persistedStatus: "EDITING",
      },
      formData({
        draftId,
        expectedVersion: "4",
        title: "尚未保存的页面标题",
      }),
    );

    expect(result).toMatchObject({
      status: "conflict",
      values: { title: "尚未保存的页面标题" },
      draftId,
      expectedVersion: 4,
    });
    expect(result.message).toContain("页面输入仍然保留");
  });

  it("does not call a command when the Clerk session is unavailable", async () => {
    mocks.createUiCommandContext.mockRejectedValue(
      new AuthenticationError("UNAUTHENTICATED"),
    );
    const result = await saveActivityDraftAction(
      initialState,
      formData(),
    );

    expect(result.status).toBe("unauthorized");
    expect(mocks.getDatabaseClient).not.toHaveBeenCalled();
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });
});
