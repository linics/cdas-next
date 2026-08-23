import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityContent } from "../../domain/activity/activity-content";
import type { PrismaClient } from "../../generated/prisma/client";
import { DecideActionIntentError } from "../commands/decide-action-intent";
import { PreparePublishActivityIntentError } from "../commands/prepare-publish-activity-intent";
import type { CommandContext } from "../commands/command-context";
import { createActivityAssistantTools } from "./activity-assistant-tools";

vi.mock("server-only", () => ({}));

const actorId = "10000000-0000-4000-8000-000000000001";
const runId = "20000000-0000-4000-8000-000000000002";
const draftId = "30000000-0000-4000-8000-000000000003";
const classroomId = "40000000-0000-4000-8000-000000000004";
const intentId = "50000000-0000-4000-8000-000000000005";
const releaseId = "60000000-0000-4000-8000-000000000006";
const revisionId = "70000000-0000-4000-8000-000000000007";
const now = new Date("2026-08-20T04:00:00.000Z");

const agentContext: CommandContext = {
  actorId,
  source: "AGENT",
  traceId: "agent-tool-trace",
  clock: () => now,
};
const approvalContext: CommandContext = {
  actorId,
  source: "UI",
  traceId: "approval-tool-trace",
  clock: () => now,
};
const content: ActivityContent = {
  schemaVersion: 1,
  title: "校園節水行動",
  summary: "記錄水表並提出改善建議",
  learningObjectives: ["使用資料支持結論"],
  taskInstructions: "記錄兩次水表讀數並解釋差異。",
  evidenceRequirements: ["時間與讀數"],
  feedbackCriteria: ["證據與建議一致"],
};

const mocks = {
  saveDraft: vi.fn(),
  preparePublish: vi.fn(),
  decideIntent: vi.fn(),
  publishRelease: vi.fn(),
  onToolFailure: vi.fn(),
  onBusinessWriteSuccess: vi.fn(),
};

function database(): PrismaClient {
  return { kind: "assistant-tools-database" } as unknown as PrismaClient;
}

function options(toolCallId: string) {
  return {
    toolCallId,
    messages: [],
    context: {},
  };
}

function tools() {
  return createActivityAssistantTools({
    database: database(),
    agentContext,
    approvalContext,
    agentRunId: runId,
    onToolFailure: mocks.onToolFailure,
    onBusinessWriteSuccess: mocks.onBusinessWriteSuccess,
    commands: {
      saveDraft: mocks.saveDraft,
      preparePublish: mocks.preparePublish,
      decideIntent: mocks.decideIntent,
      publishRelease: mocks.publishRelease,
    },
  });
}

describe("activity assistant tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saveDraft.mockResolvedValue({
      draftId,
      revisionId,
      version: 1,
      status: "READY_FOR_PREVIEW",
      savedAt: now.toISOString(),
    });
    mocks.preparePublish.mockResolvedValue({
      actionIntentId: intentId,
      draftId,
      expectedDraftVersion: 1,
      payloadHash: "a".repeat(64),
      expiresAt: "2026-08-20T04:10:00.000Z",
    });
    mocks.decideIntent.mockResolvedValue({
      actionIntentId: intentId,
      status: "CONFIRMED",
      decidedAt: now,
    });
    mocks.publishRelease.mockResolvedValue({
      releaseId,
      snapshotHash: "b".repeat(64),
      publishedAt: now.toISOString(),
    });
  });

  it("creates a READY draft through the shared command with AGENT provenance", async () => {
    const registry = tools();
    const result = await registry.create_activity_draft.execute!(
      content,
      options("draft_call_1"),
    );

    expect(mocks.saveDraft).toHaveBeenCalledWith(
      expect.anything(),
      agentContext,
      expect.objectContaining({
        draftId: null,
        expectedVersion: null,
        desiredStatus: "READY_FOR_PREVIEW",
        content,
        agentRunId: runId,
      }),
    );
    expect(result).toEqual({
      draftId,
      version: 1,
      status: "READY_FOR_PREVIEW",
      editHref: `/teacher/activities/${draftId}`,
      previewHref: `/teacher/activities/${draftId}/preview`,
    });
    expect(mocks.onBusinessWriteSuccess).toHaveBeenCalledWith("DRAFT_SAVED");
  });

  it("keeps a committed draft authoritative when response mapping fails", async () => {
    mocks.saveDraft.mockResolvedValue({
      draftId,
      revisionId,
      version: 0,
      status: "READY_FOR_PREVIEW",
      savedAt: now.toISOString(),
    });
    const registry = tools();

    await expect(
      registry.create_activity_draft.execute!(
        content,
        options("draft_call_bad_response"),
      ),
    ).rejects.toThrow("ACTIVITY_DRAFT_COMMAND_FAILED");

    expect(mocks.saveDraft).toHaveBeenCalledTimes(1);
    expect(mocks.onBusinessWriteSuccess).toHaveBeenCalledWith("DRAFT_SAVED");
    expect(mocks.onToolFailure).toHaveBeenCalledWith("DRAFT_COMMAND_FAILED");
  });

  it("allows command replay of one call but rejects a second create call", async () => {
    const registry = tools();

    await registry.create_activity_draft.execute!(
      content,
      options("draft_call_same"),
    );
    await registry.create_activity_draft.execute!(
      content,
      options("draft_call_same"),
    );
    await expect(
      registry.create_activity_draft.execute!(
        content,
        options("draft_call_different"),
      ),
    ).rejects.toThrow("ACTIVITY_DRAFT_MULTIPLE_CREATE_ATTEMPTS");

    expect(mocks.saveDraft).toHaveBeenCalledTimes(2);
    expect(mocks.onToolFailure).toHaveBeenCalledWith(
      "DRAFT_MULTIPLE_CREATE_ATTEMPTS",
    );
  });

  it("publishes only through prepare, first-party decision, then publish", async () => {
    const order: string[] = [];
    mocks.preparePublish.mockImplementation(async () => {
      order.push("prepare");
      return {
        actionIntentId: intentId,
        draftId,
        expectedDraftVersion: 1,
        payloadHash: "a".repeat(64),
        expiresAt: "2026-08-20T04:10:00.000Z",
      };
    });
    mocks.decideIntent.mockImplementation(async () => {
      order.push("decide");
      return { actionIntentId: intentId, status: "CONFIRMED", decidedAt: now };
    });
    mocks.publishRelease.mockImplementation(async () => {
      order.push("publish");
      return {
        releaseId,
        snapshotHash: "b".repeat(64),
        publishedAt: now.toISOString(),
      };
    });
    const registry = tools();

    await expect(
      registry.publish_activity_release.execute!(
        {
          draftId,
          expectedDraftVersion: 1,
          classroomId,
          dueAt: null,
        },
        options("publish_call_1"),
      ),
    ).resolves.toMatchObject({ releaseId, status: "PUBLISHED" });

    expect(order).toEqual(["prepare", "decide", "publish"]);
    expect(mocks.preparePublish.mock.calls[0]?.[1]).toBe(agentContext);
    expect(mocks.preparePublish.mock.calls[0]?.[2]).toMatchObject({
      agentRunId: runId,
    });
    expect(mocks.decideIntent).toHaveBeenCalledWith(
      expect.anything(),
      approvalContext,
      { actionIntentId: intentId, decision: "CONFIRM" },
    );
    expect(mocks.onBusinessWriteSuccess).toHaveBeenCalledWith(
      "RELEASE_PUBLISHED",
    );
  });

  it("keeps a committed publish authoritative when response mapping fails", async () => {
    mocks.publishRelease.mockResolvedValue({
      releaseId,
      snapshotHash: "b".repeat(64),
      publishedAt: "not-an-iso-instant",
    });
    const registry = tools();

    await expect(
      registry.publish_activity_release.execute!(
        {
          draftId,
          expectedDraftVersion: 1,
          classroomId,
          dueAt: null,
        },
        options("publish_call_bad_response"),
      ),
    ).rejects.toThrow("ACTIVITY_PUBLISH_COMMAND_FAILED");

    expect(mocks.publishRelease).toHaveBeenCalledTimes(1);
    expect(mocks.onBusinessWriteSuccess).toHaveBeenCalledWith(
      "RELEASE_PUBLISHED",
    );
    expect(mocks.onToolFailure).toHaveBeenCalledWith(
      "PUBLISH_COMMAND_FAILED",
    );
  });

  it("continues an already-confirmed retry to the idempotent publish command", async () => {
    mocks.decideIntent
      .mockResolvedValueOnce({
        actionIntentId: intentId,
        status: "CONFIRMED",
        decidedAt: now,
      })
      .mockRejectedValueOnce(new DecideActionIntentError("ALREADY_DECIDED"));
    const registry = tools();
    const input = {
      draftId,
      expectedDraftVersion: 1,
      classroomId,
      dueAt: null,
    };

    const first = await registry.publish_activity_release.execute!(
      input,
      options("publish_call_retry"),
    );
    const replay = await registry.publish_activity_release.execute!(
      input,
      options("publish_call_retry"),
    );

    expect(replay).toEqual(first);
    expect(mocks.publishRelease).toHaveBeenCalledTimes(2);
    expect(new Set(mocks.publishRelease.mock.results.map(() => releaseId))).toEqual(
      new Set([releaseId]),
    );
  });

  it.each([
    new PreparePublishActivityIntentError("NOT_FOUND"),
    new PreparePublishActivityIntentError("STALE_VERSION"),
  ])("fails before confirmation for unauthorized or version-drift input", async (error) => {
    mocks.preparePublish.mockRejectedValue(error);
    const registry = tools();

    await expect(
      registry.publish_activity_release.execute!(
        {
          draftId,
          expectedDraftVersion: 1,
          classroomId,
          dueAt: null,
        },
        options("publish_call_denied"),
      ),
    ).rejects.toThrow(`ACTIVITY_PUBLISH_${error.code}`);
    expect(mocks.decideIntent).not.toHaveBeenCalled();
    expect(mocks.publishRelease).not.toHaveBeenCalled();
  });
});
