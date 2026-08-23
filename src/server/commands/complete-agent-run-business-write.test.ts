import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "../../generated/prisma/client";
import { completeAgentRunBusinessWrite } from "./complete-agent-run-business-write";

vi.mock("server-only", () => ({}));

const actorId = "10000000-0000-4000-8000-000000000001";
const runId = "20000000-0000-4000-8000-000000000002";
const now = new Date("2026-08-20T04:00:00.000Z");
const mocks = {
  updateMany: vi.fn(),
  findUnique: vi.fn(),
};

function transaction(): Prisma.TransactionClient {
  return {
    agentRun: {
      updateMany: mocks.updateMany,
      findUnique: mocks.findUnique,
    },
  } as unknown as Prisma.TransactionClient;
}

describe("completeAgentRunBusinessWrite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it("keeps UI provenance empty without touching AgentRun state", async () => {
    await expect(
      completeAgentRunBusinessWrite(
        transaction(),
        { actorId, source: "UI", now },
        null,
      ),
    ).resolves.toBe(true);
    await expect(
      completeAgentRunBusinessWrite(
        transaction(),
        { actorId, source: "UI", now },
        runId,
      ),
    ).resolves.toBe(false);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("atomically advances the actor-owned RUNNING run to SUCCEEDED", async () => {
    await expect(
      completeAgentRunBusinessWrite(
        transaction(),
        { actorId, source: "AGENT", now },
        runId,
      ),
    ).resolves.toBe(true);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: runId, actorId, status: "RUNNING" },
      data: { status: "SUCCEEDED", completedAt: now, failureCode: null },
    });
  });

  it("accepts only an exact prior success as an idempotent replay", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockResolvedValue({
      actorId,
      status: "SUCCEEDED",
      completedAt: now,
      failureCode: null,
    });
    await expect(
      completeAgentRunBusinessWrite(
        transaction(),
        { actorId, source: "AGENT", now },
        runId,
      ),
    ).resolves.toBe(false);
    expect(mocks.findUnique).not.toHaveBeenCalled();

    await expect(
      completeAgentRunBusinessWrite(
        transaction(),
        { actorId, source: "AGENT", now },
        runId,
        { allowAlreadySucceeded: true },
      ),
    ).resolves.toBe(true);

    for (const invalid of [
      null,
      { actorId: crypto.randomUUID(), status: "SUCCEEDED", completedAt: now, failureCode: null },
      { actorId, status: "SUCCEEDED", completedAt: null, failureCode: null },
      { actorId, status: "FAILED", completedAt: now, failureCode: "FAILED" },
      { actorId, status: "CANCELLED", completedAt: now, failureCode: "CANCELLED" },
    ]) {
      mocks.findUnique.mockResolvedValueOnce(invalid);
      await expect(
        completeAgentRunBusinessWrite(
          transaction(),
          { actorId, source: "AGENT", now },
          runId,
          { allowAlreadySucceeded: true },
        ),
      ).resolves.toBe(false);
    }
  });
});
