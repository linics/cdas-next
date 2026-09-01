import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";

vi.mock("server-only", () => ({}));

import {
  AgentRunLifecycleError,
  finishActivityAssistantRun,
  startActivityAssistantRun,
} from "./agent-run-lifecycle";

const actorId = "10000000-0000-4000-8000-000000000001";
const runId = "20000000-0000-4000-8000-000000000002";
const now = new Date("2026-08-20T04:00:00.000Z");
const uiContext = {
  actorId,
  source: "UI" as const,
  traceId: "assistant-start-trace",
  clock: () => now,
};
const agentContext = {
  actorId,
  source: "AGENT" as const,
  traceId: "assistant-finish-trace",
  clock: () => now,
};

const mocks = {
  findActor: vi.fn(),
  createRun: vi.fn(),
  updateRuns: vi.fn(),
  findRun: vi.fn(),
};

function database(): PrismaClient {
  return {
    appUser: { findUnique: mocks.findActor },
    agentRun: {
      create: mocks.createRun,
      updateMany: mocks.updateRuns,
      findUnique: mocks.findRun,
    },
  } as unknown as PrismaClient;
}

describe("activity assistant AgentRun lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findActor.mockResolvedValue({
      role: "TEACHER",
      accountStatus: "ACTIVE",
      schoolId: "30000000-0000-4000-8000-000000000003",
      school: { status: "ACTIVE" },
    });
    mocks.createRun.mockResolvedValue({
      id: runId,
      actorId,
      status: "RUNNING",
      model: "openai/gpt-5-mini",
      startedAt: now,
    });
    mocks.updateRuns.mockResolvedValue({ count: 1 });
  });

  it("opens an owned RUNNING record without prompt or content fields", async () => {
    const result = await startActivityAssistantRun(database(), uiContext, {
      model: "openai/gpt-5-mini",
    });

    expect(result).toMatchObject({
      id: runId,
      actorId,
      status: "RUNNING",
      startedAt: now.toISOString(),
    });
    expect(mocks.createRun).toHaveBeenCalledWith({
      data: {
        actorId,
        status: "RUNNING",
        model: "openai/gpt-5-mini",
        startedAt: now,
      },
      select: expect.any(Object),
    });
    expect(JSON.stringify(mocks.createRun.mock.calls[0])).not.toContain(
      "prompt",
    );
    expect(JSON.stringify(mocks.createRun.mock.calls[0])).not.toContain(
      "content",
    );
  });

  it("rejects a student before creating provenance", async () => {
    mocks.findActor.mockResolvedValue({
      role: "STUDENT",
      accountStatus: "ACTIVE",
      schoolId: "30000000-0000-4000-8000-000000000003",
      school: { status: "ACTIVE" },
    });

    await expect(
      startActivityAssistantRun(database(), uiContext, {
        model: "openai/gpt-5-mini",
      }),
    ).rejects.toEqual(new AgentRunLifecycleError("FORBIDDEN"));
    expect(mocks.createRun).not.toHaveBeenCalled();
  });

  it("finishes only the actor-owned RUNNING row with a truthful state", async () => {
    const result = await finishActivityAssistantRun(
      database(),
      agentContext,
      {
        agentRunId: runId,
        status: "FAILED",
        failureCode: "MODEL_STREAM_FAILED",
      },
    );

    expect(result).toEqual({
      id: runId,
      actorId,
      status: "FAILED",
      completedAt: now.toISOString(),
      failureCode: "MODEL_STREAM_FAILED",
    });
    expect(mocks.updateRuns).toHaveBeenCalledWith({
      where: { id: runId, actorId, status: "RUNNING" },
      data: {
        status: "FAILED",
        completedAt: now,
        failureCode: "MODEL_STREAM_FAILED",
      },
    });
  });

  it("does not rewrite another terminal result", async () => {
    mocks.updateRuns.mockResolvedValue({ count: 0 });
    mocks.findRun.mockResolvedValue({
      actorId,
      status: "FAILED",
      completedAt: now,
      failureCode: "MODEL_STREAM_FAILED",
    });

    await expect(
      finishActivityAssistantRun(database(), agentContext, {
        agentRunId: runId,
        status: "SUCCEEDED",
        failureCode: null,
      }),
    ).rejects.toEqual(new AgentRunLifecycleError("ALREADY_FINISHED"));
  });
});
