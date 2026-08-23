import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import type { PrismaClient } from "../../generated/prisma/client";
import type { CommandContext } from "../commands/command-context";

vi.mock("server-only", () => ({}));

import {
  listStudentReleases,
  StudentReleaseListQueryError,
} from "./student-releases";

function context(source: CommandContext["source"]): CommandContext {
  return {
    actorId: randomUUID(),
    source,
    traceId: randomUUID(),
    clock: () => new Date("2026-08-18T12:00:00.000Z"),
  };
}

function databaseDouble(options?: { role?: "STUDENT" | "TEACHER" }) {
  const appUserFindFirst = vi.fn().mockResolvedValue(
    options?.role === "TEACHER" ? null : { id: randomUUID() },
  );
  const releaseFindMany = vi.fn().mockResolvedValue([]);
  const database = {
    appUser: { findFirst: appUserFindFirst },
    activityRelease: { findMany: releaseFindMany },
  } as unknown as PrismaClient;
  return { database, appUserFindFirst, releaseFindMany };
}

describe("listStudentReleases input and role boundary", () => {
  it("rejects a widened empty input before querying the database", async () => {
    const fake = databaseDouble();

    await expect(
      listStudentReleases(
        fake.database,
        context("UI"),
        { releaseId: randomUUID() } as never,
      ),
    ).rejects.toBeInstanceOf(ZodError);
    expect(fake.appUserFindFirst).not.toHaveBeenCalled();
    expect(fake.releaseFindMany).not.toHaveBeenCalled();
  });

  it("accepts AGENT reads for a student and returns an empty safe list", async () => {
    const fake = databaseDouble();

    await expect(
      listStudentReleases(fake.database, context("AGENT"), {}),
    ).resolves.toEqual({ releases: [] });
    expect(fake.releaseFindMany).toHaveBeenCalledOnce();
  });

  it("returns not found for non-students without scanning releases", async () => {
    const fake = databaseDouble({ role: "TEACHER" });

    await expect(
      listStudentReleases(fake.database, context("UI"), {}),
    ).rejects.toEqual(new StudentReleaseListQueryError("NOT_FOUND"));
    expect(fake.releaseFindMany).not.toHaveBeenCalled();
  });

  it("rejects SYSTEM as an unsupported read source", async () => {
    const fake = databaseDouble();

    await expect(
      listStudentReleases(fake.database, context("SYSTEM"), {}),
    ).rejects.toThrow("Command source SYSTEM is not allowed");
    expect(fake.appUserFindFirst).not.toHaveBeenCalled();
  });
});
