import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import type { CommandContext } from "../commands/command-context";

vi.mock("server-only", () => ({}));

import { getTeacherReleaseDiagnosis } from "./teacher-release-diagnosis";

const ACTOR_ID = "50000000-0000-4000-8000-000000000005";
const RELEASE_ID = "60000000-0000-4000-8000-000000000006";

function context(source: CommandContext["source"] = "UI"): CommandContext {
  return {
    actorId: ACTOR_ID,
    source,
    traceId: "release-diagnosis-trace",
    clock: () => new Date("2026-10-02T04:00:00.000Z"),
  };
}

describe("teacher release diagnosis query boundary", () => {
  it("refuses the Agent source before touching the database", async () => {
    const findFirst = vi.fn();
    const database = { activityRelease: { findFirst } } as unknown as PrismaClient;

    // The diagnosis names students; the Agent keeps D-051's counts-only read.
    await expect(
      getTeacherReleaseDiagnosis(database, context("AGENT"), { releaseId: RELEASE_ID }),
    ).rejects.toThrow("Command source AGENT is not allowed");
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("scopes the read to releases the actor published and still manages", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const database = { activityRelease: { findFirst } } as unknown as PrismaClient;

    await expect(
      getTeacherReleaseDiagnosis(database, context(), { releaseId: RELEASE_ID }),
    ).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledOnce();
    expect(findFirst.mock.calls[0]?.[0].where).toEqual({
      id: RELEASE_ID,
      publisherId: ACTOR_ID,
      classroom: { managerId: ACTOR_ID },
    });
  });

  it("rejects malformed input", async () => {
    const database = {
      activityRelease: { findFirst: vi.fn() },
    } as unknown as PrismaClient;
    await expect(
      getTeacherReleaseDiagnosis(database, context(), { releaseId: "not-a-uuid" }),
    ).rejects.toThrow();
    await expect(
      getTeacherReleaseDiagnosis(database, context(), {
        releaseId: RELEASE_ID,
        studentId: ACTOR_ID,
      }),
    ).rejects.toThrow();
  });
});
