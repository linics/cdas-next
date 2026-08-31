import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { Prisma } from "../../generated/prisma/client";
import {
  isRetryableSerializationError,
  isSerializationFailure,
  serializableRetryAttempts,
  serializableRetryDelayMs,
  waitBeforeSerializableRetry,
} from "./serializable-retry";

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("conflict", {
    code,
    clientVersion: "test",
  });
}

describe("serializable retry policy", () => {
  it("separates a serialization failure from a racing idempotency insert", () => {
    // The narrow check is the one a command without an idempotency write must
    // use: for it a P2002 is a real constraint violation, and retrying it would
    // turn a bug into an intermittent success.
    expect(isSerializationFailure(prismaError("P2034"))).toBe(true);
    expect(isSerializationFailure(prismaError("P2002"))).toBe(false);

    expect(isRetryableSerializationError(prismaError("P2034"))).toBe(true);
    expect(isRetryableSerializationError(prismaError("P2002"))).toBe(true);
    expect(isRetryableSerializationError(prismaError("P2025"))).toBe(false);
    expect(isRetryableSerializationError(new Error("boom"))).toBe(false);
  });

  it("waits longer each attempt and never the same amount twice", () => {
    // The growth buys a slow commit time to land; the jitter is what stops two
    // identical requests from colliding again at the same instant, which is the
    // failure this policy exists for.
    expect(serializableRetryDelayMs(1, () => 0)).toBe(20);
    expect(serializableRetryDelayMs(2, () => 0)).toBe(40);
    expect(serializableRetryDelayMs(1, () => 0.999)).toBe(44);

    const floors = [1, 2].map((attempt) => serializableRetryDelayMs(attempt, () => 0));
    const ceilings = [1, 2].map((attempt) =>
      serializableRetryDelayMs(attempt, () => 0.999),
    );
    expect(floors[1]).toBeGreaterThan(floors[0]!);
    // A request that is going to fail anyway may wait; one that succeeds never
    // reaches here. Keep the whole budget well under a tenth of a second.
    expect(ceilings.reduce((total, value) => total + value, 0)).toBeLessThan(150);
  });

  it("sleeps for the computed delay", async () => {
    const slept: number[] = [];
    await waitBeforeSerializableRetry(2, async (ms) => {
      slept.push(ms);
    });

    expect(slept).toHaveLength(1);
    expect(slept[0]).toBeGreaterThanOrEqual(40);
    expect(slept[0]).toBeLessThan(65);
  });

  it("keeps the attempt budget in one place", () => {
    expect(serializableRetryAttempts).toBe(3);
  });
});
